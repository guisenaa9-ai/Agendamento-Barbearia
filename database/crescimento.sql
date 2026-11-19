-- Crescimento: lembretes e campanhas pelo WhatsApp (envio manual com 1 toque), avaliação no Google,
-- produtos com estoque, clube de assinatura, meta do barbeiro, avaliações dos clientes e gorjeta por Pix.
-- Execute depois de barbeiro-fidelidade.sql e equipe-atendente.sql. Repetível.
begin;
do $$ begin
 if to_regprocedure('public.is_staff()') is null or to_regprocedure('public.my_barber_id()') is null then
  raise exception 'Rode antes equipe-atendente.sql e barbeiro-fidelidade.sql (ou use atualizar-banco-existente.sql).';
 end if;
end $$;

-- Configurações e dados novos do barbeiro --------------------------------------------------------------
alter table public.shop_settings add column if not exists google_review_url text check(google_review_url is null or google_review_url ~ '^https://');
alter table public.barber_details add column if not exists monthly_goal numeric(10,2) check(monthly_goal is null or monthly_goal>=0);
alter table public.barber_details add column if not exists pix_key text check(pix_key is null or length(trim(pix_key)) between 3 and 120);

-- Registro do que já foi enviado pelo WhatsApp (o envio em si é feito pela equipe no app) -----------------
create table if not exists public.message_log(
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in('reminder','campaign','google','optout')),
 campaign text check(campaign is null or length(campaign)<=40),
 booking_id uuid references public.bookings(id) on delete cascade,
 phone text not null check(phone ~ '^[0-9]{10,15}$'),
 created_at timestamptz not null default now(),
 created_by uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists message_log_phone on public.message_log(phone,kind);
create index if not exists message_log_booking on public.message_log(booking_id);
alter table public.message_log enable row level security;
drop policy if exists message_log_staff_read on public.message_log;
drop policy if exists message_log_staff_insert on public.message_log;
drop policy if exists message_log_admin_delete on public.message_log;
create policy message_log_staff_read on public.message_log for select to authenticated using(public.is_staff());
-- A atendente registra só lembretes; campanhas, Google e "não enviar mais" são do chefe.
create policy message_log_staff_insert on public.message_log for insert to authenticated
 with check(public.is_admin() or (public.is_staff() and kind='reminder'));
create policy message_log_admin_delete on public.message_log for delete to authenticated using(public.is_admin());
revoke all on public.message_log from anon,authenticated;
grant select,insert,delete on public.message_log to authenticated;

-- Produtos e estoque ----------------------------------------------------------------------------------
create table if not exists public.products(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 80),
 price numeric(10,2) not null check(price>=0),
 stock int not null default 0 check(stock>=0),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.products enable row level security;
drop policy if exists products_staff_read on public.products;
drop policy if exists products_admin on public.products;
create policy products_staff_read on public.products for select to authenticated using(public.is_staff());
create policy products_admin on public.products for all to authenticated using(public.is_admin()) with check(public.is_admin());
revoke all on public.products from anon,authenticated;
grant select,insert,update,delete on public.products to authenticated;

-- Clube de assinatura (a cobrança da mensalidade é feita fora do sistema e registrada no painel) ------------
create table if not exists public.subscription_plans(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 80),
 price numeric(10,2) not null check(price>0),
 visits_per_month int check(visits_per_month is null or visits_per_month between 1 and 60),
 description text not null default '' check(length(description)<=300),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.subscriptions(
 id uuid primary key default gen_random_uuid(),
 plan_id uuid not null references public.subscription_plans(id),
 customer text not null check(length(trim(customer)) between 1 and 80),
 phone text not null check(phone ~ '^[0-9]{10,15}$'),
 active boolean not null default true,
 paid_until date not null,
 created_at timestamptz not null default now()
);
create unique index if not exists subscriptions_one_active on public.subscriptions(phone) where active;
alter table public.attendances add column if not exists subscription_id uuid references public.subscriptions(id) on delete set null;
alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;
drop policy if exists subscription_plans_admin on public.subscription_plans;
drop policy if exists subscriptions_admin on public.subscriptions;
create policy subscription_plans_admin on public.subscription_plans for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy subscriptions_admin on public.subscriptions for all to authenticated using(public.is_admin()) with check(public.is_admin());
revoke all on public.subscription_plans,public.subscriptions from anon,authenticated;
grant select,insert,update,delete on public.subscription_plans,public.subscriptions to authenticated;

