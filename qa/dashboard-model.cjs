// Testes do cálculo da Visão geral do Dashboard (dashboard-model.js). Rode: node qa/dashboard-model.cjs
const assert=require('node:assert/strict');require('../dashboard-model.js');const M=globalThis.DashboardModel;
const r=M.range('7','2026-11-20');
assert.deepEqual([r.start,r.end,r.prevStart,r.prevEnd],['2026-11-14','2026-11-20','2026-11-07','2026-11-13']);
assert.equal(M.localDay('2026-11-21T02:00:00Z'),'2026-11-20','22h em Manaus ainda é o dia 20');
const b=(id,ts,extra={})=>({id,starts_at:ts,status:'confirmed',no_show:false,customer_id:null,phone:'(92) 9000-000'+id.slice(-1),...extra});
const bookings=[b('a1','2026-11-20T14:00:00Z'),b('a2','2026-11-19T14:00:00Z',{phone:'(92) 9000-0001'}),b('a3','2026-11-18T14:00:00Z',{status:'cancelled'}),
 b('a4','2026-11-17T14:00:00Z',{no_show:true}),b('p1','2026-11-10T14:00:00Z'),b('x9','2026-11-01T14:00:00Z')];
const att=[{booking_id:'a1',total:50,paid:true},{booking_id:'a2',total:30,paid:true},{booking_id:'p1',total:40,paid:true},{booking_id:'x9',total:999,paid:true}];
const s=M.summarize(bookings,att,'7','2026-11-20');
assert.equal(s.cur.revenue,80);assert.equal(s.cur.attended,2);assert.equal(s.cur.clients,1,'mesmo celular conta uma vez');
assert.equal(s.cur.ticket,40);assert.equal(s.cur.lostRate,50,'1 cancelado + 1 falta de 4 reservas');
assert.equal(s.prev.revenue,40,'fora dos dois períodos não conta');assert.equal(s.delta.revenue,100);
assert.equal(s.labels.length,7);assert.equal(s.cur.series.revenue[6],50);assert.equal(s.cur.series.revenue.reduce((a,v)=>a+v,0),80);
const y=M.summarize([],[], '365','2026-11-20');assert.equal(y.labels.length,13);assert.equal(y.delta.revenue,null);
const q=M.summarize([],[], '90','2026-11-20');assert.equal(q.labels.length,13);
console.log('dashboard-model: ok');
