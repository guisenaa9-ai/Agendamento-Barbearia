(function(){
const api=window.BarberAPI,key='daniel-silva-customer-session-v1';let session=null,refreshing=null;
function persist(){try{if(session)sessionStorage.setItem(key,JSON.stringify(session));else sessionStorage.removeItem(key);}catch{}}
function set(value){session=value;if(session)session.expires_at=session.expires_at||Date.now()/1000+session.expires_in;persist();window.dispatchEvent(new Event('customer-session'));}
try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved?.access_token&&saved?.refresh_token)session=saved;}catch{}
async function token(){if(!session)throw Error('Entre na sua conta para continuar.');if(Date.now()/1000>=session.expires_at-45){if(!refreshing)refreshing=api.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}}).then(value=>{set(value);return value.access_token;}).catch(e=>{set(null);throw Error('Sua sessão expirou. Entre novamente.');}).finally(()=>{refreshing=null;});return refreshing;}return session.access_token;}
async function request(path,options={}){return api.request(path,{...options,token:await token()});}
async function rpc(name,body){return api.rpc(name,body,await token());}
async function track(){try{await api.rpc('track_kryon_usage',{p_event:'client_login'},await token());}catch{}}
async function login(email,password){set(await api.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}}));await track();return session;}
async function signup(name,email,phone,password,whatsapp=false){const site=api.base?api.base():location.origin,result=await api.request('/auth/v1/signup?redirect_to='+encodeURIComponent(site+'/conta.html'),{method:'POST',body:{email,password,data:{name,phone,whatsapp_opt_in:whatsapp===true}}});if(result?.access_token){set(result);await track();}return !!result?.access_token;}
async function logout(){const old=session?.access_token;set(null);if(old)try{await api.request('/auth/v1/logout',{method:'POST',token:old})}catch{}}
async function callback(){const values=new URLSearchParams(location.hash.slice(1));if(values.has('error_description')){const message=values.get('error_description');history.replaceState(null,'',location.pathname+location.search);throw Error(message);}if(!values.has('access_token'))return false;const access=values.get('access_token'),refresh=values.get('refresh_token');const user=await api.request('/auth/v1/user',{token:access});set({access_token:access,refresh_token:refresh,user,expires_at:Date.now()/1000+Number(values.get('expires_in')||3600)});await track();const recovery=values.get('type')==='recovery';history.replaceState(null,'',location.pathname+location.search);return recovery;}
window.CustomerAuth={token,request,rpc,login,signup,logout,callback,clear:()=>set(null),isSignedIn:()=>!!session,user:()=>session?.user};
})();
