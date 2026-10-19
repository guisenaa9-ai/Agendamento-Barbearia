// A página de agendamento só é exibida depois de validar a sessão no servidor.
window.CustomerEntry=(async function(){
const auth=window.CustomerAuth;
if(!auth?.isSignedIn()){location.replace('index.html');return false;}
try{await auth.request('/auth/v1/user');document.documentElement.classList.remove('checking-session');return true;}
catch{auth.clear();location.replace('index.html?login=1');return false;}
})();
