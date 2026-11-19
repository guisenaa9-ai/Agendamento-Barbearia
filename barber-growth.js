/* Área do barbeiro: cartão de ganhos no topo (meta do mês, comissão, previsão com a agenda marcada)
   e as avaliações dos clientes. Dados de barber_month() em database/crescimento.sql. */
(()=>{
const area=document.getElementById('barberarea'),auth=window.CustomerAuth,api=window.BarberAPI;if(!area||!auth||!api)return;
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const money=n=>api.money(Number(n)||0);
const MONTHS=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
let loading=false;
async function render(){
 if(loading)return;loading=true;
 let box=document.getElementById('barbergrowth');
 if(!box){box=el('section','barber-growth');box.id='barbergrowth';box.setAttribute('aria-label','Seus ganhos do mês');area.querySelector('.row')?.after(box);}
 try{const m=await auth.rpc('barber_month',{}),month=MONTHS[Number(m.month.slice(5,7))-1];
  const card=el('article','barber-goal');card.append(el('p','barber-goal-eyebrow',m.goal?'Meta de '+month:'Seu mês de '+month));
  if(m.goal){const pct=Math.min(100,Math.round(m.gross/m.goal*100)),bar=el('div','barber-goal-bar'),fill=el('span');fill.style.width=pct+'%';bar.append(fill);
   bar.setAttribute('role','progressbar');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-valuenow',String(pct));bar.setAttribute('aria-label','Meta do mês');
   card.append(el('p','barber-goal-value',money(m.gross)+' de '+money(m.goal)),bar,el('p','barber-goal-pct',pct+'% da meta'+(pct>=100?' · meta batida!':'')));}
  else card.append(el('p','barber-goal-value',money(m.gross)+' faturados'),el('p','barber-goal-pct','O chefe ainda não definiu sua meta do mês.'));
  const grid=el('div','barber-goal-grid');
  for(const [label,value] of [['Sua comissão ('+Number(m.rate).toLocaleString('pt-BR')+'%)',money(m.commission)],['Previsão até o fim do mês',money(m.forecast)]]){const c=el('div');c.append(el('span',null,label),el('strong',null,value));grid.append(c);}
  card.append(grid,el('p','barber-goal-help','Conta só o que já foi pago. A previsão soma os horários marcados até o fim do mês.'));
  const rating=el('article','barber-rating');
  if(m.reviews){rating.append(el('p','barber-rating-score','★ '+Number(m.rating).toLocaleString('pt-BR',{minimumFractionDigits:1})),el('p','barber-rating-count',m.reviews+(m.reviews>1?' avaliações':' avaliação')+' dos seus clientes'));
   for(const c of m.comments.slice(0,3))rating.append(el('blockquote',null,'“'+c.comment+'” · '+'★'.repeat(c.rating)));}
  else rating.append(el('p','barber-rating-count','Quando seus clientes avaliarem o atendimento pela conta deles, a nota aparece aqui.'));
  box.replaceChildren(card,rating);
 }catch(e){box.replaceChildren(el('p','help',e.message));}
 finally{loading=false;}
}
const check=()=>{if(!area.hidden)render();};
new MutationObserver(check).observe(area,{attributes:true,attributeFilter:['hidden']});check();
})();
