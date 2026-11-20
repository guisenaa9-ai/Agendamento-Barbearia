/* Financeiro (só chefe): sub-abas "Comissões" (comissão do mês menos despesas, e o pagamento) e "Despesas do barbeiro"
   (vales, produtos do estoque, compras parceladas). Banco: database/baixas-barbeiro.sql. As sub-abas vêm do subtabs.js. */
(()=>{
const $=id=>document.getElementById(id),com=$('acerto-app'),desp=$('despesas-app'),api=window.BarberAPI,auth=window.StaffAuth;if(!com||!desp||!api||!auth)return;
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const field=(label,input)=>{const l=el('label',null,label);l.append(input);return l;};
const button=(text,cls,onclick)=>{const b=el('button',cls,text);b.type='button';if(onclick)b.onclick=onclick;return b;};
const req=async(path,opt={})=>api.request(path,{...opt,token:await auth.token()}),rpc=async(n,b)=>api.rpc(n,b,await auth.token());
const money=n=>api.money(Number(n)||0),br=d=>String(d).slice(0,10).split('-').reverse().join('/');
const KINDS={cash:'Vale em dinheiro',product:'Produto do estoque',purchase:'Compra parcelada',other:'Outra despesa'};
const METHODS=[['pix','Pix'],['cash','Dinheiro (sai do caixa)'],['transfer','Transferência'],['other','Outro']];
const PAID={pix:'Pix',cash:'Dinheiro',transfer:'Transferência',other:'Outro'};
let month=api.day().slice(0,7),barbers=[],data=new Map(),selected=null,filter='',loading=0;
const period=()=>{const [y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate();return {start:month+'-01',end:month+'-'+String(last).padStart(2,'0')};};
const monthName=()=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1,15)).toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});};
const nameOf=id=>barbers.find(b=>b.id===id)?.name||'';
function monthInput(){const i=el('input');i.type='month';i.value=month;i.onchange=()=>{if(/^\d{4}-\d{2}$/.test(i.value)){month=i.value;load();}};return field('Mês',i);}
function status(){const p=el('p','growth-count');p.setAttribute('role','status');return p;}

// Estrutura das duas sub-abas.
const comBar=el('div','acerto-bar'),comTotal=el('p','acerto-total'),comTable=el('div','finance-table-wrap'),detail=el('section','new-booking settlement acerto-detail'),comStatus=status();
detail.hidden=true;
com.append(el('p','help','Comissão do mês menos as despesas que a barbearia pagou pelo barbeiro. Se as despesas passarem da comissão, o resto fica para o próximo mês.'),comBar,comTotal,comTable,detail,comStatus);
const despBar=el('div','acerto-bar'),formSlot=el('div'),despTotal=el('p','acerto-total'),despList=el('div','growth-queue settlement-items despesas-list'),despStatus=status();
desp.append(el('p','help','O que a barbearia pagou pelo barbeiro e desconta da comissão: vale em dinheiro (sai do Caixa), produto do estoque (o estoque diminui), compra parcelada (uma parcela por mês) ou outra despesa.'),despBar,formSlot,despTotal,despList,despStatus);
const say=t=>{comStatus.textContent=despStatus.textContent=t||'';};

async function load(){
 const run=++loading,{start,end}=period();say('Carregando…');
 try{
  barbers=await req('/rest/v1/barbers?select=id,name&active=eq.true&order=name');
  const [rows,items]=await Promise.all([Promise.all(barbers.map(b=>rpc('admin_barber_settlement',{p_barber:b.id,p_start:start,p_end:end}))),
   req('/rest/v1/barber_deductions?select=id,barber_id,due_date,kind,description,amount,installment,installments,settlement_id,created_at&due_date=gte.'+start+'&due_date=lte.'+end+'&order=due_date.desc')]);
  if(run!==loading)return;data=new Map(rows.map(r=>[r.barber_id,r]));if(!data.has(selected))selected=null;
  say('');renderCom();renderDesp(items);return true;
 }catch(e){if(run!==loading)return;say(e.message+' Execute baixas-barbeiro.sql no Supabase para ativar.');}
}
async function changed(msg){if(await load())say(msg);}

