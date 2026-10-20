-- Base do sistema para um projeto Supabase novo (cópia exata da estrutura em produção).
-- Execute primeiro; depois os demais arquivos na ordem do LEIA-ME.md. Repetível.
begin;
set local check_function_bodies=off; -- funções aqui usam outras criadas em horarios-loja.sql
create extension if not exists btree_gist with schema extensions;

-- Tabelas -------------------------------------------------------------------------------------------
create table if not exists public.admins(
 user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.barbers(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 80),
 active boolean not null default true,
 photo_url text check(photo_url is null or photo_url ~ '^https://')
);

create or replace function public.valid_cpf(p_cpf text)
returns boolean language plpgsql immutable set search_path='' as $$
declare total int; digit int;
begin
 if p_cpf is null then return true; end if;
 if p_cpf !~ '^[0-9]{11}$' or p_cpf ~ '^(.)\1{10}$' then return false; end if;
 for len in 9..10 loop
  total:=0;
  for i in 1..len loop total:=total+substr(p_cpf,i,1)::int*(len+2-i); end loop;
  digit:=(total*10)%11; if digit=10 then digit:=0; end if;
  if digit<>substr(p_cpf,len+1,1)::int then return false; end if;
 end loop;
 return true;
end;$$;

create table if not exists public.barber_details(
 barber_id uuid primary key references public.barbers(id) on delete cascade,
 cpf text unique check(public.valid_cpf(cpf)),
 phone text check(phone is null or phone ~ '^[0-9]{10,15}$'),
 commission_rate numeric not null default 40 check(commission_rate between 0 and 100)
);

create table if not exists public.services(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 80),
 duration int not null check(duration between 5 and 600 and duration%5=0),
 price numeric not null check(price>=0),
 active boolean not null default true
);

create table if not exists public.customer_profiles(
 id uuid primary key references auth.users(id) on delete cascade,
 name text check(name is null or length(trim(name)) between 1 and 80),
 phone text check(phone is null or phone ~ '^[0-9]{10,15}$'),
 whatsapp_opt_in boolean not null default false
);

create table if not exists public.bookings(
 id uuid primary key default gen_random_uuid(),
 customer text not null,
 phone text not null,
 service_id uuid not null references public.services(id),
 barber_id uuid not null references public.barbers(id),
 service_name text not null,
 barber_name text not null,
 price numeric not null,
 starts_at timestamp not null,
 ends_at timestamp not null,
 status text not null default 'confirmed' check(status in ('confirmed','cancelled')),
 created_at timestamptz not null default now(),
 no_preference boolean not null default false,
 customer_id uuid references auth.users(id) on delete set null,
 attendance_state text not null default 'scheduled' check(attendance_state in ('scheduled','arrived','completed')),
 check(ends_at>starts_at)
);

create table if not exists public.attendances(
 booking_id uuid primary key references public.bookings(id) on delete restrict,
 arrived_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 base_price numeric not null check(base_price>=0),
 extras jsonb not null default '[]' check(jsonb_typeof(extras)='array'),
 discount numeric not null default 0 check(discount>=0),
 total numeric not null check(total>=0),
 payment_method text check(payment_method in ('pix','cash','debit','credit','transfer','courtesy','other')),
 paid boolean not null default false,
 paid_at timestamptz,
 notes text not null default '' check(length(notes)<=2000),
 version int not null default 1,
 updated_at timestamptz not null default clock_timestamp(),
 check(not paid or (payment_method is not null and paid_at is not null)),
 check(finished_at is null or paid)
);

-- Acesso (RLS) ----------------------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.admins where user_id=auth.uid());
$$;

alter table public.admins enable row level security;
alter table public.barbers enable row level security;
alter table public.barber_details enable row level security;
alter table public.services enable row level security;
alter table public.customer_profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.attendances enable row level security;
revoke all on public.admins from anon,authenticated;

