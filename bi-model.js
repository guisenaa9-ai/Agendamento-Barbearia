(function(){
function summarize(bookings,attendances,barbers){
 const paid=new Map(attendances.filter(a=>a.paid).map(a=>[a.booking_id,Number(a.total)||0]));
 const valid=bookings.filter(b=>b.status!=='cancelled'),confirmed=bookings.filter(b=>b.status==='confirmed');
 const gross=valid.reduce((sum,b)=>sum+(paid.get(b.id)||0),0),cancelled=bookings.filter(b=>b.status==='cancelled').length;
 const services=new Map(),hours=new Map(),staff=new Map(barbers.map(b=>[b.id,{name:b.name,count:0,revenue:0}]));
 for(const b of valid){const service=b.service_name||'Não informado',hour=(b.starts_at||'').slice(11,13)+':00';services.set(service,(services.get(service)||0)+1);if(hour!==':00')hours.set(hour,(hours.get(hour)||0)+1);const row=staff.get(b.barber_id);if(row){row.count++;row.revenue+=paid.get(b.id)||0;}}
 const ordered=map=>[...map].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name,'pt-BR'));
 const staffRows=[...staff.values()].sort((a,b)=>b.revenue-a.revenue||b.count-a.count||a.name.localeCompare(b.name,'pt-BR'));
 return {bookings:bookings.length,confirmed:confirmed.length,cancelled,cancellationRate:bookings.length?cancelled/bookings.length*100:0,gross,averageTicket:paid.size?gross/paid.size:0,paidCount:paid.size,services:ordered(services),hours:ordered(hours),staff:staffRows,topService:ordered(services)[0]||null,peakHour:ordered(hours)[0]||null};
}
window.BarberBI={summarize};
})();
