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
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.';end if;
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
