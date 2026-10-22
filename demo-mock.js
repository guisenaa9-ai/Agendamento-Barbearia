// Demonstração: simula o banco (Supabase) no próprio navegador com dados fictícios. Nada sai do aparelho.
// Só liga em modo demonstração: entra com ?demo no endereço (demo.html faz isso) e vale até fechar a aba.
(function(){
const store=(()=>{try{return sessionStorage}catch{return null}})();
const params=new URLSearchParams(location.search);
try{if(params.has('demo'))store.setItem('demo-mode','1');if(params.get('demo')==='novo')store.removeItem('demo-db');if(params.get('demo')==='sair'){store.clear();return;}}catch{}
if(store?.getItem('demo-mode')!=='1')return;
// Sem CAPTCHA na demonstração: o config.js real é carregado depois e passa por aqui
let config;Object.defineProperty(window,'BARBER_CONFIG',{configurable:true,get:()=>config,set:v=>{config={...v,captchaSiteKey:''};}});
const get=k=>{try{return JSON.parse(store?.getItem(k)||'null')}catch{return null}},put=(k,v)=>{try{store?.setItem(k,JSON.stringify(v))}catch{}};
const URL0='https://nqshsvhrgrkzpivuhtxa.supabase.co',session={access_token:'demo',refresh_token:'demo',expires_in:86400,expires_at:Date.now()/1000+86400,user:{id:'u1',email:'cliente@demo.com'}};
// Quem está "logado" depende da página aberta
const page=location.pathname.split('/').pop()||'index.html';
if(/agendar|conta|barbeiro/.test(page))put('daniel-silva-customer-session-v1:'+URL0,session);
if(/admin|atendimentos/.test(page))put('daniel-silva-staff-session-v1:'+URL0,session);
const manaus=d=>new Date(d.getTime()-4*3600e3).toISOString().slice(0,19);
const day=n=>manaus(new Date(Date.now()+n*86400e3)).slice(0,10);
function seed(){
 const barbers=[{id:'b1',name:'Daniel Silva',active:true,photo_url:null,specialty:'Degradê e navalhado',bio:'Fundador da casa, 12 anos de tesoura.'},{id:'b2',name:'Lucas Rocha',active:true,photo_url:null,specialty:'Barba e toalha quente',bio:'Especialista em barba desenhada.'},{id:'b3',name:'Pedro Alves',active:true,photo_url:null,specialty:'Corte social e infantil',bio:'Paciência de sobra com a criançada.'}];
 const services=[{id:'s1',name:'Corte masculino',price:40,duration:40,active:true,photo_url:null,description:'Tesoura ou máquina, lavagem e finalização.'},{id:'s2',name:'Barba completa',price:30,duration:30,active:true,photo_url:null,description:'Toalha quente, navalha e hidratação.'},{id:'s3',name:'Corte + barba',price:65,duration:70,active:true,photo_url:null,description:'O combo completo, com desconto.'},{id:'s4',name:'Sobrancelha',price:15,duration:15,active:true,photo_url:null,description:'Acabamento na navalha.'}];
 const names=['Carlos Mendes','Rafael Lima','João Pedro','André Souza','Marcos Vinícius','Pedro Henrique','Bruno Costa','Thiago Ramos','Felipe Nunes','Gustavo Reis','Diego Martins','Leonardo Pinto'];
 const bookings=[],attendances=[];let n=0;
 for(let d=-20;d<=6;d++){const date=day(d),count=d===0?8:d>0?3:5;
  for(let i=0;i<count;i++){const s=services[(i+d+40)%3],b=barbers[(i+d+40)%3],h=9+Math.floor(i*1.2),m=i%2?'30':'00',id='demo-'+(n++),past=d<0||(d===0&&i<3),cancelled=(i+d+40)%9===4;
   const state=cancelled?null:past?'completed':d===0&&i===3?'arrived':'scheduled';
   bookings.push({id,customer:names[(i*5+d+40)%12],phone:'929'+String(91234000+n),customer_id:null,service_id:s.id,service_name:s.name,barber_id:b.id,barber_name:b.name,price:s.price,starts_at:`${date}T${String(h).padStart(2,'0')}:${m}:00`,ends_at:`${date}T${String(h+1).padStart(2,'0')}:${m}:00`,status:cancelled?'cancelled':'confirmed',attendance_state:state,no_show:false,cancellation_reason:cancelled?'Imprevisto no trabalho':null,cancellation_source:cancelled?'customer':null,created_at:`${date}T08:00:00`});
   if(state==='completed')attendances.push({booking_id:id,total:s.price,paid:true,payment_method:['pix','cash','credit','debit'][n%4],extras:[],arrived_at:`${date}T${String(h).padStart(2,'0')}:${m}:00`});}}
 // Reservas do cliente da demonstração
 for(const [d,h,s,b] of [[2,'10:00',0,0],[9,'15:30',2,1],[-12,'11:00',0,0],[-26,'16:00',1,1]]){const sv=services[s],bb=barbers[b];bookings.push({id:'demo-me-'+d,customer:'Guilherme',phone:'92991230000',customer_id:'u1',service_id:sv.id,service_name:sv.name,barber_id:bb.id,barber_name:bb.name,price:sv.price,starts_at:`${day(d)}T${h}:00`,ends_at:`${day(d)}T${h}:00`,status:'confirmed',attendance_state:d<0?'completed':'scheduled',no_show:false,created_at:`${day(d-3)}T08:00:00`});}
 return {barbers,services,bookings,attendances,cash_movements:[],cash_sessions:[],schedule_blocks:[],
  barber_details:barbers.map((b,i)=>({barber_id:b.id,commission_rate:[50,40,40][i],cpf:'',phone:'',login_email:i?'':'cliente@demo.com'})),
  business_hours:[1,2,3,4,5,6].map(w=>({weekday:w,opens_at:'09:00',closes_at:w===6?'17:00':'19:00'})),
  shop_settings:[{slot_minutes:20,loyalty_enabled:true,loyalty_goal:10}],customer_profiles:[{id:'u1',name:'Guilherme',phone:'(92) 99123-0000',whatsapp_opt_in:true}]};}
const db=get('demo-db')||seed();const save=()=>put('demo-db',db);save();
// PostgREST simplificado: filtros eq/neq/gte/gt/lte/lt/in e order
function filter(rows,params){return rows.filter(r=>{for(const [k,v] of params){if(['select','order','limit','offset','on_conflict'].includes(k))continue;const i=v.indexOf('.'),op=v.slice(0,i),val=decodeURIComponent(v.slice(i+1)),x=r[k]==null?'':String(r[k]).slice(0,Math.max(val.length,10));
 if(op==='eq'&&String(r[k])!==val&&!(val==='true'&&r[k]===true)&&!(val==='false'&&r[k]===false))return false;if(op==='neq'&&String(r[k])===val)return false;if(op==='gte'&&!(x>=val.slice(0,19)))return false;if(op==='gt'&&!(x>val.slice(0,19)))return false;if(op==='lte'&&!(x<=val.slice(0,19)))return false;if(op==='lt'&&!(x<val.slice(0,19)))return false;if(op==='in'&&!val.replace(/[()]/g,'').split(',').includes(String(r[k])))return false;}return true;});}
const slots=['09:00','09:40','10:20','11:00','13:00','13:40','14:20','15:00','16:20','17:00'];
const rpc={staff_role:()=>'admin',is_admin:()=>true,track_kryon_usage:()=>null,
 available_options:()=>slots.map(slot=>({slot,barbers:db.barbers.map(b=>b.name)})),available_slots:()=>slots.map(slot=>({slot})),admin_slots:()=>slots.map(slot=>({slot})),
 customer_book:p=>book(p),customer_book_with_assignment:p=>{const id=book({...p,p_barber:'b2'});return [{booking_id:id,barber_name:'Lucas Rocha'}];},admin_book:p=>book({...p,customer:p.p_customer}),
 customer_cancel:p=>cancel(p.p_id||p.p_booking),admin_cancel_booking:p=>cancel(p.p_id||p.p_booking),customer_change_slots:()=>slots.map(slot=>({slot})),customer_reschedule:()=>null,customer_claim:()=>null,customer_delete_account:()=>null,
 customer_loyalty:()=>({enabled:true,goal:10,progress:4,available:0}),admin_loyalty:()=>[],
 barber_summary:()=>{const paid=db.attendances.filter(a=>db.bookings.find(b=>b.id===a.booking_id&&b.barber_id==='b1'));const gross=paid.reduce((s,a)=>s+a.total,0);return {name:'Daniel Silva',barber_id:'b1',count:paid.length,gross,rate:50,commission:gross/2};},
 barber_updates:()=>db.bookings.filter(b=>b.barber_id==='b1'&&b.starts_at>=day(0)).slice(0,4).map((b,i)=>({event_type:b.status==='cancelled'?'booking_cancelled':i===2?'booking_rescheduled':'booking_created',customer:b.customer,service_name:b.service_name,starts_at:b.starts_at,happened_at:new Date(Date.now()-i*5400e3).toISOString()})),
 mark_arrival:p=>{const b=db.bookings.find(b=>b.id===(p.p_booking||p.p_id));if(b)b.attendance_state='arrived';save();return null;},
 save_attendance:p=>{const id=p.p_booking||p.p_id,b=db.bookings.find(b=>b.id===id);if(b)b.attendance_state=p.p_complete===false?'arrived':'completed';db.attendances=db.attendances.filter(a=>a.booking_id!==id).concat({booking_id:id,total:p.p_total??b?.price,paid:p.p_paid??true,payment_method:p.p_payment_method||'pix',extras:p.p_extras||[]});save();return null;},
 mark_no_show:p=>{const b=db.bookings.find(b=>b.id===(p.p_booking||p.p_id));if(b)b.no_show=true;save();return null;},
 admin_list_attendants:()=>[],admin_search_customers:()=>[{name:'Carlos Mendes',phone:'92991234001',customer_id:null}]};
function book(p){const s=db.services.find(s=>s.id===p.p_service)||db.services[0],b=db.barbers.find(b=>b.id===p.p_barber)||db.barbers[0],id='demo-new-'+Date.now(),t=p.p_time||'10:00';db.bookings.push({id,customer:p.customer||'Guilherme',phone:'92991230000',customer_id:'u1',service_id:s.id,service_name:s.name,barber_id:b.id,barber_name:b.name,price:s.price,starts_at:`${p.p_date}T${t}:00`,ends_at:`${p.p_date}T${t}:00`,status:'confirmed',attendance_state:'scheduled',no_show:false,created_at:manaus(new Date())});save();return id;}
function cancel(id){const b=db.bookings.find(b=>b.id===id);if(b){b.status='cancelled';b.cancellation_source='customer';}save();return null;}
const json=(v,status=200)=>new Response(v===undefined?'':JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
const realFetch=window.fetch.bind(window);
window.fetch=async(input,init={})=>{const url=String(input?.url||input);if(!url.startsWith(URL0))return realFetch(input,init);
const u=new URL(url),path=u.pathname,method=(init.method||'GET').toUpperCase(),body=init.body?JSON.parse(init.body):{};
 if(path.startsWith('/auth/v1/user'))return json({id:'u1',email:'cliente@demo.com',factors:[]});
 if(path.startsWith('/auth/v1/'))return json(path.includes('logout')?{}:session);
 if(path.startsWith('/rest/v1/rpc/')){const f=rpc[path.slice(13)];return json(f?f(body):null);}
 const table=path.slice(9),rows=db[table];if(!rows)return json([]);
 if(method==='GET'){let out=filter(rows,[...u.searchParams]);const order=u.searchParams.get('order');if(order){const [k,dir]=order.split(',')[0].split('.');out=[...out].sort((a,b)=>String(a[k]).localeCompare(String(b[k]))*(dir==='desc'?-1:1));}return json(out);}
 if(method==='PATCH'){for(const r of filter(rows,[...u.searchParams]))Object.assign(r,body);save();return json([]);}
 if(method==='POST'){for(const r of [].concat(body))rows.push({id:'demo-'+Date.now(),created_at:manaus(new Date()),...r});save();return json([]);}
 if(method==='DELETE'){const keep=rows.filter(r=>!filter([r],[...u.searchParams]).length);db[table]=keep;save();return json([]);}
 return json([]);};
// Faixa fixa avisando que é demonstração, com volta ao início
if(page!=='demo.html')addEventListener('DOMContentLoaded',()=>{const bar=document.createElement('a');bar.href='demo.html';bar.textContent='Demonstração com dados fictícios · voltar às telas';bar.style.cssText='position:fixed;z-index:9998;top:0;left:50%;transform:translateX(-50%);padding:6px 14px;border-radius:0 0 10px 10px;background:#c49242;color:#fff;font:600 12px/1.4 system-ui,sans-serif;text-decoration:none;white-space:nowrap';document.body.append(bar);});
})();
