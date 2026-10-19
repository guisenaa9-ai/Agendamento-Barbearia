(function(){
function barberId(value){return value==='any'?null:value;}
function rows(items){const unique=new Map();for(const item of items){const old=unique.get(item.slot);unique.set(item.slot,{slot:item.slot,barbers:[...new Set([...(old?.barbers||[]),...(item.barbers||[])])]});}return [...unique.values()].sort((a,b)=>a.slot.localeCompare(b.slot));}
window.BarberAvailability={barberId,rows};
})();