// Comissões: uma linha por barbeiro e o detalhe de quem está sendo pago.
function renderCom(){
 comBar.replaceChildren(monthInput());
 const open=[...data.values()].filter(s=>!s.settlement),sum=open.reduce((t,s)=>t+Number(s.to_pay),0);
 comTotal.replaceChildren(el('span',null,'A pagar em '+monthName()+': '),el('strong',null,money(sum)),el('span','growth-muted',' · '+(open.length?open.length+' de '+data.size+' barbeiros sem pagamento':'todos pagos')));
 const table=el('table','finance-table acerto-table'),head=el('tr');
 for(const t of ['Barbeiro','Comissão','Despesas','A pagar',''])head.append(el('th',null,t));
 table.append(el('thead'),el('tbody'));table.tHead.append(head);
 for(const b of barbers){const s=data.get(b.id),tr=el('tr');if(selected===b.id)tr.className='is-selected';
  const act=el('td','acerto-action');
  act.append(s.settlement?button('✓ Pago '+br(new Date(s.settlement.paid_at).toLocaleDateString('en-CA',{timeZone:'America/Manaus'})).slice(0,5),'acerto-paidbtn',()=>pick(b.id)):button(selected===b.id?'Fechar':'Pagar',null,()=>pick(b.id)));
  tr.append(el('td',null,b.name),el('td',null,money(s.commission)+' ('+Number(s.rate)+'%)'),el('td',Number(s.deductions)?'acerto-minus':null,(Number(s.deductions)?'- ':'')+money(s.deductions)),el('td','acerto-topay',money(s.to_pay)),act);
  table.tBodies[0].append(tr);}
 comTable.replaceChildren(table);renderDetail();
}
function pick(id){selected=selected===id?null:id;renderCom();if(selected)detail.scrollIntoView({behavior:'smooth',block:'nearest'});}
function line(label,value,cls){const p=el('p','bill-line'+(cls?' '+cls:''));p.append(el('span',null,label),el('strong',null,value));return p;}
function itemRow(i,who){const row=el('div','growth-row'+(i.included===false?' is-off':''));
 const info=el('div');info.append(el('strong',null,i.description+(i.installments>1?' (parcela '+i.installment+'/'+i.installments+')':'')),
  el('span','growth-muted',br(i.due_date)+(who?' · '+who:'')+' · '+KINDS[i.kind]+(i.included===false?' · fica para o próximo mês':'')+(i.settled?' · já paga':'')));
 const actions=el('div','growth-actions');actions.append(el('strong',null,money(i.amount)));
 if(!i.settled)actions.append(button('Excluir','growth-stop',async()=>{
  if(!confirm('Excluir esta despesa'+(i.installments>1?' e as parcelas ainda não pagas desta compra':'')+'?'+(i.kind==='product'?' O produto volta ao estoque.':i.kind==='cash'?' A saída também sai do Caixa.':'')))return;
  try{await rpc('admin_delete_deduction',{p_id:i.id});await changed('Despesa excluída.');}catch(e){say(e.message);}}));
 row.append(info,actions);return row;}
function renderDetail(){
 const s=data.get(selected);detail.hidden=!s;if(!s)return;
 const name=nameOf(selected),paid=!!s.settlement;
 const head=el('div','settlement-head');head.append(el('h3',null,name+' · '+monthName()),button('Fechar','growth-stop',()=>pick(selected)));
 detail.replaceChildren(head,line('Comissão do mês ('+Number(s.rate)+'%)',money(s.commission)),line('Despesas',(Number(s.deductions)?'- ':'')+money(s.deductions)));
 const list=el('div','growth-queue settlement-items');for(const i of s.items)list.append(itemRow(i));
 if(!s.items.length)list.append(el('p','help','Nenhuma despesa neste mês.'));
 detail.append(list);
 if(Number(s.carry))detail.append(line('Fica para o próximo mês',money(s.carry),'settlement-carry'));
 detail.append(line(paid?'Pago':'A pagar',money(s.to_pay),'bill-total'));
 if(paid){detail.append(el('p','settlement-paid','✓ Pago em '+new Date(s.settlement.paid_at).toLocaleDateString('pt-BR',{timeZone:'America/Manaus'})+' · '+(PAID[s.settlement.payment_method]||'')));return;}
 const actions=el('div','extra-shortcuts settlement-actions'),method=el('select');
 for(const [v,t] of METHODS)method.append(new Option(t,v));method.setAttribute('aria-label','Como o barbeiro foi pago');
 const pay=button('Marcar como pago',null,async()=>{
  if(!confirm('Marcar como pago o mês de '+name+' ('+monthName()+'): '+money(s.to_pay)+'? Depois disso as despesas deste mês não podem ser excluídas.'))return;
  pay.disabled=true;const {start,end}=period();
  try{await rpc('admin_settle',{p_barber:s.barber_id,p_start:start,p_end:end,p_method:method.value});await changed(name+' marcado como pago.'+(method.value==='cash'?' A saída entrou no Caixa de hoje.':''));}catch(e){say(e.message);pay.disabled=false;}});
 actions.append(method,pay);detail.append(actions);
}

