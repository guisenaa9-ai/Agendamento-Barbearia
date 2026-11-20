-- Baixas na comissão do barbeiro e acerto (pagamento) da comissão.
-- Baixa = valor que a barbearia adiantou ou comprou para o barbeiro e desconta da comissão dele:
--   product  produto do estoque (o estoque diminui)       cash      vale em dinheiro (sai do Caixa do dia)
--   purchase compra parcelada (uma parcela por mês)        other     outra baixa
-- Acerto: comissão do período menos as baixas pendentes até o fim do período. Se as baixas passarem da
-- comissão, entram as mais antigas até o limite e o resto fica para o próximo acerto.
-- Execute depois de crescimento.sql. Repetível.
begin;
do $$ begin
 if to_regclass('public.products') is null or to_regprocedure('public.my_barber_id()') is null then
  raise exception 'Rode antes crescimento.sql e barbeiro-fidelidade.sql (ou use atualizar-banco-existente.sql).';
 end if;
end $$;

create table if not exists public.barber_settlements(
 id uuid primary key default gen_random_uuid(),
 barber_id uuid not null references public.barbers(id) on delete cascade,
 period_start date not null, period_end date not null check(period_end>=period_start),
 commission numeric(10,2) not null check(commission>=0),
 deductions numeric(10,2) not null check(deductions>=0),
 paid_amount numeric(10,2) not null check(paid_amount>=0),
 payment_method text not null check(payment_method in('pix','cash','transfer','other')),
 paid_at timestamptz not null default now(),
 created_by uuid default auth.uid() references auth.users(id) on delete set null
);
create table if not exists public.barber_deductions(
 id uuid primary key default gen_random_uuid(),
 barber_id uuid not null references public.barbers(id) on delete cascade,
 due_date date not null,
 kind text not null check(kind in('product','cash','purchase','other')),
 description text not null check(length(trim(description)) between 1 and 120),
 amount numeric(10,2) not null check(amount>0),
 product_id uuid references public.products(id) on delete set null,
 quantity int check(quantity is null or quantity between 1 and 99),
 group_id uuid not null default gen_random_uuid(),
 installment int not null default 1, installments int not null default 1 check(installments between 1 and 24 and installment between 1 and installments),
 cash_movement_id uuid references public.cash_movements(id) on delete set null,
 settlement_id uuid references public.barber_settlements(id) on delete restrict,
 created_at timestamptz not null default now(),
 created_by uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists barber_deductions_barber on public.barber_deductions(barber_id,due_date);
create index if not exists barber_settlements_barber on public.barber_settlements(barber_id,period_start);
alter table public.barber_deductions enable row level security;
alter table public.barber_settlements enable row level security;
drop policy if exists barber_deductions_read on public.barber_deductions;
drop policy if exists barber_settlements_read on public.barber_settlements;
-- Leitura: chefe vê tudo, barbeiro vê só as próprias. Escrita só pelas funções abaixo.
create policy barber_deductions_read on public.barber_deductions for select to authenticated using(public.is_admin() or barber_id=(select public.my_barber_id()));
create policy barber_settlements_read on public.barber_settlements for select to authenticated using(public.is_admin() or barber_id=(select public.my_barber_id()));
revoke all on public.barber_deductions,public.barber_settlements from anon,authenticated;
grant select on public.barber_deductions,public.barber_settlements to authenticated;

-- Conta do acerto (uso interno). Comissão arredondada por atendimento, igual ao Financeiro.
create or replace function public.settlement_data(p_barber uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rate numeric; commission numeric; done public.barber_settlements%rowtype; items jsonb:='[]'::jsonb; used numeric:=0; d record; fits boolean;
begin
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>366 then raise exception 'Período inválido.'; end if;
 if not exists(select 1 from public.barbers where id=p_barber) then raise exception 'Barbeiro não encontrado.'; end if;
 rate:=coalesce((select commission_rate from public.barber_details where barber_id=p_barber),40);
 select coalesce(sum(round(a.total*rate/100,2)),0) into commission from public.bookings b join public.attendances a on a.booking_id=b.id and a.paid
  where b.barber_id=p_barber and b.starts_at::date between p_start and p_end;
 select * into done from public.barber_settlements where barber_id=p_barber and period_start=p_start and period_end=p_end order by paid_at desc limit 1;
 if done.id is not null then
  -- Período já pago: mostra o que foi descontado nele.
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'due_date',x.due_date,'kind',x.kind,'description',x.description,'amount',x.amount,
   'installment',x.installment,'installments',x.installments,'included',true,'settled',true) order by x.due_date,x.created_at),'[]') into items
  from public.barber_deductions x where x.settlement_id=done.id;
  return jsonb_build_object('barber_id',p_barber,'rate',rate,'commission',done.commission,'deductions',done.deductions,'carry',0,
   'to_pay',done.paid_amount,'items',items,'settlement',jsonb_build_object('id',done.id,'paid_at',done.paid_at,'payment_method',done.payment_method,'paid_amount',done.paid_amount));
 end if;
 for d in select * from public.barber_deductions where barber_id=p_barber and settlement_id is null and due_date<=p_end order by due_date,created_at,installment loop
  fits:=used+d.amount<=commission;
  if fits then used:=used+d.amount; end if;
  items:=items||jsonb_build_object('id',d.id,'due_date',d.due_date,'kind',d.kind,'description',d.description,'amount',d.amount,
   'installment',d.installment,'installments',d.installments,'included',fits,'settled',false);
 end loop;
 return jsonb_build_object('barber_id',p_barber,'rate',rate,'commission',commission,'deductions',used,
  'carry',coalesce((select sum((i->>'amount')::numeric) from jsonb_array_elements(items) i where not (i->>'included')::boolean),0),
  'to_pay',commission-used,'items',items,'settlement',null);
