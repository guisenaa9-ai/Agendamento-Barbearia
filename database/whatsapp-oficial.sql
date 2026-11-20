-- WhatsApp oficial (API Cloud da Meta): lembrete automático na véspera e robô de agendamento.
-- Fica DESLIGADO até o chefe preencher os dados da Meta no painel e ligar. Veja WHATSAPP-OFICIAL.md.
-- Execute depois de crescimento.sql. Repetível.
begin;
do $$ begin
 if to_regclass('public.message_log') is null or to_regprocedure('public.book_appointment(date,text,uuid,uuid,text,text)') is null then
  raise exception 'Rode antes crescimento.sql e sem-preferencia-cliente.sql (ou use atualizar-banco-existente.sql).';
 end if;
end $$;

-- Configuração (o token da Meta NÃO fica aqui: é um segredo da Edge Function) ---------------------------
create table if not exists public.whatsapp_settings(
 id int primary key default 1 check(id=1),
 enabled boolean not null default false,
 reminders_enabled boolean not null default true,
 bot_enabled boolean not null default true,
 phone_number_id text check(phone_number_id is null or phone_number_id ~ '^[0-9]{5,30}$'),
 template_name text not null default 'lembrete_horario' check(template_name ~ '^[a-z0-9_]+$' and length(template_name)<=512),
 template_lang text not null default 'pt_BR' check(template_lang ~ '^[a-z]{2}(_[A-Z]{2})?$'),
 graph_version text not null default 'v26.0' check(graph_version ~ '^v[0-9]{2}\.0$'),
 reminder_hour int not null default 18 check(reminder_hour between 6 and 22),
 last_run_at timestamptz,
 last_result text check(last_result is null or length(last_result)<=500)
);
insert into public.whatsapp_settings(id) values(1) on conflict do nothing;
alter table public.whatsapp_settings enable row level security;
drop policy if exists whatsapp_settings_admin on public.whatsapp_settings;
create policy whatsapp_settings_admin on public.whatsapp_settings for all to authenticated using(public.is_admin()) with check(public.is_admin());
revoke all on public.whatsapp_settings from anon,authenticated;
grant select,update on public.whatsapp_settings to authenticated;

-- O que saiu pela API fica marcado igual ao envio manual (o painel mostra ✓ Enviado nos dois casos).
alter table public.message_log add column if not exists channel text not null default 'manual' check(channel in('manual','api'));
alter table public.message_log add column if not exists provider_id text check(provider_id is null or length(provider_id)<=200);

-- Conversa do robô: em que passo cada celular está. Só a Edge Function (service_role) usa.
create table if not exists public.wa_sessions(
 phone text primary key check(phone ~ '^[0-9]{10,15}$'),
 step text not null default 'start' check(length(step)<=30),
 data jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table public.wa_sessions enable row level security;
revoke all on public.wa_sessions from anon,authenticated;

-- Reserva feita pelo robô: mesmas regras do site (horário livre, 3 horários futuros e 10 reservas em 24 h por celular).
create or replace function public.bot_book(p_phone text,p_name text,p_date date,p_time text,p_barber uuid,p_service uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare clean text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'); candidate uuid; result uuid;
begin
 if length(clean) not between 10 and 15 then raise exception 'Celular inválido.'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Informe o nome.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('bot_book:'||clean,0));
 if (select count(*) from public.bookings r where regexp_replace(r.phone,'[^0-9]','','g')=clean and r.status='confirmed'
     and r.starts_at>clock_timestamp() at time zone 'America/Manaus')>=3 then
  raise exception 'Você já tem 3 horários marcados. Cancele um para agendar outro.'; end if;
 if (select count(*) from public.bookings r where regexp_replace(r.phone,'[^0-9]','','g')=clean and r.created_at>clock_timestamp()-interval '24 hours')>=10 then
  raise exception 'Muitas reservas em pouco tempo. Fale com a barbearia.'; end if;
 if p_barber is null then
  select b.id into candidate from public.barbers b
  where b.active and exists(select 1 from public.available_slots(p_date,b.id,p_service) a where a.slot=p_time)
  order by (select count(*) from public.bookings r where r.barber_id=b.id and r.status='confirmed' and r.starts_at::date=p_date),b.name,b.id
  limit 1;
  if candidate is null then raise exception 'Esse horário acabou de ser ocupado. Escolha outro.'; end if;
 else candidate:=p_barber;
 end if;
 result:=public.book_appointment(p_date,p_time,candidate,p_service,trim(p_name),clean);
 update public.bookings set no_preference=(p_barber is null) where id=result;
 return result;
end;$$;

-- Lembretes que faltam: reservas de amanhã sem lembrete, a partir da hora configurada (horário de Manaus).
create or replace function public.whatsapp_due_reminders(p_limit int)
returns table(booking_id uuid,customer text,phone text,service_name text,barber_name text,starts_at timestamp)
language sql stable security definer set search_path='' as $$
 with cfg as (select reminder_hour,(clock_timestamp() at time zone 'America/Manaus') agora from public.whatsapp_settings where id=1 and enabled and reminders_enabled)
 select r.id,r.customer,regexp_replace(r.phone,'[^0-9]','','g'),r.service_name,r.barber_name,r.starts_at
 from public.bookings r cross join cfg
 where extract(hour from cfg.agora)>=cfg.reminder_hour
 and r.status='confirmed' and not r.no_show and r.starts_at::date=cfg.agora::date+1
 and length(regexp_replace(r.phone,'[^0-9]','','g')) between 10 and 15
 and not exists(select 1 from public.message_log m where m.booking_id=r.id and m.kind='reminder')
 order by r.starts_at limit least(greatest(coalesce(p_limit,20),1),100);
$$;

revoke all on function public.bot_book(text,text,date,text,uuid,uuid),public.whatsapp_due_reminders(int) from public,anon,authenticated;
grant execute on function public.bot_book(text,text,date,text,uuid,uuid),public.whatsapp_due_reminders(int) to service_role;
commit;
notify pgrst,'reload schema';
