(function(){
const $=id=>document.getElementById(id),api=window.BarberAPI;
let session=window.StaffAuth.session(),privateDetails=new Map(),newBookingVersion=0,creatingBooking=false,financeReport=null,financeLoading=0,biLoading=0,cancellingBooking=null;
const status=text=>$('status').textContent=text;

async function authorized(){return window.StaffAuth.token();
}
async function request(path,opts={}){return api.request(path,{...opts,token:await authorized()});
}
function leave(){session=null;
window.StaffAuth.clear();
$('panel').hidden=true;
$('login').hidden=false;
$('barbercards').replaceChildren();
$('nopreferencesummary').hidden=true;
$('nopreferencelist').replaceChildren();
$('password').value='';
privateDetails.clear();
financeReport=null;
financeLoading++;
biLoading++;
$('financemetrics').replaceChildren();
$('financebody').replaceChildren();
$('financefoot').replaceChildren();
$('financedetails').replaceChildren();
$('metrics').replaceChildren();
$('ranking').replaceChildren();
$('bimetrics').replaceChildren();
$('biservices').replaceChildren();
$('bihours').replaceChildren();
$('bistaff').replaceChildren();
$('biinsights').replaceChildren();
$('barbers').replaceChildren();
$('barberform').reset();
$('adminbooking').reset();
$('newbookingstatus').textContent='';
$('newconfirm').disabled=true;
newBookingVersion++;
$('whatsapptest').value='';
$('whatsappdestination').value='client';
$('whatsapptestlabel').hidden=true;
}
async function load(){try{const activeSession=session;
if(!activeSession)return;
const filter=$('filter').value;
const query=filter?'&starts_at=gte.'+encodeURIComponent(filter+'T00:00:00')+'&starts_at=lt.'+encodeURIComponent(filter+'T23:59:59.999999'):'';
const [bookings,barbers]=await Promise.all([allBookings(query),request('/rest/v1/barbers?select=id,name,active,photo_url&order=name')]);
if(!session||session!==activeSession)return;

renderDashboard(bookings,barbers);
$('barbercards').replaceChildren();
$('count').textContent=bookings.length+' agendamento(s) · '+api.money(bookings.filter(r=>r.status==='confirmed').reduce((a,r)=>a+Number(r.price),0))+' confirmados';
$('empty').hidden=bookings.length>0;
const noPreferenceBookings=bookings.filter(r=>r.no_preference&&r.status==='confirmed');
$('nopreferencesummary').hidden=!noPreferenceBookings.length;
$('nopreferencelist').replaceChildren();
for(const r of noPreferenceBookings){const item=document.createElement('div'),time=document.createElement('strong'),client=document.createElement('span'),assigned=document.createElement('small');time.textContent=r.starts_at.slice(11,16);client.textContent=r.customer;assigned.textContent='Direcionado para '+r.barber_name;item.append(time,client,assigned);$('nopreferencelist').append(item);}

for(const group of window.BarberTeam.group(bookings,barbers).filter(item=>item.bookings.length)){
const card=document.createElement('article');
card.className='barber-agenda';

const head=document.createElement('div');
head.className='barber-heading';
head.append(window.BarberTeam.portrait(group.name,group.photo_url));
const title=document.createElement('div'),name=document.createElement('h3'),total=document.createElement('p');
name.textContent=group.name;
const confirmed=group.bookings.filter(r=>r.status==='confirmed');
const noPreference=confirmed.filter(r=>r.no_preference).length;
total.textContent=confirmed.length+' confirmado(s) · '+api.money(confirmed.reduce((sum,r)=>sum+Number(r.price),0))+(noPreference?' · '+noPreference+' sem preferência':'');
title.append(name,total);
head.append(title);
card.append(head);

if(!group.bookings.length){const empty=document.createElement('p');
empty.className='agenda-empty';
empty.textContent='Nenhuma reserva para este barbeiro no período selecionado.';
card.append(empty);
}
let agendaDay=null,lastAgendaDate='';
for(const r of group.bookings){const dateKey=r.starts_at.slice(0,10);if(dateKey!==lastAgendaDate){lastAgendaDate=dateKey;agendaDay=document.createElement('section');agendaDay.className='agenda-day';const dayTitle=document.createElement('h4');dayTitle.className='agenda-day-heading';dayTitle.textContent=new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long',timeZone:'America/Manaus'}).format(new Date(dateKey+'T12:00:00-04:00'));agendaDay.append(dayTitle);card.append(agendaDay);}const reservation=document.createElement('div');
reservation.className='reservation'+(r.status==='cancelled'?' cancelled':'');
const when=document.createElement('p');
when.className='reservation-time';
when.textContent=r.starts_at.slice(11,16)+' — '+r.ends_at.slice(11,16);
const customer=document.createElement('h4');
customer.textContent=r.customer;
const details=document.createElement('p');
details.textContent=r.service_name+' · '+api.money(r.price);
const phone=document.createElement('p');
phone.textContent='Celular: '+r.phone;
const state=document.createElement('span');
state.className='booking-state';
state.textContent=r.status==='cancelled'?'Cancelado'+(r.cancellation_source==='client'?' pelo cliente':r.cancellation_source==='shop'?' pela loja':' · origem não registrada'):r.attendance_state==='completed'?'Atendimento concluído':r.attendance_state==='arrived'?'Cliente recebido':'Confirmado';
reservation.classList.add(r.status==='cancelled'?'state-cancelled':r.attendance_state==='completed'?'state-completed':r.attendance_state==='arrived'?'state-arrived':'state-confirmed');
reservation.append(when,customer,details,phone);
if(r.no_preference){const preference=document.createElement('span');preference.className='no-preference-badge';preference.textContent='Sem preferência · direcionado para '+group.name;reservation.append(preference);}
reservation.append(state);
if(r.status==='cancelled'&&r.cancellation_reason){const reason=document.createElement('p');reason.className='cancellation-reason';reason.textContent='Motivo: '+r.cancellation_reason;reservation.append(reason);}
if(r.status==='confirmed'&&(!r.attendance_state||r.attendance_state==='scheduled')&&!r.no_show&&r.starts_at<=api.nowManaus()){const absent=document.createElement('button');absent.className='no-show-button';absent.textContent='Registrar falta';absent.onclick=async()=>{if(!confirm('Registrar que '+r.customer+' não compareceu?'))return;absent.disabled=true;try{await window.BarberOperations.markNoShow(r.id);await load();}catch(e){status(e.message);absent.disabled=false;}};reservation.append(absent);}
const code=document.createElement('details'),codeTitle=document.createElement('summary'),codeValue=document.createElement('p');code.className='reservation-code';codeTitle.textContent='Código da reserva';codeValue.textContent=r.id;code.append(codeTitle,codeValue);reservation.append(code);
addWhatsApp(reservation,r);

if(r.status==='confirmed'&&(!r.attendance_state||r.attendance_state==='scheduled')){const cancel=document.createElement('button');
cancel.className='cancel-booking';
cancel.textContent='Cancelar horário';
cancel.onclick=()=>openCancellation(r);
reservation.append(cancel);
}agendaDay.append(reservation);
}
$('barbercards').append(card);
}
}catch(e){status(e.message)}}
function closeCancellation(){$('cancelmodal').hidden=true;$('cancelform').reset();$('cancelerror').textContent='';cancellingBooking=null;}
function openCancellation(booking){cancellingBooking=booking;$('canceldetails').textContent=booking.customer+' · '+booking.service_name+' · '+booking.starts_at.slice(0,10).split('-').reverse().join('/')+' às '+booking.starts_at.slice(11,16);$('cancelmodal').hidden=false;$('cancelreason').focus();}
$('closecancel').onclick=closeCancellation;
$('abortcancel').onclick=closeCancellation;
$('cancelmodal').onclick=e=>{if(e.target===$('cancelmodal'))closeCancellation();};
$('cancelform').onsubmit=async e=>{e.preventDefault();const booking=cancellingBooking,reason=$('cancelreason').value.trim();if(!booking||reason.length<5){$('cancelerror').textContent='Informe um motivo com pelo menos 5 caracteres.';return;}const button=$('confirmcancel');button.disabled=true;$('cancelerror').textContent='';const notice=window.open('about:blank','_blank');try{let historyRecorded=true;try{await api.rpc('admin_cancel_booking',{p_booking:booking.id,p_reason:reason},await authorized());}catch(databaseError){const unavailable=/admin_cancel_booking|schema cache|could not find the function/i.test(String(databaseError.message));if(!unavailable)throw databaseError;await request('/rest/v1/bookings?id=eq.'+booking.id,{method:'PATCH',body:{status:'cancelled'}});historyRecorded=false;}const cancelled={...booking,status:'cancelled',cancellation_source:'shop',cancellation_reason:reason};const message=window.BarberWhatsApp.message(cancelled,'cancelled',api.base?api.base():location.origin);const link=window.BarberWhatsApp.link(booking.phone,message);if(notice)notice.location.href=link;else window.location.href=link;closeCancellation();status(historyRecorded?'Reserva cancelada pela loja. Horário liberado e aviso preparado para o cliente.':'Reserva cancelada e aviso preparado. Para guardar o motivo no histórico, instale a atualização do banco.');await load();}catch(ex){if(notice)notice.close();const message=/permission denied|not authorized|jwt/i.test(String(ex.message))?'Sua sessão não tem permissão para cancelar. Saia e entre novamente no Portal do Chefe.':'Não foi possível cancelar este horário. Atualize a página e tente novamente.';$('cancelerror').textContent=message;status(message);}finally{button.disabled=false;}};
function addWhatsApp(container,booking){const group=document.createElement('details');
group.className='whatsapp-actions';
const summary=document.createElement('summary');summary.textContent='WhatsApp e avisos';group.append(summary);
const label=document.createElement('label');
label.textContent='Mensagem ao cliente';
const type=document.createElement('select');
type.setAttribute('aria-label','Tipo de mensagem para '+booking.customer);
if(booking.status==='cancelled')type.add(new Option('Aviso de cancelamento','cancelled'));
else{type.add(new Option('Confirmação de agendamento','confirmed'));
type.add(new Option('Aviso de alteração','rescheduled'));
}label.append(type);
const send=document.createElement('a');
send.className='whatsapp-send';
send.textContent='Enviar pelo WhatsApp';
send.href='#';
send.target='_blank';
send.rel='noopener noreferrer';
const feedback=document.createElement('p');
feedback.className='help';
feedback.setAttribute('role','status');
send.onclick=e=>{try{const test=$('whatsappdestination').value==='test';
const destination=test?$('whatsapptest').value:booking.phone;
if(!destination?.trim())throw Error(test?'Preencha seu número em “WhatsApp: envio manual e teste”.':'Esta reserva não tem celular cadastrado.');
const message=window.BarberWhatsApp.message(booking,type.value,api.base?api.base():location.origin);
send.href=window.BarberWhatsApp.link(destination,message);
feedback.textContent=test?'Mensagem preparada para seu número de teste. Confirme o envio no WhatsApp.':'Mensagem preparada para o cliente. Confirme o envio no WhatsApp.';
}catch(ex){e.preventDefault();
feedback.textContent=ex.message;
status(ex.message);
}};
group.append(label,send,feedback);
container.append(group);
}
$('whatsappdestination').onchange=()=>{const test=$('whatsappdestination').value==='test';
$('whatsapptestlabel').hidden=!test;
$('whatsappmode').textContent=test?'Modo teste: os avisos serão abertos somente para o número de teste informado.':'Os botões abrirão a conversa com o cliente de cada reserva.';
};

async function allBookings(query){let results=[];
for(let offset=0;
;
offset+=500){const page=await request('/rest/v1/bookings?select=*&order=starts_at,id'+query+'&limit=500&offset='+offset);
results.push(...page);
if(page.length<500)return results;
}}
function renderDashboard(bookings,barbers){const data=window.BarberDashboard.summarize(bookings,barbers);
$('metrics').replaceChildren();
$('ranking').replaceChildren();
$('dashboardperiod').textContent=$('filter').value?'Data: '+$('filter').value.split('-').reverse().join('/')+' · Manaus':'Todos os agendamentos · Horário de Manaus';
for(const [label,value] of [['Confirmados',data.confirmed],['Clientes com reserva',data.customers],['Valor agendado',api.money(data.value)],['Cancelados',data.cancelled]]){const card=document.createElement('div');
card.className='metric';
const title=document.createElement('span'),total=document.createElement('strong');
title.textContent=label;
total.textContent=value;
card.append(title,total);
$('metrics').append(card);
}$('leader').textContent=data.leaders.length?(data.leaders.length>1?'Empate na liderança: ':'Mais agendamentos: ')+data.leaders.map(r=>r.name).join(', ')+' · '+data.leaders[0].count+' confirmado(s)':'Ainda não há reservas confirmadas neste período.';
for(const r of data.ranking){const item=document.createElement('li');
item.className='ranking-item';
const line=document.createElement('div');
line.className='ranking-line';
const name=document.createElement('strong'),count=document.createElement('span');
name.textContent=r.name;
count.textContent=r.count+' · '+api.money(r.value);
line.append(name,count);
const track=document.createElement('div');
track.className='ranking-track';
const bar=document.createElement('div');
bar.style.width=(data.ranking[0].count?r.count/data.ranking[0].count*100:0)+'%';
track.append(bar);
item.append(line,track);
$('ranking').append(item);
}}
async function loadFinance(){const run=++financeLoading,start=$('financestart').value,end=$('financeend').value;
if(!start||!end||start>end){status('Confira as datas do relatório financeiro.');
return;
}$('financerefresh').disabled=true;
try{const [bookings,barbers,details]=await Promise.all([allBookings('&starts_at=gte.'+encodeURIComponent(start+'T00:00:00')+'&starts_at=lt.'+encodeURIComponent(end+'T23:59:59.999999')),request('/rest/v1/barbers?select=id,name&order=name'),request('/rest/v1/barber_details?select=barber_id,commission_rate')]);
const attendances=[];
for(let i=0;
i<bookings.length;
i+=80){const ids=bookings.slice(i,i+80).map(r=>r.id).join(',');
if(ids)for(let offset=0;
;
offset+=500){const page=await request('/rest/v1/attendances?select=booking_id,total,paid&booking_id=in.('+ids+')&limit=500&offset='+offset);
attendances.push(...page);
if(page.length<500)break;
}}if(run!==financeLoading||!session)return;
const rates=new Map(details.map(r=>[r.barber_id,Number(r.commission_rate)]));
financeReport=window.BarberFinance.summarize(bookings,attendances,barbers,rates);
renderFinance(start,end);
status('Relatório financeiro atualizado.');
}catch(e){status(e.message+' Execute relatorio-financeiro.sql no Supabase para ativar esta aba.');
}finally{if(run===financeLoading)$('financerefresh').disabled=false;
}}
function renderFinance(start,end){const report=financeReport;
$('financeperiod').textContent='Período: '+start.split('-').reverse().join('/')+' a '+end.split('-').reverse().join('/')+' · Atendimentos pagos · Horário de Manaus';
$('financemetrics').replaceChildren();
for(const [label,value] of [['Faturamento recebido',api.money(report.grossCents/100)],['Comissões',api.money(report.commissionCents/100)],['Líquido da barbearia',api.money(report.netCents/100)],['A receber (valor agendado)',api.money(report.pendingCents/100)]]){const card=document.createElement('div');
card.className='metric';
const text=document.createElement('span'),strong=document.createElement('strong');
text.textContent=label;
strong.textContent=value;
card.append(text,strong);
$('financemetrics').append(card);
}$('financebody').replaceChildren();
for(const r of report.rows){const tr=document.createElement('tr');
for(const value of [r.name,r.services,r.rate.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%',api.money(r.grossCents/100),api.money(r.commissionCents/100),api.money(r.netCents/100)]){const td=document.createElement('td');
td.textContent=value;
tr.append(td);
}$('financebody').append(tr);
}$('financefoot').replaceChildren();
const total=document.createElement('tr');
for(const value of ['Total',report.paidCount,'—',api.money(report.grossCents/100),api.money(report.commissionCents/100),api.money(report.netCents/100)]){const td=document.createElement('td');
td.textContent=value;
total.append(td);
}$('financefoot').append(total);
$('financedetails').replaceChildren();
for(const r of report.rows){const card=document.createElement('article');
card.className='finance-detail-card';
const title=document.createElement('h4');
title.textContent=r.name+' · comissão de '+r.rate.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';
card.append(title);
if(!r.serviceRows.length){const empty=document.createElement('p');
empty.className='help';
empty.textContent='Nenhum serviço pago neste período.';
card.append(empty);
}else{const table=document.createElement('table');
table.className='finance-service-table';
const head=document.createElement('thead');
head.innerHTML='<tr><th>Serviço prestado</th><th>Qtd.</th><th>Faturamento</th><th>Comissão</th><th>Líquido</th></tr>';
table.append(head);
const body=document.createElement('tbody');
for(const s of r.serviceRows){const tr=document.createElement('tr');
for(const value of [s.name,s.count,api.money(s.grossCents/100),api.money(s.commissionCents/100),api.money(s.netCents/100)]){const td=document.createElement('td');
td.textContent=value;
tr.append(td);
}body.append(tr);
}table.append(body);
card.append(table);
}$('financedetails').append(card);
}$('financeempty').hidden=report.paidCount>0;
}
function downloadFinance(){if(!financeReport)return status('Gere o relatório antes de baixar.');
const csv=window.BarberFinance.csv(financeReport,$('financestart').value,$('financeend').value),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
a.href=url;
a.download='relatorio-financeiro-'+$('financestart').value+'-a-'+$('financeend').value+'.csv';
document.body.append(a);
a.click();
a.remove();
URL.revokeObjectURL(url);
}
function renderBIBars(container,rows,suffix=''){container.replaceChildren();const max=rows[0]?.value||0;if(!rows.length){const empty=document.createElement('p');empty.className='bi-empty';empty.textContent='Sem dados no período selecionado.';container.append(empty);return;}for(const row of rows.slice(0,8)){const item=document.createElement('div'),head=document.createElement('div'),name=document.createElement('strong'),value=document.createElement('span'),track=document.createElement('div'),fill=document.createElement('div');head.className='bi-bar-head';track.className='bi-bar-track';fill.className='bi-bar-fill';name.textContent=row.name;value.textContent=row.value+suffix;fill.style.width=(max?row.value/max*100:0)+'%';head.append(name,value);track.append(fill);item.append(head,track);container.append(item);}}
async function loadBI(){const run=++biLoading,start=$('bistart').value,end=$('biend').value;if(!start||!end||start>end){status('Confira as datas do BI.');return;}$('birefresh').disabled=true;try{const [bookings,barbers]=await Promise.all([allBookings('&starts_at=gte.'+encodeURIComponent(start+'T00:00:00')+'&starts_at=lt.'+encodeURIComponent(end+'T23:59:59.999999')),request('/rest/v1/barbers?select=id,name&order=name')]),attendances=[];for(let i=0;i<bookings.length;i+=80){const ids=bookings.slice(i,i+80).map(r=>r.id).join(',');if(ids){const rows=await request('/rest/v1/attendances?select=booking_id,total,paid&booking_id=in.('+ids+')');attendances.push(...rows);}}if(run!==biLoading||!session)return;const data=window.BarberBI.summarize(bookings,attendances,barbers);$('biperiod').textContent='Análise de '+start.split('-').reverse().join('/')+' a '+end.split('-').reverse().join('/')+' · Horário de Manaus';$('bimetrics').replaceChildren();for(const [label,value] of [['Receita recebida',api.money(data.gross)],['Ticket médio',api.money(data.averageTicket)],['Reservas confirmadas',data.confirmed],['Taxa de cancelamento',data.cancellationRate.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%']]){const card=document.createElement('div'),text=document.createElement('span'),strong=document.createElement('strong');card.className='metric';text.textContent=label;strong.textContent=value;card.append(text,strong);$('bimetrics').append(card);}renderBIBars($('biservices'),data.services);renderBIBars($('bihours'),data.hours);$('bistaff').replaceChildren();for(const row of data.staff){const card=document.createElement('div'),name=document.createElement('strong'),count=document.createElement('span'),label=document.createElement('span'),revenue=document.createElement('b');card.className='bi-staff-item';name.textContent=row.name;count.textContent=row.count+' atendimento(s)';label.textContent='Receita recebida';revenue.textContent=api.money(row.revenue);card.append(name,count,label,revenue);$('bistaff').append(card);}$('biinsights').replaceChildren();const insights=[data.topService?'Serviço mais procurado: '+data.topService.name+' ('+data.topService.value+').':'Ainda não há serviço líder.',data.peakHour?'Maior procura por volta de '+data.peakHour.name+', com '+data.peakHour.value+' reserva(s).':'Ainda não há horário de pico.',data.staff[0]?.count?'Destaque da equipe: '+data.staff[0].name+', com '+data.staff[0].count+' atendimento(s).':'Ainda não há destaque da equipe.'];for(const insight of insights){const p=document.createElement('p');p.textContent=insight;$('biinsights').append(p);}status('BI atualizado.');}catch(e){status(e.message+' O BI usa os dados de agenda e atendimentos já cadastrados.');}finally{if(run===biLoading)$('birefresh').disabled=false;}}
async function uploadBarberPhoto(id,file){if(!file)return null;
if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Use uma foto JPG, PNG ou WebP.');
if(file.size>3145728)throw Error('A foto deve ter no máximo 3 MB.');
const extension={"image/jpeg":'jpg',"image/png":'png',"image/webp":'webp'}[file.type],path=id+'/perfil.'+extension,config=window.BARBER_CONFIG,response=await fetch(config.url+'/storage/v1/object/barber-photos/'+path,{method:'POST',headers:{apikey:config.publicKey,Authorization:'Bearer '+await authorized(),'Content-Type':file.type,'x-upsert':'true'},body:file});
if(!response.ok){let message='Não foi possível enviar a foto.';
try{const error=await response.json();
message=error.message||error.error||message;
}catch{}throw Error(message+' Execute fotos-barbeiros.sql no Supabase.');
}const url=config.url+'/storage/v1/object/public/barber-photos/'+path+'?v='+Date.now();
await api.rpc('save_barber_photo',{p_barber:id,p_url:url},await authorized());
return url;
}
function chooseBarberPhoto(id,name){const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.onchange=async()=>{const file=input.files[0];if(!file)return;status('Enviando foto de '+name+'…');try{await uploadBarberPhoto(id,file);await Promise.all([catalog(),load()]);status('Foto de '+name+' salva. Ela já pode aparecer para os clientes.');}catch(e){status(e.message);}};input.click();}
async function catalog(){
for(const table of ['services','barbers']){const values=await request('/rest/v1/'+table+'?select=*&order=name');
setBookingOptions(table,values);
let detailsError=false;

if(table==='barbers'){try{const rows=await request('/rest/v1/barber_details?select=barber_id,cpf,phone,commission_rate');
privateDetails=new Map(rows.map(r=>[r.barber_id,r]));
}catch{privateDetails.clear();
detailsError=true;
status('Execute dashboard-chefe.sql e relatorio-financeiro.sql no Supabase para ativar todos os dados dos barbeiros.');
}}
$(table).replaceChildren();
for(const r of values){const li=document.createElement('li');
const info=document.createElement('div'),text=document.createElement('span');
text.textContent=r.name+(table==='services'?' · '+api.money(r.price)+' · '+r.duration+' min':'')+(r.active?'':' (inativo)');
info.append(text);

const actions=document.createElement('div');
actions.className='catalog-actions';
if(table==='services'){const edit=document.createElement('button');edit.type='button';edit.textContent='Editar serviço / foto';edit.onclick=()=>{ $('serviceid').value=r.id;$('servicename').value=r.name;$('price').value=r.price;$('duration').value=r.duration;$('servicedescription').value=r.description||'';$('servicephoto').value='';$('removeservicephoto').checked=false;$('servicepreview').hidden=!r.photo_url;$('servicepreview').src=r.photo_url||'';$('saveservice').textContent='Salvar serviço';$('resetservice').hidden=false;$('serviceform').scrollIntoView({behavior:'smooth',block:'center'});};actions.append(edit);}

if(table==='barbers'){const detail=privateDetails.get(r.id)||{};
if(r.photo_url){const photo=document.createElement('img');photo.className='barber-list-photo';photo.src=r.photo_url;photo.alt='Foto de '+r.name;photo.onerror=()=>photo.remove();info.prepend(photo);}
const phone=document.createElement('small');
phone.className='contact-detail';
phone.textContent='Celular: '+(detail.phone||'Não informado');
info.append(phone);
const commission=document.createElement('small');
commission.className='contact-detail';
commission.textContent='Comissão: '+Number(detail.commission_rate??40).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';
info.append(commission);
const cpf=document.createElement('small');
cpf.className='contact-detail';
cpf.textContent='CPF: '+(detail.cpf?'***.***.***-'+detail.cpf.slice(-2):'Não informado');
info.append(cpf);
if(detail.cpf){const reveal=document.createElement('button');
reveal.type='button';
reveal.textContent='Mostrar CPF';
let shown=false;
reveal.onclick=()=>{shown=!shown;
cpf.textContent='CPF: '+(shown?detail.cpf:'***.***.***-'+detail.cpf.slice(-2));
reveal.textContent=shown?'Ocultar CPF':'Mostrar CPF';
};
actions.append(reveal);
}const edit=document.createElement('button');
edit.type='button';
edit.textContent='Editar dados';
edit.disabled=detailsError;
edit.onclick=()=>{$('barberid').value=r.id;
$('barbername').value=r.name;
$('barbercpf').value=detail.cpf||'';
$('barberphone').value=detail.phone||'';
$('barbercommission').value=detail.commission_rate??40;
$('savebarber').textContent='Salvar alterações';
$('resetbarber').hidden=false;
$('barberform').scrollIntoView({behavior:'smooth',block:'center'});
$('barbername').focus();
};
actions.append(edit);
const photoButton=document.createElement('button');
photoButton.type='button';
photoButton.textContent=r.photo_url?'Trocar foto':'Adicionar foto';
photoButton.onclick=()=>chooseBarberPhoto(r.id,r.name);
actions.append(photoButton);
}
const toggle=document.createElement('button');
toggle.textContent=r.active?'Desativar':'Ativar';
toggle.onclick=async()=>{toggle.disabled=true;
try{await request('/rest/v1/'+table+'?id=eq.'+r.id,{method:'PATCH',body:{active:!r.active}});
await catalog();
await load();
status('Cadastro atualizado. Reservas existentes foram preservadas.')}catch(e){status(e.message);
toggle.disabled=false}};
actions.append(toggle);
li.append(info,actions);
$(table).append(li);
}}
}
$('loginform').onsubmit=async e=>{e.preventDefault();
const button=$('loginform').querySelector('button');
button.disabled=true;
status('Entrando…');
try{session=await window.StaffAuth.login($('email').value.trim(),$('password').value);
$('password').value='';
$('panel').hidden=false;
$('login').hidden=true;
status('Acesso autorizado.');
await Promise.all([load(),catalog(),loadFinance()]);
}catch(e){leave();
status(e.message)}finally{button.disabled=false}};

$('logout').onclick=async()=>{const logout=window.StaffAuth.logout();
leave();
await logout;
status('Você saiu do painel.');
};

$('refresh').onclick=load;
$('filter').onchange=load;
$('all').onclick=()=>{$('filter').value=api.day();
load()};

const today=api.day(),monthStart=today.slice(0,8)+'01';
$('filter').value=today;
$('financestart').value=monthStart;
$('financeend').value=today;
$('financerefresh').onclick=loadFinance;
$('financecsv').onclick=downloadFinance;
$('financeprint').onclick=()=>window.print();
$('bistart').value=monthStart;
$('biend').value=today;
$('birefresh').onclick=loadBI;
window.addEventListener('stafftabchange',e=>{if(e.detail.name==='financeiro'&&session&&!financeReport)loadFinance();if(e.detail.name==='bi'&&session)loadBI();
});

$('serviceform').onsubmit=async e=>{e.preventDefault();
const name=$('servicename').value.trim();
if(!name)return status('Informe o nome do serviço.');
const button=e.target.querySelector('button');
button.disabled=true;
try{const id=$('serviceid').value,body={name,price:Number($('price').value),duration:Number($('duration').value)};
const description=$('servicedescription').value.trim();
if(description||id)body.description=description;
if($('removeservicephoto').checked)body.photo_url=null;
if($('servicephoto').files[0])body.photo_url=await window.ServiceCards.photo($('servicephoto').files[0]);
await request('/rest/v1/services'+(id?'?id=eq.'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',body});
$('serviceid').value='';$('servicepreview').hidden=true;$('saveservice').textContent='Cadastrar serviço';$('resetservice').hidden=true;
e.target.reset();
await catalog();
status('Serviço salvo.')}catch(ex){status(ex.message+(/photo_url|description|schema cache/.test(ex.message)?' Execute servicos-visuais.sql no Supabase para ativar fotos e descrições.':''))}finally{button.disabled=false}};

$('resetbarber').onclick=()=>{$('barberform').reset();
$('barberid').value='';
$('barbercommission').value='40';
$('savebarber').textContent='Cadastrar barbeiro';
$('resetbarber').hidden=true;
};
$('newbarberbutton').onclick=()=>{$('resetbarber').onclick();$('barberform').scrollIntoView({behavior:'smooth',block:'center'});$('barbername').focus();status('Preencha os dados para criar um novo barbeiro. CPF e celular são opcionais.');};

$('barberform').onsubmit=async e=>{e.preventDefault();
const name=$('barbername').value.trim(),cpf=$('barbercpf').value.replace(/\D/g,''),phone=$('barberphone').value.replace(/\D/g,''),commission=Number($('barbercommission').value),photo=$('barberphoto').files[0];
if(!name)return status('Informe o nome do barbeiro.');
if(!window.BarberDashboard.validCPF(cpf))return status('CPF inválido. Confira os dígitos ou deixe em branco.');
if(phone&&(phone.length<10||phone.length>15))return status('Informe celular com DDD.');
if(!Number.isFinite(commission)||commission<0||commission>100)return status('A comissão deve ficar entre 0 e 100%.');
const button=$('savebarber');
button.disabled=true;
try{const id=await api.rpc('save_barber',{p_id:$('barberid').value||null,p_name:name,p_cpf:cpf||null,p_phone:phone||null},await authorized());
await api.rpc('save_barber_commission',{p_barber:id,p_rate:commission},await authorized());
if(photo){status('Enviando foto do barbeiro…');await uploadBarberPhoto(id,photo);}
$('resetbarber').onclick();
await catalog();
await Promise.all([load(),loadFinance()]);
status(photo?'Dados, comissão e foto do barbeiro salvos.':'Dados e comissão do barbeiro salvos.')}catch(ex){status(ex.message)}finally{button.disabled=false}};

function setBookingOptions(table,values){const id=table==='services'?'newservice':'newbarber',select=$(id),previous=select.value;
select.replaceChildren();
select.add(new Option(table==='services'?'Escolha um serviço':'Sem preferência',''));
for(const r of values.filter(r=>r.active))select.add(new Option(r.name+(table==='services'?' · '+api.money(r.price):''),r.id));
select.value=previous;
if(!select.value)select.value='';
}
async function newSlots(){const version=++newBookingVersion;
$('newconfirm').disabled=true;
const old=$('newtime').value;
$('newtime').replaceChildren();
$('newtime').add(new Option('Escolha um horário',''));
if(!$('newservice').value||!$('newdate').value)return;
try{const rows=await api.rpc('admin_slots',{p_date:$('newdate').value,p_service:$('newservice').value,p_barber:$('newbarber').value||null},await authorized());
if(version!==newBookingVersion||!session)return;
for(const r of rows)$('newtime').add(new Option(r.slot,r.slot));
if(rows.some(r=>r.slot===old))$('newtime').value=old;
$('newbookingstatus').textContent=rows.length?'Horários disponíveis de Manaus.':'Sem horários para essa escolha.';
$('newconfirm').disabled=creatingBooking||!$('newtime').value;
}catch(e){$('newbookingstatus').textContent=e.message+' Se a função não existir, aplique a atualização do banco.';
}}
$('newservice').onchange=newSlots;
$('newbarber').onchange=newSlots;
$('newdate').onchange=newSlots;
$('newtime').onchange=()=>{$('newconfirm').disabled=creatingBooking||!$('newtime').value;
};

$('newdate').min=api.day();
$('newdate').value=api.day();
const maxNew=new Date(api.day()+'T12:00:00Z');
maxNew.setUTCDate(maxNew.getUTCDate()+60);
$('newdate').max=maxNew.toISOString().slice(0,10);

$('adminbooking').onsubmit=async e=>{e.preventDefault();
if(creatingBooking)return;
const name=$('newcustomer').value.trim(),phone=$('newphone').value.trim();
if(!name||phone.replace(/\D/g,'').length<10||phone.replace(/\D/g,'').length>15){$('newbookingstatus').textContent='Informe nome e celular com DDD.';
return;
}creatingBooking=true;
$('newconfirm').disabled=true;
try{const id=await api.rpc('admin_book',{p_date:$('newdate').value,p_time:$('newtime').value,p_service:$('newservice').value,p_barber:$('newbarber').value||null,p_customer:name,p_phone:phone},await authorized());
const result=await request('/rest/v1/bookings?id=eq.'+id+'&select=barber_name,starts_at');
const booking=result[0];
const message='Agendamento confirmado'+(booking?' com '+booking.barber_name+' às '+booking.starts_at.slice(11,16):'')+'.';
$('newbookingstatus').textContent=message;
status(message);
$('newtime').value='';
await load();
}catch(ex){$('newbookingstatus').textContent=ex.message;
status(ex.message);
}finally{creatingBooking=false;
await newSlots();
}};

if(!api.ready()){$('loginform').querySelector('button').disabled=true;
status('O banco online ainda não foi conectado.');
}
if(api.ready()&&session)(async()=>{try{await window.StaffAuth.check();
$('panel').hidden=false;
$('login').hidden=true;
await Promise.all([load(),catalog(),loadFinance()]);
}catch(e){leave();
status(e.message);
}})();

window.addEventListener('focus',()=>{if(session&&!$('panel').hidden)load()});

$('resetservice').onclick=()=>{$('serviceform').reset();$('serviceid').value='';$('servicepreview').hidden=true;$('saveservice').textContent='Cadastrar serviço';$('resetservice').hidden=true;};

})();


