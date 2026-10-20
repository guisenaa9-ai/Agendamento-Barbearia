-- Barbeiro pede folga/bloqueio (o chefe aprova ou recusa) e vê avisos de agendamento e cancelamento.
-- Execute depois de barbeiro-fidelidade.sql e painel-kryon.sql. Repetível.
begin;
do $$ begin
 if to_regprocedure('public.my_barber_id()') is null or to_regclass('public.kryon_booking_events') is null then
  raise exception 'Rode antes barbeiro-fidelidade.sql e painel-kryon.sql (ou use atualizar-banco-existente.sql).';
 end if;
end $$;

create table if not exists public.block_requests(
 id uuid primary key default gen_random_uuid(),
 barber_id uuid not null references public.barbers(id) on delete cascade,
 starts_at timestamp not null,
 ends_at timestamp not null,
 reason text not null check(length(trim(reason)) between 3 and 120),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),
 decided_at timestamptz,
 block_id uuid references public.schedule_blocks(id) on delete set null,
 check(ends_at>starts_at)
);
alter table public.block_requests enable row level security;
drop policy if exists block_requests_admin on public.block_requests;
drop policy if exists block_requests_barber on public.block_requests;
create policy block_requests_admin on public.block_requests for select to authenticated using(public.is_admin());
create policy block_requests_barber on public.block_requests for select to authenticated using(barber_id=(select public.my_barber_id()));
revoke all on public.block_requests from anon,authenticated;
grant select on public.block_requests to authenticated; -- gravações só pelas funções abaixo

create or replace function public.barber_request_block(p_start timestamp,p_end timestamp,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=public.my_barber_id(); result uuid;
begin
 if me is null then raise exception 'Esta conta não está ligada a um barbeiro.'; end if;
 if p_start is null or p_end is null or p_end<=p_start then raise exception 'O fim deve ser depois do início.'; end if;
 if p_start<clock_timestamp() at time zone 'America/Manaus' then raise exception 'Escolha um horário a partir de agora.'; end if;
 if p_end-p_start>interval '31 days' then raise exception 'Peça no máximo 31 dias por vez.'; end if;
 if length(trim(coalesce(p_reason,''))) not between 3 and 120 then raise exception 'Informe o motivo (3 a 120 caracteres).'; end if;
 if (select count(*) from public.block_requests where barber_id=me and status='pending')>=10 then
  raise exception 'Você já tem 10 pedidos aguardando o chefe.';
 end if;
 insert into public.block_requests(barber_id,starts_at,ends_at,reason) values(me,p_start,p_end,trim(p_reason)) returning id into result;
 return result;
end;$$;

-- Aprovar cria o bloqueio na agenda; recusar só registra a decisão.
create or replace function public.admin_decide_block(p_request uuid,p_approve boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.block_requests%rowtype; created uuid;
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 select * into r from public.block_requests where id=p_request for update;
 if not found then raise exception 'Pedido não encontrado.'; end if;
 if r.status<>'pending' then raise exception 'Este pedido já foi respondido.'; end if;
 if p_approve then
  insert into public.schedule_blocks(barber_id,starts_at,ends_at,reason) values(r.barber_id,r.starts_at,r.ends_at,r.reason) returning id into created;
 end if;
 update public.block_requests set status=case when p_approve then 'approved' else 'rejected' end,decided_at=now(),block_id=created where id=p_request;
 return created;
end;$$;

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

revoke all on function public.barber_request_block(timestamp,timestamp,text),public.admin_decide_block(uuid,boolean),public.barber_updates(int) from public,anon;
grant execute on function public.barber_request_block(timestamp,timestamp,text),public.admin_decide_block(uuid,boolean),public.barber_updates(int) to authenticated;
commit;
notify pgrst,'reload schema';
