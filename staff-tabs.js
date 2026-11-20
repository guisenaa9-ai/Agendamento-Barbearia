(function(){
const names={dashboard:'Visão geral e BI',agenda:'Agenda de clientes',financeiro:'Faturamento e comissões',caixa:'Caixa diário',servicos:'Serviços da barbearia',barbeiros:'Equipe e dados dos barbeiros',atendimentos:'Atendimentos',campanhas:'Campanhas',manual:'Manual do sistema'};
const $=id=>document.getElementById(id),all=Object.keys(names);
let allowed=null;
function select(name){
 if(!names[name]||(allowed&&!allowed.includes(name)))name=allowed?allowed[0]:'dashboard';
 for(const key of all){$('tab-'+key).hidden=key!==name;const button=$('nav-'+key);button.setAttribute('aria-selected',String(key===name));button.tabIndex=key===name?0:-1;}
 $('staffpagetitle').textContent=allowed&&name==='atendimentos'?'Balcão do dia':names[name];
 $('datefilters').hidden=!['dashboard','agenda'].includes(name);
 window.dispatchEvent(new CustomEvent('stafftabchange',{detail:{name}}));
}
for(const name of all){const button=$('nav-'+name);
 button.onclick=()=>{select(name);history.replaceState(null,'',location.pathname+location.search+'#'+name);};
 button.onkeydown=e=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();const keys=allowed||all,index=keys.indexOf(name);
  const next=e.key==='Home'?keys[0]:e.key==='End'?keys.at(-1):keys[(index+(['ArrowUp','ArrowLeft'].includes(e.key)?-1:1)+keys.length)%keys.length];
  $('nav-'+next).click();$('nav-'+next).focus();
 };
}
window.addEventListener('hashchange',()=>select(location.hash.slice(1)));
function setRole(role){
 const changed=!!allowed!==(role==='attendant');
 allowed=role==='attendant'?['atendimentos','agenda','caixa','manual']:null;
 if(changed)$('visitstate').value=allowed?'active':'all';
 document.body.classList.toggle('role-attendant',!!allowed);
 document.title=(allowed?'Balcão do dia':'Portal do chefe')+' · Barbearia Daniel Silva';
 document.querySelector('.staff-header-note').textContent=allowed?'BALCÃO DO DIA · MANAUS':'PORTAL DO CHEFE · MANAUS';
 document.querySelector('.staff-nav').setAttribute('aria-label',allowed?'Seções do balcão':'Seções do portal do chefe');
 document.querySelector('.staff-nav-label').textContent=allowed?'ATENDIMENTO':'SUA BARBEARIA';
 document.querySelector('.staff-toolbar .staff-eyebrow').textContent=allowed?'RECEPÇÃO E ATENDIMENTO':'VISÃO GERENCIAL';
 $('nav-atendimentos').textContent=allowed?'Balcão do dia':'Atendimentos';
 $('desknewbooking').hidden=!allowed;
 for(const name of all)$('nav-'+name).hidden=!!allowed&&!allowed.includes(name);
 for(const name of allowed||all)document.querySelector('.staff-nav').append($('nav-'+name));
 select(location.hash.slice(1));
}
$('desknewbooking').onclick=()=>{
 $('nav-agenda').click();const details=$('adminbooking').closest('details');details.open=true;
 details.scrollIntoView({behavior:'smooth',block:'start'});$('newcustomer').focus({preventScroll:true});
};
window.StaffTabs={select,setRole};
})();