-- "Assinatura" vira forma de pagamento: o serviço já foi pago na mensalidade.
alter table public.attendances drop constraint if exists attendances_payment_method_check;
alter table public.attendances add constraint attendances_payment_method_check
 check(payment_method in ('pix','cash','debit','credit','transfer','courtesy','subscription','other'));

-- Situação da assinatura do cliente desta reserva, para a ficha de atendimento.
create or replace function public.subscription_for_booking(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s record; used int; today date:=(clock_timestamp() at time zone 'America/Manaus')::date;
begin
 if not public.is_staff() then raise exception 'Acesso permitido somente à equipe da barbearia.'; end if;
 select x.id,x.paid_until,p.name plan,p.visits_per_month into s
 from public.bookings b join public.subscriptions x on x.active and x.phone=regexp_replace(b.phone,'[^0-9]','','g')
 join public.subscription_plans p on p.id=x.plan_id where b.id=p_booking;
 if not found then return null; end if;
 select count(*) into used from public.attendances a join public.bookings b on b.id=a.booking_id
  where a.subscription_id=s.id and a.booking_id<>p_booking and date_trunc('month',b.starts_at)=date_trunc('month',today::timestamp);
 return jsonb_build_object('id',s.id,'plan',s.plan,'paid_until',s.paid_until,'up_to_date',s.paid_until>=today,
  'limit',s.visits_per_month,'used',used,'available',s.paid_until>=today and (s.visits_per_month is null or used<s.visits_per_month));
end;$$;

-- Usa (ou deixa de usar) a assinatura neste atendimento. A ficha passa a ter desconto igual ao serviço.
create or replace function public.apply_subscription(p_booking uuid,p_apply boolean)
returns int language plpgsql security definer set search_path='' as $$
declare info jsonb; visit public.attendances%rowtype;
begin
 if not public.is_staff() then raise exception 'Acesso permitido somente à equipe da barbearia.'; end if;
 select * into visit from public.attendances where booking_id=p_booking for update;
 if not found then raise exception 'Confirme a chegada antes de usar a assinatura.'; end if;
 if visit.finished_at is not null then raise exception 'Este atendimento já foi concluído.'; end if;
 if p_apply then
  info:=public.subscription_for_booking(p_booking);
  if info is null then raise exception 'Este cliente não tem assinatura ativa.'; end if;
  if not (info->>'up_to_date')::boolean then raise exception 'A mensalidade da assinatura está atrasada. Registre o pagamento antes.'; end if;
  if not (info->>'available')::boolean then raise exception 'O cliente já usou todos os atendimentos do plano neste mês.'; end if;
 end if;
 update public.attendances set subscription_id=case when p_apply then (info->>'id')::uuid else null end,
  discount=case when p_apply then base_price else 0 end,
  total=case when p_apply then greatest(total-base_price+discount,0) else total+discount end,
  version=version+1,updated_at=clock_timestamp()
 where booking_id=p_booking returning version into visit.version;
 return visit.version;
end;$$;

-- Registra a mensalidade: entra no caixa do dia e adianta a validade em um mês.
create or replace function public.admin_subscription_payment(p_subscription uuid,p_method text)
returns date language plpgsql security definer set search_path='' as $$
declare s record; today date:=(clock_timestamp() at time zone 'America/Manaus')::date; next_date date;
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 if p_method is null or p_method not in ('pix','cash','debit','credit','transfer','other') then raise exception 'Selecione a forma de pagamento.'; end if;
 select x.*,p.price,p.name plan into s from public.subscriptions x join public.subscription_plans p on p.id=x.plan_id where x.id=p_subscription for update of x;
 if not found or not s.active then raise exception 'Assinatura não encontrada ou cancelada.'; end if;
 next_date:=(greatest(s.paid_until,today)+interval '1 month')::date;
 update public.subscriptions set paid_until=next_date where id=p_subscription;
 insert into public.cash_movements(business_date,kind,category,description,amount,payment_method)
 values(today,'income','Assinatura',s.plan||' · '||s.customer,s.price,p_method);
 return next_date;
end;$$;

-- Atendimento: mesma regra de antes + "Assinatura" e baixa de estoque dos produtos vendidos.
-- Substitui a versão de equipe-atendente.sql (este arquivo roda depois).
create or replace function public.save_attendance(p_booking uuid,p_version int,p_extras jsonb,p_discount numeric,p_method text,p_paid boolean,p_notes text,p_finish boolean)
returns int language plpgsql security definer set search_path='' as $$
declare visit public.attendances%rowtype; item jsonb; extra_total numeric:=0; amount numeric; quantity int; subtotal numeric; next_version int; booking_status text; product uuid;
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
  if item ? 'product_id' and (jsonb_typeof(item->'product_id')<>'string' or item->>'product_id' !~ '^[0-9a-f-]{36}$') then raise exception 'Produto inválido.'; end if;
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
 if p_paid and (p_method is null or p_method not in ('pix','cash','debit','credit','transfer','courtesy','subscription','other')) then raise exception 'Selecione a forma de pagamento.'; end if;
 if p_paid and p_method='courtesy' and subtotal-p_discount<>0 then raise exception 'Cortesia exige total igual a zero.'; end if;
 if p_paid and p_method='subscription' and (visit.subscription_id is null or subtotal-p_discount<>0) then
  raise exception 'Use "Usar assinatura" e cobre os extras com outra forma de pagamento. "Assinatura" só vale com total zero.';
 end if;
 if p_finish and not p_paid then raise exception 'Confirme o pagamento antes de concluir o atendimento.'; end if;
 if length(coalesce(p_notes,''))>2000 then raise exception 'Use até 2000 caracteres nas observações.'; end if;
 -- Ao concluir, cada produto vendido sai do estoque; falta de estoque impede a conclusão.
 if p_finish then
  for item in select value from jsonb_array_elements(p_extras) where value ? 'product_id' loop
   product:=(item->>'product_id')::uuid;
   update public.products set stock=stock-(item->>'quantity')::int where id=product and stock>=(item->>'quantity')::int;
   if not found then raise exception 'Estoque insuficiente de %. Confira o estoque em Serviços.',item->>'name'; end if;
  end loop;
 end if;
 update public.attendances set extras=p_extras,discount=p_discount,total=subtotal-p_discount,
  payment_method=case when p_paid then p_method else null end,paid=p_paid,
  paid_at=case when p_paid then coalesce(visit.paid_at,clock_timestamp()) else null end,
  notes=coalesce(p_notes,''),finished_at=case when p_finish then clock_timestamp() else null end,
  version=visit.version+1,updated_at=clock_timestamp()
 where booking_id=p_booking returning version into next_version;
 if p_finish then update public.bookings set attendance_state='completed' where id=p_booking; end if;
 return next_version;
end;$$;

-- Fidelidade: atendimento pago pela assinatura não conta ponto.
create or replace function public.loyalty_status(p_phone text)
returns jsonb language sql stable security definer set search_path='' as $$
 with cfg as (select loyalty_enabled enabled,loyalty_goal goal from public.shop_settings where id=1),
 visits as (
  select count(*) filter(where a.payment_method not in('courtesy','subscription')) earned,count(*) filter(where a.payment_method='courtesy') used
  from public.attendances a join public.bookings b on b.id=a.booking_id
  where a.paid and a.finished_at is not null
  and regexp_replace(b.phone,'[^0-9]','','g')=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')
  and length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'))>=10)
 select jsonb_build_object('enabled',coalesce(c.enabled,false),'goal',coalesce(c.goal,10),
  'progress',v.earned%coalesce(c.goal,10),
  'available',greatest(v.earned/coalesce(c.goal,10)-v.used,0))
 from visits v left join cfg c on true;
$$;

-- Avaliações dos clientes e gorjeta ----------------------------------------------------------------------
create table if not exists public.reviews(
 booking_id uuid primary key references public.bookings(id) on delete cascade,
 barber_id uuid not null references public.barbers(id) on delete cascade,
 rating int not null check(rating between 1 and 5),
 comment text not null default '' check(length(comment)<=300),
 created_at timestamptz not null default now()
);
alter table public.reviews enable row level security;
drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to authenticated using(
 public.is_admin() or barber_id=(select public.my_barber_id())
 or exists(select 1 from public.bookings b where b.id=booking_id and b.customer_id=auth.uid()));
revoke all on public.reviews from anon,authenticated;
grant select on public.reviews to authenticated;

-- O cliente avalia só o próprio atendimento concluído; pode mudar a nota depois.
create or replace function public.customer_review(p_booking uuid,p_rating int,p_comment text)
returns void language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
 select * into b from public.bookings where id=p_booking and customer_id=auth.uid();
 if not found or b.attendance_state<>'completed' then raise exception 'Só é possível avaliar atendimentos concluídos da sua conta.'; end if;
 if p_rating is null or p_rating not between 1 and 5 then raise exception 'Escolha de 1 a 5 estrelas.'; end if;
 if length(coalesce(p_comment,''))>300 then raise exception 'Use até 300 caracteres no comentário.'; end if;
 insert into public.reviews(booking_id,barber_id,rating,comment) values(p_booking,b.barber_id,p_rating,trim(coalesce(p_comment,'')))
 on conflict(booking_id) do update set rating=excluded.rating,comment=excluded.comment,created_at=now();
end;$$;

-- Chave Pix do barbeiro para gorjeta: só para o cliente de um atendimento concluído com ele.
create or replace function public.customer_tip_info(p_booking uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('barber_name',b.barber_name,'pix_key',d.pix_key)
 from public.bookings b join public.barber_details d on d.barber_id=b.barber_id
 where b.id=p_booking and b.customer_id=auth.uid() and b.attendance_state='completed' and d.pix_key is not null;
$$;

-- Painel do barbeiro: meta do mês, ganhos, previsão com a agenda marcada e avaliações.
create or replace function public.barber_month()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.my_barber_id(); rate numeric; goal numeric; agora timestamp:=clock_timestamp() at time zone 'America/Manaus';
 first_day date:=date_trunc('month',agora)::date; last_day date:=(date_trunc('month',agora)+interval '1 month -1 day')::date; gross numeric; booked numeric; result jsonb;
begin
 if me is null then raise exception 'Esta conta não está ligada a um barbeiro. Peça ao chefe para informar seu e-mail no cadastro de barbeiros.'; end if;
 select coalesce(commission_rate,40),monthly_goal into rate,goal from public.barber_details where barber_id=me;
 select coalesce(sum(a.total),0) into gross from public.bookings b join public.attendances a on a.booking_id=b.id and a.paid
  where b.barber_id=me and b.starts_at::date between first_day and last_day;
 select coalesce(sum(b.price),0) into booked from public.bookings b
  where b.barber_id=me and b.status='confirmed' and not b.no_show and b.attendance_state<>'completed'
  and b.starts_at>=agora and b.starts_at::date<=last_day;
 select jsonb_build_object('month',to_char(first_day,'YYYY-MM'),'rate',coalesce(rate,40),'goal',goal,'gross',gross,
  'commission',round(gross*coalesce(rate,40)/100,2),'forecast',gross+booked,
  'rating',(select round(avg(rating)::numeric,1) from public.reviews where barber_id=me),
  'reviews',(select count(*) from public.reviews where barber_id=me),
  'comments',coalesce((select jsonb_agg(x) from (select rating,comment,created_at from public.reviews
    where barber_id=me and comment<>'' order by created_at desc limit 5) x),'[]'::jsonb))
 into result;
 return result;
end;$$;

revoke all on function public.subscription_for_booking(uuid),public.apply_subscription(uuid,boolean),public.admin_subscription_payment(uuid,text),
 public.save_attendance(uuid,int,jsonb,numeric,text,boolean,text,boolean),public.customer_review(uuid,int,text),public.customer_tip_info(uuid),
 public.barber_month() from public,anon;
grant execute on function public.subscription_for_booking(uuid),public.apply_subscription(uuid,boolean),public.admin_subscription_payment(uuid,text),
 public.save_attendance(uuid,int,jsonb,numeric,text,boolean,text,boolean),public.customer_review(uuid,int,text),public.customer_tip_info(uuid),
 public.barber_month() to authenticated;
revoke all on function public.loyalty_status(text) from public,anon,authenticated;
commit;
notify pgrst,'reload schema';
