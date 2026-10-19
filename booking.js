(async function(){
if(window.CustomerEntry&&!(await window.CustomerEntry))return;

const $=id=>document.getElementById(id),api=window.BarberAPI;
let services=[],barbers=[],generation=0,busy=false,canBook=false,availableRows=[];

const message=text=>$('runtime').textContent=text;

function options(id,items,label){const select=$(id);
select.replaceChildren();
select.add(new Option(label,''));
for(const item of items)select.add(new Option(item.label,item.id));
}
function summary(){const s=services.find(s=>s.id===$('servicechoice').value),b=barbers.find(b=>b.id===$('barberchoice').value);
$('sumservice').textContent=s?.name||'Selecione um serviço';
$('sumduration').textContent=s?s.duration+' minutos':'';
$('total').textContent=s?api.money(s.price):'—';
$('sumbarber').textContent=$('barberchoice').value==='any'?'Sem preferência':b?.name||'Selecione um barbeiro';
showAvailableBarbers();
$('sumdate').textContent=$('date').value?new Date($('date').value+'T12:00:00').toLocaleDateString('pt-BR'):'Selecione uma data';
$('sumtime').textContent=$('timechoice').value||'Selecione um horário';
}
function showAvailableBarbers(){const row=availableRows.find(r=>r.slot===$('timechoice').value);
$('availablebarbers').textContent=$('barberchoice').value==='any'?(row?.barbers.length?'Disponíveis neste horário: '+row.barbers.join(', ')+'. A atribuição é feita ao confirmar.':'Todos os barbeiros ativos serão consultados. Escolha um horário para ver os disponíveis.'):'';
}
async function slots(){const current=++generation;
availableRows=[];
$('confirm').disabled=true;
const previous=$('timechoice').value;
options('timechoice',[],'Selecione serviço, barbeiro e data');
summary();
if(!canBook){$('datehint').textContent='Entre ou crie sua conta para escolher serviço, barbeiro e horário.';
return;
}if(!$('date').value||!$('servicechoice').value||!$('barberchoice').value)return;
$('datehint').textContent='Consultando horários…';
try{const any=$('barberchoice').value==='any';
let response;
if(any){try{response=await api.rpc('available_options',{p_date:$('date').value,p_service:$('servicechoice').value});}catch(ex){if(!/available_options|schema cache|could not find the function/i.test(String(ex.message)))throw ex;const byBarber=await Promise.all(barbers.map(async b=>({barber:b,slots:await api.rpc('available_slots',{p_date:$('date').value,p_barber:b.id,p_service:$('servicechoice').value})})));response=byBarber.flatMap(row=>row.slots.map(item=>({slot:typeof item==='string'?item:item.slot,barbers:[row.barber.name]})));}}
else response=await api.rpc('available_slots',{p_date:$('date').value,p_barber:$('barberchoice').value,p_service:$('servicechoice').value});
const result=window.BarberAvailability.rows(response);
if(current!==generation)return;
availableRows=result;
options('timechoice',result.map(r=>({id:r.slot,label:r.slot+(any?' · '+r.barbers.length+' disponível(is)':'')})),'Selecione um horário');
if(result.some(r=>r.slot===previous))$('timechoice').value=previous;
$('datehint').textContent=result.length?'Horários de Manaus · Das 9h às 19h':'Sem horários. Escolha outra data ou barbeiro.';
summary();
$('confirm').disabled=!canBook||busy||!$('timechoice').value;
}catch(e){if(current===generation)$('datehint').textContent=e.message;
}}
$('servicechoice').onchange=slots;
$('barberchoice').onchange=slots;
$('date').onchange=slots;
$('timechoice').onchange=()=>{summary();
$('confirm').disabled=!canBook||busy||!$('timechoice').value;
};

function renderTeam(team){$('teamcards').replaceChildren();
for(const b of team){const p=window.BarberTeam.profile(b.name),card=document.createElement('article');
card.className='team-card';
card.append(window.BarberTeam.portrait(b.name,b.photo_url));
const copy=document.createElement('div');
copy.className='team-copy';
const name=document.createElement('h3');
name.textContent=b.name;
const specialty=document.createElement('small');
specialty.textContent=p.specialty;
const bio=document.createElement('p');
bio.textContent=p.bio;
const book=document.createElement('a');
book.href=canBook?'#booking':'/#cadastro';
book.textContent='Agendar com '+b.name.split(' ')[0]+' ↗';
book.onclick=()=>{if(!canBook){book.href='/#cadastro';
return;
}book.href='#booking';
$('barberchoice').value=b.id;
$('timechoice').value='';
slots();
};
copy.append(name,specialty,bio,book);
card.append(copy);
$('teamcards').append(card);
}}
$('form').onsubmit=async e=>{e.preventDefault();
if(busy)return;
$('error').textContent='';
if(!canBook||!window.CustomerAuth.isSignedIn()){location.href=(api.base?api.base():location.origin)+'/#entrar';
return;
}if(!$('timechoice').value){$('error').textContent='Selecione um horário.';
return;
}const selection={p_date:$('date').value,p_time:$('timechoice').value,p_service:$('servicechoice').value,p_barber:window.BarberAvailability.barberId($('barberchoice').value)};
const s=services.find(s=>s.id===selection.p_service),b=barbers.find(b=>b.id===selection.p_barber);
busy=true;
$('confirm').disabled=true;
try{let id,assigned=b?.name||'';
if(selection.p_barber===null){try{const result=await window.CustomerAuth.rpc('customer_book_with_assignment',{p_date:selection.p_date,p_time:selection.p_time,p_service:selection.p_service});const row=Array.isArray(result)?result[0]:result;if(!row?.booking_id)throw Error('A confirmação não retornou a reserva.');id=row.booking_id;assigned=row.barber_name||'';}catch(ex){if(!/customer_book_with_assignment|schema cache|could not find the function/i.test(String(ex.message)))throw ex;id=await window.CustomerAuth.rpc('customer_book',selection);}}
else id=await window.CustomerAuth.rpc('customer_book',selection);
if(!b){try{const records=await window.CustomerAuth.request('/rest/v1/bookings?id=eq.'+encodeURIComponent(id)+'&select=barber_name');
if(records[0]?.barber_name)assigned=records[0].barber_name;
}catch{}}const bookingDate=new Date(selection.p_date+'T12:00:00').toLocaleDateString('pt-BR');
$('successdetail').textContent=assigned?`${s.name} com ${assigned}, ${bookingDate} às ${selection.p_time}.`:`${s.name}, sem preferência de barbeiro, ${bookingDate} às ${selection.p_time}. A equipe já recebeu sua reserva.`;
$('reservationcode').value=id;
$('copyfeedback').textContent='';
$('canceldeadline').textContent='Consulte sua conta para cancelar ou alterar até uma hora antes do atendimento (Manaus).';
$('confirmation').hidden=false;
$('confirmation').scrollIntoView({behavior:'smooth',block:'center'});
$('timechoice').value='';
}catch(ex){$('error').textContent=$('barberchoice').value==='any'&&/barbeiro|customer_book|schema cache|function/i.test(String(ex.message))?'A reserva sem preferência ainda precisa ser ativada no sistema da barbearia. Tente novamente após a atualização ou escolha um barbeiro específico.':ex.message;
}finally{busy=false;
await slots();
}};

function gate(allowed){canBook=allowed;
for(const id of ['servicechoice','barberchoice','timechoice','date'])$(id).disabled=!allowed;
$('accountgate').hidden=allowed;
$('signupnav').hidden=allowed;
$('accountnav').textContent=allowed?'Meus agendamentos':'Entrar';
if(!allowed){$('confirm').disabled=true;
$('name').value='';
$('phone').value='';
}}
async function account(){gate(false);
if(!window.CustomerAuth.isSignedIn()){$('bookingaccount').textContent='Crie sua conta ou entre para confirmar uma reserva.';
return;
}try{const profiles=await window.CustomerAuth.request('/rest/v1/customer_profiles?select=name,phone');
const p=profiles[0];
const complete=!!(p?.name&&p?.phone);
gate(complete);
$('name').value=p?.name||'';
$('phone').value=p?.phone||'';
$('bookingaccount').textContent=complete?'Agendando para '+p.name+'. Sua reserva ficará na sua conta.':'Complete nome e celular em Minha conta para agendar.';
if(!complete){location.replace('conta.html?completar=1');
$('gateheading').textContent='Complete seu cadastro';
$('gatetext').textContent='Abra Minha conta e preencha nome e celular em “Meus dados” para liberar o agendamento.';
}await slots();
}catch(ex){gate(false);
$('bookingaccount').textContent=ex.message;
}}
if(!api.ready()){message('Agenda ainda não ativada. A barbearia precisa conectar o banco online antes de receber reservas.');
options('servicechoice',[],'Agenda não ativada');
options('barberchoice',[],'Agenda não ativada');
options('timechoice',[],'Agenda não ativada');
return}
await account();

try{[services,barbers]=await Promise.all([api.request('/rest/v1/services?active=eq.true&select=*&order=name'),api.request('/rest/v1/barbers?active=eq.true&select=id,name,photo_url&order=name')]);
renderTeam(barbers);
window.ServiceCards?.render(services);
options('servicechoice',services.map(s=>({id:s.id,label:`${s.name} — ${api.money(s.price)} — ${s.duration} min`})),'Selecione um corte');
options('barberchoice',[{id:'any',label:'Sem preferência'},...barbers.map(b=>({id:b.id,label:b.name}))],'Selecione um barbeiro');
$('date').min=api.day();
const max=new Date($('date').min+'T12:00:00');
max.setDate(max.getDate()+60);
$('date').max=max.toISOString().slice(0,10);
$('date').value=$('date').min;
message(canBook?'Escolha serviço, barbeiro, data e horário. Horário de Manaus.':'Para agendar, crie sua conta ou entre pelos botões acima.');
await slots();
}catch(e){message(e.message);
}
window.addEventListener('customer-session',()=>{if(!window.CustomerAuth.isSignedIn())gate(false);
});

window.addEventListener('booking-cancelled',()=>{if(!busy&&api.ready())slots();
});

window.addEventListener('focus',()=>{if(!busy&&api.ready())slots();
});

})();

