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
