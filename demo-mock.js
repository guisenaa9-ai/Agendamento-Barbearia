// Demonstração: simula o banco (Supabase) no próprio navegador com dados fictícios. Nada sai do aparelho.
// Só liga em modo demonstração: entra com ?demo no endereço (demo.html faz isso) e vale até fechar a aba.
// As regras seguem as funções SQL de database/instalar-tudo.sql (horários livres, chegada, pagamento, remarcação).
(function(){
const store=(()=>{try{return sessionStorage}catch{return null}})();
const params=new URLSearchParams(location.search);
try{if(params.has('demo'))store.setItem('demo-mode','1');if(params.get('demo')==='novo')store.removeItem('demo-db');if(params.get('demo')==='sair'){store.clear();return;}if(params.has('demo')&&params.get('demo')!=='novo')store.setItem('demo-role',params.get('demo')==='atendente'?'attendant':'admin');}catch{}
if(store?.getItem('demo-mode')!=='1')return;
// Sem CAPTCHA na demonstração: o config.js real é carregado depois e passa por aqui
let config;Object.defineProperty(window,'BARBER_CONFIG',{configurable:true,get:()=>config,set:v=>{config={...v,captchaSiteKey:''};}});
const get=k=>{try{return JSON.parse(store?.getItem(k)||'null')}catch{return null}},put=(k,v)=>{try{store?.setItem(k,JSON.stringify(v));return true}catch{return false}};
const URL0='https://nqshsvhrgrkzpivuhtxa.supabase.co',EMAIL='cliente@demo.com',session={access_token:'demo',refresh_token:'demo',expires_in:86400,expires_at:Date.now()/1000+86400,user:{id:'u1',email:EMAIL}};
// Quem está "logado" depende da página aberta
const page=location.pathname.split('/').pop()||'index.html';
if(/agendar|conta|barbeiro/.test(page))put('daniel-silva-customer-session-v1:'+URL0,session);
if(/admin|atendimentos/.test(page))put('daniel-silva-staff-session-v1:'+URL0,session);
// Datas no horário de Manaus, sem fuso: 'AAAA-MM-DDTHH:MM:SS'
const manaus=d=>new Date(d.getTime()-4*3600e3).toISOString().slice(0,19);
const now=()=>manaus(new Date()),day=n=>manaus(new Date(Date.now()+n*86400e3)).slice(0,10);
const plus=(t,min)=>new Date(Date.parse(t+'Z')+min*60e3).toISOString().slice(0,19);
const weekday=d=>new Date(d+'T12:00:00Z').getUTCDay();
const norm=t=>String(t).length===16?t+':00':String(t).slice(0,19);
const digits=s=>String(s||'').replace(/\D/g,'');
const uuid=()=>'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g,()=>(Math.random()*16|0).toString(16));
const fail=m=>{throw Error(m)};
function validDate(d){if(!/^\d{4}-\d{2}-\d{2}$/.test(d||'')||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)fail('Data inválida.');}
function seed(){
 const barbers=[{id:'b1',name:'Daniel Silva',active:true,photo_url:null,specialty:'Degradê e navalhado',bio:'Fundador da casa, 12 anos de tesoura.'},{id:'b2',name:'Lucas Rocha',active:true,photo_url:null,specialty:'Barba e toalha quente',bio:'Especialista em barba desenhada.'},{id:'b3',name:'Pedro Alves',active:true,photo_url:null,specialty:'Corte social e infantil',bio:'Paciência de sobra com a criançada.'}];
 const services=[{id:'s1',name:'Corte masculino',price:40,duration:40,active:true,photo_url:null,description:'Tesoura ou máquina, lavagem e finalização.'},{id:'s2',name:'Barba completa',price:30,duration:30,active:true,photo_url:null,description:'Toalha quente, navalha e hidratação.'},{id:'s3',name:'Corte + barba',price:65,duration:70,active:true,photo_url:null,description:'O combo completo, com desconto.'},{id:'s4',name:'Sobrancelha',price:15,duration:15,active:true,photo_url:null,description:'Acabamento na navalha.'}];
 const names=['Carlos Mendes','Rafael Lima','João Pedro','André Souza','Marcos Vinícius','Pedro Henrique','Bruno Costa','Thiago Ramos','Felipe Nunes','Gustavo Reis','Diego Martins','Leonardo Pinto'];
 const bookings=[],attendances=[];let n=0;
 const visit=(b,method,paid=true)=>{const t=b.starts_at+'-04:00';attendances.push({booking_id:b.id,base_price:b.price,extras:[],discount:0,total:b.price,paid,payment_method:paid?method:null,notes:'',arrived_at:t,finished_at:paid?t:null,paid_at:paid?t:null,version:1});};
 for(let d=-20;d<=6;d++){const date=day(d);if(weekday(date)===0)continue;const count=d===0?8:d>0?3:5;
  // Horários distintos por barbeiro, sem sobreposição: cada barbeiro tem um atendimento a cada 1h30
  for(let i=0;i<count;i++){const s=services[(i+d+40)%3],b=barbers[i%3],start=plus(date+'T09:00:00',Math.floor(i/3)*90+(i%3)*20),id='demo-'+(n++),past=d<0||(d===0&&i<3),cancelled=(i+d+40)%9===4;
   const state=cancelled?null:past?'completed':d===0&&i===3?'arrived':'scheduled';
   const booking={id,customer:names[(i*5+d+40)%12],phone:'929'+String(91234000+(i*5+d+40)%12),customer_id:null,service_id:s.id,service_name:s.name,barber_id:b.id,barber_name:b.name,price:s.price,starts_at:start,ends_at:plus(start,s.duration),status:cancelled?'cancelled':'confirmed',attendance_state:state,no_show:false,no_preference:d===0&&i===5,cancellation_reason:cancelled?'Imprevisto no trabalho':null,cancellation_source:cancelled?'customer':null,created_at:`${day(d-2)}T08:00:00`};
   bookings.push(booking);if(state==='completed')visit(booking,['pix','cash','credit','debit'][n%4]);if(state==='arrived')visit(booking,null,false);}}
 // Clientes que pararam de vir (35 a 60 dias atrás), para a campanha "Sumidos"
 ['Ricardo Alves','Fábio Moura','Wesley Prado','Caio Ribeiro','Igor Santana'].forEach((name,k)=>{for(const back of [60-k*3,38+k]){let date=day(-back);if(weekday(date)===0)date=day(-back-1);const s=services[k%3],b=barbers[k%3],start=date+'T'+String(10+k).padStart(2,'0')+':00:00';
  const row={id:'demo-old-'+k+'-'+back,customer:name,phone:'929'+String(91235000+k),customer_id:null,service_id:s.id,service_name:s.name,barber_id:b.id,barber_name:b.name,price:s.price,starts_at:start,ends_at:plus(start,s.duration),status:'confirmed',attendance_state:'completed',no_show:false,created_at:date+'T08:00:00'};bookings.push(row);visit(row,'pix');}});
 // Reservas do cliente da demonstração (domingo fechado: passa para segunda)
 for(const [d,h,s,b] of [[2,'10:00',0,0],[9,'15:30',2,1],[-12,'11:00',0,0],[-26,'16:00',1,1]]){const sv=services[s],bb=barbers[b],date=weekday(day(d))===0?day(d+1):day(d),start=`${date}T${h}:00`;
  const booking={id:'demo-me-'+d,customer:'Guilherme',phone:'92991230000',customer_id:'u1',service_id:sv.id,service_name:sv.name,barber_id:bb.id,barber_name:bb.name,price:sv.price,starts_at:start,ends_at:plus(start,sv.duration),status:'confirmed',attendance_state:d<0?'completed':'scheduled',no_show:false,created_at:`${day(d-3)}T08:00:00`};
  bookings.push(booking);if(d<0)visit(booking,'pix');}
 return {v:3,barbers,services,bookings,attendances,cash_movements:[],cash_sessions:[],schedule_blocks:[],attendants:[],photos:{},
  barber_details:barbers.map((b,i)=>({barber_id:b.id,commission_rate:[50,40,40][i],cpf:'',phone:'',login_email:i?'':EMAIL,monthly_goal:[5000,3500,3500][i],pix_key:['daniel.silva@pix.demo','','92991234567'][i]||null})),
  business_hours:[1,2,3,4,5,6].map(w=>({id:'h'+w,barber_id:null,weekday:w,opens_at:'09:00',closes_at:w===6?'17:00':'19:00'})),
  shop_settings:[{id:1,slot_minutes:20,booking_days:60,loyalty_enabled:true,loyalty_goal:10,google_review_url:'https://g.page/r/barbearia-demo/review'}],
  customer_profiles:[{id:'u1',name:'Guilherme',phone:'(92) 99123-0000',whatsapp_opt_in:true}],
  customer_directory:names.map((name,i)=>({id:'c'+i,name,phone:'929'+String(91234000+i),email:null})),
  products:[{id:'p1',name:'Pomada modeladora',price:45,stock:12,active:true},{id:'p2',name:'Óleo para barba',price:38,stock:3,active:true},{id:'p3',name:'Shampoo anticaspa',price:32,stock:0,active:true}],
  subscription_plans:[{id:'sp1',name:'Corte ilimitado',price:99.9,visits_per_month:null,description:'Corte masculino quantas vezes quiser no mês.',active:true},{id:'sp2',name:'Corte + barba (4 por mês)',price:149.9,visits_per_month:4,description:'Até 4 atendimentos de corte e barba.',active:true}],
  subscriptions:[{id:'sb1',plan_id:'sp1',customer:names[0],phone:'929'+String(91234000),active:true,paid_until:day(12)},{id:'sb2',plan_id:'sp2',customer:names[3],phone:'929'+String(91234003),active:true,paid_until:day(-4)},{id:'sb3',plan_id:'sp1',customer:'Guilherme',phone:'92991230000',active:true,paid_until:day(20)}],
  reviews:bookings.filter(b=>b.attendance_state==='completed').slice(0,14).map((b,i)=>({booking_id:b.id,barber_id:b.barber_id,rating:[5,5,4,5,5,3,5,4,5,5,4,5,5,5][i],comment:['Melhor degradê da cidade!','','Atendimento pontual.','Barba ficou perfeita.','','Demorou um pouco, mas ficou ótimo.','Ambiente top.','','Voltarei com certeza.','','Gostei do acabamento.','','Profissional atencioso.',''][i],created_at:b.starts_at+'-04:00'})),
  message_log:[]};}
let db=get('demo-db');if(db?.v!==3)db=seed();
// shortcut: se a sessionStorage lotar (fotos grandes), descarta as fotos enviadas para não perder o resto; trocar por IndexedDB se virar problema.
const save=()=>{if(!put('demo-db',db)){db.photos={};for(const b of db.barbers)if(String(b.photo_url).startsWith('data:'))b.photo_url=null;put('demo-db',db);}};save();
const settings=()=>db.shop_settings[0];
// PostgREST simplificado: filtros eq/neq/gte/gt/lte/lt/in/is, order, limit/offset e upsert por on_conflict
const cmp=(a,b)=>typeof a==='number'&&!isNaN(b)?a-Number(b):String(a).localeCompare(String(b));
function filter(rows,params){return rows.filter(r=>{for(const [k,v] of params){if(['select','order','limit','offset','on_conflict'].includes(k))continue;const i=v.indexOf('.'),op=v.slice(0,i),val=decodeURIComponent(v.slice(i+1)),x=r[k]==null?'':String(r[k]).slice(0,Math.max(val.length,10)),num=typeof r[k]==='number';
 const c=num?r[k]-Number(val):x<val.slice(0,19)?-1:x>val.slice(0,19)?1:0;
 if(op==='eq'&&String(r[k])!==val)return false;if(op==='neq'&&String(r[k])===val)return false;if(op==='gte'&&!(c>=0))return false;if(op==='gt'&&!(c>0))return false;if(op==='lte'&&!(c<=0))return false;if(op==='lt'&&!(c<0))return false;if(op==='in'&&!val.replace(/[()]/g,'').split(',').includes(String(r[k])))return false;
 if(op==='is'&&String(r[k]??null)!==val)return false;if(op==='ilike'&&!String(r[k]??'').toLowerCase().includes(val.replace(/\*/g,'').toLowerCase()))return false;}return true;});}
// Horários livres: expediente do barbeiro (ou da loja), intervalo configurado, sem reservas, faltas ou bloqueios por cima
function free(date,barberId,duration,ignore){validDate(date);const b=db.barbers.find(x=>x.id===barberId&&x.active);if(!b||date<day(0)||date>day(settings().booking_days||60))return [];
 const own=db.business_hours.filter(h=>h.barber_id===barberId),h=(own.length?own:db.business_hours.filter(h=>h.barber_id==null)).find(h=>h.weekday===weekday(date));if(!h)return [];
 const out=[],agora=now(),close=date+'T'+h.closes_at.slice(0,5)+':00';
 for(let t=date+'T'+h.opens_at.slice(0,5)+':00';plus(t,duration)<=close;t=plus(t,settings().slot_minutes||30)){const end=plus(t,duration);if(t<=agora)continue;
  if(db.bookings.some(r=>r.id!==ignore&&r.barber_id===barberId&&r.status==='confirmed'&&!r.no_show&&r.starts_at<end&&r.ends_at>t))continue;
  if(db.schedule_blocks.some(x=>(!x.barber_id||x.barber_id===barberId)&&norm(x.starts_at)<end&&norm(x.ends_at)>t))continue;out.push(t.slice(11,16));}
 return out;}
const service=id=>db.services.find(s=>s.id===id&&s.active)||fail('Serviço indisponível.');
const booking=id=>db.bookings.find(b=>b.id===id)||fail('Agendamento não encontrado.');
// Sem preferência: o barbeiro livre com menos reservas no dia
function pick(date,time,s){const options=db.barbers.filter(b=>free(date,b.id,s.duration).includes(time));if(!options.length)fail('Esse horário acabou de ser reservado por outra pessoa. Escolha outro horário.');const load=b=>db.bookings.filter(r=>r.barber_id===b.id&&r.status==='confirmed'&&r.starts_at.startsWith(date)).length;return options.sort((a,b)=>load(a)-load(b))[0];}
function book(p,extra){validDate(p.p_date);if(!/^\d{2}:\d{2}$/.test(p.p_time||''))fail('Horário inválido.');const s=service(p.p_service),b=p.p_barber?db.barbers.find(b=>b.id===p.p_barber):pick(p.p_date,p.p_time,s);
 if(!b||!free(p.p_date,b.id,s.duration).includes(p.p_time))fail('Esse horário acabou de ser reservado por outra pessoa. Escolha outro horário.');
 const me=db.customer_profiles.find(c=>c.id==='u1'),start=`${p.p_date}T${p.p_time}:00`,row={id:uuid(),customer:me?.name||'Cliente',phone:digits(me?.phone),customer_id:'u1',service_id:s.id,service_name:s.name,barber_id:b.id,barber_name:b.name,price:s.price,starts_at:start,ends_at:plus(start,s.duration),status:'confirmed',attendance_state:'scheduled',no_show:false,no_preference:!p.p_barber,created_at:now(),...extra};
 db.bookings.push(row);save();return row;}
function cancel(id,source,reason){const b=booking(id);b.status='cancelled';b.cancellation_source=source;b.cancellation_reason=reason||null;b.updated_at=now();save();return null;}
function loyalty(phone){const s=settings();if(!s.loyalty_enabled)return {enabled:false};const mine=db.attendances.filter(a=>a.paid&&digits(db.bookings.find(b=>b.id===a.booking_id)?.phone)===digits(phone)),paid=mine.filter(a=>!['courtesy','subscription'].includes(a.payment_method)).length,used=mine.filter(a=>a.payment_method==='courtesy').length;
 return {enabled:true,goal:s.loyalty_goal,progress:paid%s.loyalty_goal,available:Math.max(0,Math.floor(paid/s.loyalty_goal)-used)};}
// Assinatura do cliente desta reserva (mesma regra de subscription_for_booking)
function subscriptionFor(b){const s=db.subscriptions.find(x=>x.active&&x.phone===digits(b.phone));if(!s)return null;const plan=db.subscription_plans.find(x=>x.id===s.plan_id),month=day(0).slice(0,7);
 const used=db.attendances.filter(a=>a.subscription_id===s.id&&a.booking_id!==b.id&&db.bookings.find(x=>x.id===a.booking_id)?.starts_at.startsWith(month)).length,up=s.paid_until>=day(0);
 return {id:s.id,plan:plan.name,paid_until:s.paid_until,up_to_date:up,limit:plan.visits_per_month,used,available:up&&(plan.visits_per_month==null||used<plan.visits_per_month)};}
const myBarber=()=>db.barber_details.find(d=>d.login_email===EMAIL)?.barber_id||'b1';
const rpc={staff_role:()=>store?.getItem('demo-role')||'admin',is_admin:()=>true,
 available_slots:p=>{const s=service(p.p_service);return free(p.p_date,p.p_barber,s.duration).map(slot=>({slot}));},
 admin_slots:p=>{const s=service(p.p_service),team=p.p_barber?[p.p_barber]:db.barbers.map(b=>b.id);return [...new Set(team.flatMap(id=>free(p.p_date,id,s.duration)))].sort().map(slot=>({slot}));},
 available_options:p=>{const s=service(p.p_service),map=new Map();for(const b of db.barbers)for(const slot of free(p.p_date,b.id,s.duration))map.set(slot,[...(map.get(slot)||[]),b.name]);return [...map].sort().map(([slot,barbers])=>({slot,barbers}));},
 customer_book:p=>book(p).id,
 customer_book_with_assignment:p=>{const r=book({...p,p_barber:null});return [{booking_id:r.id,barber_name:r.barber_name}];},
 admin_book:p=>{if(!String(p.p_customer||'').trim())fail('Informe o nome do cliente.');if(digits(p.p_phone).length<10)fail('Informe celular com DDD.');return book(p,{customer:p.p_customer.trim(),phone:digits(p.p_phone),customer_id:null}).id;},
 customer_cancel:p=>cancel(p.p_booking||p.p_id,'customer'),admin_cancel_booking:p=>cancel(p.p_booking||p.p_id,'shop',p.p_reason),
 customer_change_slots:p=>{const b=booking(p.p_booking);if(b.status!=='confirmed'||plus(b.starts_at,-60)<now())return [];return free(p.p_date,p.p_barber,(Date.parse(b.ends_at+'Z')-Date.parse(b.starts_at+'Z'))/60e3,b.id).map(slot=>({slot}));},
 customer_reschedule:p=>{const b=booking(p.p_booking);if(!rpc.customer_change_slots(p).some(s=>s.slot===p.p_time))fail('Esse horário não está mais disponível. Escolha outro.');const dur=(Date.parse(b.ends_at+'Z')-Date.parse(b.starts_at+'Z'))/60e3,bb=db.barbers.find(x=>x.id===p.p_barber);
  Object.assign(b,{starts_at:`${p.p_date}T${p.p_time}:00`,ends_at:plus(`${p.p_date}T${p.p_time}:00`,dur),barber_id:bb.id,barber_name:bb.name,rescheduled:true,updated_at:now()});save();return null;},
 customer_claim:p=>{const b=db.bookings.find(b=>b.id===p.p_booking&&digits(b.phone)===digits(p.p_phone)&&!b.customer_id);if(!b)fail('Reserva não encontrada para esse código e celular.');b.customer_id='u1';save();return null;},
 customer_delete_account:()=>{for(const b of db.bookings.filter(b=>b.customer_id==='u1')){if(b.status==='confirmed'&&b.starts_at>now())b.status='cancelled';Object.assign(b,{customer_id:null,customer:'Cliente removido',phone:''});}db.customer_profiles=db.customer_profiles.filter(c=>c.id!=='u1');save();return null;},
 customer_loyalty:()=>loyalty(db.customer_profiles.find(c=>c.id==='u1')?.phone),admin_loyalty:p=>loyalty(p.p_phone),
 barber_summary:p=>{const id=myBarber(),b=db.barbers.find(b=>b.id===id),rate=Number(db.barber_details.find(d=>d.barber_id===id)?.commission_rate||0);
  const paid=db.attendances.filter(a=>{if(!a.paid)return false;const r=db.bookings.find(r=>r.id===a.booking_id&&r.barber_id===id);return r&&r.starts_at.slice(0,10)>=p.p_start&&r.starts_at.slice(0,10)<=p.p_end;});
  const gross=paid.reduce((s,a)=>s+Number(a.total),0);return {name:b.name,barber_id:id,count:paid.length,gross,rate,commission:Math.round(gross*rate)/100};},
 barber_updates:()=>db.bookings.filter(b=>b.barber_id===myBarber()&&b.starts_at>=day(0)).map(b=>({event_type:b.status==='cancelled'?'booking_cancelled':b.rescheduled?'booking_rescheduled':'booking_created',customer:b.customer,service_name:b.service_name,starts_at:b.starts_at,happened_at:(b.updated_at||b.created_at)+'-04:00'})).sort((a,b)=>b.happened_at.localeCompare(a.happened_at)),
 mark_arrival:p=>{const b=booking(p.p_booking||p.p_id);if(b.status!=='confirmed')fail('Agendamento não encontrado ou cancelado.');if(db.attendances.some(a=>a.booking_id===b.id))return b.id;
  if(b.starts_at.slice(0,10)!==day(0))fail('A chegada só pode ser confirmada no dia do agendamento, no horário de Manaus.');
  db.attendances.push({booking_id:b.id,base_price:b.price,extras:[],discount:0,total:b.price,paid:false,payment_method:null,notes:'',arrived_at:new Date().toISOString(),finished_at:null,paid_at:null,version:1});b.attendance_state='arrived';save();return b.id;},
 save_attendance:p=>{const b=booking(p.p_booking),a=db.attendances.find(a=>a.booking_id===b.id);if(b.status!=='confirmed')fail('Agendamento indisponível.');if(!a)fail('Confirme a chegada antes de registrar o atendimento.');if(a.finished_at)fail('Este atendimento já foi concluído.');
  if(p.p_version!==a.version)fail('Este atendimento foi atualizado em outra tela. Atualize antes de salvar.');if(!Array.isArray(p.p_extras)||p.p_extras.length>20)fail('Procedimentos extras inválidos.');
  let extras=0;for(const x of p.p_extras){if(typeof x?.name!=='string'||!x.name.trim()||typeof x.price!=='number'||x.price<0||!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>99)fail('Preencha nome, valor e quantidade de cada procedimento.');extras+=x.price*x.quantity;}
  const subtotal=Number(a.base_price)+extras,discount=Number(p.p_discount);if(!(discount>=0)||discount>subtotal)fail('Desconto inválido. Confira o total dos procedimentos.');
  if(p.p_paid&&!['pix','cash','debit','credit','transfer','courtesy','subscription','other'].includes(p.p_method))fail('Selecione a forma de pagamento.');if(p.p_paid&&p.p_method==='courtesy'&&subtotal-discount!==0)fail('Cortesia exige total igual a zero.');
  if(p.p_paid&&p.p_method==='subscription'&&(!a.subscription_id||subtotal-discount!==0))fail('Use "Usar assinatura" e cobre os extras com outra forma de pagamento. "Assinatura" só vale com total zero.');if(p.p_finish&&!p.p_paid)fail('Confirme o pagamento antes de concluir o atendimento.');
  // Ao concluir, cada produto vendido sai do estoque; falta de estoque impede a conclusão
  if(p.p_finish){for(const x of p.p_extras.filter(x=>x.product_id)){const pr=db.products.find(r=>r.id===x.product_id);if(!pr||pr.stock<x.quantity)fail('Estoque insuficiente de '+x.name+'. Confira o estoque em Serviços.');}for(const x of p.p_extras.filter(x=>x.product_id))db.products.find(r=>r.id===x.product_id).stock-=x.quantity;}
  const at=new Date().toISOString();Object.assign(a,{extras:p.p_extras,discount,total:Math.round((subtotal-discount)*100)/100,paid:!!p.p_paid,payment_method:p.p_paid?p.p_method:null,paid_at:p.p_paid?a.paid_at||at:null,notes:p.p_notes||'',finished_at:p.p_finish?at:null,version:a.version+1});
  b.attendance_state=p.p_finish?'completed':'arrived';save();return a.version;},
 subscription_for_booking:p=>subscriptionFor(booking(p.p_booking)),
 apply_subscription:p=>{const a=db.attendances.find(a=>a.booking_id===p.p_booking);if(!a)fail('Confirme a chegada antes de usar a assinatura.');if(a.finished_at)fail('Este atendimento já foi concluído.');let info=null;
  if(p.p_apply){info=subscriptionFor(booking(p.p_booking));if(!info)fail('Este cliente não tem assinatura ativa.');if(!info.up_to_date)fail('A mensalidade da assinatura está atrasada. Registre o pagamento antes.');if(!info.available)fail('O cliente já usou todos os atendimentos do plano neste mês.');}
  const subtotal=Number(a.total)+Number(a.discount);a.subscription_id=info?.id||null;a.discount=p.p_apply?Number(a.base_price):0;a.total=Math.max(subtotal-a.discount,0);a.version++;save();return a.version;},
 admin_subscription_payment:p=>{if(!['pix','cash','debit','credit','transfer','other'].includes(p.p_method))fail('Selecione a forma de pagamento.');const sub=db.subscriptions.find(x=>x.id===p.p_subscription&&x.active);if(!sub)fail('Assinatura não encontrada ou cancelada.');const plan=db.subscription_plans.find(x=>x.id===sub.plan_id);
  const base=sub.paid_until>day(0)?sub.paid_until:day(0),d=new Date(base+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);sub.paid_until=d.toISOString().slice(0,10);
  db.cash_movements.push({id:uuid(),business_date:day(0),kind:'income',category:'Assinatura',description:plan.name+' · '+sub.customer,amount:plan.price,payment_method:p.p_method,created_at:now()});save();return sub.paid_until;},
 customer_review:p=>{const b=db.bookings.find(b=>b.id===p.p_booking&&b.customer_id==='u1');if(!b||b.attendance_state!=='completed')fail('Só é possível avaliar atendimentos concluídos da sua conta.');if(!(p.p_rating>=1&&p.p_rating<=5))fail('Escolha de 1 a 5 estrelas.');if(String(p.p_comment||'').length>300)fail('Use até 300 caracteres no comentário.');
  db.reviews=db.reviews.filter(r=>r.booking_id!==b.id).concat({booking_id:b.id,barber_id:b.barber_id,rating:p.p_rating,comment:String(p.p_comment||'').trim(),created_at:new Date().toISOString()});save();return null;},
 customer_tip_info:p=>{const b=db.bookings.find(b=>b.id===p.p_booking&&b.customer_id==='u1'&&b.attendance_state==='completed'),k=b&&db.barber_details.find(d=>d.barber_id===b.barber_id)?.pix_key;return k?{barber_name:b.barber_name,pix_key:k}:null;},
 barber_month:()=>{const id=myBarber(),d=db.barber_details.find(d=>d.barber_id===id),rate=Number(d?.commission_rate??40),month=day(0).slice(0,7),agora=now();
  const gross=db.attendances.filter(a=>a.paid&&db.bookings.some(b=>b.id===a.booking_id&&b.barber_id===id&&b.starts_at.startsWith(month))).reduce((s,a)=>s+Number(a.total),0);
  const booked=db.bookings.filter(b=>b.barber_id===id&&b.status==='confirmed'&&!b.no_show&&b.attendance_state!=='completed'&&b.starts_at>=agora&&b.starts_at.startsWith(month)).reduce((s,b)=>s+Number(b.price),0);
  const mine=db.reviews.filter(r=>r.barber_id===id);
  return {month,rate,goal:d?.monthly_goal??null,gross,commission:Math.round(gross*rate)/100,forecast:gross+booked,rating:mine.length?Math.round(mine.reduce((s,r)=>s+r.rating,0)/mine.length*10)/10:null,reviews:mine.length,
   comments:mine.filter(r=>r.comment).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,5).map(({rating,comment,created_at})=>({rating,comment,created_at}))};},
 mark_no_show:p=>{booking(p.p_booking||p.p_id).no_show=true;save();return null;},
 save_barber:p=>{if(!String(p.p_name||'').trim())fail('Informe o nome do barbeiro.');let b=p.p_id&&db.barbers.find(b=>b.id===p.p_id);if(!b){b={id:uuid(),active:true,photo_url:null,specialty:'',bio:''};db.barbers.push(b);db.barber_details.push({barber_id:b.id,commission_rate:40,cpf:'',phone:'',login_email:''});}
  b.name=p.p_name.trim();Object.assign(db.barber_details.find(d=>d.barber_id===b.id),{cpf:p.p_cpf||'',phone:p.p_phone||''});for(const r of db.bookings)if(r.barber_id===b.id)r.barber_name=b.name;save();return b.id;},
 save_barber_commission:p=>{const rate=Number(p.p_rate);if(!(rate>=0&&rate<=100))fail('A comissão deve ficar entre 0% e 100%.');db.barber_details.find(d=>d.barber_id===p.p_barber).commission_rate=rate;save();return null;},
 admin_set_barber_login:p=>{db.barber_details.find(d=>d.barber_id===p.p_barber).login_email=String(p.p_email||'').trim().toLowerCase();save();return null;},
 save_barber_photo:p=>{const key=String(p.p_url).split('/object/public/')[1]?.split('?')[0];db.barbers.find(b=>b.id===p.p_barber).photo_url=db.photos[key]||p.p_url;save();return null;},
 admin_list_attendants:()=>db.attendants.map(email=>({email})),
 admin_set_attendant:p=>{const email=String(p.p_email||'').trim().toLowerCase();if(!/^[^@ ]+@[^@ ]+\.[^@ ]+$/.test(email))fail('Confira o e-mail da atendente.');db.attendants=db.attendants.filter(e=>e!==email);if(p.p_allow)db.attendants.push(email);save();return null;},
 admin_search_customers:p=>{const q=String(p.p_query||'').trim().toLowerCase(),d=digits(q);if(q.length<2)return [];
  return [...db.customer_profiles.map(c=>({id:c.id,name:c.name,phone:digits(c.phone),email:c.id==='u1'?EMAIL:null,source:'online'})),...db.customer_directory.map(c=>({...c,source:'presencial'}))]
   .filter(c=>String(c.name).toLowerCase().includes(q)||(d&&c.phone.includes(d))||String(c.email||'').includes(q)).slice(0,12);},
 admin_save_customer:p=>{const phone=digits(p.p_phone);if(!String(p.p_name||'').trim())fail('Informe o nome do cliente.');if(phone.length<10||phone.length>15)fail('Informe celular com DDD.');
  let c=db.customer_directory.find(c=>c.phone===phone);if(!c){c={id:uuid(),phone};db.customer_directory.push(c);}Object.assign(c,{name:p.p_name.trim(),email:String(p.p_email||'').trim().toLowerCase()||c.email||null});save();return c.id;}};
// Valores padrão do banco para inserções feitas pelo painel
const defaults={services:{active:true,photo_url:null,description:''},barbers:{active:true,photo_url:null,specialty:'',bio:''},products:{active:true,stock:0},subscription_plans:{active:true,description:'',visits_per_month:null},subscriptions:{active:true},message_log:{campaign:null,booking_id:null}};
const headers={'Content-Type':'application/json','X-Content-Type-Options':'nosniff'};
const json=(v,status=200)=>new Response(v===undefined?'':JSON.stringify(v),{status,headers});
const realFetch=window.fetch.bind(window);
window.fetch=async(input,init={})=>{const url=String(input?.url||input);if(!url.startsWith(URL0))return realFetch(input,init);
 const u=new URL(url),path=u.pathname,method=(init.method||'GET').toUpperCase();
 // Foto do barbeiro: guarda reduzida no próprio navegador
 if(path.startsWith('/storage/v1/object/')){const key=path.slice('/storage/v1/object/'.length);try{db.photos[key]=await window.ServiceCards.photo(init.body);save();}catch{}return json({Key:key});}
 let body={};try{body=init.body?JSON.parse(init.body):{};}catch{return json({message:'Corpo inválido.'},400);}
 if(path.startsWith('/auth/v1/user'))return json({id:'u1',email:EMAIL,factors:[{id:'demo-factor',factor_type:'totp',status:'verified'}]});
 // Verificação em duas etapas: na demonstração qualquer código de 6 dígitos vale
 if(path==='/auth/v1/factors'&&method==='POST')return json({id:'demo-factor',type:'totp',totp:{qr_code:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/><text x="1" y="6" font-size="3">DEMO</text></svg>',secret:'DEMONSTRACAO',uri:''}});
 if(/\/challenge$/.test(path))return json({id:'demo-challenge'});
 if(/\/verify$/.test(path))return /^\d{6}$/.test(body.code||'')?json(session):json({message:'Código inválido.'},400);
 if(path.startsWith('/auth/v1/signup')){const d=body.data||{};db.customer_profiles=db.customer_profiles.filter(c=>c.id!=='u1').concat({id:'u1',name:d.name||'Cliente',phone:d.phone||'',whatsapp_opt_in:!!d.whatsapp_opt_in});save();return json(session);}
 if(path.startsWith('/auth/v1/'))return json(path.includes('logout')?{}:session);
 if(path.startsWith('/rest/v1/rpc/')){const f=rpc[path.slice(13)];try{return json(f?f(body):null);}catch(e){return json({message:e.message},400);}}
 const table=path.slice(9),rows=db[table];if(!rows)return json([]);
 if(method==='GET'){let out=filter(rows,[...u.searchParams]);const order=u.searchParams.get('order');if(order){const [k,dir]=order.split(',')[0].split('.');out=[...out].sort((a,b)=>cmp(a[k],b[k])*(dir==='desc'?-1:1));}
  const offset=Number(u.searchParams.get('offset')||0),limit=u.searchParams.get('limit');return json(out.slice(offset,limit==null?undefined:offset+Number(limit)));}
 if(method==='PATCH'){for(const r of filter(rows,[...u.searchParams]))Object.assign(r,body);save();return json([]);}
 if(method==='POST'){const keys=u.searchParams.get('on_conflict')?.split(',');const out=[];for(const r of [].concat(body)){const same=keys&&rows.find(x=>keys.every(k=>(x[k]??null)===(r[k]??null)));if(same)out.push(Object.assign(same,r));else{const row={id:uuid(),created_at:now(),...defaults[table],...r};rows.push(row);out.push(row);}}save();return json(out);}
 if(method==='DELETE'){db[table]=rows.filter(r=>!filter([r],[...u.searchParams]).length);save();return json([]);}
 return json([]);};
// Faixa fixa avisando que é demonstração, com volta ao início
if(page!=='demo.html')addEventListener('DOMContentLoaded',()=>{const bar=document.createElement('a');bar.href='demo.html';bar.textContent='Demonstração com dados fictícios · voltar às telas';bar.style.cssText='position:fixed;z-index:9998;top:0;left:50%;transform:translateX(-50%);padding:6px 14px;border-radius:0 0 10px 10px;background:#c49242;color:#fff;font:600 12px/1.4 system-ui,sans-serif;text-decoration:none;white-space:nowrap';document.body.append(bar);});
})();