// Despesas do barbeiro: lista do mês, filtro por barbeiro e o formulário.
function renderDesp(items){
 const who=el('select');who.setAttribute('aria-label','Filtrar por barbeiro');who.append(new Option('Todos os barbeiros',''));for(const b of barbers)who.append(new Option(b.name,b.id));who.value=filter;
 who.onchange=()=>{filter=who.value;renderDesp(items);};
 despBar.replaceChildren(monthInput(),field('Barbeiro',who),button('+ Lançar despesa','acerto-add',()=>form()));
 const shown=items.filter(i=>!filter||i.barber_id===filter);
 despTotal.replaceChildren(el('span',null,'Despesas em '+monthName()+': '),el('strong',null,money(shown.reduce((t,i)=>t+Number(i.amount),0))),el('span','growth-muted',' · '+shown.length+(shown.length===1?' lançamento':' lançamentos')));
 despList.replaceChildren(...shown.map(i=>itemRow({...i,settled:!!i.settlement_id},nameOf(i.barber_id))));
 if(!shown.length)despList.append(el('p','help','Nenhuma despesa neste mês.'));
}
async function form(){
 $('deductionform')?.remove();
 const f=el('form','growth-form deduction-form');f.id='deductionform';
 const who=el('select');for(const b of barbers)who.append(new Option(b.name,b.id));who.required=true;if(filter)who.value=filter;
 const kind=el('select');for(const [v,t] of Object.entries(KINDS))kind.append(new Option(t,v));
 const date=el('input');date.type='date';date.value=api.day();date.required=true;
 const descr=el('input');descr.maxLength=120;
 const amount=el('input');amount.type='number';amount.min='0.01';amount.step='0.01';
 const product=el('select'),qty=el('input');qty.type='number';qty.min='1';qty.max='99';qty.value='1';
 const parts=el('input');parts.type='number';parts.min='1';parts.max='24';parts.value='3';
 const L={descr:field('Descrição',descr),amount:field('Valor total (R$)',amount),product:field('Produto',product),qty:field('Quantidade',qty),parts:field('Parcelas (uma por mês)',parts)};
 try{const rows=await req('/rest/v1/products?select=id,name,price,stock&active=eq.true&stock=gt.0&order=name');for(const p of rows)product.append(new Option(p.name+' · '+money(p.price)+' ('+p.stock+' no estoque)',p.id));}catch{}
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
   const name=who.selectedOptions[0].textContent;f.remove();month=date.value.slice(0,7);// mostra o mês da despesa lançada
   await changed('Despesa lançada para '+name+'.');}catch(ex){say(ex.message);save.disabled=false;}};
 formSlot.replaceChildren(f);show();kind.focus();
}

const wanted=()=>auth.session()&&auth.role()==='admin'&&!$('tab-financeiro').hidden&&['Comissões','Despesas do barbeiro'].includes(window.StaffSubtabs?.current('financeiro'));
window.addEventListener('staffsubtab',e=>{if(e.detail.tab==='financeiro'&&wanted())load();});
window.addEventListener('stafftabchange',e=>{if(e.detail.name==='financeiro'&&wanted())load();});
})();
