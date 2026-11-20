-- GERADO por gerar-instalar-tudo.sh. Atualiza um banco que já está em uso. Pode rodar mais de uma vez.

-- ===== historico-agenda.sql =====
-- Histórico das movimentações da agenda (base dos avisos do barbeiro). Repetível.
begin;

-- Compatibilidade com instalações que ainda não receberam todos os módulos
-- de agenda e atendimento.
alter table public.bookings add column if not exists attendance_state text not null default 'scheduled';
alter table public.bookings add column if not exists no_show boolean not null default false;
alter table public.bookings add column if not exists no_show_at timestamptz;
alter table public.bookings add column if not exists no_preference boolean not null default false;
alter table public.bookings add column if not exists cancellation_source text;
alter table public.bookings add column if not exists cancellation_reason text;
alter table public.bookings add column if not exists cancelled_at timestamptz;

-- Banco que tinha o painel antigo: preserva o histórico e remove o restante.
alter table if exists public.kryon_booking_events rename to booking_events;
alter index if exists public.kryon_booking_events_time_idx rename to booking_events_time_idx;
drop trigger if exists kryon_booking_audit on public.bookings;
drop function if exists public.record_kryon_booking_event();
drop function if exists public.kryon_dashboard(date,date);
drop function if exists public.track_kryon_usage(text);
drop function if exists public.is_kryon_admin();
drop table if exists public.kryon_usage_events;
drop table if exists public.kryon_admins;

-- Histórico imutável das movimentações da agenda; clientes e funcionários
-- não têm acesso direto a esta tabela.
create table if not exists public.booking_events(
 id bigint generated always as identity primary key,
 booking_id uuid references public.bookings(id) on delete set null,
 event_type text not null check(event_type in ('booking_created','booking_updated','booking_rescheduled','booking_cancelled','client_arrived','attendance_completed','no_show')),
 customer text not null,
 service_name text not null,
 barber_name text not null,
 starts_at timestamp not null,
 snapshot jsonb not null default '{}',
 happened_at timestamptz not null default clock_timestamp()
);
create index if not exists booking_events_time_idx on public.booking_events(happened_at desc,id desc);
alter table public.booking_events enable row level security;
revoke all on public.booking_events from public,anon,authenticated;

create or replace function public.record_booking_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 if tg_op='INSERT' then kind:='booking_created';
 elsif new.status='cancelled' and old.status is distinct from new.status then kind:='booking_cancelled';
 elsif new.starts_at is distinct from old.starts_at or new.barber_id is distinct from old.barber_id then kind:='booking_rescheduled';
 elsif new.attendance_state='completed' and old.attendance_state is distinct from new.attendance_state then kind:='attendance_completed';
 elsif new.attendance_state='arrived' and old.attendance_state is distinct from new.attendance_state then kind:='client_arrived';
 elsif new.no_show and old.no_show is distinct from new.no_show then kind:='no_show';
 else kind:='booking_updated';end if;
 insert into public.booking_events(booking_id,event_type,customer,service_name,barber_name,starts_at,snapshot)
 values(new.id,kind,new.customer,new.service_name,new.barber_name,new.starts_at,jsonb_build_object(
  'status',new.status,'attendance_state',new.attendance_state,'no_preference',new.no_preference,
  'price',new.price,'ends_at',new.ends_at,'cancellation_source',new.cancellation_source,
  'cancellation_reason',new.cancellation_reason));
 return new;
end;$$;
revoke all on function public.record_booking_event() from public;
drop trigger if exists booking_audit on public.bookings;
create trigger booking_audit after insert or update on public.bookings
for each row execute function public.record_booking_event();

-- Os agendamentos anteriores também aparecem no histórico inicial.
insert into public.booking_events(booking_id,event_type,customer,service_name,barber_name,starts_at,snapshot,happened_at)
select b.id,'booking_created',b.customer,b.service_name,b.barber_name,b.starts_at,
 jsonb_build_object('status',b.status,'attendance_state',b.attendance_state,'no_preference',b.no_preference,'price',b.price),b.created_at
from public.bookings b
where not exists(select 1 from public.booking_events e where e.booking_id=b.id and e.event_type='booking_created');

commit;
notify pgrst,'reload schema';

-- ===== horarios-loja.sql =====
-- Expediente por dia da semana (da loja e, se quiser, de cada barbeiro), intervalo entre horários
-- e apresentação dos barbeiros. Execute depois de gestao-profissional.sql. Repetível.
begin;

create table if not exists public.shop_settings(
 id int primary key default 1 check(id=1),
 slot_minutes int not null default 30 check(slot_minutes between 10 and 120),
 booking_days int not null default 60 check(booking_days between 1 and 180)
);
insert into public.shop_settings(id) values(1) on conflict do nothing;

-- Sem linha para o dia = fechado. barber_id nulo = horário da loja. Um barbeiro com linhas próprias
-- usa só as dele; sem linhas próprias, segue o horário da loja.
create table if not exists public.business_hours(
 id uuid primary key default gen_random_uuid(),
 barber_id uuid references public.barbers(id) on delete cascade,
 weekday smallint not null check(weekday between 0 and 6),
 opens_at time not null, closes_at time not null check(closes_at>opens_at),
 unique nulls not distinct (barber_id,weekday)
);
-- Primeira instalação: mantém o horário antigo (todos os dias, 9h às 19h). O chefe ajusta no painel.
insert into public.business_hours(barber_id,weekday,opens_at,closes_at)
select null,d,'09:00','19:00' from generate_series(0,6) d
where not exists(select 1 from public.business_hours);

alter table public.shop_settings enable row level security;
alter table public.business_hours enable row level security;
drop policy if exists shop_settings_admin on public.shop_settings;
drop policy if exists business_hours_admin on public.business_hours;
create policy shop_settings_admin on public.shop_settings for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy business_hours_admin on public.business_hours for all to authenticated using(public.is_admin()) with check(public.is_admin());
revoke all on public.shop_settings,public.business_hours from anon,authenticated;
grant select,insert,update,delete on public.shop_settings,public.business_hours to authenticated;

-- Especialidade e apresentação aparecem para os clientes.
alter table public.barbers add column if not exists specialty text not null default '' check(length(specialty)<=60);
alter table public.barbers add column if not exists bio text not null default '' check(length(bio)<=400);
-- Textos que antes estavam fixos no código (team.js).
update public.barbers set specialty='Cortes clássicos',bio='Bruno gosta do visual clássico: corte social, linhas bem definidas e acabamento cuidadoso. Sua proposta é um corte prático que combine com o dia a dia.' where name='Bruno Martins' and specialty='' and bio='';
update public.barbers set specialty='Degradê e estilo',bio='Caio traz uma proposta moderna, com foco em degradês e transições suaves. Gosta de conversar sobre o estilo desejado antes de começar o atendimento.' where name='Caio Ribeiro' and specialty='' and bio='';
update public.barbers set specialty='Corte e barba',bio='Diego se dedica à combinação de corte e barba, buscando equilíbrio no visual e atenção aos detalhes do acabamento.' where name='Diego Costa' and specialty='' and bio='';

-- Única definição de available_slots. Respeita expediente, bloqueios, faltas e reservas.
-- shortcut: fuso fixo America/Manaus (mercado-alvo: Amazonas); trocar por coluna em shop_settings ao vender fora do fuso.
create or replace function public.available_slots(p_date date,p_barber uuid,p_service uuid)
returns table(slot text) language sql stable security definer set search_path='' as $$
with cfg as (
 select coalesce((select slot_minutes from public.shop_settings where id=1),30) step,
  coalesce((select booking_days from public.shop_settings where id=1),60) days,
  now() at time zone 'America/Manaus' agora)
select distinct to_char(t,'HH24:MI')
from cfg cross join public.services s cross join public.barbers b
join lateral (select h.opens_at,h.closes_at from public.business_hours h
 where h.weekday=extract(dow from p_date)::int
 and (h.barber_id=b.id or (h.barber_id is null and not exists(select 1 from public.business_hours x where x.barber_id=b.id)))) h on true
cross join lateral generate_series(p_date+h.opens_at,p_date+h.closes_at-make_interval(mins=>s.duration),make_interval(mins=>cfg.step)) t
where s.id=p_service and s.active and b.active and (p_barber is null or b.id=p_barber)
and p_date between cfg.agora::date and cfg.agora::date+cfg.days
and t>cfg.agora
and not exists(select 1 from public.bookings r where r.barber_id=b.id and r.status='confirmed' and not r.no_show and tsrange(r.starts_at,r.ends_at,'[)')&&tsrange(t,t+make_interval(mins=>s.duration),'[)'))
and not exists(select 1 from public.schedule_blocks x where (x.barber_id is null or x.barber_id=b.id) and tsrange(x.starts_at,x.ends_at,'[)')&&tsrange(t,t+make_interval(mins=>s.duration),'[)'))
order by 1;
$$;
grant execute on function public.available_slots(date,uuid,uuid) to anon,authenticated;

-- Mesma regra para o cliente que remarca: só horários do expediente, fora de bloqueios, com a duração da reserva.
create or replace function public.customer_change_slots(p_booking uuid,p_date date,p_barber uuid)
returns table(slot text) language sql stable security definer set search_path='' as $$
with cfg as (
 select coalesce((select slot_minutes from public.shop_settings where id=1),30) step,
  coalesce((select booking_days from public.shop_settings where id=1),60) days,
  now() at time zone 'America/Manaus' agora),
r as (select id,ends_at-starts_at dur from public.bookings
 where id=p_booking and customer_id=auth.uid() and status='confirmed'
 and clock_timestamp()<=(starts_at at time zone 'America/Manaus')-interval '1 hour')
select distinct to_char(t,'HH24:MI')
from cfg cross join r cross join public.barbers b
join lateral (select h.opens_at,h.closes_at from public.business_hours h
 where h.weekday=extract(dow from p_date)::int
 and (h.barber_id=b.id or (h.barber_id is null and not exists(select 1 from public.business_hours x where x.barber_id=b.id)))) h on true
