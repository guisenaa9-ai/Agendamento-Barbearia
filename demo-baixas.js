// Demonstração: baixas na comissão e acerto do barbeiro, com as mesmas regras de database/baixas-barbeiro.sql.
// Só age em modo demonstração (demo-mock.js expõe window.DemoMock).
(function(){
const M=window.DemoMock;if(!M)return;
const db=M.db(),{fail,uuid,day,now,save}=M;
const cents=v=>Math.round(Number(v)*100),reais=c=>c/100;
// Mesma regra do PostgreSQL: soma meses e, se o dia não existir, usa o último dia do mês.
function addMonths(d,n){const [y,m,dd]=d.split('-').map(Number),t=new Date(Date.UTC(y,m-1+n,1)),last=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,0)).getUTCDate();t.setUTCDate(Math.min(dd,last));return t.toISOString().slice(0,10);}
function add(barber,date,kind,description,amount,extra={}){const grp=uuid(),parts=extra.installments||1,total=cents(amount),part=Math.trunc(total/parts),first=total-part*(parts-1);
 for(let i=1;i<=parts;i++)db.barber_deductions.push({id:uuid(),barber_id:barber,due_date:addMonths(date,i-1),kind,description,amount:reais(i===1?first:part),product_id:extra.product_id||null,quantity:extra.quantity||null,group_id:grp,installment:i,installments:parts,cash_movement_id:extra.cash||null,settlement_id:null,created_at:now()+'.'+String(i).padStart(3,'0')});
 return grp;}
if(!db.barber_deductions){db.barber_deductions=[];db.barber_settlements=[];
 const cash={id:uuid(),business_date:day(-12),kind:'withdrawal',category:'Vale barbeiro',description:'Vale · Daniel Silva',amount:100,payment_method:'cash',created_at:now()};db.cash_movements.push(cash);
 add('b1',day(-12),'cash','Vale em dinheiro',100,{cash:cash.id});
 add('b1',day(-5),'product','Pomada modeladora x1',45,{product_id:'p1',quantity:1});
 add('b1',day(-15),'purchase','Máquina de corte',120,{installments:3});
 save();}
