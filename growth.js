/* Crescimento no painel: lembretes de horário (Agenda), Campanhas (só chefe), produtos e clube de assinatura
   (Serviços), metas e chave Pix dos barbeiros (Barbeiros) e, na ficha de atendimento, venda de produto e uso
   da assinatura. As mensagens saem do WhatsApp da própria equipe, uma por vez; o sistema só registra o envio.
   Banco: database/crescimento.sql. */
(()=>{
const $=id=>document.getElementById(id),api=window.BarberAPI,auth=window.StaffAuth,wa=window.BarberWhatsApp;
if(!$('tab-agenda')||!api||!auth)return;
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(v==null||v===false)continue;if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e[k]=v;else if(k in e&&typeof e[k]!=='function'&&!k.includes('-'))e[k]=v;else e.setAttribute(k,v===true?'':v);}e.append(...kids.filter(k=>k!=null&&k!==false));return e;};
const req=async(path,opt={})=>api.request(path,{...opt,token:await auth.token()});
const rpc=async(name,body)=>api.rpc(name,body,await auth.token());
const digits=s=>String(s||'').replace(/\D/g,'');
const br=d=>String(d).slice(0,10).split('-').reverse().join('/');
const money=n=>api.money(Number(n)||0);
const shop=()=>api.shop||'Daniel Silva',site=()=>api.base?api.base():location.origin;
const chefe=()=>auth.role()!=='attendant';
const addDays=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const fill=(text,values)=>text.replace(/\{(\w+)\}/g,(m,k)=>values[k]??m);
const say=(id,text)=>{const p=$(id);if(p)p.textContent=text;};
async function pages(path){const out=[];for(let offset=0;;offset+=500){const page=await req(path+'&limit=500&offset='+offset);out.push(...page);if(page.length<500)return out;}}
async function byIds(path,ids){const out=[];for(let i=0;i<ids.length;i+=80)out.push(...await req(path+'('+ids.slice(i,i+80).join(',')+')'));return out;}
const log=body=>req('/rest/v1/message_log',{method:'POST',prefer:'return=minimal',body:{...body,phone:digits(body.phone)}});
// Botão que abre o WhatsApp com a mensagem pronta; o envio é registrado ao tocar.
// text pode ser função: a mensagem é montada no toque, com o texto que está na tela.
function sendLink(phone,text,label,onSent){const build=()=>wa.link(phone,typeof text==='function'?text():text);let href;try{href=build();}catch{return el('span',{class:'growth-muted',text:'Celular inválido'});}
 const a=el('a',{class:'growth-send',href,target:'_blank',rel:'noopener noreferrer',text:label});a.onclick=()=>{try{a.href=build();}catch{}onSent().catch(e=>alertLine(e.message));};return a;}
function alertLine(text){const p=document.querySelector('[role=status]');if(p)p.textContent=text;}
function section(id,title,help,...body){return el('details',{class:'new-booking growth-box',id},el('summary',{text:title}),help&&el('p',{class:'help',text:help}),...body);}

