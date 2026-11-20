/* Faixa de aviso no topo do site do cliente (texto escrito pelo chefe em Campanhas → Aviso no site).
   Banco: database/aviso-site.sql (shop_settings.announcement + função pública site_announcement). */
(()=>{
const api=window.BarberAPI;if(!api)return;
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const KEY='aviso-fechado';
const closed=()=>{try{return localStorage.getItem(KEY);}catch{return null;}};

// Painel do chefe: editor na aba Campanhas.
const tab=document.getElementById('tab-campanhas');
if(tab){const auth=window.StaffAuth;if(!auth)return;
 const box=el('article','catalog-form site-banner-admin');box.id='sitebanneradmin';
 const text=el('textarea');text.maxLength=140;text.rows=2;text.placeholder='Ex.: Novembro: corte + barba com 10% de desconto';
 const count=el('span','growth-muted'),status=el('p','growth-count');status.setAttribute('role','status');
 const preview=el('div','site-banner site-banner-preview');
 const show=()=>{count.textContent=text.value.length+'/140';preview.replaceChildren(...(text.value.trim()?[el('span','site-banner-glow')]:[]),el('span','site-banner-text',text.value.trim()||'Sem aviso: a faixa não aparece no site.'));preview.classList.toggle('is-empty',!text.value.trim());};
 text.oninput=show;
 const save=el('button',null,'Salvar aviso');save.type='button';const clear=el('button','growth-stop','Tirar aviso');clear.type='button';
 const put=async v=>{save.disabled=clear.disabled=true;try{await api.request('/rest/v1/shop_settings?id=eq.1',{method:'PATCH',body:{announcement:v||null},token:await auth.token()});text.value=v;show();status.textContent=v?'Aviso publicado no site.':'Aviso retirado do site.';}
  catch(e){status.textContent=e.message+' Execute aviso-site.sql no Supabase para ativar.';}finally{save.disabled=clear.disabled=false;}};
 save.onclick=()=>put(text.value.trim());clear.onclick=()=>put('');
 const label=el('label',null,'Texto do aviso (até 140 caracteres)');label.append(text);
 const actions=el('div','extra-shortcuts');actions.append(save,clear,count);
 box.append(el('h3',null,'Aviso no site'),el('p','help','Aparece numa faixa no topo da página inicial e do agendamento. O cliente pode fechar no X; se você mudar o texto, a faixa volta a aparecer.'),label,actions,el('p','site-banner-label','Prévia'),preview,status);
 tab.append(box);show();
 window.addEventListener('stafftabchange',async e=>{if(e.detail.name!=='campanhas'||auth.role()!=='admin')return;
  try{const [row]=await api.request('/rest/v1/shop_settings?select=announcement&id=eq.1',{token:await auth.token()});if(document.activeElement!==text){text.value=row?.announcement||'';show();}}catch{}});
 return;}

// Site do cliente: mostra a faixa se houver aviso e o cliente não fechou este mesmo texto.
(async()=>{
 let msg;try{msg=await api.rpc('site_announcement',{});}catch{return;}
 msg=typeof msg==='string'?msg.trim():'';if(!msg||closed()===msg)return;
 const bar=el('div','site-banner');bar.setAttribute('role','region');bar.setAttribute('aria-label','Aviso da barbearia');
 const x=el('button','site-banner-close','×');x.type='button';x.setAttribute('aria-label','Fechar aviso');
 x.onclick=()=>{bar.remove();try{localStorage.setItem(KEY,msg);}catch{}};
 bar.append(el('span','site-banner-glow'),el('span','site-banner-text',msg),x);document.body.prepend(bar);
})();
})();
