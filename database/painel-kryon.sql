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
   'usage_days',(select count(distinct x.day) from (select (e.happened_at at time zone 'America/Manaus')::date day from public.kryon_usage_events e union all select (e.happened_at at time zone 'America/Manaus')::date from public.kryon_booking_events e) x where x.day between p_start and p_end),
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
