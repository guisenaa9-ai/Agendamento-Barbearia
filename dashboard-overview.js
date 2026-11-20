/* Dashboard → Visão geral: período (7 dias, 30 dias, 90 dias, 12 meses), 4 cartões com variação e minigráfico,
   e o gráfico de faturamento do período contra o anterior (ou em tabela). Cálculo em dashboard-model.js. */
(()=>{
const $=id=>document.getElementById(id),tab=$('tab-dashboard'),api=window.BarberAPI,auth=window.StaffAuth,M=window.DashboardModel;if(!tab||!api||!auth||!M)return;
const NS='http://www.w3.org/2000/svg';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const svg=(tag,attrs={})=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
const money=n=>api.money(Number(n)||0),num=n=>Number(n).toLocaleString('pt-BR');
const pct=n=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
const LABEL={'7':'7 dias','30':'30 dias','90':'90 dias','365':'12 meses'},SHORT={'7':'7D','30':'30D','90':'90D','365':'12M'};
let key='30',view='chart',loading=0,last=null;

const box=el('section','overview');box.id='overview';box.setAttribute('aria-label','Visão geral do período');
const head=el('div','overview-head'),titles=el('div'),sub=el('p','overview-sub');
titles.append(el('h2','overview-title','Visão geral'),sub);
const seg=el('div','overview-seg');seg.setAttribute('role','group');seg.setAttribute('aria-label','Período');
for(const k of Object.keys(LABEL)){const b=el('button',null,SHORT[k]);b.type='button';b.dataset.k=k;b.title=LABEL[k];b.setAttribute('aria-label',LABEL[k]);b.onclick=()=>{key=k;load();};seg.append(b);}
head.append(titles,seg);
const cards=el('div','overview-cards'),chart=el('article','overview-chart'),status=el('p','growth-count');status.setAttribute('role','status');
box.append(head,cards,chart,status);
(tab.querySelector(':scope>section[aria-label="Indicadores"]')||tab.firstElementChild).before(box);

async function all(path){const out=[];for(let off=0;;off+=500){const page=await api.request(path+'&limit=500&offset='+off,{token:await auth.token()});out.push(...page);if(page.length<500)return out;}}
async function load(){
 const run=++loading,r=M.range(key,api.day());
 for(const b of seg.children)b.setAttribute('aria-pressed',String(b.dataset.k===key));
 sub.textContent='Últimos '+LABEL[key]+' · comparado com o período anterior';status.textContent='Carregando…';
 try{
  // Busca do início do período anterior até o fim de hoje (folga de 1 dia por causa do fuso de Manaus).
  const from=r.prevStart+'T00:00:00',to=new Date(Date.parse(r.end+'T00:00:00Z')+2*864e5).toISOString().slice(0,10);
  const bookings=await all('/rest/v1/bookings?select=id,starts_at,status,no_show,customer_id,phone&starts_at=gte.'+encodeURIComponent(from)+'&starts_at=lt.'+to+'&order=starts_at,id');
  const ids=bookings.filter(b=>b.status!=='cancelled').map(b=>b.id),chunks=[];for(let i=0;i<ids.length;i+=80)chunks.push(ids.slice(i,i+80));
  const token=await auth.token(),att=(await Promise.all(chunks.map(c=>api.request('/rest/v1/attendances?select=booking_id,total,paid&booking_id=in.('+c.join(',')+')',{token})))).flat();
  if(run!==loading)return;last=M.summarize(bookings,att,key,api.day());status.textContent='';render();
 }catch(e){if(run===loading)status.textContent=e.message;}
}

function spark(values,good){
 const w=120,h=40,max=Math.max(...values,0),min=Math.min(...values,0),span=max-min||1,step=values.length>1?w/(values.length-1):w;
 const pts=values.map((v,i)=>[i*step,h-4-((v-min)/span)*(h-8)]);
 const s=svg('svg',{viewBox:`0 0 ${w} ${h}`,class:'overview-spark','aria-hidden':'true'});
 if(pts.length<2)return s;
 const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
 s.append(svg('path',{d:line+` L${w} ${h} L0 ${h} Z`,class:'spark-area'}),svg('path',{d:line,class:'spark-line'}));
 const [x,y]=pts.at(-1);s.append(svg('circle',{cx:x,cy:y,r:3,class:'spark-dot '+(good?'is-good':'is-bad')}));
 return s;
}
function badge(d,lowerIsBetter){
 if(d==null)return el('span','overview-badge is-flat','sem base');
 const up=d>0,good=d===0||(up!==!!lowerIsBetter),b=el('span','overview-badge '+(d===0?'is-flat':good?'is-good':'is-bad'),(d>0?'↗ +':d<0?'↘ ':'')+d.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%');
 return b;
}
function card(title,value,d,series,lowerIsBetter,hint){
 const c=el('article','overview-card'),info=el('div');
 const row=el('p','overview-delta');row.append(badge(d,lowerIsBetter),el('span',null,' vs anterior'));
 info.append(el('p','overview-label',title),el('p','overview-value',value),row);
 c.append(info,spark(series,d==null||d===0||((d>0)!==!!lowerIsBetter)));if(hint)c.title=hint;return c;
}
function render(){
 const {cur,prev,delta}=last;
 cards.replaceChildren(
  card('Faturamento',money(cur.revenue),delta.revenue,cur.series.revenue,false,'Atendimentos pagos no período'),
  card('Clientes atendidos',num(cur.clients),delta.clients,cur.series.clients,false,'Clientes diferentes com atendimento pago'),
  card('Ticket médio',money(cur.ticket),delta.ticket,cur.series.ticket,false,'Faturamento dividido pelos atendimentos pagos'),
  card('Cancelamentos e faltas',pct(cur.lostRate),delta.lostRate,cur.series.lostRate,true,'Reservas canceladas ou com falta, sobre o total de reservas'));
 const top=el('div','overview-chart-head'),left=el('div');
 const total=el('p','overview-chart-total');total.append(el('strong',null,money(cur.revenue)),el('span',null,' '+(delta.revenue==null?'sem período anterior para comparar':(delta.revenue>0?'+':'')+delta.revenue.toLocaleString('pt-BR',{maximumFractionDigits:1})+'% vs período anterior')));
 left.append(el('h3',null,'Faturamento'),total);
 const legend=el('div','overview-legend');legend.append(el('span','lg-cur','Este período'),el('span','lg-prev','Período anterior'));
 const tg=el('div','overview-toggle');tg.setAttribute('role','group');tg.setAttribute('aria-label','Mostrar como');
 for(const [v,t,d] of [['chart','Gráfico','M3 17l5-6 4 3 6-8M3 21h18'],['table','Tabela','M4 4h16v16H4zM4 10h16M4 15h16M10 4v16']]){const b=el('button');const i=svg('svg',{viewBox:'0 0 24 24','aria-hidden':'true'});i.append(svg('path',{d}));b.append(i);b.type='button';b.title=t;b.setAttribute('aria-label',t);b.setAttribute('aria-pressed',String(view===v));b.onclick=()=>{view=v;render();};tg.append(b);}
 const right=el('div','overview-chart-tools');right.append(legend,tg);top.append(left,right);
 chart.replaceChildren(top,view==='chart'?lineChart(cur.series.revenue,prev.series.revenue,last.labels):table(cur.series.revenue,prev.series.revenue,last.labels));
}
function lineChart(a,b,labels){
 // Desenha no tamanho real do cartão, para o texto dos eixos não encolher no celular.
 const W=Math.max(300,Math.min(1100,(chart.clientWidth||900)-48)),H=W<600?220:280,L=W<600?52:64,R=12,T=14,B=34,max=niceMax(Math.max(...a,...b,1)),n=labels.length,x=i=>L+(n>1?i*(W-L-R)/(n-1):0),y=v=>T+(1-v/max)*(H-T-B);
 const s=svg('svg',{viewBox:`0 0 ${W} ${H}`,class:'overview-svg',role:'img','aria-label':'Faturamento por '+(last.range.unit==='day'?'dia':last.range.unit==='week'?'semana':'mês')+': este período contra o anterior. Use o botão Tabela para ver os valores.'});
 for(let k=0;k<=4;k++){const v=max*k/4,yy=y(v);s.append(svg('line',{x1:L,x2:W-R,y1:yy,y2:yy,class:'grid'}));const t=svg('text',{x:L-10,y:yy+4,class:'axis','text-anchor':'end'});t.textContent=short(v);s.append(t);}
 const step=Math.max(1,Math.ceil(n/(W<600?4:7)));labels.forEach((l,i)=>{if(i!==n-1&&(i%step||n-1-i<step*.7))return;const t=svg('text',{x:x(i),y:H-10,class:'axis','text-anchor':i===0?'start':i===n-1?'end':'middle'});t.textContent=l;s.append(t);});
 const path=v=>v.map((p,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(p).toFixed(1)).join(' ');
 s.append(svg('path',{d:path(a)+` L${x(n-1)} ${y(0)} L${x(0)} ${y(0)} Z`,class:'area'}),svg('path',{d:path(b),class:'prev'}),svg('path',{d:path(a),class:'cur'}));
 a.forEach((v,i)=>{const c=svg('circle',{cx:x(i),cy:y(v),r:n>40?0:W<600&&n>14?2:3,class:'pt'});const t=svg('title');t.textContent=labels[i]+': '+money(v)+' (anterior '+money(b[i]||0)+')';c.append(t);s.append(c);});
 return s;
}
function table(a,b,labels){
 const wrap=el('div','finance-table-wrap'),t=el('table','finance-table overview-table'),h=el('tr');
 for(const c of [last.range.unit==='day'?'Dia':last.range.unit==='week'?'Semana de':'Mês','Este período','Período anterior','Variação'])h.append(el('th',null,c));
 t.append(el('thead'),el('tbody'));t.tHead.append(h);
 labels.forEach((l,i)=>{const tr=el('tr'),d=b[i]?Math.round((a[i]-b[i])/b[i]*1000)/10:null;tr.append(el('td',null,l),el('td',null,money(a[i])),el('td',null,money(b[i]||0)),el('td',null,d==null?'—':(d>0?'+':'')+d.toLocaleString('pt-BR')+'%'));t.tBodies[0].append(tr);});
 wrap.append(t);return wrap;
}
function niceMax(v){const raw=v/4,p=10**Math.floor(Math.log10(raw)),m=raw/p;return (m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10)*p*4;}
function short(v){return v>=1000?'R$ '+(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':'R$ '+Math.round(v);}

let resized;window.addEventListener('resize',()=>{clearTimeout(resized);resized=setTimeout(()=>{if(last&&view==='chart'&&!tab.hidden)render();},150);});
const ready=()=>auth.session()&&auth.role()==='admin'&&!tab.hidden;
window.addEventListener('stafftabchange',e=>{if(e.detail.name==='dashboard'&&ready())load();});
// O login pode terminar antes deste arquivo carregar.
if(ready())load();
})();
