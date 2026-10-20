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
