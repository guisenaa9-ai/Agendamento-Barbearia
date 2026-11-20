/* Aba "Acerto dos barbeiros" (só chefe): comissão do mês menos as despesas que a barbearia pagou pelo barbeiro.
   Banco: database/baixas-barbeiro.sql. Também acrescenta as colunas Despesas e A pagar no relatório do Financeiro. */
(()=>{
const $=id=>document.getElementById(id),app=$('acerto-app'),api=window.BarberAPI,auth=window.StaffAuth;if(!app||!api||!auth)return;
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const field=(label,input)=>{const l=el('label',null,label);l.append(input);return l;};
const button=(text,cls,onclick)=>{const b=el('button',cls,text);b.type='button';if(onclick)b.onclick=onclick;return b;};
const req=async(path,opt={})=>api.request(path,{...opt,token:await auth.token()}),rpc=async(n,b)=>api.rpc(n,b,await auth.token());
const money=n=>api.money(Number(n)||0),br=d=>String(d).slice(0,10).split('-').reverse().join('/');
const KINDS={cash:'Vale em dinheiro',product:'Produto do estoque',purchase:'Compra parcelada',other:'Outra despesa'};
const METHODS=[['pix','Pix'],['cash','Dinheiro (sai do caixa)'],['transfer','Transferência'],['other','Outro']];
const PAID={pix:'Pix',cash:'Dinheiro',transfer:'Transferência',other:'Outro'};
let barbers=[],data=new Map(),selected=null,loading=0;

// Estrutura fixa da aba.
const month=el('input');month.type='month';month.id='acertomonth';month.value=api.day().slice(0,7);
const addBtn=button('+ Lançar despesa','acerto-add',()=>form());
const bar=el('div','acerto-bar');bar.append(field('Mês do acerto',month),addBtn);
const formSlot=el('div'),total=el('p','acerto-total'),cards=el('div','growth-cards acerto-cards'),detail=el('section','new-booking settlement acerto-detail'),status=el('p','growth-count');
detail.hidden=true;status.setAttribute('role','status');
app.append(bar,formSlot,total,cards,detail,status);
const say=t=>{status.textContent=t;};
const period=()=>{const [y,m]=month.value.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate();return {start:month.value+'-01',end:month.value+'-'+String(last).padStart(2,'0')};};
const monthName=()=>{const [y,m]=month.value.split('-').map(Number);return new Date(Date.UTC(y,m-1,15)).toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});};
month.onchange=()=>{if(/^\d{4}-\d{2}$/.test(month.value))load();};

