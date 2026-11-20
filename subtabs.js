/* Sub-abas do painel (barra no topo de cada aba). Cada sub-aba diz quais blocos mostra; o resto da aba fica sempre visível.
   Blocos criados depois por outros scripts (growth.js, whatsapp-api.js, baixas.js) são reaplicados por um MutationObserver. */
(()=>{
const $=id=>document.getElementById(id),q=(root,sel)=>root?[...root.querySelectorAll(sel)]:[];
const kids=t=>[...t.children].filter(e=>!e.classList.contains('staff-subtabs'));
// Irmãos a partir de um elemento (inclusive), dentro do mesmo pai.
const from=el=>{const out=[];for(let e=el;e;e=e.nextElementSibling)out.push(e);return out;};
const card=title=>q($('tab-caixa'),'.cash-card').find(c=>c.querySelector('h4')?.textContent.trim()===title);
const queueHead=()=>q($('campaigns-app'),'.growth-panel>h4').find(h=>h.textContent==='Fila de envio');
const TABS={
 dashboard:[['Visão geral',t=>kids(t).filter(e=>!e.matches('.bi-section'))],['Análise do período',t=>q(t,':scope>.bi-section')]],
 agenda:[
  ['Agenda',t=>kids(t).filter(e=>!e.matches('.section-intro,.availability-desk,.chefe-only')&&e!==$('adminbooking')?.closest('details'))],
  ['Nova reserva',t=>[t.querySelector('.availability-desk'),$('adminbooking')?.closest('details')],{open:true}],
  ['Bloqueios e horários',t=>q(t,':scope>details.chefe-only'),{open:true,chefe:true}]],
 financeiro:[['Visão geral',()=>[$('fin-geral')]],['Comissões',()=>[$('fin-comissoes')]],['Despesas do barbeiro',()=>[$('fin-despesas')]],['Detalhamento',()=>[$('fin-detalhe')]]],
 caixa:[['Hoje',t=>[$('cashmetrics'),card('Abertura e fechamento'),t.querySelector('.cash-grid')]],['Novo lançamento',t=>[card('Novo lançamento'),t.querySelector('.cash-grid')]],['Movimentações',()=>[card('Movimentações do dia')]]],
 servicos:[['Serviços',t=>[t.querySelector('.catalog-screen')]],['Produtos',()=>[$('productsbox')],{open:true}],['Clube de assinatura',()=>[$('clubbox')],{open:true}],['Fidelidade',t=>[t.querySelector('.loyalty-settings')],{open:true}]],
 barbeiros:[['Equipe',t=>[t.querySelector('.catalog-screen')]],['Metas e Pix',()=>[$('goalsbox')],{open:true}],['Atendentes',t=>[t.querySelector('.attendants-admin')]]],
 campanhas:[
  ['Públicos',()=>{const app=$('campaigns-app'),h=queueHead();return [...q(app,':scope>.growth-cards,.growth-panel'),...q(app,'.growth-panel>*').filter(e=>!h||!from(h).includes(e))];}],
  ['Fila de envio',()=>{const h=queueHead();return [...q($('campaigns-app'),'.growth-panel'),...(h?from(h):[])];}],
  ['WhatsApp oficial',()=>[$('waofficial')],{open:true}],
  ['Aviso no site',()=>[$('sitebanneradmin')]]]
};
const current={},bars={};
// A barra fica logo abaixo do título da aba (em Campanhas, o título é criado pelo growth.js).
function place(tab,t){const bar=bars[tab],intro=q(t,':scope>.section-intro')[0]||(tab==='campanhas'&&q(t,'#campaigns-app>.section-intro')[0]);
 if(intro){if(intro.nextElementSibling!==bar)intro.after(bar);}else if(t.firstElementChild!==bar)t.prepend(bar);}
function apply(tab,opening){
 const t=$('tab-'+tab);if(!t)return;const list=TABS[tab],name=current[tab];place(tab,t);
 // Um bloco pode estar em mais de uma sub-aba (ex.: o painel da campanha): aparece se estiver na escolhida.
 const shown=new Set(),all=new Set();
 for(const [label,get,opt={}] of list)for(const e of get(t).filter(Boolean)){all.add(e);if(label===name){shown.add(e);if(opening&&opt.open&&e.tagName==='DETAILS')e.open=true;}}
 for(const e of all)e.classList.toggle('sub-off',!shown.has(e));
 for(const b of q(t,'.staff-subtabs [role=tab]')){const on=b.dataset.sub===name;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}
}
function show(tab,name){
 if(!TABS[tab]?.some(([l])=>l===name))return;current[tab]=name;apply(tab,true);
 window.dispatchEvent(new CustomEvent('staffsubtab',{detail:{tab,name}}));
}
for(const [tab,list] of Object.entries(TABS)){
 const t=$('tab-'+tab);if(!t)continue;current[tab]=list[0][0];
 const bar=document.createElement('div');bar.className='staff-subtabs';bar.setAttribute('role','tablist');bar.setAttribute('aria-label','Partes de '+($('nav-'+tab)?.textContent.trim()||tab));
 list.forEach(([label,,opt={}],i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','tab');b.dataset.sub=label;b.textContent=label;if(opt.chefe)b.classList.add('chefe-only');
  b.onclick=()=>show(tab,label);
  b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
   const vis=q(bar,'[role=tab]').filter(x=>x.offsetParent),k=vis.indexOf(b),n=e.key==='Home'?0:e.key==='End'?vis.length-1:(k+(e.key==='ArrowLeft'?-1:1)+vis.length)%vis.length;vis[n].click();vis[n].focus();};
  bar.append(b);});
 bars[tab]=bar;
 apply(tab);
 // Reaplica quando outro script recria blocos desta aba (sem reabrir nada).
 let pending=false;new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;apply(tab);});}).observe(t,{childList:true,subtree:true});
}
// Atendente: a sub-aba só do chefe não aparece; se estava nela, volta para a primeira.
new MutationObserver(()=>{if(document.body.classList.contains('role-attendant')&&current.agenda==='Bloqueios e horários')show('agenda','Agenda');}).observe(document.body,{attributes:true,attributeFilter:['class']});
// Botão "Nova reserva" do balcão leva à sub-aba certa antes de rolar até o formulário.
document.addEventListener('click',e=>{if(e.target.closest?.('#desknewbooking'))show('agenda','Nova reserva');},true);
window.StaffSubtabs={show,current:tab=>current[tab]};
})();
