(function(){
// Tema claro/escuro dos painéis da equipe. A escolha fica salva neste navegador.
// O tema escuro é montado a partir das próprias folhas de estilo: cores claras de fundo e borda escurecem,
// textos escuros clareiam. Assim qualquer CSS novo já sai no tema escuro sem lista de cores para manter.
const key='barbearia-tema',root=document.documentElement,css=document.createElement('style');let built=false;
function parse(c){if(/^white$/i.test(c))return[255,255,255,1];if(/^black$/i.test(c))return[0,0,0,1];if(c[0]==='#'){let h=c.slice(1);if(h.length<5)h=[...h].map(x=>x+x).join('');return[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)).concat(h.length>6?parseInt(h.slice(6,8),16)/255:1);}const n=c.match(/[\d.]+%?/g).map(parseFloat);return[n[0],n[1],n[2],n.length>3?n[3]:1];}
function shift(c,text){const[r,g,b,a]=parse(c).map((v,i)=>i<3?v/255:v),max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2,d=max-min;let s=d?d/(1-Math.abs(2*l-1)):0,h=0;
if(d)h=max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4;
// Fundos e bordas claros viram superfícies escuras; textos escuros viram claros. Cores de destaque ficam como estão.
let nl;if(text){if(l>=.6)return c;nl=.97-l*.5;}else{if(l<=.7)return c;nl=.1+(1-l)*.8;s=Math.min(s,.12);}
return`hsla(${Math.round(h*60)},${Math.round(s*100)}%,${Math.round(nl*100)}%,${+a.toFixed(3)})`;}
const color=/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(white|black)\b/gi;
function split(text,sep){const out=[];let depth=0,from=0;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='(')depth++;else if(ch===')')depth--;else if(ch===sep&&!depth){out.push(text.slice(from,i));from=i+1;}}out.push(text.slice(from));return out.map(x=>x.trim()).filter(Boolean);}
function build(){const vars={},rules=[];const sheets=[...document.styleSheets].filter(s=>s.ownerNode!==css).map(s=>{try{return s.cssRules;}catch{return null;}}).filter(Boolean);
for(const list of sheets)for(const rule of list)if(rule.selectorText===':root')for(const decl of split(rule.style.cssText,';')){const[name,...rest]=decl.split(':');if(name.trim().startsWith('--'))vars[name.trim()]=rest.join(':').trim();}
// Repete também as cores que não mudam: com o prefixo, a ordem de prioridade entre as regras continua a mesma do tema claro.
function walk(list){const out=[];for(const rule of list){if(rule.cssRules&&rule.conditionText!==undefined){const inner=walk(rule.cssRules);if(inner.length)out.push('@'+(rule instanceof CSSMediaRule?'media ':'supports ')+rule.conditionText+'{'+inner.join('')+'}');continue;}if(!rule.selectorText||rule.selectorText===':root')continue;
const decls=[];for(const decl of split(rule.style.cssText,';')){const at=decl.indexOf(':'),prop=decl.slice(0,at).trim();const text=/^(color|text-decoration|-webkit-text-fill-color)/.test(prop);if(!text&&!/^(background|border)/.test(prop)||/radius|width|style$/.test(prop))continue;
const value=decl.slice(at+1).replace(/var\((--[\w-]+)[^)]*\)/g,(m,v)=>vars[v]||m),next=value.replace(color,c=>shift(c,text));decls.push(prop+':'+next);}
if(decls.length)out.push(split(rule.selectorText,',').map(s=>/^(:root|html)\b/.test(s)?s.replace(/^(:root|html)/,':root[data-theme=dark]'):':root[data-theme=dark] '+s).join(',')+'{'+decls.join(';')+'}');}return out;}
for(const list of sheets)rules.push(...walk(list));
css.textContent=':root[data-theme=dark]{color-scheme:dark}'+rules.join('\n');built=true;}
function apply(theme){if(theme==='dark'&&!built)build();root.dataset.theme=theme;const button=document.getElementById('theme-toggle');if(button){button.lastChild.textContent=theme==='dark'?'Tema claro':'Tema escuro';button.firstChild.textContent=theme==='dark'?'☀':'☾';}}
let saved='light';try{saved=localStorage.getItem(key)==='dark'?'dark':'light';}catch{}
const style=document.createElement('style');style.textContent='.theme-toggle{display:inline-flex;align-items:center;gap:7px;margin-left:14px;border:1px solid #d9ded5;background:#fff;color:#18392c;border-radius:999px;padding:8px 14px;font:600 13px DM Sans,system-ui,sans-serif;cursor:pointer;white-space:nowrap;box-shadow:none}.theme-toggle span{font-size:15px;line-height:1}@media(max-width:640px){.theme-toggle b{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.theme-toggle{padding:9px 11px}.staff-header .staff-header-note{display:none}}';document.head.prepend(style);
document.head.append(css);apply(saved);
document.addEventListener('DOMContentLoaded',()=>{const header=document.querySelector('.staff-header,.customer-header');if(!header)return;const button=document.createElement('button');button.type='button';button.id='theme-toggle';button.className='theme-toggle';button.innerHTML='<span aria-hidden="true"></span><b></b>';header.lastElementChild.style.marginLeft="auto";header.append(button);apply(root.dataset.theme);
button.onclick=()=>{const theme=root.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem(key,theme);}catch{}apply(theme);};});
})();
