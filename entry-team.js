(async function(){
const container=document.getElementById('entryteamcards'),api=window.BarberAPI;
if(!container||!api.ready())return;
try{
 const barbers=await api.request('/rest/v1/barbers?active=eq.true&select=id,name,photo_url&order=name');
 container.replaceChildren();
 for(const barber of barbers){
  const card=document.createElement('article');card.className='entry-team-card';
  card.append(window.BarberTeam.portrait(barber.name,barber.photo_url));
  const copy=document.createElement('div'),name=document.createElement('h3'),specialty=document.createElement('p');
  name.textContent=barber.name;specialty.textContent=window.BarberTeam.profile(barber.name).specialty;
  copy.append(name,specialty);card.append(copy);container.append(card);
 }
 document.getElementById('entryteam').hidden=barbers.length===0;
}catch{document.getElementById('entryteam').hidden=true;}
})();
