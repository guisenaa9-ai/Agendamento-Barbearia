(function(){
const api=window.BarberAPI,key='daniel-silva-staff-session-v1';let session=null,refreshing=null;
try{const value=JSON.parse(sessionStorage.getItem(key)||'null');if(value?.access_token&&value?.refresh_token)session=value;}catch{}
function set(value){session=value;if(session)session.expires_at=session.expires_at||Date.now()/1000+session.expires_in;try{if(session)sessionStorage.setItem(key,JSON.stringify(session));else sessionStorage.removeItem(key);}catch{}}
async function token(){if(!session)throw Error('Entre com a conta do chefe.');if(Date.now()/1000>=session.expires_at-45){if(!refreshing)refreshing=api.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}}).then(value=>{set(value);return value.access_token;}).catch(()=>{set(null);throw Error('Sua sessão expirou. Entre novamente.');}).finally(()=>refreshing=null);return refreshing;}return session.access_token;}
async function rpc(name,body){return api.rpc(name,body,await token());}
async function check(){const allowed=await rpc('is_admin',{});if(!allowed){set(null);throw Error('Acesso permitido somente ao chefe.');}}
async function login(email,password){const value=await api.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});set(value);try{await check();try{await api.rpc('track_kryon_usage',{p_event:'staff_login'},await token());}catch{}return session;}catch(e){set(null);throw e;}}
async function logout(){const previous=session?.access_token;set(null);if(previous)try{await api.request('/auth/v1/logout',{method:'POST',token:previous});}catch{}}
window.StaffAuth={token,rpc,check,login,logout,clear:()=>set(null),session:()=>session,request:async(path,options={})=>api.request(path,{...options,token:await token()})};
})();