cross join lateral generate_series(p_date+h.opens_at,p_date+h.closes_at-r.dur,make_interval(mins=>cfg.step)) t
where b.id=p_barber and b.active
and p_date between cfg.agora::date and cfg.agora::date+cfg.days
and t>cfg.agora
and not exists(select 1 from public.bookings o where o.id<>r.id and o.barber_id=b.id and o.status='confirmed' and not o.no_show and tsrange(o.starts_at,o.ends_at,'[)')&&tsrange(t,t+r.dur,'[)'))
and not exists(select 1 from public.schedule_blocks x where (x.barber_id is null or x.barber_id=b.id) and tsrange(x.starts_at,x.ends_at,'[)')&&tsrange(t,t+r.dur,'[)'))
order by 1;
$$;
revoke all on function public.customer_change_slots(uuid,date,uuid) from public,anon;
grant execute on function public.customer_change_slots(uuid,date,uuid) to authenticated;

-- Igual à versão original, sem o horário fixo das 9h às 18h30: quem valida o horário é available_slots.
create or replace function public.book_appointment(p_date date,p_time text,p_barber uuid,p_service uuid,p_customer text,p_phone text)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.services%rowtype; b public.barbers%rowtype; start_time timestamp; result uuid;
begin
 if p_customer is null or length(trim(p_customer)) not between 1 and 80 or p_phone is null or length(p_phone)>30
  or length(regexp_replace(p_phone,'[^0-9]','','g')) not between 10 and 15 then
  raise exception 'Informe nome e celular com DDD.';
 end if;
 if p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Horário inválido.'; end if;
 select * into s from public.services where id=p_service and active for share;
 if not found then raise exception 'Serviço indisponível.'; end if;
 select * into b from public.barbers where id=p_barber and active for share;
 if not found then raise exception 'Barbeiro indisponível.'; end if;
 if not exists(select 1 from public.available_slots(p_date,p_barber,p_service) where slot=p_time) then
  raise exception 'Horário indisponível. Escolha outro horário.';
 end if;
 start_time:=p_date+p_time::time;
 insert into public.bookings(customer,phone,service_id,barber_id,service_name,barber_name,price,starts_at,ends_at)
 values(trim(p_customer),p_phone,s.id,b.id,s.name,b.name,s.price,start_time,start_time+make_interval(mins=>s.duration))
 returning id into result;
 return result;
exception when exclusion_violation then
 raise exception 'Horário acabou de ser reservado. Escolha outro horário.';
end;$$;
revoke all on function public.book_appointment(date,text,uuid,uuid,text,text) from public,anon,authenticated;
commit;
notify pgrst,'reload schema';

-- ===== sem-horario-duplicado.sql =====
-- Garante no banco que um barbeiro nunca tenha duas reservas confirmadas no mesmo horário,
-- mesmo que dois clientes confirmem no mesmo segundo. Repetível.
begin;
create extension if not exists btree_gist with schema extensions;

do $$
declare conflitos int;
begin
 if exists(select 1 from pg_constraint where conname='bookings_no_overlap') then return; end if;
 -- A proteção antiga também bloqueava o horário de quem faltou; a nova libera, igual à busca de horários.
 alter table public.bookings drop constraint if exists bookings_barber_id_tsrange_excl;
 select count(*) into conflitos from public.bookings a join public.bookings b
  on a.barber_id=b.barber_id and a.id<b.id
  and a.status='confirmed' and b.status='confirmed' and not a.no_show and not b.no_show
  and tsrange(a.starts_at,a.ends_at,'[)') && tsrange(b.starts_at,b.ends_at,'[)');
 if conflitos>0 then
  raise exception 'Existem % pares de reservas sobrepostas. Rode a consulta do fim deste arquivo, resolva (cancele ou remarque) e execute de novo.',conflitos;
 end if;
 alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (barber_id with =, tsrange(starts_at,ends_at,'[)') with &&)
  where (status='confirmed' and not no_show);
end $$;
commit;

-- Para ver as reservas sobrepostas, se o bloco acima avisar:
-- select a.id,a.customer,a.starts_at,b.id,b.customer,b.starts_at,a.barber_name from public.bookings a join public.bookings b
--  on a.barber_id=b.barber_id and a.id<b.id and a.status='confirmed' and b.status='confirmed' and not a.no_show and not b.no_show
--  and tsrange(a.starts_at,a.ends_at,'[)') && tsrange(b.starts_at,b.ends_at,'[)');

-- ===== equipe-atendente.sql =====
-- Perfil de atendente: acessa só Agenda, Atendimentos e Caixa diário. O resto continua só do chefe.
-- Execute logo depois de 00-base.sql (antes de gestao-profissional.sql). Repetível.
begin;
set local check_function_bodies=off; -- admin_slots usa available_slots, criada em horarios-loja.sql

create table if not exists public.attendants(
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null,
 created_at timestamptz not null default now()
);
alter table public.attendants enable row level security;
revoke all on public.attendants from anon,authenticated;

-- Atendente sempre entra com o código do celular (aal2), como o chefe no painel.
create or replace function public.is_attendant()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.attendants where user_id=auth.uid())
  and coalesce(auth.jwt()->>'aal','aal1')='aal2';
$$;
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin() or public.is_attendant();
$$;
-- Usada pelo painel para mostrar só as abas permitidas.
create or replace function public.staff_role()
returns text language sql stable security definer set search_path='' as $$
 select case when public.is_admin() then 'admin' when public.is_attendant() then 'attendant' end;
$$;

-- O chefe libera ou tira o acesso pelo e-mail (a pessoa cria a conta pelo site antes).
create or replace function public.admin_set_attendant(p_email text,p_allow boolean)
returns text language plpgsql security definer set search_path='' as $$
declare account uuid; clean text:=lower(trim(coalesce(p_email,'')));
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 select id into account from auth.users where lower(email)=clean;
 if account is null then raise exception 'Esse e-mail ainda não tem conta. Peça para a pessoa criar a conta pelo site e tente de novo.'; end if;
 if p_allow then
  insert into public.attendants(user_id,email) values(account,clean) on conflict(user_id) do update set email=excluded.email;
  return 'liberado';
 end if;
 delete from public.attendants where user_id=account;
 return 'removido';
end;$$;
create or replace function public.admin_list_attendants()
returns table(email text,created_at timestamptz) language sql stable security definer set search_path='' as $$
 select a.email,a.created_at from public.attendants a where public.is_admin() order by a.email;
$$;

drop policy if exists bookings_read on public.bookings;
drop policy if exists attendances_admin_read on public.attendances;
create policy bookings_read on public.bookings for select to authenticated using(public.is_staff());
create policy attendances_admin_read on public.attendances for select to authenticated using(public.is_staff());

-- Funções de balcão: chefe e atendente.
create or replace function public.admin_slots(p_date date,p_service uuid,p_barber uuid)
returns table(slot text) language sql stable security definer set search_path='' as $$
 select distinct a.slot from public.barbers b
 cross join lateral public.available_slots(p_date,b.id,p_service) a
 where public.is_staff() and b.active and (p_barber is null or b.id=p_barber)
 order by a.slot;
$$;

create or replace function public.admin_book(p_date date,p_time text,p_service uuid,p_barber uuid,p_customer text,p_phone text)
returns uuid language plpgsql security definer set search_path='' as $$
declare candidate uuid; result uuid;
begin
 if not public.is_staff() then raise exception 'Acesso permitido somente à equipe da barbearia.'; end if;
 if p_barber is not null then
  return public.book_appointment(p_date,p_time,p_barber,p_service,p_customer,p_phone);
 end if;
 select b.id into candidate from public.barbers b
 where b.active and exists(select 1 from public.available_slots(p_date,b.id,p_service) a where a.slot=p_time)
 order by (select count(*) from public.bookings r where r.barber_id=b.id and r.status='confirmed' and r.starts_at::date=p_date),b.name,b.id
 limit 1 for update of b skip locked;
 if candidate is null then raise exception 'Nenhum barbeiro disponível. Atualize os horários e tente novamente.'; end if;
 result:=public.book_appointment(p_date,p_time,candidate,p_service,p_customer,p_phone);
 update public.bookings set no_preference=true where id=result;
 return result;
end;$$;

create or replace function public.mark_arrival(p_booking uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare reservation public.bookings%rowtype;
begin
 if not public.is_staff() then raise exception 'Acesso permitido somente à equipe da barbearia.'; end if;
 select * into reservation from public.bookings where id=p_booking for update;
 if not found or reservation.status<>'confirmed' then raise exception 'Agendamento não encontrado ou cancelado.'; end if;
 if exists(select 1 from public.attendances where booking_id=p_booking) then return p_booking; end if;
 if reservation.starts_at::date<>(clock_timestamp() at time zone 'America/Manaus')::date then
  raise exception 'A chegada só pode ser confirmada no dia do agendamento, no horário de Manaus.';
 end if;
 insert into public.attendances(booking_id,base_price,total) values(p_booking,reservation.price,reservation.price);
 update public.bookings set attendance_state='arrived' where id=p_booking;
 return p_booking;
end;$$;

create or replace function public.save_attendance(p_booking uuid,p_version int,p_extras jsonb,p_discount numeric,p_method text,p_paid boolean,p_notes text,p_finish boolean)
returns int language plpgsql security definer set search_path='' as $$
declare visit public.attendances%rowtype; item jsonb; extra_total numeric:=0; amount numeric; quantity int; subtotal numeric; next_version int; booking_status text;
begin
 if not public.is_staff() then raise exception 'Acesso permitido somente à equipe da barbearia.'; end if;
 select status into booking_status from public.bookings where id=p_booking for update;
 if booking_status is distinct from 'confirmed' then raise exception 'Agendamento indisponível.'; end if;
 select * into visit from public.attendances where booking_id=p_booking for update;
 if not found then raise exception 'Confirme a chegada antes de registrar o atendimento.'; end if;
 if visit.finished_at is not null then raise exception 'Este atendimento já foi concluído.'; end if;
 if p_version is distinct from visit.version then raise exception 'Este atendimento foi atualizado em outra tela. Atualize antes de salvar.'; end if;
 if p_extras is null or jsonb_typeof(p_extras)<>'array' then raise exception 'Procedimentos extras inválidos.'; end if;
 if jsonb_array_length(p_extras)>20 then raise exception 'Limite de 20 procedimentos extras por atendimento.'; end if;
 for item in select value from jsonb_array_elements(p_extras) loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'name') is distinct from 'string' or length(trim(item->>'name')) not between 1 and 80
   or jsonb_typeof(item->'price') is distinct from 'number' or jsonb_typeof(item->'quantity') is distinct from 'number' then
   raise exception 'Preencha nome, valor e quantidade de cada procedimento.';
  end if;
  amount:=(item->>'price')::numeric;
  if amount<0 or amount>100000 or amount<>round(amount,2) then raise exception 'Valor do procedimento inválido.'; end if;
  if (item->>'quantity')::numeric not between 1 and 99 or (item->>'quantity')::numeric<>trunc((item->>'quantity')::numeric) then
   raise exception 'A quantidade deve ser um inteiro de 1 a 99.';
  end if;
  quantity:=(item->>'quantity')::int;
  extra_total:=extra_total+amount*quantity;
 end loop;
 subtotal:=visit.base_price+extra_total;
 if p_discount is null or p_discount<0 or p_discount>subtotal or p_discount<>round(p_discount,2) then raise exception 'Desconto inválido. Confira o total dos procedimentos.'; end if;
 if subtotal-p_discount>99999999.99 then raise exception 'Valor total acima do limite.'; end if;
 if p_paid is null or p_finish is null then raise exception 'Informe a situação do pagamento.'; end if;
 if p_paid and (p_method is null or p_method not in ('pix','cash','debit','credit','transfer','courtesy','other')) then raise exception 'Selecione a forma de pagamento.'; end if;
 if p_paid and p_method='courtesy' and subtotal-p_discount<>0 then raise exception 'Cortesia exige total igual a zero.'; end if;
 if p_finish and not p_paid then raise exception 'Confirme o pagamento antes de concluir o atendimento.'; end if;
 if length(coalesce(p_notes,''))>2000 then raise exception 'Use até 2000 caracteres nas observações.'; end if;
 update public.attendances set extras=p_extras,discount=p_discount,total=subtotal-p_discount,
  payment_method=case when p_paid then p_method else null end,paid=p_paid,
  paid_at=case when p_paid then coalesce(visit.paid_at,clock_timestamp()) else null end,
  notes=coalesce(p_notes,''),finished_at=case when p_finish then clock_timestamp() else null end,
  version=visit.version+1,updated_at=clock_timestamp()
 where booking_id=p_booking returning version into next_version;
 if p_finish then update public.bookings set attendance_state='completed' where id=p_booking; end if;
 return next_version;
