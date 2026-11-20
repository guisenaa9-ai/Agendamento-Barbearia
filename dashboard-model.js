/* Cálculo da Visão geral do Dashboard: período atual x período anterior (mesmo tamanho), em datas de Manaus.
   Sem DOM: testado em qa/dashboard-model.cjs. */
(function(root){
const DAY=864e5,MANAUS=-4*3600e3;
const iso=ms=>new Date(ms).toISOString().slice(0,10);
const addDays=(s,n)=>iso(Date.parse(s+'T00:00:00Z')+n*DAY);
const localDay=ts=>iso(Date.parse(ts)+MANAUS);
const PERIODS={'7':{days:7,unit:'day'},'30':{days:30,unit:'day'},'90':{days:90,unit:'week'},'365':{days:365,unit:'month'}};

function range(key,today){const p=PERIODS[key],end=today,start=addDays(end,-(p.days-1)),prevEnd=addDays(start,-1),prevStart=addDays(prevEnd,-(p.days-1));return {...p,start,end,prevStart,prevEnd};}
// Índice do grupo (dia, semana ou mês) contado a partir do início do período, para comparar os dois períodos lado a lado.
function bucketOf(day,start,unit){
 if(unit==='month'){const [y,m]=day.split('-').map(Number),[sy,sm]=start.split('-').map(Number);return (y*12+m)-(sy*12+sm);}
 const n=Math.round((Date.parse(day)-Date.parse(start))/DAY);return unit==='week'?Math.floor(n/7):n;}
function bucketCount(r){return bucketOf(r.end,r.start,r.unit)+1;}
function bucketLabel(r,i){
 if(r.unit==='month'){const [y,m]=r.start.split('-').map(Number),d=new Date(Date.UTC(y,m-1+i,1));return d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit',timeZone:'UTC'}).replace('.','');}
 const d=addDays(r.start,r.unit==='week'?i*7:i);return d.slice(8,10)+'/'+d.slice(5,7);}

function period(bookings,paidByBooking,start,end,unit){
 const n=bucketOf(end,start,unit)+1,revenue=Array(n).fill(0),attended=Array(n).fill(0),clientsBy=Array.from({length:n},()=>new Set()),total=Array(n).fill(0),lost=Array(n).fill(0),clients=new Set();
 let sum=0,count=0,all=0,lostAll=0;
 for(const b of bookings){const day=localDay(b.starts_at);if(day<start||day>end)continue;const i=bucketOf(day,start,unit);
  all++;total[i]++;if(b.status==='cancelled'||b.no_show){lostAll++;lost[i]++;continue;}
  const paid=paidByBooking.get(b.id);if(paid==null)continue;
  const key=b.customer_id||String(b.phone||'').replace(/\D/g,'')||b.id;
  sum+=paid;count++;clients.add(key);revenue[i]+=paid;attended[i]++;clientsBy[i].add(key);}
 const round=v=>Math.round(v*100)/100;
 return {revenue:round(sum),attended:count,clients:clients.size,ticket:count?round(sum/count):0,lostRate:all?round(lostAll/all*100):0,bookings:all,
  series:{revenue:revenue.map(round),clients:clientsBy.map(s=>s.size),ticket:revenue.map((v,i)=>attended[i]?round(v/attended[i]):0),lostRate:total.map((t,i)=>t?round(lost[i]/t*100):0)}};
}
// Variação em % contra o período anterior (null quando o anterior é zero).
const delta=(cur,prev)=>prev?Math.round((cur-prev)/prev*1000)/10:null;

function summarize(bookings,attendances,key,today){
 const r=range(key,today),paid=new Map();
 for(const a of attendances)if(a.paid)paid.set(a.booking_id,Number(a.total)||0);
 const cur=period(bookings,paid,r.start,r.end,r.unit),prev=period(bookings,paid,r.prevStart,r.prevEnd,r.unit);
 const labels=Array.from({length:bucketCount(r)},(_,i)=>bucketLabel(r,i));
 return {range:r,labels,cur,prev,delta:{revenue:delta(cur.revenue,prev.revenue),clients:delta(cur.clients,prev.clients),ticket:delta(cur.ticket,prev.ticket),lostRate:delta(cur.lostRate,prev.lostRate)}};
}
root.DashboardModel={range,summarize,localDay,PERIODS};
})(typeof window!=='undefined'?window:globalThis);
