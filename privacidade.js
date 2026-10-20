// Canal de contato LGPD vem de config.js (cada barbearia preenche o seu).
const contact=(window.BARBER_CONFIG||{}).contact;
if(contact)document.getElementById('contact').textContent=contact;