end;$$;

revoke all on function public.is_attendant(),public.is_staff(),public.staff_role(),public.admin_set_attendant(text,boolean),
 public.admin_list_attendants(),public.admin_slots(date,uuid,uuid),public.admin_book(date,text,uuid,uuid,text,text),
 public.mark_arrival(uuid),public.save_attendance(uuid,int,jsonb,numeric,text,boolean,text,boolean) from public,anon;
grant execute on function public.is_attendant(),public.is_staff(),public.staff_role(),public.admin_set_attendant(text,boolean),
 public.admin_list_attendants(),public.admin_slots(date,uuid,uuid),public.admin_book(date,text,uuid,uuid,text,text),
 public.mark_arrival(uuid),public.save_attendance(uuid,int,jsonb,numeric,text,boolean,text,boolean) to authenticated;
commit;
notify pgrst,'reload schema';

-- ===== gestao-profissional.sql =====
-- Gestão profissional: caixa diário, despesas, faltas e bloqueios de agenda.
-- Execute uma vez no SQL Editor do Supabase. O arquivo é repetível.
begin;
alter table public.bookings add column if not exists no_show boolean not null default false;
alter table public.bookings add column if not exists no_show_at timestamptz;

create table if not exists public.cash_sessions(
 id uuid primary key default gen_random_uuid(), business_date date not null unique,
 opening_amount numeric(10,2) not null default 0 check(opening_amount>=0),
 closing_amount numeric(10,2) check(closing_amount>=0), opened_at timestamptz not null default now(),
 closed_at timestamptz, notes text not null default '' check(length(notes)<=1000),
 created_by uuid not null default auth.uid() references auth.users(id)
);
create table if not exists public.cash_movements(
 id uuid primary key default gen_random_uuid(), business_date date not null,
 kind text not null check(kind in('income','expense','withdrawal','deposit')),
 category text not null check(length(trim(category)) between 1 and 80),
 description text not null default '' check(length(description)<=300),
 amount numeric(10,2) not null check(amount>0), payment_method text check(payment_method in('pix','cash','debit','credit','transfer','other')),
 created_at timestamptz not null default now(), created_by uuid not null default auth.uid() references auth.users(id)
);
create table if not exists public.schedule_blocks(
 id uuid primary key default gen_random_uuid(), barber_id uuid references public.barbers(id) on delete cascade,
 starts_at timestamp not null, ends_at timestamp not null, reason text not null default 'Indisponível' check(length(reason) between 1 and 120),
 created_at timestamptz not null default now(), check(ends_at>starts_at)
);
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.schedule_blocks enable row level security;
drop policy if exists cash_sessions_admin on public.cash_sessions;
drop policy if exists cash_movements_admin on public.cash_movements;
drop policy if exists schedule_blocks_admin on public.schedule_blocks;
create policy cash_sessions_admin on public.cash_sessions for all to authenticated using(public.is_staff()) with check(public.is_staff());
create policy cash_movements_admin on public.cash_movements for all to authenticated using(public.is_staff()) with check(public.is_staff());
create policy schedule_blocks_admin on public.schedule_blocks for all to authenticated using(public.is_admin()) with check(public.is_admin());
revoke all on public.cash_sessions,public.cash_movements,public.schedule_blocks from anon,authenticated;
grant select,insert,update,delete on public.cash_sessions,public.cash_movements,public.schedule_blocks to authenticated;

create or replace function public.mark_no_show(p_booking uuid) returns void language plpgsql security definer set search_path='' as $$
declare reservation public.bookings%rowtype;
begin
 if not public.is_staff() then raise exception 'Acesso permitido somente à equipe da barbearia.';end if;
 select * into reservation from public.bookings where id=p_booking for update;
 if not found or reservation.status<>'confirmed' then raise exception 'Agendamento não encontrado ou cancelado.';end if;
 if reservation.attendance_state<>'scheduled' then raise exception 'O cliente já foi recebido.';end if;
 if reservation.starts_at>clock_timestamp() at time zone 'America/Manaus' then raise exception 'A falta só pode ser registrada depois do horário marcado.';end if;
 update public.bookings set no_show=true,no_show_at=clock_timestamp() where id=p_booking;
end;$$;
revoke all on function public.mark_no_show(uuid) from public,anon;
grant execute on function public.mark_no_show(uuid) to authenticated;

-- available_slots fica em horarios-loja.sql (expediente por dia e por barbeiro).

create table if not exists public.customer_directory(id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 80),phone text not null check(phone ~ '^[0-9]{10,15}$'),email text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(phone));
alter table public.customer_directory enable row level security;
drop policy if exists customer_directory_admin on public.customer_directory;
create policy customer_directory_admin on public.customer_directory for all to authenticated using(public.is_staff()) with check(public.is_staff());
revoke all on public.customer_directory from anon,authenticated;
grant select,insert,update on public.customer_directory to authenticated;
create or replace function public.admin_search_customers(p_query text)
returns table(id uuid,name text,phone text,email text,source text) language sql stable security definer set search_path='' as $$
 select x.id,x.name,x.phone,x.email,x.source from (select p.id,p.name,p.phone,u.email::text,'online'::text source from public.customer_profiles p join auth.users u on u.id=p.id union all select d.id,d.name,d.phone,d.email,'presencial'::text from public.customer_directory d) x
 where public.is_staff() and length(trim(coalesce(p_query,'')))>=2 and (x.name ilike '%'||trim(p_query)||'%' or x.phone like '%'||regexp_replace(p_query,'[^0-9]','','g')||'%' or x.email ilike '%'||trim(p_query)||'%') order by x.name nulls last limit 12;
$$;
create or replace function public.admin_save_customer(p_name text,p_phone text,p_email text) returns uuid language plpgsql security definer set search_path='' as $$
declare clean_phone text; result uuid; begin if not public.is_staff() then raise exception 'Acesso permitido somente à equipe da barbearia.';end if;if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Informe o nome do cliente.';end if;clean_phone:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');if length(clean_phone) not between 10 and 15 then raise exception 'Informe celular com DDD.';end if;if nullif(trim(coalesce(p_email,'')),'') is not null and trim(p_email) !~* '^[^@ ]+@[^@ ]+\.[^@ ]+$' then raise exception 'Confira o e-mail do cliente.';end if;insert into public.customer_directory(name,phone,email) values(trim(p_name),clean_phone,nullif(lower(trim(p_email)),'')) on conflict(phone) do update set name=excluded.name,email=coalesce(excluded.email,public.customer_directory.email),updated_at=now() returning id into result;return result;end;$$;
revoke all on function public.admin_search_customers(text) from public,anon;
revoke all on function public.admin_save_customer(text,text,text) from public,anon;
grant execute on function public.admin_search_customers(text) to authenticated;
grant execute on function public.admin_save_customer(text,text,text) to authenticated;
commit;