async function load(){
 const run=++loading,{start,end}=period();say('Carregando…');
 try{
  barbers=await req('/rest/v1/barbers?select=id,name&active=eq.true&order=name');
  const rows=await Promise.all(barbers.map(b=>rpc('admin_barber_settlement',{p_barber:b.id,p_start:start,p_end:end})));
  if(run!==loading)return;data=new Map(rows.map(r=>[r.barber_id,r]));
  if(!data.has(selected))selected=null;say('');render();return true;
 }catch(e){if(run!==loading)return;cards.replaceChildren();total.textContent='';detail.hidden=true;say(e.message+' Execute baixas-barbeiro.sql no Supabase para ativar o acerto.');}
}
function line(label,value,cls){const p=el('p','bill-line'+(cls?' '+cls:''));p.append(el('span',null,label),el('strong',null,value));return p;}
function render(){
 const open=[...data.values()].filter(s=>!s.settlement),sum=open.reduce((t,s)=>t+Number(s.to_pay),0);
 total.replaceChildren(el('span',null,'A pagar em '+monthName()+': '),el('strong',null,money(sum)),el('span','growth-muted',' · '+(open.length?open.length+' de '+data.size+' barbeiros sem acerto pago':'todos os acertos pagos')));
 cards.replaceChildren(...barbers.map(b=>{const s=data.get(b.id),card=button('',"growth-card acerto-card",()=>{selected=selected===b.id?null:b.id;render();if(selected)detail.scrollIntoView({behavior:'smooth',block:'nearest'});});
  card.setAttribute('aria-pressed',String(selected===b.id));
  card.append(el('span','growth-card-title',b.name),el('span','growth-muted','Comissão '+money(s.commission)),el('span','growth-muted'+(Number(s.deductions)?' acerto-minus':''),'Despesas '+(Number(s.deductions)?'- ':'')+money(s.deductions)));
  if(s.settlement)card.append(el('span','acerto-paid','✓ Pago em '+br(new Date(s.settlement.paid_at).toLocaleDateString('en-CA',{timeZone:'America/Manaus'}))));
  card.append(el('strong',null,money(s.to_pay)),el('span','growth-muted',s.settlement?'pago':Number(s.carry)?'a pagar · '+money(s.carry)+' fica p/ o próximo mês':'a pagar'));
  return card;}));
 renderDetail();
}
function renderDetail(){
 const s=data.get(selected);detail.hidden=!s;if(!s)return;
 const name=barbers.find(b=>b.id===selected)?.name||'',paid=!!s.settlement;
 const head=el('div','settlement-head');head.append(el('h3',null,name+' · '+monthName()),button('Fechar','growth-stop',()=>{selected=null;render();}));
 detail.replaceChildren(head,line('Comissão do mês ('+Number(s.rate)+'%)',money(s.commission)),line('Despesas',(Number(s.deductions)?'- ':'')+money(s.deductions)));
 const list=el('div','growth-queue settlement-items');
 for(const i of s.items){const row=el('div','growth-row'+(i.included?'':' is-off'));
  const info=el('div');info.append(el('strong',null,i.description+(i.installments>1?' (parcela '+i.installment+'/'+i.installments+')':'')),
   el('span','growth-muted',br(i.due_date)+' · '+KINDS[i.kind]+(i.included?'':' · fica para o próximo acerto')));
  const actions=el('div','growth-actions');actions.append(el('strong',null,money(i.amount)));
  if(!i.settled)actions.append(button('Excluir','growth-stop',async()=>{
   if(!confirm('Excluir esta despesa'+(i.installments>1?' e as parcelas ainda não pagas desta compra':'')+'?'+(i.kind==='product'?' O produto volta ao estoque.':i.kind==='cash'?' A saída também sai do Caixa.':'')))return;
   try{await rpc('admin_delete_deduction',{p_id:i.id});await changed('Despesa excluída.');}catch(e){say(e.message);}}));
  row.append(info,actions);list.append(row);}
 if(!s.items.length)list.append(el('p','help','Nenhuma despesa neste mês.'));
 detail.append(list);
 if(Number(s.carry))detail.append(line('Fica para o próximo acerto',money(s.carry),'settlement-carry'));
 detail.append(line(paid?'Pago':'A pagar',money(s.to_pay),'bill-total'));
 if(paid){detail.append(el('p','settlement-paid','✓ Pago em '+new Date(s.settlement.paid_at).toLocaleDateString('pt-BR',{timeZone:'America/Manaus'})+' · '+(PAID[s.settlement.payment_method]||'')));return;}
 const actions=el('div','extra-shortcuts settlement-actions'),method=el('select');
 for(const [v,t] of METHODS){const o=el('option',null,t);o.value=v;method.append(o);}method.setAttribute('aria-label','Como o barbeiro foi pago');
 const pay=button('Marcar como pago',null,async()=>{
  if(!confirm('Marcar como pago o acerto de '+name+' ('+monthName()+'): '+money(s.to_pay)+'? Depois disso as despesas deste acerto não podem ser excluídas.'))return;
  pay.disabled=true;const {start,end}=period();
  try{await rpc('admin_settle',{p_barber:s.barber_id,p_start:start,p_end:end,p_method:method.value});await changed('Acerto de '+name+' marcado como pago.'+(method.value==='cash'?' A saída entrou no Caixa de hoje.':''));}catch(e){say(e.message);pay.disabled=false;}});
 actions.append(button('+ Lançar despesa para '+name.split(' ')[0],null,()=>form(selected)),method,pay);detail.append(actions);
}
async function changed(msg){if(await load())say(msg);refreshColumns();}