drop policy if exists barbers_read on public.barbers;
drop policy if exists barbers_manage on public.barbers;
drop policy if exists barber_details_admin on public.barber_details;
drop policy if exists services_read on public.services;
drop policy if exists services_manage on public.services;
drop policy if exists customer_profile_self on public.customer_profiles;
drop policy if exists customer_profile_edit on public.customer_profiles;
drop policy if exists bookings_customer_read on public.bookings;
drop policy if exists bookings_cancel on public.bookings;
create policy barbers_read on public.barbers for select to anon,authenticated using(active or public.is_admin());
create policy barbers_manage on public.barbers for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy barber_details_admin on public.barber_details for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy services_read on public.services for select to anon,authenticated using(active or public.is_admin());
create policy services_manage on public.services for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy customer_profile_self on public.customer_profiles for select to authenticated using(id=auth.uid());
create policy customer_profile_edit on public.customer_profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy bookings_customer_read on public.bookings for select to authenticated using(customer_id=auth.uid());
create policy bookings_cancel on public.bookings for update to authenticated using(public.is_admin()) with check(public.is_admin());

-- Gatilhos ----------------------------------------------------------------------------------------------
create or replace function public.create_customer_profile()
returns trigger language plpgsql security definer set search_path='' as $$
declare customer_name text; customer_phone text;
begin
 customer_name:=nullif(left(trim(coalesce(new.raw_user_meta_data->>'name','')),80),'');
 customer_phone:=nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'phone',''),'[^0-9]','','g'),'');
 if customer_phone is not null and length(customer_phone) not between 10 and 15 then customer_phone:=null; end if;
 insert into public.customer_profiles(id,name,phone,whatsapp_opt_in)
 values(new.id,customer_name,customer_phone,coalesce(new.raw_user_meta_data->>'whatsapp_opt_in','false')='true')
 on conflict(id) do nothing;
 return new;
end;$$;
drop trigger if exists barber_customer_signup on auth.users;
create trigger barber_customer_signup after insert on auth.users for each row execute function public.create_customer_profile();

create or replace function public.protect_received_booking()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.attendance_state in ('arrived','completed') and
  (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
   or new.barber_id is distinct from old.barber_id or new.status is distinct from old.status) then
  raise exception 'O cliente já foi recebido. Não é possível cancelar ou remarcar esse agendamento.';
 end if;
 return new;
end;$$;
drop trigger if exists protect_received_booking on public.bookings;
create trigger protect_received_booking before update on public.bookings for each row execute function public.protect_received_booking();

-- Funções do chefe ----------------------------------------------------------------------------------
create or replace function public.save_barber(p_id uuid,p_name text,p_cpf text,p_phone text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; clean_cpf text; clean_phone text;
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Informe o nome do barbeiro.'; end if;
 clean_cpf:=nullif(regexp_replace(coalesce(p_cpf,''),'[^0-9]','','g'),'');
 clean_phone:=nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),'');
 if not public.valid_cpf(clean_cpf) then raise exception 'CPF inválido.'; end if;
 if clean_phone is not null and length(clean_phone) not between 10 and 15 then raise exception 'Informe celular com DDD.'; end if;
 if p_id is null then
  insert into public.barbers(name) values(trim(p_name)) returning id into result;
 else
  update public.barbers set name=trim(p_name) where id=p_id returning id into result;
  if result is null then raise exception 'Barbeiro não encontrado.'; end if;
 end if;
 insert into public.barber_details(barber_id,cpf,phone) values(result,clean_cpf,clean_phone)
 on conflict(barber_id) do update set cpf=excluded.cpf,phone=excluded.phone;
 return result;
exception when unique_violation then raise exception 'CPF já cadastrado para outro barbeiro.';
end;$$;

create or replace function public.save_barber_commission(p_barber uuid,p_rate numeric)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 if p_rate is null or p_rate<0 or p_rate>100 or p_rate<>round(p_rate,2) then
  raise exception 'A comissão deve ficar entre 0 e 100 por cento.';
 end if;
 if not exists(select 1 from public.barbers where id=p_barber) then raise exception 'Barbeiro não encontrado.'; end if;
 insert into public.barber_details(barber_id,commission_rate) values(p_barber,p_rate)
 on conflict(barber_id) do update set commission_rate=excluded.commission_rate;
end;$$;

