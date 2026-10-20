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
