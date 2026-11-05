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
