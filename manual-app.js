/* Aba Manual do painel: um cartão por tópico; ao abrir, mostra o fluxo de etapas e o passo a passo.
   O texto vem de manual.html, então página e aba nunca ficam diferentes. A atendente não vê os tópicos "Só chefe". */
(()=>{
 const view=document.getElementById('tab-manual'),box=document.getElementById('manual-app');if(!view||!box)return;
 const GROUPS=[['cliente','Caminho do cliente (site)'],['painel','Painel da equipe'],['barbeiro','Barbeiros'],['ajuda','Ajuda']];
 let modules=null,started=false;
 // ícones de traço, no estilo dos ícones do menu
 const ICONS={conta:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',agendar:'M4 6h16v14H4zM4 10h16M8 3v5m8-5v5m-6 7 2 2 4-4',reservas:'M6 4h12v17H6zM9 9h6m-6 4h6m-6 4h3',
  painel:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z',agenda:'M4 5h16v15H4zM4 10h16M9 14h2m3 0h2m-7 3h2',atendimentos:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8 12l3 3 5-6',
  caixa:'M3 7h18v12H3zM3 11h18M7 15h4',dashboard:'M4 20V11m6 9V5m6 15v-7m-14 7h20',financeiro:'M12 3v18m4-14H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H7',
  servicos:'M6 6a2.5 2.5 0 1 0 0 .01M6 18a2.5 2.5 0 1 0 0 .01M8 7l12 10M8 17 20 7',barbeiros:'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9a6 6 0 0 1 12 0m1-15a3 3 0 0 1 0 6m2 9a6 6 0 0 0-3-5.2',
  'area-barbeiro':'M7 3h10v18H7zM11 18h2',seguranca:'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Zm-3 9 2 2 4-4',campanhas:'M4 6h16v12H4zM4 7l8 6 8-6',faq:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-2.5 6a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14m0 3h.01'};
 const icon=id=>{const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','manual-card-icon');path.setAttribute('d',ICONS[id]||ICONS.faq);svg.append(path);return svg;};
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
 const clone=nodes=>[...nodes].map(n=>document.importNode(n,true));
 const short=t=>{t=t.replace(/\s+/g,' ').trim();const cut=t.search(/[.:;](\s|$)/);t=cut>12&&cut<70?t.slice(0,cut):t;return t.length>70?t.slice(0,67).replace(/\s\S*$/,'')+'…':t;};
 const attendant=()=>document.body.classList.contains('role-attendant');
 async function load(){
  if(modules)return modules;
  const r=await fetch('manual.html?v=acerto-1',{cache:'no-store'});if(!r.ok)throw Error('sem acesso');
  const doc=new DOMParser().parseFromString(await r.text(),'text/html');
  modules=[...doc.querySelectorAll('.manual-section')].map(s=>{const h=s.querySelector('h2').textContent,n=h.match(/^(\d+) · /);
   return{id:s.id,title:n?h.slice(n[0].length):h,num:n?.[1],desc:s.dataset.desc,group:s.dataset.group,owner:s.dataset.role==='chefe',intro:s.querySelector('.m-intro'),steps:[...s.querySelectorAll('.m-step')]};});
  return modules;
 }
 const visible=()=>modules.filter(m=>!(m.owner&&attendant()));
 function home(focusId){
  box.replaceChildren();
  const head=make('div');const link=make('a','manual-app-link','Abrir o manual completo com o mapa do sistema ↗');link.href='manual.html';link.target='_blank';link.rel='noopener';
  head.append(make('h2','manual-app-title','Como o sistema funciona'),make('p','manual-app-lead','Escolha um tópico para ver o fluxo de etapas e o passo a passo de cada uma.'),link);box.append(head);
  for(const [group,label] of GROUPS){
   const list=visible().filter(m=>m.group===group);if(!list.length)continue;
   box.append(make('p','manual-lane',label));const grid=make('div','manual-grid');
   for(const m of list){const b=make('button','manual-card');b.type='button';b.dataset.module=m.id;
    b.append(icon(m.id));if(m.num)b.append(make('span','manual-card-step','Etapa '+m.num));
    b.append(make('b',null,m.title),make('span','manual-card-desc',m.desc));if(m.owner)b.append(make('span','org-tag','Só chefe'));
    b.onclick=()=>open(m.id);grid.append(b);}
   box.append(grid);}
  if(focusId)box.querySelector(`[data-module="${focusId}"]`)?.focus();
 }
 function open(id){
  const m=modules.find(x=>x.id===id);box.replaceChildren();
  const back=make('button','manual-back-btn','← Todos os tópicos');back.type='button';back.onclick=()=>home(id);
  const title=make('h2','manual-app-title',m.title);title.tabIndex=-1;
  const head=make('div','manual-module-head');head.append(back,title);if(m.owner)head.append(make('span','org-tag','Só chefe'));box.append(head);
  if(m.intro){const intro=make('div','manual-module-intro');intro.append(...clone(m.intro.childNodes));box.append(intro);}
  // etapas: cada subtítulo de ação vira uma caixa; com um passo a passo só, cada passo numerado vira uma caixa
  const flow=m.steps.filter(s=>s.dataset.kind!=='info'),info=m.steps.filter(s=>s.dataset.kind==='info'),faq=m.id==='faq';
  const single=flow.length===1&&flow[0].querySelector(':scope > ol');let nodes;
  if(single){const extra=[...flow[0].children].filter(c=>c.tagName!=='H3'&&c.tagName!=='OL');
   nodes=[...single.children].map((li,i)=>({label:short(li.textContent),title:'Etapa '+(i+1),body:clone(li.childNodes),extra:i===single.children.length-1?clone(extra):[]}));}
  else nodes=flow.map(s=>({label:s.querySelector('h3').textContent.replace(/\s*\(.*\)$/,''),title:s.querySelector('h3').textContent,body:clone([...s.childNodes].filter(c=>c.tagName!=='H3')),extra:[]}));
  const card=(title,num,body,cls)=>{const c=make('section','manual-stepcard'+(cls?' '+cls:''));
   if(title!=null){const h=make('h3');if(num!=null)h.append(make('span','manual-flow-num',String(num+1)));h.append(make('span',null,title));c.append(h,...body);}
   else{c.classList.add('manual-stepcard-line');const t=make('div','manual-stepcard-body');t.append(...body);c.append(make('span','manual-flow-num',String(num+1)),t);}
   return c;};
  if(nodes.length>1&&!single&&!faq){
   box.append(make('p','manual-lane','Fluxo do módulo'));const row=make('div','manual-flow');
   nodes.forEach((node,i)=>{if(i)row.append(make('span','manual-flow-arrow','→'));
    const b=make('button','manual-flow-node');b.type='button';b.append(make('span','manual-flow-num',String(i+1)),make('span',null,node.label));
    b.onclick=()=>document.getElementById('manual-step-'+m.id+'-'+i).scrollIntoView({behavior:'smooth',block:'start'});row.append(b);});
   box.append(row);}
  if(nodes.length){box.append(make('p','manual-lane',faq?'Perguntas e respostas':'Passo a passo'));const list=make('div','manual-steps');
   nodes.forEach((node,i)=>{const c=single?card(null,i,[...node.body,...node.extra]):card(node.title,faq?null:i,[...node.body,...node.extra]);c.id='manual-step-'+m.id+'-'+i;list.append(c);});box.append(list);}
  if(info.length){box.append(make('p','manual-lane','Bom saber'));const list=make('div','manual-steps');
   for(const s of info)list.append(card(s.querySelector('h3').textContent,null,clone([...s.childNodes].filter(c=>c.tagName!=='H3')),'manual-stepcard-info'));box.append(list);}
  const backEnd=make('button','manual-back-btn manual-back-end','← Voltar para todos os tópicos');backEnd.type='button';backEnd.onclick=()=>home(id);box.append(backEnd);
  title.focus({preventScroll:true});view.scrollIntoView({block:'start'});
 }
 async function start(){
  started=true;box.replaceChildren(make('p','manual-app-lead','Carregando o manual…'));
  try{await load();home();}
  catch{started=false;const p=make('p','manual-app-lead','Não foi possível carregar o manual. ');const retry=make('button','manual-back-btn','Tentar de novo');retry.type='button';retry.onclick=start;box.replaceChildren(p,retry);}
 }
 const check=()=>{if(!view.hidden&&!started)start();};
 new MutationObserver(check).observe(view,{attributes:true,attributeFilter:['hidden']});check();
})();
