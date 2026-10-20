-- GERADO por gerar-instalar-tudo.sh. Atualiza um banco que já está em uso. Pode rodar mais de uma vez.

-- ===== painel-kryon.sql =====
-- Painel independente da Kryon. Execute este arquivo inteiro no SQL Editor do Supabase.
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

create table if not exists public.kryon_admins(
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.kryon_admins enable row level security;
revoke all on public.kryon_admins from public,anon,authenticated;

insert into public.kryon_admins(user_id)
select id from auth.users where lower(email)=lower('guilhermesena7@outlook.com.br')
on conflict(user_id) do nothing;

create or replace function public.is_kryon_admin()
returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.kryon_admins where user_id=auth.uid());
$$;
revoke all on function public.is_kryon_admin() from public,anon;
grant execute on function public.is_kryon_admin() to authenticated;

create table if not exists public.kryon_usage_events(
 id bigint generated always as identity primary key,
 event_type text not null check(event_type in ('client_login','staff_login')),
 user_id uuid not null references auth.users(id) on delete cascade,
 happened_at timestamptz not null default clock_timestamp()
);
create index if not exists kryon_usage_events_time_idx on public.kryon_usage_events(happened_at desc);
alter table public.kryon_usage_events enable row level security;
revoke all on public.kryon_usage_events from public,anon,authenticated;

create or replace function public.track_kryon_usage(p_event text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_event not in ('client_login','staff_login') then return;end if;
 if not exists(select 1 from public.kryon_usage_events where user_id=auth.uid() and event_type=p_event and happened_at>clock_timestamp()-interval '10 minutes') then
  insert into public.kryon_usage_events(event_type,user_id) values(p_event,auth.uid());
 end if;
end;$$;
revoke all on function public.track_kryon_usage(text) from public,anon;
grant execute on function public.track_kryon_usage(text) to authenticated;

-- Histórico imutável das movimentações da agenda. O painel Kryon lê esta
-- tabela; clientes e funcionários não têm acesso direto a ela.
create table if not exists public.kryon_booking_events(
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
create index if not exists kryon_booking_events_time_idx on public.kryon_booking_events(happened_at desc,id desc);
alter table public.kryon_booking_events enable row level security;
revoke all on public.kryon_booking_events from public,anon,authenticated;

create or replace function public.record_kryon_booking_event()
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
 insert into public.kryon_booking_events(booking_id,event_type,customer,service_name,barber_name,starts_at,snapshot)
 values(new.id,kind,new.customer,new.service_name,new.barber_name,new.starts_at,jsonb_build_object(
  'status',new.status,'attendance_state',new.attendance_state,'no_preference',new.no_preference,
  'price',new.price,'ends_at',new.ends_at,'cancellation_source',new.cancellation_source,
  'cancellation_reason',new.cancellation_reason));
 return new;
end;$$;
revoke all on function public.record_kryon_booking_event() from public;
drop trigger if exists kryon_booking_audit on public.bookings;
create trigger kryon_booking_audit after insert or update on public.bookings
for each row execute function public.record_kryon_booking_event();

-- Os agendamentos anteriores também aparecem no histórico inicial.
insert into public.kryon_booking_events(booking_id,event_type,customer,service_name,barber_name,starts_at,snapshot,happened_at)
select b.id,'booking_created',b.customer,b.service_name,b.barber_name,b.starts_at,
 jsonb_build_object('status',b.status,'attendance_state',b.attendance_state,'no_preference',b.no_preference,'price',b.price),b.created_at
from public.bookings b
where not exists(select 1 from public.kryon_booking_events e where e.booking_id=b.id and e.event_type='booking_created');

create or replace function public.kryon_dashboard(p_start date,p_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_kryon_admin() then raise exception 'Acesso permitido somente à Kryon.';end if;
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>366 then raise exception 'Período inválido.';end if;
 select jsonb_build_object(
  'generated_at',clock_timestamp(),
  'totals',jsonb_build_object(
   'bookings',(select count(*) from public.bookings b where (b.created_at at time zone 'America/Manaus')::date between p_start and p_end),
   'confirmed',(select count(*) from public.bookings b where b.starts_at::date between p_start and p_end and b.status='confirmed'),
   'cancelled',(select count(*) from public.bookings b where b.starts_at::date between p_start and p_end and b.status='cancelled'),
   'completed',(select count(*) from public.bookings b where b.starts_at::date between p_start and p_end and b.attendance_state='completed'),
   'no_show',(select count(*) from public.bookings b where b.starts_at::date between p_start and p_end and b.no_show),
   'no_preference',(select count(*) from public.bookings b where b.starts_at::date between p_start and p_end and b.no_preference),
   'customers',(select count(distinct regexp_replace(b.phone,'[^0-9]','','g')) from public.bookings b where b.starts_at::date between p_start and p_end),
   'scheduled_value',(select coalesce(sum(b.price),0) from public.bookings b where b.starts_at::date between p_start and p_end and b.status='confirmed'),
   'active_days',(select count(distinct (b.created_at at time zone 'America/Manaus')::date) from public.bookings b where (b.created_at at time zone 'America/Manaus')::date between p_start and p_end),
   'logins',(select count(*) from public.kryon_usage_events e where (e.happened_at at time zone 'America/Manaus')::date between p_start and p_end),
   'logins_today',(select count(*) from public.kryon_usage_events e where (e.happened_at at time zone 'America/Manaus')::date=(clock_timestamp() at time zone 'America/Manaus')::date),
   'changes',(select count(*) from public.kryon_booking_events e where (e.happened_at at time zone 'America/Manaus')::date between p_start and p_end),
   'changes_today',(select count(*) from public.kryon_booking_events e where (e.happened_at at time zone 'America/Manaus')::date=(clock_timestamp() at time zone 'America/Manaus')::date),
   'usage_days',(select count(distinct x.day) from (select (e.happened_at at time zone 'America/Manaus')::date as day from public.kryon_usage_events e union all select (e.happened_at at time zone 'America/Manaus')::date from public.kryon_booking_events e) x where x.day between p_start and p_end),
   'last_login_at',(select max(e.happened_at) from public.kryon_usage_events e),
   'last_booking_at',(select max(b.created_at) from public.bookings b),
   'last_change_at',(select max(e.happened_at) from public.kryon_booking_events e),
   'last_system_activity_at',(select max(x.moment) from (select max(e.happened_at) moment from public.kryon_usage_events e union all select max(e.happened_at) from public.kryon_booking_events e) x)
  ),
  'daily',coalesce((select jsonb_agg(jsonb_build_object('day',d.day::date,'bookings',coalesce(x.bookings,0),'cancelled',coalesce(x.cancelled,0)) order by d.day) from generate_series(p_start,p_end,interval '1 day') d(day) left join lateral (select count(*) filter(where b.status='confirmed') bookings,count(*) filter(where b.status='cancelled') cancelled from public.bookings b where b.starts_at::date=d.day::date) x on true),'[]'::jsonb),
  'services',coalesce((select jsonb_agg(to_jsonb(x) order by x.total desc,x.name) from (select b.service_name name,count(*) total from public.bookings b where b.starts_at::date between p_start and p_end and b.status='confirmed' group by b.service_name limit 10) x),'[]'::jsonb),
  'barbers',coalesce((select jsonb_agg(to_jsonb(x) order by x.total desc,x.name) from (select b.barber_name name,count(*) total from public.bookings b where b.starts_at::date between p_start and p_end and b.status='confirmed' group by b.barber_name limit 20) x),'[]'::jsonb),
  'hours',coalesce((select jsonb_agg(to_jsonb(x) order by x.total desc,x.name) from (select to_char(b.starts_at,'HH24:00') name,count(*) total from public.bookings b where b.starts_at::date between p_start and p_end and b.status='confirmed' group by 1 limit 12) x),'[]'::jsonb),
  'recent',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select b.id,b.customer,b.phone,b.service_name,b.barber_name,b.starts_at,b.status,b.attendance_state,b.no_preference,b.created_at from public.bookings b order by b.created_at desc limit 40) x),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (select e.id,e.event_type,e.customer,e.service_name,e.barber_name,e.starts_at,e.snapshot,e.happened_at from public.kryon_booking_events e order by e.id desc limit 80) x),'[]'::jsonb),
  'accesses',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (select e.id,e.event_type,u.email,e.happened_at from public.kryon_usage_events e left join auth.users u on u.id=e.user_id order by e.id desc limit 80) x),'[]'::jsonb)
 ) into result;
 return result;
