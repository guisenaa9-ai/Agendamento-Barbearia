/* Financeiro (só chefe): acerto do barbeiro e baixas na comissão. Usa o período do relatório financeiro.
   Banco: database/baixas-barbeiro.sql. Também acrescenta as colunas Baixas e A pagar no relatório. */
(()=>{
const $=id=>document.getElementById(id),tab=$('tab-financeiro'),api=window.BarberAPI,auth=window.StaffAuth;if(!tab||!api||!auth)return;
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const field=(label,input)=>{const l=el('label',null,label);l.append(input);return l;};
const req=async(path,opt={})=>api.request(path,{...opt,token:await auth.token()}),rpc=async(n,b)=>api.rpc(n,b,await auth.token());
const money=n=>api.money(Number(n)||0),br=d=>String(d).slice(0,10).split('-').reverse().join('/');
const KINDS={cash:'Vale em dinheiro',product:'Produto do estoque',purchase:'Compra parcelada',other:'Outra baixa'};
const METHODS=[['pix','Pix'],['cash','Dinheiro (sai do caixa)'],['transfer','Transferência'],['other','Outro']];
let barbers=[],current=null,loading=0;
const period=()=>({start:$('financestart')?.value,end:$('financeend')?.value});

function mount(){
 if($('settlement'))return;
 const box=el('section','new-booking settlement');box.id='settlement';
 const pick=el('select');pick.id='settlementbarber';pick.setAttribute('aria-label','Barbeiro do acerto');pick.onchange=load;
 const head=el('div','settlement-head');head.append(el('h3',null,'Acerto do barbeiro'),pick);
 box.append(head,el('p','help','Comissão do período do relatório acima, menos as baixas: vales, produtos que o barbeiro levou e compras feitas para ele. Se as baixas passarem da comissão, o que sobrar fica para o próximo acerto.'),
  el('p','settlement-period'),el('div','settlement-body'),el('p','growth-count'));
 box.querySelector('.settlement-period').id='settlementperiod';box.querySelector('.settlement-body').id='settlementbody';
 const st=box.querySelector('.growth-count');st.id='settlementstatus';st.setAttribute('role','status');
 (tab.querySelector('.finance-table-wrap')||tab.lastElementChild).after(box);
}
const say=t=>{const p=$('settlementstatus');if(p)p.textContent=t;};

async function load(){
 const run=++loading,{start,end}=period(),barber=$('settlementbarber').value;if(!start||!end||!barber)return;
 $('settlementperiod').textContent='Período: '+br(start)+' a '+br(end)+' (o mesmo do relatório)';
 try{current=await rpc('admin_barber_settlement',{p_barber:barber,p_start:start,p_end:end});if(run!==loading)return;render();}
 catch(e){$('settlementbody').replaceChildren(el('p','help',e.message+' Execute baixas-barbeiro.sql no Supabase para ativar o acerto.'));}
}
function line(label,value,cls){const p=el('p','bill-line'+(cls?' '+cls:''));p.append(el('span',null,label),el('strong',null,value));return p;}
function render(){
 const s=current,paid=!!s.settlement,body=$('settlementbody');body.replaceChildren();
 body.append(line('Comissão do período',money(s.commission)),line('Baixas',(Number(s.deductions)?'- ':'')+money(s.deductions)));
 const list=el('div','growth-queue settlement-items');
 for(const i of s.items){const row=el('div','growth-row'+(i.included?'':' is-off'));
  const info=el('div');info.append(el('strong',null,i.description+(i.installments>1?' (parcela '+i.installment+'/'+i.installments+')':'')),
   el('span','growth-muted',br(i.due_date)+' · '+KINDS[i.kind]+(i.included?'':' · fica para o próximo acerto')));
  const actions=el('div','growth-actions');actions.append(el('strong',null,money(i.amount)));
  if(!i.settled){const del=el('button','growth-stop','Excluir');del.type='button';
   del.onclick=async()=>{if(!confirm('Excluir esta baixa'+(i.installments>1?' e as parcelas ainda não pagas desta compra':'')+'?'+(i.kind==='product'?' O produto volta ao estoque.':i.kind==='cash'?' A saída também sai do Caixa.':'')))return;
    try{await rpc('admin_delete_deduction',{p_id:i.id});say('Baixa excluída.');await load();}catch(e){say(e.message);}};actions.append(del);}
  row.append(info,actions);list.append(row);}
 if(!s.items.length)list.append(el('p','help','Nenhuma baixa neste acerto.'));
 body.append(list);
 if(Number(s.carry))body.append(line('Fica para o próximo acerto',money(s.carry),'settlement-carry'));
 body.append(line(paid?'Pago':'A pagar',money(s.to_pay),'bill-total'));
 if(paid){body.append(el('p','settlement-paid','✓ Pago em '+new Date(s.settlement.paid_at).toLocaleDateString('pt-BR',{timeZone:'America/Manaus'})+' · '+({pix:'Pix',cash:'Dinheiro',transfer:'Transferência',other:'Outro'}[s.settlement.payment_method]||'')));return;}
 const actions=el('div','extra-shortcuts settlement-actions'),add=el('button',null,'+ Lançar baixa');add.type='button';add.onclick=()=>form(actions);
 const method=el('select');for(const [v,t] of METHODS){const o=el('option',null,t);o.value=v;method.append(o);}method.setAttribute('aria-label','Como o barbeiro foi pago');
 const pay=el('button',null,'Marcar como pago');pay.type='button';
 pay.onclick=async()=>{const name=$('settlementbarber').selectedOptions[0].textContent;
  if(!confirm('Marcar como pago o acerto de '+name+': '+money(s.to_pay)+'? Depois disso as baixas deste acerto não podem ser excluídas.'))return;
  pay.disabled=true;try{await rpc('admin_settle',{p_barber:s.barber_id,p_start:period().start,p_end:period().end,p_method:method.value});say('Acerto marcado como pago.'+(method.value==='cash'?' A saída entrou no Caixa de hoje.':''));await load();refreshColumns();}catch(e){say(e.message);pay.disabled=false;}};
 actions.append(add,method,pay);body.append(actions);
}
async function form(anchor){
 if($('deductionform'))return $('deductionform').querySelector('select').focus();
 const f=el('form','growth-form deduction-form');f.id='deductionform';
 const kind=el('select');for(const [v,t] of Object.entries(KINDS)){const o=el('option',null,t);o.value=v;kind.append(o);}
 const date=el('input');date.type='date';date.value=api.day();date.required=true;
 const descr=el('input');descr.maxLength=120;descr.placeholder='Ex.: Vale de sábado';
 const amount=el('input');amount.type='number';amount.min='0.01';amount.step='0.01';
 const product=el('select'),qty=el('input');qty.type='number';qty.min='1';qty.max='99';qty.value='1';
 const parts=el('input');parts.type='number';parts.min='1';parts.max='24';parts.value='3';
 const wrap=(label,input)=>{const l=field(label,input);l.dataset.for=label;return l;};
 const L={descr:wrap('Descrição',descr),amount:wrap('Valor total (R$)',amount),product:wrap('Produto',product),qty:wrap('Quantidade',qty),parts:wrap('Parcelas (uma por mês)',parts)};
 try{const rows=await req('/rest/v1/products?select=id,name,price,stock&active=eq.true&stock=gt.0&order=name');for(const p of rows){const o=el('option',null,p.name+' · '+money(p.price)+' ('+p.stock+')');o.value=p.id;product.append(o);}}catch{}
 const show=()=>{const k=kind.value;L.amount.hidden=k==='product';L.product.hidden=L.qty.hidden=k!=='product';L.parts.hidden=k!=='purchase';
  descr.placeholder={cash:'Ex.: Vale de sábado',product:'Opcional: o nome do produto entra sozinho',purchase:'Ex.: Máquina de corte',other:'Ex.: Uniforme'}[k];
  hint.textContent={cash:'O valor também sai do Caixa do dia escolhido, como retirada em dinheiro.',product:'O valor vem do cadastro do produto e o estoque diminui.',purchase:'O valor total é dividido em parcelas, uma em cada mês, a partir da data escolhida.',other:''}[k];};
 const hint=el('p','help');kind.onchange=show;
 const save=el('button',null,'Lançar baixa'),cancel=el('button','growth-stop','Cancelar');cancel.type='button';cancel.onclick=()=>f.remove();
 f.append(field('Tipo',kind),field('Data',date),L.descr,L.amount,L.product,L.qty,L.parts,save,cancel,hint);
 f.onsubmit=async e=>{e.preventDefault();const k=kind.value;save.disabled=true;
  try{await rpc('admin_add_deduction',{p_barber:$('settlementbarber').value,p_date:date.value,p_kind:k,p_description:descr.value.trim(),p_amount:k==='product'?null:Number(amount.value),
    p_product:k==='product'?product.value||null:null,p_quantity:k==='product'?Number(qty.value):null,p_installments:k==='purchase'?Number(parts.value):null});
   f.remove();say('Baixa lançada.');await load();refreshColumns();}catch(ex){say(ex.message);save.disabled=false;}};
 anchor.before(f);show();kind.focus();
}

// Colunas Baixas e A pagar no relatório (uma consulta de acerto por barbeiro, com o período do relatório).
let lastReport=null;
async function refreshColumns(){
 if(!lastReport)return;const {start,end,report}=lastReport,table=tab.querySelector('.finance-table');if(!table)return;
 const headRow=table.tHead?.rows[0];if(headRow&&!headRow.querySelector('.col-deductions')){for(const t of ['Baixas','A pagar']){const th=el('th','col-deductions',t);headRow.append(th);}}
 const rows=[...$('financebody').rows];
 const data=await Promise.all(report.rows.map(r=>rpc('admin_barber_settlement',{p_barber:r.id,p_start:start,p_end:end}).catch(()=>null)));
 rows.forEach((tr,i)=>{tr.querySelectorAll('.col-deductions').forEach(td=>td.remove());const d=data[i];
  for(const v of [d?money(d.deductions):'—',d?money(d.to_pay)+(d.settlement?' ✓':''):'—']){const td=el('td','col-deductions',v);tr.append(td);}});
 const foot=$('financefoot')?.rows[0];if(foot){foot.querySelectorAll('.col-deductions').forEach(td=>td.remove());
  const sum=k=>data.reduce((s,d)=>s+(d?Number(d[k]):0),0);for(const v of [money(sum('deductions')),money(sum('to_pay'))])foot.append(el('td','col-deductions',v));}
}
window.addEventListener('financerendered',async e=>{if(auth.role()!=='admin')return;lastReport=e.detail;mount();
 try{barbers=await req('/rest/v1/barbers?select=id,name&active=eq.true&order=name');}catch{barbers=[];}
 const pick=$('settlementbarber'),keep=pick.value;pick.replaceChildren(...barbers.map(b=>{const o=el('option',null,b.name);o.value=b.id;return o;}));if(barbers.some(b=>b.id===keep))pick.value=keep;
 await Promise.all([load(),refreshColumns()]);});
})();