end;$$;

create or replace function public.admin_barber_settlement(p_barber uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 return public.settlement_data(p_barber,p_start,p_end);
end;$$;

create or replace function public.my_settlement(p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=public.my_barber_id();
begin
 if me is null then raise exception 'Esta conta não está ligada a um barbeiro.'; end if;
 return public.settlement_data(me,p_start,p_end);
end;$$;

-- Lança uma baixa. Produto: valor do cadastro e saída do estoque. Vale: saída no Caixa do dia. Compra: parcelas mensais.
create or replace function public.admin_add_deduction(p_barber uuid,p_date date,p_kind text,p_description text,p_amount numeric,p_product uuid,p_quantity int,p_installments int)
returns uuid language plpgsql security definer set search_path='' as $$
declare grp uuid:=gen_random_uuid(); total numeric; parts int:=1; part numeric; first_part numeric; prod public.products%rowtype; cash uuid; descr text:=trim(coalesce(p_description,''));
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 if not exists(select 1 from public.barbers where id=p_barber) then raise exception 'Barbeiro não encontrado.'; end if;
 if p_date is null then raise exception 'Informe a data.'; end if;
 if p_kind not in('product','cash','purchase','other') then raise exception 'Tipo de despesa inválido.'; end if;
 if p_kind='product' then
  if p_quantity is null or p_quantity not between 1 and 99 then raise exception 'Quantidade de 1 a 99.'; end if;
  update public.products set stock=stock-p_quantity where id=p_product and active and stock>=p_quantity returning * into prod;
  if not found then raise exception 'Produto sem estoque suficiente.'; end if;
  total:=prod.price*p_quantity;
  if descr='' then descr:=prod.name||' x'||p_quantity; end if;
  if total<=0 then raise exception 'O produto está com preço zero.'; end if;
 else
  total:=p_amount;
  if total is null or total<=0 or total>100000 or total<>round(total,2) then raise exception 'Valor inválido.'; end if;
  if descr='' then raise exception 'Descreva a despesa.'; end if;
 end if;
 if length(descr)>120 then raise exception 'Descrição com até 120 caracteres.'; end if;
 if p_kind='purchase' then parts:=coalesce(p_installments,1); if parts not between 1 and 24 then raise exception 'Parcelas de 1 a 24.'; end if; end if;
 if p_kind='cash' then
  insert into public.cash_movements(business_date,kind,category,description,amount,payment_method)
  values(p_date,'withdrawal','Vale barbeiro',descr||' · '||(select name from public.barbers where id=p_barber),total,'cash') returning id into cash;
 end if;
 part:=trunc(total/parts,2); first_part:=total-part*(parts-1);
 for i in 1..parts loop
  insert into public.barber_deductions(barber_id,due_date,kind,description,amount,product_id,quantity,group_id,installment,installments,cash_movement_id)
  values(p_barber,(p_date+make_interval(months=>i-1))::date,p_kind,descr,case when i=1 then first_part else part end,
   case when p_kind='product' then p_product end,case when p_kind='product' then p_quantity end,grp,i,parts,cash);
 end loop;
 return grp;
end;$$;

-- Exclui a baixa (e as parcelas ainda não pagas da mesma compra). Devolve o estoque e tira o vale do Caixa.
create or replace function public.admin_delete_deduction(p_id uuid)
returns int language plpgsql security definer set search_path='' as $$
declare d public.barber_deductions%rowtype; removed int;
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 select * into d from public.barber_deductions where id=p_id for update;
 if not found then raise exception 'Despesa não encontrada.'; end if;
 if d.settlement_id is not null then raise exception 'Esta despesa já entrou num acerto pago e não pode ser excluída.'; end if;
 if d.kind='product' and d.product_id is not null then update public.products set stock=stock+d.quantity where id=d.product_id; end if;
 delete from public.barber_deductions where group_id=d.group_id and settlement_id is null;
 get diagnostics removed=row_count;
 if d.kind='cash' and d.cash_movement_id is not null then delete from public.cash_movements where id=d.cash_movement_id; end if;
 return removed;
end;$$;

-- Marca o acerto como pago. Pagamento em dinheiro sai do Caixa do dia.
create or replace function public.admin_settle(p_barber uuid,p_start date,p_end date,p_method text)
returns uuid language plpgsql security definer set search_path='' as $$
declare info jsonb; sid uuid; today date:=(clock_timestamp() at time zone 'America/Manaus')::date;
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 if p_method not in('pix','cash','transfer','other') then raise exception 'Escolha como o barbeiro foi pago.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('settle:'||p_barber::text,0));
 if exists(select 1 from public.barber_settlements where barber_id=p_barber and period_start<=p_end and period_end>=p_start) then
  raise exception 'Já existe um acerto pago que cobre parte deste período.'; end if;
 info:=public.settlement_data(p_barber,p_start,p_end);
 insert into public.barber_settlements(barber_id,period_start,period_end,commission,deductions,paid_amount,payment_method)
 values(p_barber,p_start,p_end,(info->>'commission')::numeric,(info->>'deductions')::numeric,(info->>'to_pay')::numeric,p_method) returning id into sid;
 update public.barber_deductions set settlement_id=sid
 where id in(select (i->>'id')::uuid from jsonb_array_elements(info->'items') i where (i->>'included')::boolean);
 if p_method='cash' and (info->>'to_pay')::numeric>0 then
  insert into public.cash_movements(business_date,kind,category,description,amount,payment_method)
  values(today,'withdrawal','Pagamento barbeiro',(select name from public.barbers where id=p_barber)||' · '||to_char(p_start,'DD/MM')||' a '||to_char(p_end,'DD/MM'),(info->>'to_pay')::numeric,'cash');
 end if;
 return sid;
end;$$;

revoke all on function public.settlement_data(uuid,date,date) from public,anon,authenticated;
revoke all on function public.admin_barber_settlement(uuid,date,date),public.my_settlement(date,date),
 public.admin_add_deduction(uuid,date,text,text,numeric,uuid,int,int),public.admin_delete_deduction(uuid),public.admin_settle(uuid,date,date,text) from public,anon;
grant execute on function public.admin_barber_settlement(uuid,date,date),public.my_settlement(date,date),
 public.admin_add_deduction(uuid,date,text,text,numeric,uuid,int,int),public.admin_delete_deduction(uuid),public.admin_settle(uuid,date,date,text) to authenticated;
commit;
notify pgrst,'reload schema';