create or replace function public.save_barber_photo(p_barber uuid,p_url text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 if p_url is null or p_url !~ '^https://' or length(p_url)>1000 then raise exception 'Endereço da foto inválido.'; end if;
 update public.barbers set photo_url=p_url where id=p_barber;
 if not found then raise exception 'Barbeiro não encontrado.'; end if;
end;$$;

-- available_slots e book_appointment ficam em horarios-loja.sql; admin_slots, admin_book, mark_arrival e
-- save_attendance (usadas também pela atendente) ficam em equipe-atendente.sql.
-- Funções do cliente --------------------------------------------------------------------------------
create or replace function public.customer_claim(p_booking uuid,p_phone text)
returns uuid language plpgsql security definer set search_path='' as $$
declare reservation public.bookings%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
 if p_phone is null or length(p_phone)>30 then raise exception 'Confira os dados da reserva.'; end if;
 select * into reservation from public.bookings
 where id=p_booking and regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g')
 and (customer_id is null or customer_id=auth.uid()) for update;
 if not found then raise exception 'Não foi possível vincular a reserva. Confira o código e o celular original.'; end if;
 update public.bookings set customer_id=auth.uid() where id=p_booking;
 return p_booking;
end;$$;

-- customer_change_slots fica em horarios-loja.sql.
create or replace function public.customer_reschedule(p_booking uuid,p_date date,p_time text,p_barber uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare reservation public.bookings%rowtype; chosen public.barbers%rowtype; new_start timestamp;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
 select * into reservation from public.bookings where id=p_booking and customer_id=auth.uid() for update;
 if not found then raise exception 'Reserva não encontrada na sua conta.'; end if;
 if reservation.status<>'confirmed' then raise exception 'Uma reserva cancelada não pode ser alterada.'; end if;
 if clock_timestamp()>(reservation.starts_at at time zone 'America/Manaus')-interval '1 hour' then
  raise exception 'O prazo terminou. Alterações exigem pelo menos 1 hora de antecedência.';
 end if;
 select * into chosen from public.barbers where id=p_barber and active for share;
 if not found then raise exception 'Barbeiro indisponível.'; end if;
 if not exists(select 1 from public.customer_change_slots(p_booking,p_date,p_barber) a where a.slot=p_time) then
  raise exception 'Horário indisponível. Escolha outro horário.';
 end if;
 new_start:=p_date+p_time::time;
 update public.bookings set starts_at=new_start,ends_at=new_start+(reservation.ends_at-reservation.starts_at),
  barber_id=chosen.id,barber_name=chosen.name,no_preference=false where id=p_booking;
 return p_booking;
exception when exclusion_violation then
 raise exception 'Este horário acabou de ser reservado. Sua reserva original foi mantida.';
end;$$;

-- Permissões: só o necessário para cada perfil.
revoke all on function public.save_barber(uuid,text,text,text),public.save_barber_commission(uuid,numeric),
 public.save_barber_photo(uuid,text),
 public.customer_claim(uuid,text),public.customer_reschedule(uuid,date,text,uuid) from public,anon;
grant execute on function public.save_barber(uuid,text,text,text),public.save_barber_commission(uuid,numeric),
 public.save_barber_photo(uuid,text),
 public.customer_claim(uuid,text),public.customer_reschedule(uuid,date,text,uuid) to authenticated;
revoke all on function public.create_customer_profile(),public.protect_received_booking() from public,anon,authenticated;

-- Fotos dos barbeiros (leitura pública, envio só do chefe) ------------------------------------------------
insert into storage.buckets(id,name,public) values('barber-photos','barber-photos',true) on conflict(id) do nothing;
drop policy if exists barber_photos_admin_select on storage.objects;
drop policy if exists barber_photos_admin_insert on storage.objects;
drop policy if exists barber_photos_admin_update on storage.objects;
drop policy if exists barber_photos_admin_delete on storage.objects;
create policy barber_photos_admin_select on storage.objects for select to authenticated using(bucket_id='barber-photos' and (select public.is_admin()));
create policy barber_photos_admin_insert on storage.objects for insert to authenticated with check(bucket_id='barber-photos' and (select public.is_admin()));
create policy barber_photos_admin_update on storage.objects for update to authenticated using(bucket_id='barber-photos' and (select public.is_admin())) with check(bucket_id='barber-photos' and (select public.is_admin()));
create policy barber_photos_admin_delete on storage.objects for delete to authenticated using(bucket_id='barber-photos' and (select public.is_admin()));
commit;
notify pgrst,'reload schema';
