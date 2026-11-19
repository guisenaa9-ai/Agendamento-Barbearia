/* Minha conta: avaliar o atendimento concluído (1 a 5 estrelas + comentário) e dar gorjeta por Pix
   direto para o barbeiro. Funções customer_review e customer_tip_info em database/crescimento.sql. */
(()=>{
const auth=window.CustomerAuth;if(!auth)return;
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const mine=new Map();let pending=null;
// Busca de uma vez as notas já dadas nas reservas que aparecem na lista.
async function known(id){if(mine.has(id))return mine.get(id);
 pending??=new Promise(ok=>setTimeout(async()=>{const ids=[...document.querySelectorAll('[data-review]')].map(e=>e.dataset.review).filter(x=>!mine.has(x));
  try{for(let i=0;i<ids.length;i+=80)for(const r of await auth.request('/rest/v1/reviews?select=booking_id,rating,comment&booking_id=in.('+ids.slice(i,i+80).join(',')+')'))mine.set(r.booking_id,r);}catch{}
  for(const x of ids)if(!mine.has(x))mine.set(x,null);pending=null;ok();},0));
 await pending;return mine.get(id);}
function stars(value,onPick){const row=el('div','review-stars');row.setAttribute('role','radiogroup');row.setAttribute('aria-label','Nota de 1 a 5');
 for(let n=1;n<=5;n++){const b=el('button','review-star'+(n<=value?' on':''),'★');b.type='button';b.setAttribute('role','radio');b.setAttribute('aria-checked',String(n===value));b.setAttribute('aria-label',n+(n>1?' estrelas':' estrela'));b.onclick=()=>onPick(n);row.append(b);}return row;}
async function decorate(card,booking){
 const box=el('div','review-box');box.dataset.review=booking.id;card.append(box);
 const review=await known(booking.id);
 const show=r=>{box.replaceChildren();
  if(r){box.append(el('p','review-done','Sua avaliação: '+'★'.repeat(r.rating)+'☆'.repeat(5-r.rating)));const again=el('button','review-link','Mudar avaliação');again.type='button';again.onclick=()=>form(r);box.append(again);tip();}
  else{const open=el('button','review-open','Avaliar atendimento');open.type='button';open.onclick=()=>form(null);box.append(open);}};
 const form=r=>{let rating=r?.rating||0;box.replaceChildren();const text=el('textarea');text.rows=2;text.maxLength=300;text.placeholder='Conte como foi (opcional)';text.value=r?.comment||'';
  const msg=el('p','review-msg');msg.setAttribute('role','status');const send=el('button','review-open','Enviar avaliação');send.type='button';
  const pick=n=>{rating=n;picker.replaceWith(picker=stars(n,pick));};let picker=stars(rating,pick);
  send.onclick=async()=>{if(!rating){msg.textContent='Escolha de 1 a 5 estrelas.';return;}send.disabled=true;try{await auth.rpc('customer_review',{p_booking:booking.id,p_rating:rating,p_comment:text.value.trim()});const saved={rating,comment:text.value.trim()};mine.set(booking.id,saved);show(saved);}catch(e){msg.textContent=e.message;send.disabled=false;}};
  const label=el('p','review-title','Como foi o atendimento com '+booking.barber_name+'?');box.append(label,picker,text,send,msg);};
 const tip=async()=>{try{const t=await auth.rpc('customer_tip_info',{p_booking:booking.id});if(!t?.pix_key)return;
  const wrap=el('div','review-tip');wrap.append(el('p',null,'Quer deixar uma gorjeta para '+t.barber_name.split(' ')[0]+'? Vai direto para ele, pelo Pix:'));
  const key=el('code',null,t.pix_key),copy=el('button','review-link','Copiar chave Pix');copy.type='button';
  copy.onclick=async()=>{try{await navigator.clipboard.writeText(t.pix_key);copy.textContent='Chave copiada ✓';}catch{copy.textContent='Selecione e copie a chave';}};
  wrap.append(key,copy);box.append(wrap);}catch{}};
 show(review);
}
window.BarberReviews={decorate};
})();