/* ---------- Lembretes de horário (Agenda: chefe e atendente) ---------- */
async function reminders(){
 if(!$('reminders'))$('tab-agenda').querySelector('.section-intro')?.after(section('reminders','Lembretes de horário',
  'Clientes de hoje (a partir de agora) e de amanhã. Toque em Enviar: o WhatsApp abre com a mensagem pronta e o painel marca quem já foi avisado.',
  el('p',{id:'reminderstatus',class:'growth-count',role:'status'}),el('div',{id:'reminderlist',class:'growth-queue'})));
 $('reminders').open=true;
 const today=api.day(),tomorrow=addDays(today,1),agora=api.nowManaus();
 try{const rows=(await req('/rest/v1/bookings?select=id,customer,phone,service_name,barber_name,starts_at,status,no_show&status=eq.confirmed&starts_at=gte.'+today+'T00:00:00&starts_at=lt.'+tomorrow+'T23:59:59.999999&order=starts_at&limit=500')).filter(r=>!r.no_show&&r.starts_at>agora);
  const sent=new Set((await byIds('/rest/v1/message_log?select=booking_id&kind=eq.reminder&booking_id=in.',rows.map(r=>r.id))).map(r=>r.booking_id));
  const list=$('reminderlist');list.replaceChildren();
  const count=()=>say('reminderstatus',rows.length?sent.size+' de '+rows.length+' lembretes enviados.':'Nenhum cliente marcado para o resto de hoje e amanhã.');
  for(const r of rows){const when=r.starts_at.startsWith(today)?'Hoje':'Amanhã',time=r.starts_at.slice(11,16);
   const text='Olá, '+r.customer+'! Passando para lembrar do seu horário na Barbearia '+shop()+':\n\n'+when+' às '+time+' (Manaus)\nServiço: '+r.service_name+'\nBarbeiro: '+r.barber_name+'\n\nPrecisa alterar ou cancelar? Acesse '+site()+'/conta.html ou responda esta mensagem.';
   const done=el('span',{class:'growth-done',text:'✓ Enviado',hidden:!sent.has(r.id)});
   const row=el('div',{class:'growth-row'+(sent.has(r.id)?' is-sent':'')},el('div',{},el('strong',{text:r.customer}),el('span',{class:'growth-muted',text:when+' '+time+' · '+r.service_name+' · '+r.barber_name})),
    el('div',{class:'growth-actions'},done,sendLink(r.phone,text,sent.has(r.id)?'Enviar de novo':'Enviar lembrete',async()=>{if(sent.has(r.id))return;await log({kind:'reminder',booking_id:r.id,phone:r.phone});sent.add(r.id);done.hidden=false;row.classList.add('is-sent');count();})));
   list.append(row);}
  count();
 }catch(e){say('reminderstatus',e.message+' Execute crescimento.sql no Supabase para ativar os lembretes.');}
}

/* ---------- Campanhas (só chefe) ---------- */
const AUDIENCES={
 sumidos:{title:'Sumidos',sub:'sem vir há mais de {dias} dias',text:'Olá, {nome}! Faz {dias} dias que você não aparece na Barbearia {loja}. Que tal renovar o visual? O {barbeiro} tem horários esta semana: {link}'},
 fieis:{title:'Fiéis',sub:'5 visitas ou mais',text:'Olá, {nome}! Obrigado por ser cliente da Barbearia {loja}: já são {visitas} visitas com a gente. Quando quiser, é só agendar o próximo: {link}'},
 atrasados:{title:'Assinante atrasado',sub:'mensalidade vencida',text:'Olá, {nome}! A mensalidade do seu plano {plano} venceu em {vencimento}. Para continuar aproveitando, é só acertar no balcão ou responder esta mensagem.'},
 google:{title:'Avaliação no Google',sub:'atendidos nos últimos 7 dias',text:'Olá, {nome}! Obrigado pela visita à Barbearia {loja}. Se gostou do atendimento, deixe sua avaliação no Google, ajuda muito a gente: {google}'}};