async function form(barber){
 $('deductionform')?.remove();
 if(!barbers.length)try{barbers=await req('/rest/v1/barbers?select=id,name&active=eq.true&order=name');}catch(e){return say(e.message);}
 const f=el('form','growth-form deduction-form');f.id='deductionform';
 const who=el('select');for(const b of barbers){const o=el('option',null,b.name);o.value=b.id;who.append(o);}who.required=true;if(barber||selected)who.value=barber||selected;
 const kind=el('select');for(const [v,t] of Object.entries(KINDS)){const o=el('option',null,t);o.value=v;kind.append(o);}
 const date=el('input');date.type='date';date.value=api.day();date.required=true;
 const descr=el('input');descr.maxLength=120;
 const amount=el('input');amount.type='number';amount.min='0.01';amount.step='0.01';
 const product=el('select'),qty=el('input');qty.type='number';qty.min='1';qty.max='99';qty.value='1';
 const parts=el('input');parts.type='number';parts.min='1';parts.max='24';parts.value='3';
 const L={descr:field('Descrição',descr),amount:field('Valor total (R$)',amount),product:field('Produto',product),qty:field('Quantidade',qty),parts:field('Parcelas (uma por mês)',parts)};
 try{const rows=await req('/rest/v1/products?select=id,name,price,stock&active=eq.true&stock=gt.0&order=name');for(const p of rows){const o=el('option',null,p.name+' · '+money(p.price)+' ('+p.stock+' no estoque)');o.value=p.id;product.append(o);}}catch{}
 const hint=el('p','help');
 const show=()=>{const k=kind.value;L.amount.hidden=k==='product';L.product.hidden=L.qty.hidden=k!=='product';L.parts.hidden=k!=='purchase';amount.required=k!=='product';
  descr.placeholder={cash:'Ex.: Vale de sábado',product:'Opcional: o nome do produto entra sozinho',purchase:'Ex.: Máquina de corte',other:'Ex.: Uniforme'}[k];
  hint.textContent={cash:'O valor também sai do Caixa do dia escolhido, como retirada em dinheiro.',product:product.options.length?'O valor vem do cadastro do produto e o estoque diminui.':'Nenhum produto com estoque. Cadastre em Serviços → Produtos.',purchase:'O valor total é dividido em parcelas, uma em cada mês, a partir da data escolhida.',other:'Qualquer outro valor que a barbearia pagou pelo barbeiro.'}[k];};
 kind.onchange=show;
 const save=el('button',null,'Lançar despesa'),cancel=button('Cancelar','growth-stop',()=>f.remove());
 f.append(el('h4',null,'Nova despesa do barbeiro'),field('Barbeiro',who),field('Tipo',kind),field('Data',date),L.descr,L.amount,L.product,L.qty,L.parts,save,cancel,hint);
 f.onsubmit=async e=>{e.preventDefault();const k=kind.value;save.disabled=true;
  try{await rpc('admin_add_deduction',{p_barber:who.value,p_date:date.value,p_kind:k,p_description:descr.value.trim(),p_amount:k==='product'?null:Number(amount.value),
    p_product:k==='product'?product.value||null:null,p_quantity:k==='product'?Number(qty.value):null,p_installments:k==='purchase'?Number(parts.value):null});
   const name=who.selectedOptions[0].textContent;selected=who.value;f.remove();
   // A despesa entra no mês da data escolhida: mostra esse mês.
   if(date.value.slice(0,7)!==month.value)month.value=date.value.slice(0,7);
   await changed('Despesa lançada para '+name+'.');}catch(ex){say(ex.message);save.disabled=false;}};
 formSlot.replaceChildren(f);show();kind.focus();
}

// Financeiro: colunas Despesas e A pagar no relatório e atalho para esta aba.
let lastReport=null;
async function refreshColumns(){
 if(!lastReport)return;const {start,end,report}=lastReport,table=document.querySelector('#tab-financeiro .finance-table');if(!table)return;
 const headRow=table.tHead?.rows[0];if(headRow&&!headRow.querySelector('.col-deductions'))for(const t of ['Despesas','A pagar'])headRow.append(el('th','col-deductions',t));
 const rows=[...$('financebody').rows];
 const list=await Promise.all(report.rows.map(r=>rpc('admin_barber_settlement',{p_barber:r.id,p_start:start,p_end:end}).catch(()=>null)));
 rows.forEach((tr,i)=>{tr.querySelectorAll('.col-deductions').forEach(td=>td.remove());const d=list[i];
  for(const v of [d?money(d.deductions):'—',d?money(d.to_pay)+(d.settlement?' ✓':''):'—'])tr.append(el('td','col-deductions',v));});
 const foot=$('financefoot')?.rows[0];if(foot){foot.querySelectorAll('.col-deductions').forEach(td=>td.remove());
  const sum=k=>list.reduce((s,d)=>s+(d?Number(d[k]):0),0);for(const v of [money(sum('deductions')),money(sum('to_pay'))])foot.append(el('td','col-deductions',v));}
}
const goAcerto=()=>{$('nav-acerto').click();form();};
const filters=document.querySelector('#tab-financeiro .finance-filters');
if(filters&&!$('financededuction')){const b=button('+ Despesa do barbeiro',null,goAcerto);b.id='financededuction';filters.append(b);}
window.addEventListener('financerendered',e=>{if(auth.role()!=='admin')return;lastReport=e.detail;refreshColumns();});
window.addEventListener('stafftabchange',e=>{if(e.detail.name==='acerto'&&auth.session()&&auth.role()==='admin')load();});
// O login pode terminar antes deste arquivo carregar (página aberta direto em #acerto).
if(!$('tab-acerto').hidden&&auth.role()==='admin')load();
})();