end;$$;
revoke all on function public.kryon_dashboard(date,date) from public,anon;
grant execute on function public.kryon_dashboard(date,date) to authenticated;

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
 if not public.is_staff() then raise exception 'Acesso permitido somente ao chefe.'; end if;
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
-- Execute depois de barbeiro-fidelidade.sql e painel-kryon.sql. Repetível.
begin;
do $$ begin
 if to_regprocedure('public.my_barber_id()') is null or to_regclass('public.kryon_booking_events') is null then
  raise exception 'Rode antes barbeiro-fidelidade.sql e painel-kryon.sql (ou use atualizar-banco-existente.sql).';
 end if;
end $$;

-- Folga agora é combinada direto com o chefe, que fecha a agenda no painel: remove o pedido pelo sistema.
drop function if exists public.barber_request_block(timestamp,timestamp,text);
drop function if exists public.admin_decide_block(uuid,boolean);
drop table if exists public.block_requests;

-- Novidades da agenda do barbeiro (vêm do histórico que o painel Kryon já grava).
create or replace function public.barber_updates(p_days int)
returns table(event_type text,customer text,service_name text,starts_at timestamp,happened_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.my_barber_id();
begin
 if me is null then raise exception 'Esta conta não está ligada a um barbeiro.'; end if;
 return query select e.event_type,e.customer,e.service_name,e.starts_at,e.happened_at
 from public.kryon_booking_events e join public.bookings b on b.id=e.booking_id
 where b.barber_id=me and e.event_type in ('booking_created','booking_cancelled','booking_rescheduled')
 and e.happened_at>now()-make_interval(days=>least(greatest(coalesce(p_days,7),1),30))
 order by e.happened_at desc limit 50;
end;$$;

revoke all on function public.barber_updates(int) from public,anon;
grant execute on function public.barber_updates(int) to authenticated;
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
 update public.kryon_booking_events e set customer='Cliente removido' from public.bookings b where b.id=e.booking_id and b.customer_id=me;
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
