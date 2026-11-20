/* Calendário do mês + lista de horários livres (agendamento do cliente e "Nova reserva" do balcão).
   O <input type="date"> e o <select> continuam sendo a fonte do valor: booking.js / admin.js leem e preenchem eles. */
(()=>{
const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const SEMANA=[['D','domingo'],['S','segunda'],['T','terça'],['Q','quarta'],['Q','quinta'],['S','sexta'],['S','sábado']];
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const iso=(y,m,d)=>y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
const ISO=/^\d{4}-\d{2}-\d{2}$/;

function picker(dateId,timeId,anchorOf){
 const date=document.getElementById(dateId),time=document.getElementById(timeId);if(!date||!time)return;
 const box=el('div','calpick'),cal=el('div','calpick-cal'),side=el('div','calpick-times'),list=el('div','calpick-list');
 list.setAttribute('role','group');list.setAttribute('aria-label','Horários livres');
 side.append(el('p','calpick-title','Horários livres'),list);box.append(cal,side);anchorOf(date).after(box);
 // Esconde os campos originais (e os botões de horário antigos), mas eles seguem no formulário.
 for(const e of [date.closest('label'),document.querySelector(`label[for="${timeId}"]`)||time.closest('label'),time,time.previousElementSibling?.classList.contains('choice-chips')&&time.previousElementSibling])if(e)e.classList.add('calpick-native');
 let view=null;
 const pick=v=>{date.value=v;for(const t of ['input','change'])date.dispatchEvent(new Event(t,{bubbles:true}));draw();};
 function drawCal(){
  const sel=ISO.test(date.value)?date.value:'',min=ISO.test(date.min)?date.min:'',max=ISO.test(date.max)?date.max:'';
  if(!view||sel&&sel.slice(0,7)!==view.slice(0,7)&&!cal.contains(document.activeElement))view=(sel||min||new Date().toISOString().slice(0,10)).slice(0,7)+'-01';
  const [y,m]=view.split('-').map(Number),first=new Date(Date.UTC(y,m-1,1)).getUTCDay(),days=new Date(Date.UTC(y,m,0)).getUTCDate();
  const head=el('div','calpick-head'),prev=el('button','calpick-nav','‹'),next=el('button','calpick-nav','›');
  prev.type=next.type='button';prev.setAttribute('aria-label','Mês anterior');next.setAttribute('aria-label','Próximo mês');
  prev.disabled=!!min&&view<=min.slice(0,7)+'-01';next.disabled=!!max&&iso(y,m-1,days)>=max;
  const go=n=>{const d=new Date(Date.UTC(y,m-1+n,1));view=d.toISOString().slice(0,10);drawCal();};prev.onclick=()=>go(-1);next.onclick=()=>go(1);
  const title=el('p','calpick-month',MESES[m-1]+' '+y);title.setAttribute('aria-live','polite');head.append(prev,title,next);
  const grid=el('div','calpick-grid');grid.setAttribute('role','grid');
  for(const [s,n] of SEMANA){const h=el('span','calpick-dow',s);h.title=n;h.setAttribute('aria-hidden','true');grid.append(h);}
  for(let i=0;i<first;i++)grid.append(el('span'));
  for(let d=1;d<=days;d++){const v=iso(y,m-1,d),b=el('button','calpick-day',String(d));b.type='button';
   b.disabled=date.disabled||!!min&&v<min||!!max&&v>max;b.setAttribute('aria-pressed',String(v===sel));if(v===min)b.classList.add('is-today');
   b.setAttribute('aria-label',d+' de '+MESES[m-1]+(v===sel?', escolhido':''));b.onclick=()=>pick(v);grid.append(b);}
  cal.replaceChildren(head,grid);
 }
 function drawTimes(){
  const opts=[...time.options].filter(o=>o.value);
  if(!opts.length){list.replaceChildren(el('p','calpick-empty',time.disabled||!ISO.test(date.value)?time.options[0]?.text||'Escolha uma data':'Sem horários livres neste dia. Escolha outra data.'));return;}
  list.replaceChildren(...opts.map(o=>{const [main,...rest]=o.text.split(' · '),b=el('button','calpick-time',main);b.type='button';
   if(rest.length)b.append(el('small',null,rest.join(' · ')));b.disabled=time.disabled||o.disabled;b.setAttribute('aria-pressed',String(time.value===o.value));
   b.onclick=()=>{time.value=o.value;time.dispatchEvent(new Event('change',{bubbles:true}));drawTimes();};return b;}));
 }
 function draw(){drawCal();drawTimes();}
 // Os horários e a data mudam por código (outro serviço, outro barbeiro, atalho da agenda): redesenha junto.
 let queued=false;const later=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;draw();});};
 new MutationObserver(later).observe(time,{childList:true,subtree:true,attributes:true});
 new MutationObserver(later).observe(date,{attributes:true});
 date.addEventListener('change',later);time.addEventListener('change',later);
 draw();
}
picker('date','timechoice',d=>d.closest('.row')||d.closest('label'));
picker('newdate','newtime',d=>d.closest('.grid')||d.closest('label'));
})();