function settlementData(barber,start,end){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end||'')||start>end)fail('Período inválido.');
 if(!db.barbers.some(b=>b.id===barber))fail('Barbeiro não encontrado.');
 const rate=Number(db.barber_details.find(d=>d.barber_id===barber)?.commission_rate??40);
 let commission=0;for(const a of db.attendances){if(!a.paid)continue;const b=db.bookings.find(r=>r.id===a.booking_id);if(b&&b.barber_id===barber&&b.starts_at.slice(0,10)>=start&&b.starts_at.slice(0,10)<=end)commission+=Math.round(cents(a.total)*rate/100);}
 const done=db.barber_settlements.filter(s=>s.barber_id===barber&&s.period_start===start&&s.period_end===end).at(-1);
 const view=(d,included,settled)=>({id:d.id,due_date:d.due_date,kind:d.kind,description:d.description,amount:d.amount,installment:d.installment,installments:d.installments,included,settled});
 if(done)return {barber_id:barber,rate,commission:done.commission,deductions:done.deductions,carry:0,to_pay:done.paid_amount,
  items:db.barber_deductions.filter(d=>d.settlement_id===done.id).sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.created_at.localeCompare(b.created_at)).map(d=>view(d,true,true)),settlement:{id:done.id,paid_at:done.paid_at,payment_method:done.payment_method,paid_amount:done.paid_amount}};
 let used=0,carry=0;const items=db.barber_deductions.filter(d=>d.barber_id===barber&&!d.settlement_id&&d.due_date<=end)
  .sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.created_at.localeCompare(b.created_at)||a.installment-b.installment)
  .map(d=>{const fits=used+cents(d.amount)<=commission;if(fits)used+=cents(d.amount);else carry+=cents(d.amount);return view(d,fits,false);});
 return {barber_id:barber,rate,commission:reais(commission),deductions:reais(used),carry:reais(carry),to_pay:reais(commission-used),items,settlement:null};
}
Object.assign(M.rpc,{
 admin_barber_settlement:p=>settlementData(p.p_barber,p.p_start,p.p_end),
 my_settlement:p=>settlementData(M.myBarber(),p.p_start,p.p_end),
 admin_add_deduction:p=>{if(!db.barbers.some(b=>b.id===p.p_barber))fail('Barbeiro não encontrado.');if(!p.p_date)fail('Informe a data.');
  if(!['product','cash','purchase','other'].includes(p.p_kind))fail('Tipo de baixa inválido.');let total,descr=String(p.p_description||'').trim(),extra={};
  if(p.p_kind==='product'){const q=p.p_quantity;if(!(q>=1&&q<=99))fail('Quantidade de 1 a 99.');const pr=db.products.find(x=>x.id===p.p_product&&x.active);if(!pr||pr.stock<q)fail('Produto sem estoque suficiente.');
   pr.stock-=q;total=pr.price*q;if(!descr)descr=pr.name+' x'+q;extra={product_id:pr.id,quantity:q};}
  else{total=Number(p.p_amount);if(!(total>0)||total>100000||cents(total)/100!==total)fail('Valor inválido.');if(!descr)fail('Descreva a baixa.');}
  if(descr.length>120)fail('Descrição com até 120 caracteres.');
  if(p.p_kind==='purchase'){extra.installments=p.p_installments||1;if(!(extra.installments>=1&&extra.installments<=24))fail('Parcelas de 1 a 24.');}
  if(p.p_kind==='cash'){const c={id:uuid(),business_date:p.p_date,kind:'withdrawal',category:'Vale barbeiro',description:descr+' · '+db.barbers.find(b=>b.id===p.p_barber).name,amount:total,payment_method:'cash',created_at:now()};db.cash_movements.push(c);extra.cash=c.id;}
  const grp=add(p.p_barber,p.p_date,p.p_kind,descr,total,extra);save();return grp;},
 admin_delete_deduction:p=>{const d=db.barber_deductions.find(x=>x.id===p.p_id);if(!d)fail('Baixa não encontrada.');if(d.settlement_id)fail('Esta baixa já entrou num acerto pago e não pode ser excluída.');
  if(d.kind==='product'&&d.product_id){const pr=db.products.find(x=>x.id===d.product_id);if(pr)pr.stock+=d.quantity;}
  const before=db.barber_deductions.length;db.barber_deductions=db.barber_deductions.filter(x=>!(x.group_id===d.group_id&&!x.settlement_id));
  if(d.kind==='cash'&&d.cash_movement_id)db.cash_movements=db.cash_movements.filter(c=>c.id!==d.cash_movement_id);save();return before-db.barber_deductions.length;},
 admin_settle:p=>{if(!['pix','cash','transfer','other'].includes(p.p_method))fail('Escolha como o barbeiro foi pago.');
  if(db.barber_settlements.some(s=>s.barber_id===p.p_barber&&s.period_start<=p.p_end&&s.period_end>=p.p_start))fail('Já existe um acerto pago que cobre parte deste período.');
  const info=settlementData(p.p_barber,p.p_start,p.p_end),id=uuid();
  db.barber_settlements.push({id,barber_id:p.p_barber,period_start:p.p_start,period_end:p.p_end,commission:info.commission,deductions:info.deductions,paid_amount:info.to_pay,payment_method:p.p_method,paid_at:new Date().toISOString()});
  for(const i of info.items)if(i.included)db.barber_deductions.find(d=>d.id===i.id).settlement_id=id;
  if(p.p_method==='cash'&&info.to_pay>0)db.cash_movements.push({id:uuid(),business_date:day(0),kind:'withdrawal',category:'Pagamento barbeiro',description:db.barbers.find(b=>b.id===p.p_barber).name,amount:info.to_pay,payment_method:'cash',created_at:now()});
  save();return id;}});
})();
