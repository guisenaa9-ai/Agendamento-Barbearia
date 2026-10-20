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
drop policy if exists bookings_read on public.bookings;
drop policy if exists bookings_cancel on public.bookings;
drop policy if exists attendances_admin_read on public.attendances;
create policy barbers_read on public.barbers for select to anon,authenticated using(active or public.is_admin());
create policy barbers_manage on public.barbers for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy barber_details_admin on public.barber_details for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy services_read on public.services for select to anon,authenticated using(active or public.is_admin());
create policy services_manage on public.services for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy customer_profile_self on public.customer_profiles for select to authenticated using(id=auth.uid());
create policy customer_profile_edit on public.customer_profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy bookings_customer_read on public.bookings for select to authenticated using(customer_id=auth.uid());
create policy bookings_read on public.bookings for select to authenticated using(public.is_admin());
create policy bookings_cancel on public.bookings for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy attendances_admin_read on public.attendances for select to authenticated using(public.is_admin());

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

-- available_slots e book_appointment ficam em horarios-loja.sql (única definição de cada).
create or replace function public.admin_slots(p_date date,p_service uuid,p_barber uuid)
returns table(slot text) language sql stable security definer set search_path='' as $$
 select distinct a.slot from public.barbers b
 cross join lateral public.available_slots(p_date,b.id,p_service) a
 where public.is_admin() and b.active and (p_barber is null or b.id=p_barber)
 order by a.slot;
$$;

create or replace function public.admin_book(p_date date,p_time text,p_service uuid,p_barber uuid,p_customer text,p_phone text)
returns uuid language plpgsql security definer set search_path='' as $$
declare candidate uuid; result uuid;
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
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
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
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
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
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
 public.save_barber_photo(uuid,text),public.admin_slots(date,uuid,uuid),
 public.admin_book(date,text,uuid,uuid,text,text),public.mark_arrival(uuid),
 public.save_attendance(uuid,int,jsonb,numeric,text,boolean,text,boolean),
 public.customer_claim(uuid,text),public.customer_reschedule(uuid,date,text,uuid) from public,anon;
grant execute on function public.save_barber(uuid,text,text,text),public.save_barber_commission(uuid,numeric),
 public.save_barber_photo(uuid,text),public.admin_slots(date,uuid,uuid),
 public.admin_book(date,text,uuid,uuid,text,text),public.mark_arrival(uuid),
 public.save_attendance(uuid,int,jsonb,numeric,text,boolean,text,boolean),
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
