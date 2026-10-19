(function(){
const api=window.BarberAPI,key='kryon-monitor-session-v1';let session=null,refreshing=null;
try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved?.access_token&&saved?.refresh_token)session=saved;}catch{}
function set(value){session=value;if(session)session.expires_at=session.expires_at||Date.now()/1000+session.expires_in;try{if(session)sessionStorage.setItem(key,JSON.stringify(session));else sessionStorage.removeItem(key);}catch{}}
async function token(){if(!session)throw Error('Entre no Painel Kryon.');if(Date.now()/1000>=session.expires_at-45){if(!refreshing)refreshing=api.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}}).then(value=>{set(value);return value.access_token;}).catch(()=>{set(null);throw Error('Sua sessão expirou. Entre novamente.');}).finally(()=>refreshing=null);return refreshing;}return session.access_token;}
async function rpc(name,body={}){return api.rpc(name,body,await token());}
async function check(){if(!await rpc('is_kryon_admin')){set(null);throw Error('Esta conta não possui acesso ao Painel Kryon.');}return true;}
async function login(email,password){const value=await api.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});set(value);try{await check();return session;}catch(e){set(null);throw e;}}
async function logout(){const previous=session?.access_token;set(null);if(previous)try{await api.request('/auth/v1/logout',{method:'POST',token:previous});}catch{}}
window.KryonAuth={token,rpc,check,login,logout,clear:()=>set(null),session:()=>session};
})();
