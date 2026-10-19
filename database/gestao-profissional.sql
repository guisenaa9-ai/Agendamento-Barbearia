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
create policy cash_sessions_admin on public.cash_sessions for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy cash_movements_admin on public.cash_movements for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy schedule_blocks_admin on public.schedule_blocks for all to authenticated using(public.is_admin()) with check(public.is_admin());
revoke all on public.cash_sessions,public.cash_movements,public.schedule_blocks from anon,authenticated;
grant select,insert,update,delete on public.cash_sessions,public.cash_movements,public.schedule_blocks to authenticated;

create or replace function public.mark_no_show(p_booking uuid) returns void language plpgsql security definer set search_path='' as $$
declare reservation public.bookings%rowtype;
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.';end if;
 select * into reservation from public.bookings where id=p_booking for update;
 if not found or reservation.status<>'confirmed' then raise exception 'Agendamento não encontrado ou cancelado.';end if;
 if reservation.attendance_state<>'scheduled' then raise exception 'O cliente já foi recebido.';end if;
 if reservation.starts_at>clock_timestamp() at time zone 'America/Manaus' then raise exception 'A falta só pode ser registrada depois do horário marcado.';end if;
 update public.bookings set no_show=true,no_show_at=clock_timestamp() where id=p_booking;
end;$$;
revoke all on function public.mark_no_show(uuid) from public,anon;
grant execute on function public.mark_no_show(uuid) to authenticated;

create or replace function public.available_slots(p_date date,p_barber uuid,p_service uuid)
returns table(slot text) language sql stable security definer set search_path='' as $$
select to_char(t,'HH24:MI') from public.services s
cross join generate_series(p_date+time '09:00',p_date+time '18:30',interval '30 minutes') t
where s.id=p_service and s.active
and p_date between (now() at time zone 'America/Manaus')::date and (now() at time zone 'America/Manaus')::date+60
and t>now() at time zone 'America/Manaus' and t+make_interval(mins=>s.duration)<=p_date+time '19:00'
and exists(select 1 from public.barbers b where b.active and (p_barber is null or b.id=p_barber)
 and not exists(select 1 from public.bookings r where r.barber_id=b.id and r.status='confirmed' and not r.no_show and tsrange(r.starts_at,r.ends_at,'[)')&&tsrange(t,t+make_interval(mins=>s.duration),'[)'))
 and not exists(select 1 from public.schedule_blocks x where (x.barber_id is null or x.barber_id=b.id) and tsrange(x.starts_at,x.ends_at,'[)')&&tsrange(t,t+make_interval(mins=>s.duration),'[)'))
) order by t;
$$;
grant execute on function public.available_slots(date,uuid,uuid) to anon,authenticated;

create table if not exists public.customer_directory(id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 80),phone text not null check(phone ~ '^[0-9]{10,15}$'),email text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(phone));
alter table public.customer_directory enable row level security;
drop policy if exists customer_directory_admin on public.customer_directory;
create policy customer_directory_admin on public.customer_directory for all to authenticated using(public.is_admin()) with check(public.is_admin());
revoke all on public.customer_directory from anon,authenticated;
grant select,insert,update on public.customer_directory to authenticated;
create or replace function public.admin_search_customers(p_query text)
returns table(id uuid,name text,phone text,email text,source text) language sql stable security definer set search_path='' as $$
 select x.id,x.name,x.phone,x.email,x.source from (select p.id,p.name,p.phone,u.email::text,'online'::text source from public.customer_profiles p join auth.users u on u.id=p.id union all select d.id,d.name,d.phone,d.email,'presencial'::text from public.customer_directory d) x
 where public.is_admin() and length(trim(coalesce(p_query,'')))>=2 and (x.name ilike '%'||trim(p_query)||'%' or x.phone like '%'||regexp_replace(p_query,'[^0-9]','','g')||'%' or x.email ilike '%'||trim(p_query)||'%') order by x.name nulls last limit 12;
$$;
create or replace function public.admin_save_customer(p_name text,p_phone text,p_email text) returns uuid language plpgsql security definer set search_path='' as $$
declare clean_phone text; result uuid; begin if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.';end if;if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Informe o nome do cliente.';end if;clean_phone:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');if length(clean_phone) not between 10 and 15 then raise exception 'Informe celular com DDD.';end if;if nullif(trim(coalesce(p_email,'')),'') is not null and trim(p_email) !~* '^[^@ ]+@[^@ ]+\.[^@ ]+$' then raise exception 'Confira o e-mail do cliente.';end if;insert into public.customer_directory(name,phone,email) values(trim(p_name),clean_phone,nullif(lower(trim(p_email)),'')) on conflict(phone) do update set name=excluded.name,email=coalesce(excluded.email,public.customer_directory.email),updated_at=now() returning id into result;return result;end;$$;
revoke all on function public.admin_search_customers(text) from public,anon;
revoke all on function public.admin_save_customer(text,text,text) from public,anon;
grant execute on function public.admin_search_customers(text) to authenticated;
grant execute on function public.admin_save_customer(text,text,text) to authenticated;
commit;