const camp={key:'sumidos',days:30,data:null};
const stored=(k,v)=>{try{if(v===undefined)return localStorage.getItem('campanha-'+k);localStorage.setItem('campanha-'+k,v);}catch{return null;}};
async function campaignData(){
 const [bookings,subs,plans,logs,settings]=await Promise.all([
  pages('/rest/v1/bookings?select=id,customer,phone,barber_name,starts_at,status,attendance_state&order=starts_at,id'),
  req('/rest/v1/subscriptions?select=id,plan_id,customer,phone,paid_until,active&active=eq.true'),
  req('/rest/v1/subscription_plans?select=id,name'),
  pages('/rest/v1/message_log?select=kind,campaign,phone,created_at&kind=in.(campaign,google,optout)&order=created_at'),
  req('/rest/v1/shop_settings?select=google_review_url&id=eq.1')]);
 const people=new Map(),agora=api.nowManaus();
 for(const b of bookings){const phone=digits(b.phone);if(phone.length<10)continue;const p=people.get(phone)||{phone,name:b.customer,visits:0,last:null,barber:'',future:false,recent:false};
  if(b.attendance_state==='completed'){p.visits++;if(!p.last||b.starts_at>p.last){p.last=b.starts_at;p.barber=b.barber_name;p.name=b.customer;}}
  if(b.status==='confirmed'&&b.starts_at>agora)p.future=true;people.set(phone,p);}
 return {people:[...people.values()],subs,plans:new Map(plans.map(p=>[p.id,p.name])),logs,google:settings[0]?.google_review_url||''};
}
function audience(key){const d=camp.data,today=api.day(),optout=new Set(d.logs.filter(l=>l.kind==='optout').map(l=>l.phone));let rows;
 if(key==='sumidos'){const limit=addDays(today,-camp.days);rows=d.people.filter(p=>p.visits&&!p.future&&p.last.slice(0,10)<limit).sort((a,b)=>a.last.localeCompare(b.last))
  .map(p=>({...p,detail:'Última vez '+br(p.last)+' · '+p.visits+' visita(s) · '+p.barber,vars:{dias:Math.round((Date.parse(today)-Date.parse(p.last.slice(0,10)))/864e5)}}));}
 else if(key==='fieis')rows=d.people.filter(p=>p.visits>=5).sort((a,b)=>b.visits-a.visits).map(p=>({...p,detail:p.visits+' visitas · última '+br(p.last),vars:{}}));
 else if(key==='atrasados')rows=d.subs.filter(s=>s.paid_until<today).map(s=>({phone:digits(s.phone),name:s.customer,barber:'',visits:0,detail:(d.plans.get(s.plan_id)||'Plano')+' · venceu '+br(s.paid_until),vars:{plano:d.plans.get(s.plan_id)||'',vencimento:br(s.paid_until)}}));
 else{const asked=new Set(d.logs.filter(l=>l.kind==='google').map(l=>l.phone)),from=addDays(today,-7);rows=d.people.filter(p=>p.last&&p.last.slice(0,10)>=from&&!asked.has(p.phone)).map(p=>({...p,detail:'Atendido em '+br(p.last)+' por '+p.barber,vars:{}}));}
 return rows.filter(r=>!optout.has(r.phone));
}
function sentRecently(key){const since=new Date(Date.now()-30*864e5).toISOString(),kind=key==='google'?'google':'campaign';return new Set(camp.data.logs.filter(l=>l.kind===kind&&(kind==='google'||l.campaign===key)&&String(l.created_at)>=since.slice(0,19)).map(l=>l.phone));}
function renderCampaigns(){
 const box=$('campaigns-app');box.replaceChildren();
 box.append(el('div',{class:'section-intro'},el('h3',{text:'Traga o cliente de volta.'}),el('p',{text:'Escolha um público, ajuste a mensagem e envie pelo seu WhatsApp, um cliente por vez. Envie só para clientes da barbearia e respeite quem pedir para não receber mais (LGPD).'})));
 const cards=el('div',{class:'growth-cards',role:'group','aria-label':'Públicos'});
 for(const [key,a] of Object.entries(AUDIENCES)){const n=audience(key).length;
  cards.append(el('button',{type:'button',class:'growth-card','aria-pressed':String(key===camp.key),onclick:()=>{camp.key=key;renderCampaigns();}},el('span',{class:'growth-card-title',text:a.title}),el('span',{class:'growth-muted',text:fill(a.sub,{dias:camp.days})}),el('strong',{text:String(n)})));}
 box.append(cards);
 const a=AUDIENCES[camp.key],panel=el('article',{class:'catalog-form growth-panel'});
 if(camp.key==='sumidos'){const days=el('input',{type:'number',min:'15',max:'365',step:'5',value:String(camp.days),id:'campaigndays'});days.onchange=()=>{const v=Number(days.value);if(v>=15&&v<=365){camp.days=v;stored('dias',String(v));renderCampaigns();}};panel.append(el('label',{text:'Sem vir há mais de (dias)'},days));}
 if(camp.key==='google'){const url=el('input',{type:'url',id:'googleurl',value:camp.data.google,placeholder:'https://g.page/r/.../review'}),save=el('button',{type:'button',text:'Salvar link'});
  save.onclick=async()=>{const v=url.value.trim();if(v&&!/^https:\/\//.test(v))return say('campaignstatus','O link do Google precisa começar com https://');try{await req('/rest/v1/shop_settings?id=eq.1',{method:'PATCH',body:{google_review_url:v||null}});camp.data.google=v;say('campaignstatus','Link de avaliação salvo.');renderCampaigns();}catch(e){say('campaignstatus',e.message);}};
  panel.append(el('label',{text:'Link de avaliação no Google (Perfil da Empresa → Pedir avaliações)'},url),save);}
 const text=el('textarea',{id:'campaigntext',rows:4,maxLength:700,value:stored(camp.key)||a.text});text.oninput=()=>{stored(camp.key,text.value);};
 panel.append(el('label',{text:'Mensagem'},text),el('p',{class:'help',text:'Troca automática: {nome}, {barbeiro}, {loja}, {link} (agendar), {visitas}'+(camp.key==='sumidos'?', {dias}':'')+(camp.key==='atrasados'?', {plano}, {vencimento}':'')+(camp.key==='google'?', {google}':'')+'.'}));
 const rows=audience(camp.key),sent=sentRecently(camp.key),list=el('div',{class:'growth-queue'}),count=el('p',{class:'growth-count',id:'campaignstatus',role:'status'});
 const recount=()=>{count.textContent=rows.length?[...sent].filter(p=>rows.some(r=>r.phone===p)).length+' de '+rows.length+' enviados nos últimos 30 dias.':'Ninguém neste público agora.';};
 const blocked=camp.key==='google'&&!camp.data.google;
 for(const r of rows){const done=el('span',{class:'growth-done',text:'✓ Enviado',hidden:!sent.has(r.phone)}),row=el('div',{class:'growth-row'+(sent.has(r.phone)?' is-sent':'')});
  const message=()=>fill(text.value,{nome:r.name.split(' ')[0],barbeiro:r.barber||'nosso time',loja:shop(),link:site()+'/agendar.html',visitas:r.visits,google:camp.data.google,...r.vars});
  const send=blocked?el('span',{class:'growth-muted',text:'Salve o link do Google acima'}):sendLink(r.phone,message,sent.has(r.phone)?'Enviar de novo':'Enviar ↗',async()=>{await log(camp.key==='google'?{kind:'google',phone:r.phone}:{kind:'campaign',campaign:camp.key,phone:r.phone});sent.add(r.phone);camp.data.logs.push({kind:camp.key==='google'?'google':'campaign',campaign:camp.key,phone:r.phone,created_at:new Date().toISOString()});done.hidden=false;row.classList.add('is-sent');recount();});
  const stop=el('button',{type:'button',class:'growth-stop',text:'Não enviar mais',onclick:async()=>{if(!confirm(r.name+' não vai mais aparecer nas campanhas. Continuar?'))return;try{await log({kind:'optout',phone:r.phone});camp.data.logs.push({kind:'optout',phone:r.phone});renderCampaigns();}catch(e){say('campaignstatus',e.message);}}});
  row.append(el('div',{},el('strong',{text:r.name}),el('span',{class:'growth-muted',text:r.detail})),el('div',{class:'growth-actions'},done,send,stop));list.append(row);}
 panel.append(el('h4',{text:'Fila de envio'}),count,list);box.append(panel);recount();
}
async function campaigns(){if(!chefe())return;const box=$('campaigns-app');if(!camp.data)box.replaceChildren(el('p',{class:'help',text:'Carregando campanhas…'}));
 try{camp.data=await campaignData();const saved=Number(stored('dias'));if(saved)camp.days=saved;renderCampaigns();}catch(e){box.replaceChildren(el('p',{class:'help',text:e.message+' Execute crescimento.sql no Supabase para ativar as campanhas.'}));}}

/* ---------- Produtos e estoque + Clube de assinatura (Serviços, só chefe) ---------- */
const METHODS=[['pix','Pix'],['cash','Dinheiro'],['debit','Cartão de débito'],['credit','Cartão de crédito'],['transfer','Transferência'],['other','Outro']];
const methodSelect=id=>el('select',{id},...METHODS.map(([v,t])=>el('option',{value:v,text:t})));
function mountCatalog(){if($('productsbox'))return;const anchor=$('tab-servicos').querySelector('.loyalty-settings')||$('tab-servicos').querySelector('.section-intro');
 const pform=el('form',{id:'productform',class:'growth-form'},el('label',{text:'Produto'},el('input',{id:'productname',maxLength:80,required:true,placeholder:'Ex.: Pomada modeladora'})),el('label',{text:'Preço (R$)'},el('input',{id:'productprice',type:'number',min:'0',step:'0.01',required:true})),el('label',{text:'Estoque inicial'},el('input',{id:'productstock',type:'number',min:'0',step:'1',value:'0',required:true})),el('button',{text:'Cadastrar produto'}));
 const plform=el('form',{id:'planform',class:'growth-form'},el('label',{text:'Nome do plano'},el('input',{id:'planname',maxLength:80,required:true,placeholder:'Ex.: Corte ilimitado'})),el('label',{text:'Mensalidade (R$)'},el('input',{id:'planprice',type:'number',min:'1',step:'0.01',required:true})),el('label',{text:'Por mês (vazio = ilimitado)'},el('input',{id:'planvisits',type:'number',min:'1',max:'60',step:'1'})),el('label',{text:'O que inclui'},el('input',{id:'plandescription',maxLength:300,placeholder:'Ex.: Corte masculino quantas vezes quiser'})),el('button',{text:'Criar plano'}));
 const sform=el('form',{id:'subscriberform',class:'growth-form'},el('label',{text:'Cliente'},el('input',{id:'subname',maxLength:80,required:true})),el('label',{text:'Celular com DDD'},el('input',{id:'subphone',type:'tel',maxLength:25,required:true})),el('label',{text:'Plano'},el('select',{id:'subplan',required:true})),el('label',{text:'1ª mensalidade paga em'},methodSelect('submethod')),el('button',{text:'Cadastrar assinante'}));
 anchor.after(section('productsbox','Produtos e estoque','Produtos vendidos na ficha de atendimento ("+ Produto") saem do estoque quando o atendimento é concluído.',pform,el('div',{id:'productlist',class:'growth-queue'})),
  section('clubbox','Clube de assinatura','O cliente paga a mensalidade fora do sistema (Pix, cartão, dinheiro) e você registra aqui: o valor entra no Caixa do dia. No atendimento, a equipe toca em "Usar assinatura" na ficha.',
   el('h4',{text:'Planos'}),plform,el('div',{id:'planlist',class:'growth-queue'}),el('h4',{text:'Assinantes'}),sform,el('div',{id:'sublist',class:'growth-queue'})));
 pform.onsubmit=async e=>{e.preventDefault();try{await req('/rest/v1/products',{method:'POST',prefer:'return=minimal',body:{name:$('productname').value.trim(),price:Number($('productprice').value),stock:Number($('productstock').value)}});pform.reset();say('productstatus','');await catalog();}catch(ex){alertLine(ex.message);}};
 plform.onsubmit=async e=>{e.preventDefault();const visits=$('planvisits').value;try{await req('/rest/v1/subscription_plans',{method:'POST',prefer:'return=minimal',body:{name:$('planname').value.trim(),price:Number($('planprice').value),visits_per_month:visits?Number(visits):null,description:$('plandescription').value.trim()}});plform.reset();await catalog();}catch(ex){alertLine(ex.message);}};
 sform.onsubmit=async e=>{e.preventDefault();const phone=digits($('subphone').value);if(phone.length<10||phone.length>15)return alertLine('Informe o celular do assinante com DDD.');
  try{const [row]=await req('/rest/v1/subscriptions',{method:'POST',prefer:'return=representation',body:{plan_id:$('subplan').value,customer:$('subname').value.trim(),phone,paid_until:addDays(api.day(),-1)}});
   await rpc('admin_subscription_payment',{p_subscription:row.id,p_method:$('submethod').value});sform.reset();alertLine('Assinante cadastrado e 1ª mensalidade lançada no Caixa.');await catalog();}
  catch(ex){alertLine(/subscriptions_one_active|duplicate/.test(ex.message)?'Este celular já tem uma assinatura ativa.':ex.message);}};
}
async function catalog(){if(!chefe())return;mountCatalog();
 try{const [products,plans,subs]=await Promise.all([req('/rest/v1/products?select=*&order=name'),req('/rest/v1/subscription_plans?select=*&order=name'),req('/rest/v1/subscriptions?select=*&active=eq.true&order=customer')]);
  $('productlist').replaceChildren(...products.map(p=>{const price=el('input',{type:'number',min:'0',step:'0.01',value:String(p.price),'aria-label':'Preço de '+p.name}),entry=el('input',{type:'number',min:'0',step:'1',value:'0','aria-label':'Entrada de estoque de '+p.name});
   const save=el('button',{type:'button',text:'Salvar',onclick:async()=>{const n=Number(entry.value);if(!(n>=0)||!(Number(price.value)>=0))return alertLine('Confira preço e entrada.');try{await req('/rest/v1/products?id=eq.'+p.id,{method:'PATCH',body:{price:Number(price.value),stock:p.stock+n}});alertLine(n?n+' unidade(s) de '+p.name+' entraram no estoque.':'Produto salvo.');await catalog();}catch(e){alertLine(e.message);}}});
   const toggle=el('button',{type:'button',class:'growth-stop',text:p.active?'Desativar':'Ativar',onclick:async()=>{try{await req('/rest/v1/products?id=eq.'+p.id,{method:'PATCH',body:{active:!p.active}});await catalog();}catch(e){alertLine(e.message);}}});
   return el('div',{class:'growth-row'+(p.active?'':' is-off')},el('div',{},el('strong',{text:p.name}),el('span',{class:'growth-muted'+(p.stock<=3?' growth-low':''),text:'Estoque: '+p.stock+(p.stock===0?' · esgotado':p.stock<=3?' · acabando':'')+(p.active?'':' · desativado')})),
    el('div',{class:'growth-actions growth-inline'},el('label',{text:'Preço'},price),el('label',{text:'+ Entrada'},entry),save,toggle));}));
  if(!products.length)$('productlist').append(el('p',{class:'help',text:'Nenhum produto cadastrado.'}));
  const active=plans.filter(p=>p.active),names=new Map(plans.map(p=>[p.id,p]));
  $('subplan').replaceChildren(...active.map(p=>el('option',{value:p.id,text:p.name+' · '+money(p.price)})));
  $('subscriberform').querySelector('button').disabled=!active.length;
  $('planlist').replaceChildren(...plans.map(p=>el('div',{class:'growth-row'+(p.active?'':' is-off')},el('div',{},el('strong',{text:p.name+' · '+money(p.price)+'/mês'}),el('span',{class:'growth-muted',text:(p.visits_per_month?p.visits_per_month+' atendimento(s) por mês':'Ilimitado')+(p.description?' · '+p.description:'')+' · '+subs.filter(s=>s.plan_id===p.id).length+' assinante(s)'})),
   el('div',{class:'growth-actions'},el('button',{type:'button',class:'growth-stop',text:p.active?'Desativar':'Ativar',onclick:async()=>{try{await req('/rest/v1/subscription_plans?id=eq.'+p.id,{method:'PATCH',body:{active:!p.active}});await catalog();}catch(e){alertLine(e.message);}}})))));
  if(!plans.length)$('planlist').append(el('p',{class:'help',text:'Crie o primeiro plano para cadastrar assinantes.'}));
  const today=api.day();
  $('sublist').replaceChildren(...subs.map(s=>{const late=s.paid_until<today,method=methodSelect('');
   return el('div',{class:'growth-row'+(late?' is-late':'')},el('div',{},el('strong',{text:s.customer}),el('span',{class:'growth-muted'+(late?' growth-low':''),text:(names.get(s.plan_id)?.name||'Plano')+' · '+(late?'Atrasada desde ':'Em dia até ')+br(s.paid_until)})),
    el('div',{class:'growth-actions growth-inline'},method,el('button',{type:'button',text:'Registrar mensalidade',onclick:async()=>{try{const until=await rpc('admin_subscription_payment',{p_subscription:s.id,p_method:method.value});alertLine('Mensalidade registrada no Caixa. Em dia até '+br(until)+'.');await catalog();}catch(e){alertLine(e.message);}}}),
     el('button',{type:'button',class:'growth-stop',text:'Cancelar',onclick:async()=>{if(!confirm('Cancelar a assinatura de '+s.customer+'?'))return;try{await req('/rest/v1/subscriptions?id=eq.'+s.id,{method:'PATCH',body:{active:false}});await catalog();}catch(e){alertLine(e.message);}}})));}));
  if(!subs.length)$('sublist').append(el('p',{class:'help',text:'Nenhum assinante ativo.'}));
 }catch(e){alertLine(e.message+' Execute crescimento.sql no Supabase para ativar produtos e assinaturas.');}
}

/* ---------- Metas e chave Pix dos barbeiros (Barbeiros, só chefe) ---------- */
async function goals(){if(!chefe())return;
 if(!$('goalsbox'))$('tab-barbeiros').querySelector('.catalog-screen')?.after(section('goalsbox','Metas e gorjetas da equipe','A meta aparece na Área do barbeiro com o quanto ele já faturou no mês e a previsão com a agenda marcada. A chave Pix aparece para o cliente dar gorjeta depois do atendimento, direto para o barbeiro.',el('div',{id:'goallist',class:'growth-queue'})));
 try{const [barbers,details]=await Promise.all([req('/rest/v1/barbers?select=id,name,active&order=name'),req('/rest/v1/barber_details?select=barber_id,monthly_goal,pix_key')]),map=new Map(details.map(d=>[d.barber_id,d]));
  $('goallist').replaceChildren(...barbers.filter(b=>b.active).map(b=>{const d=map.get(b.id)||{},goal=el('input',{type:'number',min:'0',step:'50',value:d.monthly_goal??'','aria-label':'Meta de '+b.name}),pix=el('input',{class:'growth-wide',maxLength:120,value:d.pix_key||'',placeholder:'CPF, celular, e-mail ou chave aleatória','aria-label':'Chave Pix de '+b.name});
   return el('div',{class:'growth-row'},el('strong',{text:b.name}),el('div',{class:'growth-actions growth-inline'},el('label',{text:'Meta do mês (R$)'},goal),el('label',{text:'Chave Pix para gorjeta'},pix),
    el('button',{type:'button',text:'Salvar',onclick:async()=>{const key=pix.value.trim();if(key&&key.length<3)return alertLine('Chave Pix muito curta.');try{await req('/rest/v1/barber_details?on_conflict=barber_id',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{barber_id:b.id,monthly_goal:goal.value===''?null:Number(goal.value),pix_key:key||null}});alertLine('Meta e chave Pix de '+b.name+' salvas.');}catch(e){alertLine(e.message);}}})));}));
 }catch(e){alertLine(e.message+' Execute crescimento.sql no Supabase para ativar metas e gorjetas.');}
}

/* ---------- Ficha de atendimento: + Produto e assinatura ---------- */
const method=$('visitmethod');
if(method&&!method.querySelector('option[value=subscription]'))method.querySelector('option[value=other]')?.before(el('option',{value:'subscription',text:'Assinatura'}));
let products=[];
async function visit({booking,visit}){
 const closed=!!visit.finished_at,shortcuts=$('visitform')?.querySelector('.extra-shortcuts');
 if(shortcuts&&!$('productpick')){const pick=el('select',{id:'productpick','aria-label':'Produto vendido'}),add=el('button',{type:'button',id:'addproduct',text:'+ Produto'});
  add.onclick=()=>{const p=products.find(x=>x.id===pick.value);if(!p)return;window.BarberAttendance.addExtra({name:p.name,price:Number(p.price),quantity:1,product_id:p.id});};
  shortcuts.append(el('span',{class:'growth-product'},pick,add));}
 try{products=(await req('/rest/v1/products?select=id,name,price,stock&active=eq.true&stock=gt.0&order=name'));
  $('productpick').replaceChildren(...products.map(p=>el('option',{value:p.id,text:p.name+' · '+money(p.price)+' ('+p.stock+' em estoque)'})));
  $('productpick').closest('.growth-product').hidden=!products.length||closed;}catch{$('productpick').closest('.growth-product').hidden=true;}
 let note=$('visitsubscription');if(!note){note=el('div',{id:'visitsubscription',class:'loyalty-note growth-sub'});$('visitloyalty')?.after(note);}
 note.hidden=true;note.replaceChildren();
 try{const info=await rpc('subscription_for_booking',{p_booking:booking.id});if(!info||window.BarberAttendance.current()?.booking_id!==booking.id)return;
  const using=visit.subscription_id===info.id,usage=info.limit?info.used+' de '+info.limit+' usados este mês':'ilimitado';
  note.append(el('span',{text:'Assinante: '+info.plan+' · '+(info.up_to_date?'em dia até '+br(info.paid_until):'mensalidade atrasada desde '+br(info.paid_until))+' · '+usage+(using?' · usando neste atendimento':'')}));
  if(!closed&&(using||info.available)){const b=el('button',{type:'button',text:using?'Tirar assinatura':'Usar assinatura'});
   b.onclick=async()=>{b.disabled=true;try{await rpc('apply_subscription',{p_booking:booking.id,p_apply:!using});await window.BarberAttendance.reopen();if(!using&&!(window.BarberAttendance.current()?.extras||[]).length){$('visitpaid').checked=true;method.value='subscription';method.required=true;}}catch(e){$('visiterror').textContent=e.message;b.disabled=false;}};note.append(b);}
  note.hidden=false;
 }catch{}
}
window.addEventListener('visitedit',e=>visit(e.detail));

/* ---------- Quando cada aba abre ---------- */
const loaders={agenda:reminders,campanhas:campaigns,servicos:catalog,barbeiros:goals};
window.addEventListener('stafftabchange',e=>{const run=loaders[e.detail.name];if(run&&auth.session()&&auth.role())run();});
// O login pode terminar antes deste arquivo carregar: abre já o que estiver na tela.
const open=Object.keys(loaders).find(k=>$('tab-'+k)&&!$('tab-'+k).hidden);if(open&&auth.session()&&auth.role())loaders[open]();
window.GrowthPanel={reminders,campaigns,catalog,goals};
})();
