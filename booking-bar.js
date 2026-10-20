// Celular: barra fixa no rodapé com horário, total e "Confirmar". Usa o botão #confirm original, então a regra de reserva é a mesma.
(function(){
const $=id=>document.getElementById(id),confirm=$('confirm'),summary=document.querySelector('.summary');if(!confirm||!summary)return;
const bar=document.createElement('div'),info=document.createElement('p'),button=document.createElement('button');
bar.className='booking-bar';bar.setAttribute('aria-hidden','true');button.type='button';button.className='primary';button.textContent='Confirmar';button.tabIndex=-1;bar.append(info,button);document.body.append(bar);
let summaryVisible=false;
// Só escreve no DOM quando muda: a barra observa o body e não pode se realimentar
function sync(){const time=$('timechoice').value,total=$('total').textContent,text=time?time+(total?' · '+total:''):'Escolha serviço, barbeiro e horário',hide=summaryVisible||$('booking').hidden||!$('confirmation').hidden;if(info.textContent!==text)info.textContent=text;if(button.disabled!==confirm.disabled)button.disabled=confirm.disabled;if(bar.hidden!==hide){bar.hidden=hide;document.body.classList.toggle('has-booking-bar',!hide);}}
button.onclick=()=>confirm.click();
// Erro ao confirmar aparece no resumo: leva o cliente até ele
new MutationObserver(()=>{if($('error').textContent)$('error').scrollIntoView({behavior:'smooth',block:'center'});}).observe($('error'),{childList:true,characterData:true,subtree:true});
new IntersectionObserver(([e])=>{summaryVisible=e.isIntersecting;sync();}).observe(summary);
new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['disabled','hidden','aria-pressed'],childList:true,characterData:true,subtree:true});
sync();
})();
