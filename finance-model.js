(function(){
function cents(value){const n=Number(value);return Number.isFinite(n)?Math.round(n*100):0;}
function summarize(bookings,attendances,barbers,rates){
 const visits=new Map(attendances.filter(v=>v.paid).map(v=>[v.booking_id,v]));
 const rows=barbers.map(b=>({id:b.id,name:b.name,rate:Number(rates.get(b.id)??40),services:0,grossCents:0,commissionCents:0,netCents:0,serviceRows:[]}));
 const byId=new Map(rows.map(r=>[r.id,r]));let pendingCents=0,paidCount=0;
 for(const booking of bookings){if(booking.status==='cancelled')continue;const visit=visits.get(booking.id);if(!visit){pendingCents+=cents(booking.price);continue;}const row=byId.get(booking.barber_id);if(!row)continue;const gross=cents(visit.total),commission=Math.round(gross*row.rate/100),serviceName=booking.service_name||'Serviço não informado';row.services++;row.grossCents+=gross;row.commissionCents+=commission;let service=row.serviceRows.find(s=>s.name===serviceName);if(!service){service={name:serviceName,count:0,grossCents:0,commissionCents:0,netCents:0};row.serviceRows.push(service);}service.count++;service.grossCents+=gross;service.commissionCents+=commission;service.netCents=service.grossCents-service.commissionCents;paidCount++;}
 for(const row of rows){row.netCents=row.grossCents-row.commissionCents;row.serviceRows.sort((a,b)=>b.grossCents-a.grossCents||a.name.localeCompare(b.name,'pt-BR'));}
 rows.sort((a,b)=>b.grossCents-a.grossCents||a.name.localeCompare(b.name,'pt-BR'));
 return {rows,paidCount,grossCents:rows.reduce((s,r)=>s+r.grossCents,0),commissionCents:rows.reduce((s,r)=>s+r.commissionCents,0),netCents:rows.reduce((s,r)=>s+r.netCents,0),pendingCents};
}
function csv(report,start,end){const q=v=>'"'+String(v).replaceAll('"','""')+'"';const lines=[['Relatório financeiro',start+' a '+end],[],['Barbeiro','Serviço','Quantidade','Comissão (%)','Faturamento (R$)','Comissão (R$)','Líquido barbearia (R$)']];for(const r of report.rows){if(!r.serviceRows.length)lines.push([r.name,'Sem atendimentos pagos',0,r.rate.toFixed(2),'0.00','0.00','0.00']);for(const s of r.serviceRows)lines.push([r.name,s.name,s.count,r.rate.toFixed(2),(s.grossCents/100).toFixed(2),(s.commissionCents/100).toFixed(2),(s.netCents/100).toFixed(2)]);lines.push([r.name+' — subtotal','Todos os serviços',r.services,r.rate.toFixed(2),(r.grossCents/100).toFixed(2),(r.commissionCents/100).toFixed(2),(r.netCents/100).toFixed(2)]);}lines.push([],['TOTAL GERAL','',report.paidCount,'',(report.grossCents/100).toFixed(2),(report.commissionCents/100).toFixed(2),(report.netCents/100).toFixed(2)]);return '\ufeff'+lines.map(row=>row.map(q).join(';')).join('\r\n');}
window.BarberFinance={summarize,csv};
})();