-- ===== sem-preferencia-cliente.sql =====
-- Repetível. Mantém reservas e permite escolher qualquer barbeiro disponível.
begin;
alter table public.bookings add column if not exists no_preference boolean not null default false;
-- available_slots fica só em gestao-profissional.sql (versão com bloqueios e faltas).
create or replace function public.available_options(p_date date,p_service uuid)
returns table(slot text,barbers text[]) language sql stable security definer set search_path='' as $$
select a.slot,array_agg(b.name order by b.name,b.id) from public.barbers b
cross join lateral public.available_slots(p_date,b.id,p_service) a
where b.active group by a.slot order by a.slot;
$$;
create or replace function public.customer_book(p_date date,p_time text,p_barber uuid,p_service uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare profile public.customer_profiles%rowtype; result uuid; candidate uuid;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta para agendar.';end if;
 -- Uma reserva por vez para cada cliente: sem isso, chamadas simultâneas passam do limite abaixo.
 perform pg_advisory_xact_lock(hashtextextended('customer_book:'||auth.uid()::text,0));
 select * into profile from public.customer_profiles where id=auth.uid();
 if not found or profile.name is null or profile.phone is null then raise exception 'Complete nome e celular na sua conta antes de agendar.';end if;
 -- Limite contra abuso: uma conta não pode lotar a agenda.
 if (select count(*) from public.bookings r where r.customer_id=auth.uid() and r.status='confirmed' and r.starts_at>clock_timestamp() at time zone 'America/Manaus')>=3 then raise exception 'Você já tem 3 horários marcados. Cancele um para agendar outro.';end if;
 if (select count(*) from public.bookings r where r.customer_id=auth.uid() and r.created_at>clock_timestamp()-interval '24 hours')>=10 then raise exception 'Muitas reservas em pouco tempo. Tente novamente amanhã ou fale com a barbearia.';end if;
 if p_barber is null then
 select b.id into candidate from public.barbers b
 where b.active and exists(select 1 from public.available_slots(p_date,b.id,p_service) a where a.slot=p_time)
 order by (select count(*) from public.bookings r where r.barber_id=b.id and r.status='confirmed' and r.starts_at::date=p_date),b.name,b.id
 limit 1;
 if candidate is null then raise exception 'Nenhum barbeiro disponível para esse horário. Atualize e escolha outro.';end if;
 else candidate:=p_barber;
 end if;
 result:=public.book_appointment(p_date,p_time,candidate,p_service,profile.name,profile.phone);
 update public.bookings set customer_id=auth.uid(),no_preference=(p_barber is null) where id=result;
 return result;
end;$$;
revoke all on function public.available_options(date,uuid) from public;
grant execute on function public.available_options(date,uuid) to anon,authenticated;
revoke all on function public.customer_book(date,text,uuid,uuid) from public,anon;
grant execute on function public.customer_book(date,text,uuid,uuid) to authenticated;

create or replace function public.customer_book_with_assignment(p_date date,p_time text,p_service uuid)
returns table(booking_id uuid,barber_name text) language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 result:=public.customer_book(p_date,p_time,null,p_service);
 return query select r.id,r.barber_name from public.bookings r where r.id=result and r.customer_id=auth.uid();
end;$$;
revoke all on function public.customer_book_with_assignment(date,text,uuid) from public,anon;
grant execute on function public.customer_book_with_assignment(date,text,uuid) to authenticated;
commit;
notify pgrst,'reload schema';

-- ===== cancelamento-com-motivo.sql =====
-- Execute este arquivo inteiro no SQL Editor do Supabase.
-- Registra quem cancelou e exige motivo quando a loja cancela.
begin;

alter table public.bookings add column if not exists cancellation_source text;
alter table public.bookings add column if not exists cancellation_reason text;
alter table public.bookings add column if not exists cancelled_at timestamptz;

do $$ begin
 if not exists(select 1 from pg_constraint where conname='bookings_cancellation_source_check') then
  alter table public.bookings add constraint bookings_cancellation_source_check check(cancellation_source in ('client','shop'));
 end if;
 if not exists(select 1 from pg_constraint where conname='bookings_cancellation_reason_check') then
  alter table public.bookings add constraint bookings_cancellation_reason_check check(cancellation_reason is null or length(trim(cancellation_reason)) between 5 and 500);
 end if;
end $$;

create or replace function public.admin_cancel_booking(p_booking uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare reservation public.bookings%rowtype; clean_reason text;
begin
 if not public.is_staff() then raise exception 'Acesso permitido somente à equipe da barbearia.';end if;
 clean_reason:=trim(coalesce(p_reason,''));
 if length(clean_reason) not between 5 and 500 then raise exception 'Informe um motivo entre 5 e 500 caracteres.';end if;
 select * into reservation from public.bookings where id=p_booking for update;
 if not found then raise exception 'Agendamento não encontrado.';end if;
 if reservation.status='cancelled' then raise exception 'Este agendamento já foi cancelado.';end if;
 if reservation.attendance_state in ('arrived','completed') then raise exception 'O cliente já foi recebido. Este horário não pode ser cancelado.';end if;
 update public.bookings set status='cancelled',cancellation_source='shop',cancellation_reason=clean_reason,cancelled_at=clock_timestamp() where id=p_booking;
 return p_booking;
end;$$;
revoke all on function public.admin_cancel_booking(uuid,text) from public,anon;
grant execute on function public.admin_cancel_booking(uuid,text) to authenticated;

create or replace function public.customer_cancel(p_booking uuid)
returns text language plpgsql security definer set search_path='' as $$
declare reservation public.bookings%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.';end if;
 select * into reservation from public.bookings where id=p_booking and customer_id=auth.uid() for update;
 if not found then raise exception 'Reserva não encontrada na sua conta.';end if;
 if reservation.status='cancelled' then return 'already_cancelled';end if;
 if clock_timestamp()>(reservation.starts_at at time zone 'America/Manaus')-interval '1 hour' then raise exception 'O prazo terminou. Cancelamentos e alterações exigem pelo menos 1 hora de antecedência.';end if;
 update public.bookings set status='cancelled',cancellation_source='client',cancellation_reason=null,cancelled_at=clock_timestamp() where id=p_booking;
 return 'cancelled';
end;$$;
revoke all on function public.customer_cancel(uuid) from public,anon;
grant execute on function public.customer_cancel(uuid) to authenticated;

commit;

-- ===== barbeiro-fidelidade.sql =====
-- Área do barbeiro (cada um vê só a própria agenda e comissão) e programa de fidelidade
-- (desligado até o chefe ativar no painel). Execute depois de horarios-loja.sql. Repetível.
begin;
do $$ begin
 if to_regclass('public.shop_settings') is null then
  raise exception 'Rode antes o horarios-loja.sql (ou use atualizar-banco-existente.sql, que já roda tudo na ordem).';
 end if;
end $$;

-- Área do barbeiro --------------------------------------------------------------------------------
alter table public.barbers add column if not exists user_id uuid unique references auth.users(id) on delete set null;
alter table public.barber_details add column if not exists login_email text;

create or replace function public.my_barber_id()
returns uuid language sql stable security definer set search_path='' as $$
 select id from public.barbers where user_id=auth.uid() and active;
$$;

-- O barbeiro cria a conta pelo site (como cliente) e o chefe liga essa conta ao cadastro dele.
create or replace function public.admin_set_barber_login(p_barber uuid,p_email text)
returns text language plpgsql security definer set search_path='' as $$
declare account uuid; clean text:=lower(trim(coalesce(p_email,'')));
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 if not exists(select 1 from public.barbers where id=p_barber) then raise exception 'Barbeiro não encontrado.'; end if;
 if clean='' then
  update public.barbers set user_id=null where id=p_barber;
  update public.barber_details set login_email=null where barber_id=p_barber;
  return 'sem acesso';
 end if;
 select id into account from auth.users where lower(email)=clean;
 if account is null then
  raise exception 'Esse e-mail ainda não tem conta. Peça ao barbeiro para criar a conta pelo site (Criar conta) e salve de novo.';
 end if;
 update public.barbers set user_id=null where user_id=account and id<>p_barber;
 update public.barbers set user_id=account where id=p_barber;
 insert into public.barber_details(barber_id,login_email) values(p_barber,clean)
 on conflict(barber_id) do update set login_email=excluded.login_email;
 return 'com acesso';
end;$$;

drop policy if exists bookings_barber_read on public.bookings;
drop policy if exists attendances_barber_read on public.attendances;
create policy bookings_barber_read on public.bookings for select to authenticated using(barber_id=(select public.my_barber_id()));
create policy attendances_barber_read on public.attendances for select to authenticated
 using(exists(select 1 from public.bookings b where b.id=booking_id and b.barber_id=(select public.my_barber_id())));

-- Resumo do período para o próprio barbeiro (comissão arredondada por atendimento, como no Financeiro).
create or replace function public.barber_summary(p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.my_barber_id(); rate numeric; result jsonb;
begin
 if me is null then raise exception 'Esta conta não está ligada a um barbeiro. Peça ao chefe para informar seu e-mail no cadastro de barbeiros.'; end if;
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>366 then raise exception 'Período inválido.'; end if;
 rate:=coalesce((select commission_rate from public.barber_details where barber_id=me),40);
 select jsonb_build_object(
  'barber_id',me,'name',(select name from public.barbers where id=me),'rate',rate,
  'count',count(a.booking_id),
  'gross',coalesce(sum(a.total),0),
  'commission',coalesce(sum(round(a.total*rate/100,2)),0))
 into result
 from public.bookings b join public.attendances a on a.booking_id=b.id and a.paid
 where b.barber_id=me and b.starts_at::date between p_start and p_end;
 return result;
end;$$;

-- Fidelidade -------------------------------------------------------------------------------------
alter table public.shop_settings add column if not exists loyalty_enabled boolean not null default false;
alter table public.shop_settings add column if not exists loyalty_goal int not null default 10 check(loyalty_goal between 2 and 50);

-- Conta pelo celular, então vale para cliente do site e do balcão.
-- shortcut: atendimento em "Cortesia" conta como prêmio usado; criar forma de pagamento própria se a loja der cortesias por outros motivos.
create or replace function public.loyalty_status(p_phone text)
returns jsonb language sql stable security definer set search_path='' as $$
 with cfg as (select loyalty_enabled enabled,loyalty_goal goal from public.shop_settings where id=1),
 visits as (
  select count(*) filter(where a.payment_method<>'courtesy') earned,count(*) filter(where a.payment_method='courtesy') used
  from public.attendances a join public.bookings b on b.id=a.booking_id
  where a.paid and a.finished_at is not null
  and regexp_replace(b.phone,'[^0-9]','','g')=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')
  and length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'))>=10)
 select jsonb_build_object('enabled',coalesce(c.enabled,false),'goal',coalesce(c.goal,10),
  'progress',v.earned%coalesce(c.goal,10),
  'available',greatest(v.earned/coalesce(c.goal,10)-v.used,0))
 from visits v left join cfg c on true;
$$;

create or replace function public.customer_loyalty()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
 if not coalesce((select loyalty_enabled from public.shop_settings where id=1),false) then return jsonb_build_object('enabled',false); end if;
 return public.loyalty_status((select phone from public.customer_profiles where id=auth.uid()));
end;$$;

create or replace function public.admin_loyalty(p_phone text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_staff() then raise exception 'Acesso permitido somente à equipe da barbearia.'; end if;
 return public.loyalty_status(p_phone);
end;$$;

revoke all on function public.loyalty_status(text) from public,anon,authenticated;
revoke all on function public.my_barber_id(),public.admin_set_barber_login(uuid,text),public.barber_summary(date,date),
 public.customer_loyalty(),public.admin_loyalty(text) from public,anon;
grant execute on function public.my_barber_id(),public.admin_set_barber_login(uuid,text),public.barber_summary(date,date),
 public.customer_loyalty(),public.admin_loyalty(text) to authenticated;
commit;
notify pgrst,'reload schema';

-- ===== barbeiro-avisos.sql =====
-- Avisos para o barbeiro: novos agendamentos, cancelamentos e remarcações com ele.
-- Execute depois de barbeiro-fidelidade.sql e historico-agenda.sql. Repetível.
begin;
do $$ begin
 if to_regprocedure('public.my_barber_id()') is null or to_regclass('public.booking_events') is null then
  raise exception 'Rode antes barbeiro-fidelidade.sql e historico-agenda.sql (ou use atualizar-banco-existente.sql).';
 end if;
end $$;

-- Folga agora é combinada direto com o chefe, que fecha a agenda no painel: remove o pedido pelo sistema.
drop function if exists public.barber_request_block(timestamp,timestamp,text);
drop function if exists public.admin_decide_block(uuid,boolean);
drop table if exists public.block_requests;

-- Novidades da agenda do barbeiro (vêm do histórico da agenda).
create or replace function public.barber_updates(p_days int)
returns table(event_type text,customer text,service_name text,starts_at timestamp,happened_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.my_barber_id();
begin
 if me is null then raise exception 'Esta conta não está ligada a um barbeiro.'; end if;
 return query select e.event_type,e.customer,e.service_name,e.starts_at,e.happened_at
 from public.booking_events e join public.bookings b on b.id=e.booking_id
 where b.barber_id=me and e.event_type in ('booking_created','booking_cancelled','booking_rescheduled')
 and e.happened_at>now()-make_interval(days=>least(greatest(coalesce(p_days,7),1),30))
 order by e.happened_at desc limit 50;
end;$$;

revoke all on function public.barber_updates(int) from public,anon;
grant execute on function public.barber_updates(int) to authenticated;
commit;
notify pgrst,'reload schema';

-- ===== crescimento.sql =====
-- Crescimento: lembretes e campanhas pelo WhatsApp (envio manual com 1 toque), avaliação no Google,
-- produtos com estoque, clube de assinatura, meta do barbeiro, avaliações dos clientes e gorjeta por Pix.
-- Execute depois de barbeiro-fidelidade.sql e equipe-atendente.sql. Repetível.
begin;
do $$ begin
 if to_regprocedure('public.is_staff()') is null or to_regprocedure('public.my_barber_id()') is null then
  raise exception 'Rode antes equipe-atendente.sql e barbeiro-fidelidade.sql (ou use atualizar-banco-existente.sql).';
 end if;
end $$;

-- Configurações e dados novos do barbeiro --------------------------------------------------------------
alter table public.shop_settings add column if not exists google_review_url text check(google_review_url is null or google_review_url ~ '^https://');
alter table public.barber_details add column if not exists monthly_goal numeric(10,2) check(monthly_goal is null or monthly_goal>=0);
alter table public.barber_details add column if not exists pix_key text check(pix_key is null or length(trim(pix_key)) between 3 and 120);

-- Registro do que já foi enviado pelo WhatsApp (o envio em si é feito pela equipe no app) -----------------
create table if not exists public.message_log(
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in('reminder','campaign','google','optout')),
 campaign text check(campaign is null or length(campaign)<=40),
 booking_id uuid references public.bookings(id) on delete cascade,
 phone text not null check(phone ~ '^[0-9]{10,15}$'),
 created_at timestamptz not null default now(),
 created_by uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists message_log_phone on public.message_log(phone,kind);
create index if not exists message_log_booking on public.message_log(booking_id);
alter table public.message_log enable row level security;
drop policy if exists message_log_staff_read on public.message_log;
drop policy if exists message_log_staff_insert on public.message_log;
drop policy if exists message_log_admin_delete on public.message_log;
create policy message_log_staff_read on public.message_log for select to authenticated using(public.is_staff());
-- A atendente registra só lembretes; campanhas, Google e "não enviar mais" são do chefe.
create policy message_log_staff_insert on public.message_log for insert to authenticated
 with check(public.is_admin() or (public.is_staff() and kind='reminder'));
create policy message_log_admin_delete on public.message_log for delete to authenticated using(public.is_admin());
revoke all on public.message_log from anon,authenticated;
grant select,insert,delete on public.message_log to authenticated;

-- Produtos e estoque ----------------------------------------------------------------------------------
create table if not exists public.products(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 80),
 price numeric(10,2) not null check(price>=0),
 stock int not null default 0 check(stock>=0),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.products enable row level security;
drop policy if exists products_staff_read on public.products;
drop policy if exists products_admin on public.products;
create policy products_staff_read on public.products for select to authenticated using(public.is_staff());
create policy products_admin on public.products for all to authenticated using(public.is_admin()) with check(public.is_admin());
revoke all on public.products from anon,authenticated;
grant select,insert,update,delete on public.products to authenticated;

-- Clube de assinatura (a cobrança da mensalidade é feita fora do sistema e registrada no painel) ------------
create table if not exists public.subscription_plans(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 80),
 price numeric(10,2) not null check(price>0),
 visits_per_month int check(visits_per_month is null or visits_per_month between 1 and 60),
 description text not null default '' check(length(description)<=300),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.subscriptions(
 id uuid primary key default gen_random_uuid(),
 plan_id uuid not null references public.subscription_plans(id),
 customer text not null check(length(trim(customer)) between 1 and 80),
 phone text not null check(phone ~ '^[0-9]{10,15}$'),
 active boolean not null default true,
 paid_until date not null,
 created_at timestamptz not null default now()
);
create unique index if not exists subscriptions_one_active on public.subscriptions(phone) where active;
alter table public.attendances add column if not exists subscription_id uuid references public.subscriptions(id) on delete set null;
alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;
drop policy if exists subscription_plans_admin on public.subscription_plans;
drop policy if exists subscriptions_admin on public.subscriptions;
create policy subscription_plans_admin on public.subscription_plans for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy subscriptions_admin on public.subscriptions for all to authenticated using(public.is_admin()) with check(public.is_admin());
revoke all on public.subscription_plans,public.subscriptions from anon,authenticated;
grant select,insert,update,delete on public.subscription_plans,public.subscriptions to authenticated;

-- "Assinatura" vira forma de pagamento: o serviço já foi pago na mensalidade.
alter table public.attendances drop constraint if exists attendances_payment_method_check;
alter table public.attendances add constraint attendances_payment_method_check
 check(payment_method in ('pix','cash','debit','credit','transfer','courtesy','subscription','other'));

-- Situação da assinatura do cliente desta reserva, para a ficha de atendimento.
create or replace function public.subscription_for_booking(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s record; used int; today date:=(clock_timestamp() at time zone 'America/Manaus')::date;
begin
 if not public.is_staff() then raise exception 'Acesso permitido somente à equipe da barbearia.'; end if;
 select x.id,x.paid_until,p.name plan,p.visits_per_month into s
 from public.bookings b join public.subscriptions x on x.active and x.phone=regexp_replace(b.phone,'[^0-9]','','g')
 join public.subscription_plans p on p.id=x.plan_id where b.id=p_booking;
 if not found then return null; end if;
 select count(*) into used from public.attendances a join public.bookings b on b.id=a.booking_id
  where a.subscription_id=s.id and a.booking_id<>p_booking and date_trunc('month',b.starts_at)=date_trunc('month',today::timestamp);
 return jsonb_build_object('id',s.id,'plan',s.plan,'paid_until',s.paid_until,'up_to_date',s.paid_until>=today,
  'limit',s.visits_per_month,'used',used,'available',s.paid_until>=today and (s.visits_per_month is null or used<s.visits_per_month));
end;$$;

-- Usa (ou deixa de usar) a assinatura neste atendimento. A ficha passa a ter desconto igual ao serviço.
create or replace function public.apply_subscription(p_booking uuid,p_apply boolean)
returns int language plpgsql security definer set search_path='' as $$
declare info jsonb; visit public.attendances%rowtype;
begin
 if not public.is_staff() then raise exception 'Acesso permitido somente à equipe da barbearia.'; end if;
 select * into visit from public.attendances where booking_id=p_booking for update;
 if not found then raise exception 'Confirme a chegada antes de usar a assinatura.'; end if;
 if visit.finished_at is not null then raise exception 'Este atendimento já foi concluído.'; end if;
 if p_apply then
  info:=public.subscription_for_booking(p_booking);
  if info is null then raise exception 'Este cliente não tem assinatura ativa.'; end if;
  if not (info->>'up_to_date')::boolean then raise exception 'A mensalidade da assinatura está atrasada. Registre o pagamento antes.'; end if;
  if not (info->>'available')::boolean then raise exception 'O cliente já usou todos os atendimentos do plano neste mês.'; end if;
 end if;
 update public.attendances set subscription_id=case when p_apply then (info->>'id')::uuid else null end,
  discount=case when p_apply then base_price else 0 end,
  total=case when p_apply then greatest(total-base_price+discount,0) else total+discount end,
  version=version+1,updated_at=clock_timestamp()
 where booking_id=p_booking returning version into visit.version;
 return visit.version;
end;$$;

-- Registra a mensalidade: entra no caixa do dia e adianta a validade em um mês.
create or replace function public.admin_subscription_payment(p_subscription uuid,p_method text)
returns date language plpgsql security definer set search_path='' as $$
declare s record; today date:=(clock_timestamp() at time zone 'America/Manaus')::date; next_date date;
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 if p_method is null or p_method not in ('pix','cash','debit','credit','transfer','other') then raise exception 'Selecione a forma de pagamento.'; end if;
 select x.*,p.price,p.name plan into s from public.subscriptions x join public.subscription_plans p on p.id=x.plan_id where x.id=p_subscription for update of x;
 if not found or not s.active then raise exception 'Assinatura não encontrada ou cancelada.'; end if;
 next_date:=(greatest(s.paid_until,today)+interval '1 month')::date;
 update public.subscriptions set paid_until=next_date where id=p_subscription;
 insert into public.cash_movements(business_date,kind,category,description,amount,payment_method)
 values(today,'income','Assinatura',s.plan||' · '||s.customer,s.price,p_method);
 return next_date;
end;$$;

-- Atendimento: mesma regra de antes + "Assinatura" e baixa de estoque dos produtos vendidos.
-- Substitui a versão de equipe-atendente.sql (este arquivo roda depois).
create or replace function public.save_attendance(p_booking uuid,p_version int,p_extras jsonb,p_discount numeric,p_method text,p_paid boolean,p_notes text,p_finish boolean)
returns int language plpgsql security definer set search_path='' as $$
declare visit public.attendances%rowtype; item jsonb; extra_total numeric:=0; amount numeric; quantity int; subtotal numeric; next_version int; booking_status text; product uuid;
begin
 if not public.is_staff() then raise exception 'Acesso permitido somente à equipe da barbearia.'; end if;
 select status into booking_status from public.bookings where id=p_booking for update;
 if booking_status is distinct from 'confirmed' then raise exception 'Agendamento indisponível.'; end if;
 select * into visit from public.attendances where booking_id=p_booking for update;
 if not found then raise exception 'Confirme a chegada antes de registrar o atendimento.'; end if;
 if visit.finished_at is not null then raise exception 'Este atendimento já foi concluído.'; end if;
 if p_version is distinct from visit.version then raise exception 'Este atendimento foi atualizado em outra tela. Atualize antes de salvar.'; end if;
 if p_extras is null or jsonb_typeof(p_extras)<>'array' then raise exception 'Procedimentos extras inválidos.'; end if;
 if jsonb_array_length(p_extras)>20 then raise exception 'Limite de 20 procedimentos extras por atendimento.'; end if;
 for item in select value from jsonb_array_elements(p_extras) loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'name') is distinct from 'string' or length(trim(item->>'name')) not between 1 and 80
   or jsonb_typeof(item->'price') is distinct from 'number' or jsonb_typeof(item->'quantity') is distinct from 'number' then
   raise exception 'Preencha nome, valor e quantidade de cada procedimento.';
  end if;
  if item ? 'product_id' and (jsonb_typeof(item->'product_id')<>'string' or item->>'product_id' !~ '^[0-9a-f-]{36}$') then raise exception 'Produto inválido.'; end if;
  amount:=(item->>'price')::numeric;
  if amount<0 or amount>100000 or amount<>round(amount,2) then raise exception 'Valor do procedimento inválido.'; end if;
  if (item->>'quantity')::numeric not between 1 and 99 or (item->>'quantity')::numeric<>trunc((item->>'quantity')::numeric) then
   raise exception 'A quantidade deve ser um inteiro de 1 a 99.';
  end if;
  quantity:=(item->>'quantity')::int;
  extra_total:=extra_total+amount*quantity;
 end loop;
 subtotal:=visit.base_price+extra_total;
 if p_discount is null or p_discount<0 or p_discount>subtotal or p_discount<>round(p_discount,2) then raise exception 'Desconto inválido. Confira o total dos procedimentos.'; end if;
 if subtotal-p_discount>99999999.99 then raise exception 'Valor total acima do limite.'; end if;
 if p_paid is null or p_finish is null then raise exception 'Informe a situação do pagamento.'; end if;
 if p_paid and (p_method is null or p_method not in ('pix','cash','debit','credit','transfer','courtesy','subscription','other')) then raise exception 'Selecione a forma de pagamento.'; end if;
 if p_paid and p_method='courtesy' and subtotal-p_discount<>0 then raise exception 'Cortesia exige total igual a zero.'; end if;
 if p_paid and p_method='subscription' and (visit.subscription_id is null or subtotal-p_discount<>0) then
  raise exception 'Use "Usar assinatura" e cobre os extras com outra forma de pagamento. "Assinatura" só vale com total zero.';
 end if;
 if p_finish and not p_paid then raise exception 'Confirme o pagamento antes de concluir o atendimento.'; end if;
 if length(coalesce(p_notes,''))>2000 then raise exception 'Use até 2000 caracteres nas observações.'; end if;
 -- Ao concluir, cada produto vendido sai do estoque; falta de estoque impede a conclusão.
 if p_finish then
  for item in select value from jsonb_array_elements(p_extras) where value ? 'product_id' loop
   product:=(item->>'product_id')::uuid;
   update public.products set stock=stock-(item->>'quantity')::int where id=product and stock>=(item->>'quantity')::int;
   if not found then raise exception 'Estoque insuficiente de %. Confira o estoque em Serviços.',item->>'name'; end if;
  end loop;
 end if;
 update public.attendances set extras=p_extras,discount=p_discount,total=subtotal-p_discount,
  payment_method=case when p_paid then p_method else null end,paid=p_paid,
  paid_at=case when p_paid then coalesce(visit.paid_at,clock_timestamp()) else null end,
  notes=coalesce(p_notes,''),finished_at=case when p_finish then clock_timestamp() else null end,
  version=visit.version+1,updated_at=clock_timestamp()
 where booking_id=p_booking returning version into next_version;
 if p_finish then update public.bookings set attendance_state='completed' where id=p_booking; end if;
 return next_version;
end;$$;

-- Fidelidade: atendimento pago pela assinatura não conta ponto.
create or replace function public.loyalty_status(p_phone text)
returns jsonb language sql stable security definer set search_path='' as $$
 with cfg as (select loyalty_enabled enabled,loyalty_goal goal from public.shop_settings where id=1),
 visits as (
  select count(*) filter(where a.payment_method not in('courtesy','subscription')) earned,count(*) filter(where a.payment_method='courtesy') used
  from public.attendances a join public.bookings b on b.id=a.booking_id
  where a.paid and a.finished_at is not null
  and regexp_replace(b.phone,'[^0-9]','','g')=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')
  and length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'))>=10)
 select jsonb_build_object('enabled',coalesce(c.enabled,false),'goal',coalesce(c.goal,10),
  'progress',v.earned%coalesce(c.goal,10),
  'available',greatest(v.earned/coalesce(c.goal,10)-v.used,0))
 from visits v left join cfg c on true;
$$;

-- Avaliações dos clientes e gorjeta ----------------------------------------------------------------------
create table if not exists public.reviews(
 booking_id uuid primary key references public.bookings(id) on delete cascade,
 barber_id uuid not null references public.barbers(id) on delete cascade,
 rating int not null check(rating between 1 and 5),
 comment text not null default '' check(length(comment)<=300),
 created_at timestamptz not null default now()
);
alter table public.reviews enable row level security;
drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to authenticated using(
 public.is_admin() or barber_id=(select public.my_barber_id())
 or exists(select 1 from public.bookings b where b.id=booking_id and b.customer_id=auth.uid()));
revoke all on public.reviews from anon,authenticated;
grant select on public.reviews to authenticated;

-- O cliente avalia só o próprio atendimento concluído; pode mudar a nota depois.
create or replace function public.customer_review(p_booking uuid,p_rating int,p_comment text)
returns void language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
 select * into b from public.bookings where id=p_booking and customer_id=auth.uid();
 if not found or b.attendance_state<>'completed' then raise exception 'Só é possível avaliar atendimentos concluídos da sua conta.'; end if;
 if p_rating is null or p_rating not between 1 and 5 then raise exception 'Escolha de 1 a 5 estrelas.'; end if;
 if length(coalesce(p_comment,''))>300 then raise exception 'Use até 300 caracteres no comentário.'; end if;
 insert into public.reviews(booking_id,barber_id,rating,comment) values(p_booking,b.barber_id,p_rating,trim(coalesce(p_comment,'')))
 on conflict(booking_id) do update set rating=excluded.rating,comment=excluded.comment,created_at=now();
end;$$;

-- Chave Pix do barbeiro para gorjeta: só para o cliente de um atendimento concluído com ele.
create or replace function public.customer_tip_info(p_booking uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('barber_name',b.barber_name,'pix_key',d.pix_key)
 from public.bookings b join public.barber_details d on d.barber_id=b.barber_id
 where b.id=p_booking and b.customer_id=auth.uid() and b.attendance_state='completed' and d.pix_key is not null;
$$;

-- Painel do barbeiro: meta do mês, ganhos, previsão com a agenda marcada e avaliações.
create or replace function public.barber_month()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.my_barber_id(); rate numeric; goal numeric; agora timestamp:=clock_timestamp() at time zone 'America/Manaus';
 first_day date:=date_trunc('month',agora)::date; last_day date:=(date_trunc('month',agora)+interval '1 month -1 day')::date; gross numeric; booked numeric; result jsonb;
begin
 if me is null then raise exception 'Esta conta não está ligada a um barbeiro. Peça ao chefe para informar seu e-mail no cadastro de barbeiros.'; end if;
 select coalesce(commission_rate,40),monthly_goal into rate,goal from public.barber_details where barber_id=me;
 select coalesce(sum(a.total),0) into gross from public.bookings b join public.attendances a on a.booking_id=b.id and a.paid
  where b.barber_id=me and b.starts_at::date between first_day and last_day;
 select coalesce(sum(b.price),0) into booked from public.bookings b
  where b.barber_id=me and b.status='confirmed' and not b.no_show and b.attendance_state<>'completed'
  and b.starts_at>=agora and b.starts_at::date<=last_day;
 select jsonb_build_object('month',to_char(first_day,'YYYY-MM'),'rate',coalesce(rate,40),'goal',goal,'gross',gross,
  'commission',round(gross*coalesce(rate,40)/100,2),'forecast',gross+booked,
  'rating',(select round(avg(rating)::numeric,1) from public.reviews where barber_id=me),
  'reviews',(select count(*) from public.reviews where barber_id=me),
  'comments',coalesce((select jsonb_agg(x) from (select rating,comment,created_at from public.reviews
    where barber_id=me and comment<>'' order by created_at desc limit 5) x),'[]'::jsonb))
 into result;
 return result;
end;$$;

revoke all on function public.subscription_for_booking(uuid),public.apply_subscription(uuid,boolean),public.admin_subscription_payment(uuid,text),
 public.save_attendance(uuid,int,jsonb,numeric,text,boolean,text,boolean),public.customer_review(uuid,int,text),public.customer_tip_info(uuid),
 public.barber_month() from public,anon;
grant execute on function public.subscription_for_booking(uuid),public.apply_subscription(uuid,boolean),public.admin_subscription_payment(uuid,text),
 public.save_attendance(uuid,int,jsonb,numeric,text,boolean,text,boolean),public.customer_review(uuid,int,text),public.customer_tip_info(uuid),
 public.barber_month() to authenticated;
revoke all on function public.loyalty_status(text) from public,anon,authenticated;
commit;
notify pgrst,'reload schema';

-- ===== whatsapp-oficial.sql =====
-- WhatsApp oficial (API Cloud da Meta): lembrete automático na véspera e robô de agendamento.
-- Fica DESLIGADO até o chefe preencher os dados da Meta no painel e ligar. Veja WHATSAPP-OFICIAL.md.
-- Execute depois de crescimento.sql. Repetível.
begin;
do $$ begin
 if to_regclass('public.message_log') is null or to_regprocedure('public.book_appointment(date,text,uuid,uuid,text,text)') is null then
  raise exception 'Rode antes crescimento.sql e sem-preferencia-cliente.sql (ou use atualizar-banco-existente.sql).';
 end if;
end $$;

-- Configuração (o token da Meta NÃO fica aqui: é um segredo da Edge Function) ---------------------------
create table if not exists public.whatsapp_settings(
 id int primary key default 1 check(id=1),
 enabled boolean not null default false,
 reminders_enabled boolean not null default true,
 bot_enabled boolean not null default true,
 phone_number_id text check(phone_number_id is null or phone_number_id ~ '^[0-9]{5,30}$'),
 template_name text not null default 'lembrete_horario' check(template_name ~ '^[a-z0-9_]+$' and length(template_name)<=512),
 template_lang text not null default 'pt_BR' check(template_lang ~ '^[a-z]{2}(_[A-Z]{2})?$'),
 graph_version text not null default 'v26.0' check(graph_version ~ '^v[0-9]{2}\.0$'),
 reminder_hour int not null default 18 check(reminder_hour between 6 and 22),
 last_run_at timestamptz,
 last_result text check(last_result is null or length(last_result)<=500)
);
insert into public.whatsapp_settings(id) values(1) on conflict do nothing;
alter table public.whatsapp_settings enable row level security;
drop policy if exists whatsapp_settings_admin on public.whatsapp_settings;
create policy whatsapp_settings_admin on public.whatsapp_settings for all to authenticated using(public.is_admin()) with check(public.is_admin());
revoke all on public.whatsapp_settings from anon,authenticated;
grant select,update on public.whatsapp_settings to authenticated;

-- O que saiu pela API fica marcado igual ao envio manual (o painel mostra ✓ Enviado nos dois casos).
alter table public.message_log add column if not exists channel text not null default 'manual' check(channel in('manual','api'));
alter table public.message_log add column if not exists provider_id text check(provider_id is null or length(provider_id)<=200);

-- Conversa do robô: em que passo cada celular está. Só a Edge Function (service_role) usa.
create table if not exists public.wa_sessions(
 phone text primary key check(phone ~ '^[0-9]{10,15}$'),
 step text not null default 'start' check(length(step)<=30),
 data jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table public.wa_sessions enable row level security;
revoke all on public.wa_sessions from anon,authenticated;

-- Reserva feita pelo robô: mesmas regras do site (horário livre, 3 horários futuros e 10 reservas em 24 h por celular).
create or replace function public.bot_book(p_phone text,p_name text,p_date date,p_time text,p_barber uuid,p_service uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare clean text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'); candidate uuid; result uuid;
begin
 if length(clean) not between 10 and 15 then raise exception 'Celular inválido.'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Informe o nome.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('bot_book:'||clean,0));
 if (select count(*) from public.bookings r where regexp_replace(r.phone,'[^0-9]','','g')=clean and r.status='confirmed'
     and r.starts_at>clock_timestamp() at time zone 'America/Manaus')>=3 then
  raise exception 'Você já tem 3 horários marcados. Cancele um para agendar outro.'; end if;
 if (select count(*) from public.bookings r where regexp_replace(r.phone,'[^0-9]','','g')=clean and r.created_at>clock_timestamp()-interval '24 hours')>=10 then
  raise exception 'Muitas reservas em pouco tempo. Fale com a barbearia.'; end if;
 if p_barber is null then
  select b.id into candidate from public.barbers b
  where b.active and exists(select 1 from public.available_slots(p_date,b.id,p_service) a where a.slot=p_time)
  order by (select count(*) from public.bookings r where r.barber_id=b.id and r.status='confirmed' and r.starts_at::date=p_date),b.name,b.id
  limit 1;
  if candidate is null then raise exception 'Esse horário acabou de ser ocupado. Escolha outro.'; end if;
 else candidate:=p_barber;
 end if;
 result:=public.book_appointment(p_date,p_time,candidate,p_service,trim(p_name),clean);
 update public.bookings set no_preference=(p_barber is null) where id=result;
 return result;
end;$$;

-- Lembretes que faltam: reservas de amanhã sem lembrete, a partir da hora configurada (horário de Manaus).
create or replace function public.whatsapp_due_reminders(p_limit int)
returns table(booking_id uuid,customer text,phone text,service_name text,barber_name text,starts_at timestamp)
language sql stable security definer set search_path='' as $$
 with cfg as (select reminder_hour,(clock_timestamp() at time zone 'America/Manaus') agora from public.whatsapp_settings where id=1 and enabled and reminders_enabled)
 select r.id,r.customer,regexp_replace(r.phone,'[^0-9]','','g'),r.service_name,r.barber_name,r.starts_at
 from public.bookings r cross join cfg
 where extract(hour from cfg.agora)>=cfg.reminder_hour
 and r.status='confirmed' and not r.no_show and r.starts_at::date=cfg.agora::date+1
 and length(regexp_replace(r.phone,'[^0-9]','','g')) between 10 and 15
 and not exists(select 1 from public.message_log m where m.booking_id=r.id and m.kind='reminder')
 order by r.starts_at limit least(greatest(coalesce(p_limit,20),1),100);
$$;

revoke all on function public.bot_book(text,text,date,text,uuid,uuid),public.whatsapp_due_reminders(int) from public,anon,authenticated;
grant execute on function public.bot_book(text,text,date,text,uuid,uuid),public.whatsapp_due_reminders(int) to service_role;
commit;
notify pgrst,'reload schema';

-- ===== baixas-barbeiro.sql =====
-- Baixas na comissão do barbeiro e acerto (pagamento) da comissão.
-- Baixa = valor que a barbearia adiantou ou comprou para o barbeiro e desconta da comissão dele:
--   product  produto do estoque (o estoque diminui)       cash      vale em dinheiro (sai do Caixa do dia)
--   purchase compra parcelada (uma parcela por mês)        other     outra baixa
-- Acerto: comissão do período menos as baixas pendentes até o fim do período. Se as baixas passarem da
-- comissão, entram as mais antigas até o limite e o resto fica para o próximo acerto.
-- Execute depois de crescimento.sql. Repetível.
begin;
do $$ begin
 if to_regclass('public.products') is null or to_regprocedure('public.my_barber_id()') is null then
  raise exception 'Rode antes crescimento.sql e barbeiro-fidelidade.sql (ou use atualizar-banco-existente.sql).';
 end if;
end $$;

create table if not exists public.barber_settlements(
 id uuid primary key default gen_random_uuid(),
 barber_id uuid not null references public.barbers(id) on delete cascade,
 period_start date not null, period_end date not null check(period_end>=period_start),
 commission numeric(10,2) not null check(commission>=0),
 deductions numeric(10,2) not null check(deductions>=0),
 paid_amount numeric(10,2) not null check(paid_amount>=0),
 payment_method text not null check(payment_method in('pix','cash','transfer','other')),
 paid_at timestamptz not null default now(),
 created_by uuid default auth.uid() references auth.users(id) on delete set null
);
create table if not exists public.barber_deductions(
 id uuid primary key default gen_random_uuid(),
 barber_id uuid not null references public.barbers(id) on delete cascade,
 due_date date not null,
 kind text not null check(kind in('product','cash','purchase','other')),
 description text not null check(length(trim(description)) between 1 and 120),
 amount numeric(10,2) not null check(amount>0),
 product_id uuid references public.products(id) on delete set null,
 quantity int check(quantity is null or quantity between 1 and 99),
 group_id uuid not null default gen_random_uuid(),
 installment int not null default 1, installments int not null default 1 check(installments between 1 and 24 and installment between 1 and installments),
 cash_movement_id uuid references public.cash_movements(id) on delete set null,
 settlement_id uuid references public.barber_settlements(id) on delete restrict,
 created_at timestamptz not null default now(),
 created_by uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists barber_deductions_barber on public.barber_deductions(barber_id,due_date);
create index if not exists barber_settlements_barber on public.barber_settlements(barber_id,period_start);
alter table public.barber_deductions enable row level security;
alter table public.barber_settlements enable row level security;
drop policy if exists barber_deductions_read on public.barber_deductions;
drop policy if exists barber_settlements_read on public.barber_settlements;
-- Leitura: chefe vê tudo, barbeiro vê só as próprias. Escrita só pelas funções abaixo.
create policy barber_deductions_read on public.barber_deductions for select to authenticated using(public.is_admin() or barber_id=(select public.my_barber_id()));
create policy barber_settlements_read on public.barber_settlements for select to authenticated using(public.is_admin() or barber_id=(select public.my_barber_id()));
revoke all on public.barber_deductions,public.barber_settlements from anon,authenticated;
grant select on public.barber_deductions,public.barber_settlements to authenticated;

-- Conta do acerto (uso interno). Comissão arredondada por atendimento, igual ao Financeiro.
create or replace function public.settlement_data(p_barber uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rate numeric; commission numeric; done public.barber_settlements%rowtype; items jsonb:='[]'::jsonb; used numeric:=0; d record; fits boolean;
begin
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>366 then raise exception 'Período inválido.'; end if;
 if not exists(select 1 from public.barbers where id=p_barber) then raise exception 'Barbeiro não encontrado.'; end if;
 rate:=coalesce((select commission_rate from public.barber_details where barber_id=p_barber),40);
 select coalesce(sum(round(a.total*rate/100,2)),0) into commission from public.bookings b join public.attendances a on a.booking_id=b.id and a.paid
  where b.barber_id=p_barber and b.starts_at::date between p_start and p_end;
 select * into done from public.barber_settlements where barber_id=p_barber and period_start=p_start and period_end=p_end order by paid_at desc limit 1;
 if done.id is not null then
  -- Período já pago: mostra o que foi descontado nele.
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'due_date',x.due_date,'kind',x.kind,'description',x.description,'amount',x.amount,
   'installment',x.installment,'installments',x.installments,'included',true,'settled',true) order by x.due_date,x.created_at),'[]') into items
  from public.barber_deductions x where x.settlement_id=done.id;
  return jsonb_build_object('barber_id',p_barber,'rate',rate,'commission',done.commission,'deductions',done.deductions,'carry',0,
   'to_pay',done.paid_amount,'items',items,'settlement',jsonb_build_object('id',done.id,'paid_at',done.paid_at,'payment_method',done.payment_method,'paid_amount',done.paid_amount));
 end if;
 for d in select * from public.barber_deductions where barber_id=p_barber and settlement_id is null and due_date<=p_end order by due_date,created_at,installment loop
  fits:=used+d.amount<=commission;
  if fits then used:=used+d.amount; end if;
  items:=items||jsonb_build_object('id',d.id,'due_date',d.due_date,'kind',d.kind,'description',d.description,'amount',d.amount,
   'installment',d.installment,'installments',d.installments,'included',fits,'settled',false);
 end loop;
 return jsonb_build_object('barber_id',p_barber,'rate',rate,'commission',commission,'deductions',used,
  'carry',coalesce((select sum((i->>'amount')::numeric) from jsonb_array_elements(items) i where not (i->>'included')::boolean),0),
  'to_pay',commission-used,'items',items,'settlement',null);
end;$$;

create or replace function public.admin_barber_settlement(p_barber uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 return public.settlement_data(p_barber,p_start,p_end);
end;$$;

create or replace function public.my_settlement(p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.my_barber_id();
begin
 if me is null then raise exception 'Esta conta não está ligada a um barbeiro.'; end if;
 return public.settlement_data(me,p_start,p_end);
end;$$;

-- Lança uma baixa. Produto: valor do cadastro e saída do estoque. Vale: saída no Caixa do dia. Compra: parcelas mensais.
create or replace function public.admin_add_deduction(p_barber uuid,p_date date,p_kind text,p_description text,p_amount numeric,p_product uuid,p_quantity int,p_installments int)
returns uuid language plpgsql security definer set search_path='' as $$
declare grp uuid:=gen_random_uuid(); total numeric; parts int:=1; part numeric; first_part numeric; prod public.products%rowtype; cash uuid; descr text:=trim(coalesce(p_description,''));
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 if not exists(select 1 from public.barbers where id=p_barber) then raise exception 'Barbeiro não encontrado.'; end if;
 if p_date is null then raise exception 'Informe a data.'; end if;
 if p_kind not in('product','cash','purchase','other') then raise exception 'Tipo de baixa inválido.'; end if;
 if p_kind='product' then
  if p_quantity is null or p_quantity not between 1 and 99 then raise exception 'Quantidade de 1 a 99.'; end if;
  update public.products set stock=stock-p_quantity where id=p_product and active and stock>=p_quantity returning * into prod;
  if not found then raise exception 'Produto sem estoque suficiente.'; end if;
  total:=prod.price*p_quantity;
  if descr='' then descr:=prod.name||' x'||p_quantity; end if;
  if total<=0 then raise exception 'O produto está com preço zero.'; end if;
 else
  total:=p_amount;
  if total is null or total<=0 or total>100000 or total<>round(total,2) then raise exception 'Valor inválido.'; end if;
  if descr='' then raise exception 'Descreva a baixa.'; end if;
 end if;
 if length(descr)>120 then raise exception 'Descrição com até 120 caracteres.'; end if;
 if p_kind='purchase' then parts:=coalesce(p_installments,1); if parts not between 1 and 24 then raise exception 'Parcelas de 1 a 24.'; end if; end if;
 if p_kind='cash' then
  insert into public.cash_movements(business_date,kind,category,description,amount,payment_method)
  values(p_date,'withdrawal','Vale barbeiro',descr||' · '||(select name from public.barbers where id=p_barber),total,'cash') returning id into cash;
 end if;
 part:=trunc(total/parts,2); first_part:=total-part*(parts-1);
 for i in 1..parts loop
  insert into public.barber_deductions(barber_id,due_date,kind,description,amount,product_id,quantity,group_id,installment,installments,cash_movement_id)
  values(p_barber,(p_date+make_interval(months=>i-1))::date,p_kind,descr,case when i=1 then first_part else part end,
   case when p_kind='product' then p_product end,case when p_kind='product' then p_quantity end,grp,i,parts,cash);
 end loop;
 return grp;
end;$$;

-- Exclui a baixa (e as parcelas ainda não pagas da mesma compra). Devolve o estoque e tira o vale do Caixa.
create or replace function public.admin_delete_deduction(p_id uuid)
returns int language plpgsql security definer set search_path='' as $$
declare d public.barber_deductions%rowtype; removed int;
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 select * into d from public.barber_deductions where id=p_id for update;
 if not found then raise exception 'Baixa não encontrada.'; end if;
 if d.settlement_id is not null then raise exception 'Esta baixa já entrou num acerto pago e não pode ser excluída.'; end if;
 if d.kind='product' and d.product_id is not null then update public.products set stock=stock+d.quantity where id=d.product_id; end if;
 delete from public.barber_deductions where group_id=d.group_id and settlement_id is null;
 get diagnostics removed=row_count;
 if d.kind='cash' and d.cash_movement_id is not null then delete from public.cash_movements where id=d.cash_movement_id; end if;
 return removed;
end;$$;

-- Marca o acerto como pago. Pagamento em dinheiro sai do Caixa do dia.
create or replace function public.admin_settle(p_barber uuid,p_start date,p_end date,p_method text)
returns uuid language plpgsql security definer set search_path='' as $$
declare info jsonb; sid uuid; today date:=(clock_timestamp() at time zone 'America/Manaus')::date;
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 if p_method not in('pix','cash','transfer','other') then raise exception 'Escolha como o barbeiro foi pago.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('settle:'||p_barber::text,0));
 if exists(select 1 from public.barber_settlements where barber_id=p_barber and period_start<=p_end and period_end>=p_start) then
  raise exception 'Já existe um acerto pago que cobre parte deste período.'; end if;
 info:=public.settlement_data(p_barber,p_start,p_end);
 insert into public.barber_settlements(barber_id,period_start,period_end,commission,deductions,paid_amount,payment_method)
 values(p_barber,p_start,p_end,(info->>'commission')::numeric,(info->>'deductions')::numeric,(info->>'to_pay')::numeric,p_method) returning id into sid;
 update public.barber_deductions set settlement_id=sid
 where id in(select (i->>'id')::uuid from jsonb_array_elements(info->'items') i where (i->>'included')::boolean);
 if p_method='cash' and (info->>'to_pay')::numeric>0 then
  insert into public.cash_movements(business_date,kind,category,description,amount,payment_method)
  values(today,'withdrawal','Pagamento barbeiro',(select name from public.barbers where id=p_barber)||' · '||to_char(p_start,'DD/MM')||' a '||to_char(p_end,'DD/MM'),(info->>'to_pay')::numeric,'cash');
 end if;
 return sid;
end;$$;

revoke all on function public.settlement_data(uuid,date,date) from public,anon,authenticated;
revoke all on function public.admin_barber_settlement(uuid,date,date),public.my_settlement(date,date),
 public.admin_add_deduction(uuid,date,text,text,numeric,uuid,int,int),public.admin_delete_deduction(uuid),public.admin_settle(uuid,date,date,text) from public,anon;
grant execute on function public.admin_barber_settlement(uuid,date,date),public.my_settlement(date,date),
 public.admin_add_deduction(uuid,date,text,text,numeric,uuid,int,int),public.admin_delete_deduction(uuid),public.admin_settle(uuid,date,date,text) to authenticated;
commit;
notify pgrst,'reload schema';

-- ===== lgpd.sql =====
-- LGPD: o cliente pode excluir a própria conta. Repetível.
-- Reservas já atendidas ficam no histórico financeiro da barbearia, mas sem nome e celular.
begin;
create or replace function public.customer_delete_account()
returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
 if me is null then raise exception 'Entre na sua conta.'; end if;
 if exists(select 1 from public.admins where user_id=me) then raise exception 'A conta do chefe não pode ser excluída por aqui.'; end if;
 -- Horários futuros voltam a ficar livres; atendimentos já recebidos não são alterados.
 update public.bookings set status='cancelled',cancellation_source='client',cancelled_at=clock_timestamp()
 where customer_id=me and status='confirmed' and attendance_state='scheduled'
 and starts_at>clock_timestamp() at time zone 'America/Manaus';
 update public.booking_events e set customer='Cliente removido' from public.bookings b where b.id=e.booking_id and b.customer_id=me;
 update public.bookings set customer='Cliente removido',phone='' where customer_id=me;
 delete from auth.users where id=me; -- perfil apaga junto (on delete cascade)
end;$$;
revoke all on function public.customer_delete_account() from public,anon;
grant execute on function public.customer_delete_account() to authenticated;
commit;
notify pgrst,'reload schema';

-- ===== seguranca-permissoes.sql =====
-- Fecha permissões que o Supabase concede por padrão a toda função nova. Repetível.
begin;
do $$
declare f regprocedure;
begin
 -- Só o chefe usa (o site chama com o login dele); visitante sem login não pode executar.
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('admin_book','admin_slots','save_barber') loop
  execute format('revoke all on function %s from public, anon', f);
  execute format('grant execute on function %s to authenticated', f);
 end loop;
 -- Uso interno: só customer_book, admin_book e customer_cancel chamam estas, e elas rodam como dono.
 -- Chamadas direto, permitiriam furar o limite de reservas e agendar no nome de outra pessoa.
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('book_appointment','cancel_appointment') loop
  execute format('revoke all on function %s from public, anon, authenticated', f);
 end loop;
end $$;
commit;
