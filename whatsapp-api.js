/* Painel do chefe (aba Campanhas): configuração do WhatsApp oficial — lembrete automático na véspera e
   robô de agendamento. Fica desligado até a Meta liberar o número. Banco: database/whatsapp-oficial.sql.
   O token da Meta nunca passa pelo painel: é um segredo da Edge Function (database/WHATSAPP-OFICIAL.md). */
(()=>{
const tab=document.getElementById('tab-campanhas'),api=window.BarberAPI,auth=window.StaffAuth;if(!tab||!api||!auth)return;
const GUIDE='https://github.com/guisenaa9-ai/Agendamento-Barbearia/blob/main/database/WHATSAPP-OFICIAL.md';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const field=(label,input)=>{const l=el('label',null,label);l.append(input);return l;};
const req=async(path,opt={})=>api.request(path,{...opt,token:await auth.token()});
const template=()=>'Olá, {{1}}! Lembrete da Barbearia '+(api.shop||'Daniel Silva')+': seu horário é {{2}} às {{3}} (horário de Manaus), com {{4}}, para {{5}}. Se precisar alterar ou cancelar, responda esta mensagem.';
async function render(){
 let box=document.getElementById('waofficial');
 if(!box){box=el('details','new-booking growth-box wa-official');box.id='waofficial';tab.append(box);}
 let cfg,missing=false;
 try{[cfg]=await req('/rest/v1/whatsapp_settings?select=*&id=eq.1');}catch{missing=true;}
 if(!cfg){missing=true;cfg={enabled:false,reminders_enabled:true,bot_enabled:true,phone_number_id:'',template_name:'lembrete_horario',template_lang:'pt_BR',graph_version:'v26.0',reminder_hour:18};}
 const ready=!!cfg.phone_number_id,state=cfg.enabled&&ready?['on','Ligado']:ready?['wait','Pronto, desligado']:['off','Aguardando a Meta'];
 const summary=el('summary');summary.append('WhatsApp oficial (automático) ',el('span','wa-pill wa-'+state[0],state[1]));
 const help=el('p','help','Lembrete na véspera e robô de agendamento pelo número oficial da barbearia, sem risco de bloqueio. Enquanto estiver desligado, use os lembretes de 1 toque na Agenda.');
 const id=el('input');id.inputMode='numeric';id.value=cfg.phone_number_id||'';id.placeholder='Ex.: 123456789012345';
 const name=el('input');name.value=cfg.template_name;const lang=el('input');lang.value=cfg.template_lang;const ver=el('input');ver.value=cfg.graph_version;
 const hour=el('select');for(let h=6;h<=22;h++){const o=el('option',null,String(h).padStart(2,'0')+':00');o.value=String(h);hour.append(o);}hour.value=String(cfg.reminder_hour);
 const check=(label,value)=>{const l=el('label','payment-check'),c=el('input');c.type='checkbox';c.checked=value;l.append(c,' '+label);return [l,c];};
 const [remL,rem]=check('Lembrete automático na véspera',cfg.reminders_enabled),[botL,bot]=check('Robô de agendamento (cliente marca pelo WhatsApp)',cfg.bot_enabled),[onL,on]=check('Ligar o WhatsApp oficial',cfg.enabled);
 const status=el('p','growth-count');status.setAttribute('role','status');
 const save=el('button',null,'Salvar configuração');save.type='button';
 save.onclick=async()=>{const phone=id.value.trim();if(phone&&!/^[0-9]{5,30}$/.test(phone))return status.textContent='O Phone Number ID tem só números (veja no painel da Meta).';
  if(on.checked&&!phone)return status.textContent='Preencha o Phone Number ID antes de ligar.';
  if(!/^[a-z0-9_]{1,512}$/.test(name.value.trim()))return status.textContent='O nome do modelo usa só letras minúsculas, números e _.';
  if(!/^v[0-9]{2}\.0$/.test(ver.value.trim()))return status.textContent='Versão da API no formato v26.0.';
  save.disabled=true;try{await req('/rest/v1/whatsapp_settings?id=eq.1',{method:'PATCH',body:{phone_number_id:phone||null,template_name:name.value.trim(),template_lang:lang.value.trim(),graph_version:ver.value.trim(),reminder_hour:Number(hour.value),reminders_enabled:rem.checked,bot_enabled:bot.checked,enabled:on.checked}});
   status.textContent=on.checked?'Salvo. O WhatsApp oficial está ligado.':'Salvo. Continua desligado.';await render();document.getElementById('waofficial').open=true;}catch(e){status.textContent=e.message+' Execute whatsapp-oficial.sql no Supabase.';}finally{save.disabled=false;}};
 const grid=el('div','growth-form');grid.append(field('Phone Number ID (Meta)',id),field('Nome do modelo de lembrete',name),field('Idioma do modelo',lang),field('Versão da API',ver),field('Enviar a partir de (Manaus)',hour));
 const last=el('p','help',cfg.last_run_at?'Última execução: '+new Date(cfg.last_run_at).toLocaleString('pt-BR',{timeZone:'America/Manaus',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' · '+(cfg.last_result||''):'Ainda não rodou.');
 const tpl=el('textarea','wa-template');tpl.readOnly=true;tpl.rows=4;tpl.value=template();
 const copy=el('button','growth-stop','Copiar texto do modelo');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(tpl.value);copy.textContent='Copiado ✓';}catch{tpl.select();}};
 const guide=el('a','manual-app-link','Passo a passo para ligar (Meta + Supabase) ↗');guide.href=GUIDE;guide.target='_blank';guide.rel='noopener';const actions=el('div','wa-actions');actions.append(copy,guide);
 box.replaceChildren(...[summary,help,missing&&el('p','wa-note',sessionStorage.getItem('demo-mode')==='1'?'Na demonstração esta configuração aparece só para conhecer; ela é salva no sistema real.':'Execute database/whatsapp-oficial.sql no Supabase para salvar esta configuração.'),grid,remL,botL,onL,save,status,last,
  el('h4',null,'Modelo para cadastrar na Meta (categoria Utilidade, nome lembrete_horario, idioma pt_BR)'),tpl,actions].filter(Boolean));
 for(const c of box.querySelectorAll('input,select,button:not(.growth-stop)'))if(missing)c.disabled=true;
}
const check=()=>{if(!tab.hidden&&auth.session()&&auth.role()==='admin')render();};
new MutationObserver(check).observe(tab,{attributes:true,attributeFilter:['hidden']});check();
})();
