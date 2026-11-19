// Testa o robô de agendamento e o lembrete (supabase/functions/whatsapp/bot.js) sem Meta nem Supabase.
import assert from 'node:assert/strict';
import { handleMessage, reminderPayload, localPhone, waPhone } from '../supabase/functions/whatsapp/bot.js';

function world({ known = null, bookError = null } = {}) {
  const sessions = new Map(), sent = [], booked = [];
  const services = [{ id: 's1', name: 'Corte masculino', price: 40, duration: 40 }, { id: 's2', name: 'Barba completa', price: 30, duration: 30 }];
  const barbers = [{ id: 'b1', name: 'Daniel Silva', specialty: 'Degradê' }, { id: 'b2', name: 'Lucas Rocha', specialty: '' }];
  const free = { b1: ['09:00', '09:40', '10:20'], b2: ['09:00', '14:00'] };
  const deps = {
    shop: 'Daniel Silva', site: 'https://exemplo.com', today: () => '2026-11-19', nowIso: () => '2026-11-19T12:00:00.000Z',
    send: async p => { sent.push(p); },
    db: {
      session: async p => sessions.get(p) || null,
      save: async (p, step, data) => { sessions.set(p, { step, data, updated_at: '2026-11-19T11:59:00.000Z' }); },
      services: async () => services, barbers: async () => barbers,
      slots: async (date, barber) => (date === '2026-11-23' ? [] : free[barber] || []), // domingo fechado
      knownName: async () => known,
      book: async b => { if (bookError) throw new Error(bookError); booked.push(b); return 'uuid-123'; },
      upcoming: async () => [{ id: 'abc', starts_at: '2026-11-20T09:00:00', service_name: 'Corte masculino', barber_name: 'Daniel Silva' }],
    },
  };
  const talk = (m) => handleMessage({ waId: '5592999990000', profileName: 'Zé', ...m }, deps);
  return { deps, sent, booked, sessions, talk, last: () => sent.at(-1) };
}
const ids = p => p.interactive.type === 'list' ? p.interactive.action.sections[0].rows.map(r => r.id) : p.interactive.action.buttons.map(b => b.reply.id);
const tests = [];
const test = (n, f) => tests.push([n, f]);

test('Primeira mensagem mostra o menu com 3 botões', async () => {
  const w = world(); await w.talk({ text: 'Oi, boa tarde' });
  assert.equal(w.last().interactive.type, 'button'); assert.deepEqual(ids(w.last()), ['agendar', 'meus', 'site']);
  assert.match(w.last().interactive.body.text, /Olá, Zé!/);
});
test('Fluxo completo: serviço, barbeiro, dia, horário, nome e confirmação', async () => {
  const w = world(); await w.talk({ text: 'oi' });
  await w.talk({ replyId: 'agendar' }); assert.deepEqual(ids(w.last()), ['svc:s1', 'svc:s2']);
  await w.talk({ replyId: 'svc:s1' }); assert.deepEqual(ids(w.last()), ['bar:any', 'bar:b1', 'bar:b2']);
  await w.talk({ replyId: 'bar:b1' }); const days = ids(w.last()); assert.ok(days.length === 10 && days[0] === 'day:2026-11-19' && !days.includes('day:2026-11-23'));
  await w.talk({ replyId: 'day:2026-11-20' }); assert.deepEqual(ids(w.last()), ['time:09:00', 'time:09:40', 'time:10:20']);
  await w.talk({ replyId: 'time:09:40' }); assert.match(w.last().text.body, /qual é o seu nome/);
  await w.talk({ text: 'João Pedro' }); assert.deepEqual(ids(w.last()), ['ok', 'agendar']); assert.match(w.last().interactive.body.text, /Daniel Silva[\s\S]*09:40[\s\S]*João Pedro/);
  await w.talk({ replyId: 'ok' });
  assert.deepEqual(w.booked[0], { phone: '92999990000', name: 'João Pedro', date: '2026-11-20', time: '09:40', barber: 'b1', service: 's1' });
  assert.match(w.last().text.body, /Agendado![\s\S]*uuid-123/);
});
test('Sem preferência junta os horários de todos e reserva sem barbeiro', async () => {
  const w = world({ known: 'Carlos Mendes' }); await w.talk({ text: 'oi' }); await w.talk({ replyId: 'agendar' }); await w.talk({ replyId: 'svc:s2' });
  await w.talk({ replyId: 'bar:any' }); await w.talk({ replyId: 'day:2026-11-20' });
  assert.deepEqual(ids(w.last()), ['time:09:00', 'time:09:40', 'time:10:20', 'time:14:00']);
  await w.talk({ replyId: 'time:14:00' }); assert.equal(w.last().interactive.type, 'button'); // nome já conhecido: vai direto à confirmação
  await w.talk({ replyId: 'ok' }); assert.equal(w.booked[0].barber, null); assert.equal(w.booked[0].name, 'Carlos Mendes');
});
test('Horário que deixou de estar livre não é aceito', async () => {
  const w = world({ known: 'Ana' }); await w.talk({ text: 'oi' }); await w.talk({ replyId: 'agendar' }); await w.talk({ replyId: 'svc:s1' }); await w.talk({ replyId: 'bar:b1' }); await w.talk({ replyId: 'day:2026-11-20' });
  await w.talk({ replyId: 'time:18:00' }); assert.ok(ids(w.last()).includes('time:09:00')); assert.equal(w.booked.length, 0);
});
test('Erro do banco na reserva volta para os horários', async () => {
  const w = world({ known: 'Ana', bookError: 'Você já tem 3 horários marcados.' }); for (const m of [{ text: 'oi' }, { replyId: 'agendar' }, { replyId: 'svc:s1' }, { replyId: 'bar:b1' }, { replyId: 'day:2026-11-20' }, { replyId: 'time:09:00' }, { replyId: 'ok' }]) await w.talk(m);
  assert.match(w.sent.at(-2).text.body, /3 horários marcados/); assert.ok(ids(w.last()).includes('time:09:00'));
});
test('"menu" no meio da conversa recomeça', async () => {
  const w = world(); await w.talk({ text: 'oi' }); await w.talk({ replyId: 'agendar' }); await w.talk({ text: 'menu' });
  assert.deepEqual(ids(w.last()), ['agendar', 'meus', 'site']);
});
test('Meus horários lista os próximos com código', async () => {
  const w = world(); await w.talk({ text: 'oi' }); await w.talk({ replyId: 'meus' }); assert.match(w.last().text.body, /20\/11 às 09:00[\s\S]*Código: abc/);
});
test('Texto solto num passo de lista repete a pergunta', async () => {
  const w = world(); await w.talk({ text: 'oi' }); await w.talk({ replyId: 'agendar' }); await w.talk({ text: 'corte' }); assert.deepEqual(ids(w.last()), ['svc:s1', 'svc:s2']);
});
test('Listas respeitam os limites da Meta', async () => {
  const w = world(); await w.talk({ text: 'oi' }); await w.talk({ replyId: 'agendar' }); await w.talk({ replyId: 'svc:s1' }); await w.talk({ replyId: 'bar:b1' });
  for (const p of w.sent.filter(p => p.interactive?.type === 'list')) for (const r of p.interactive.action.sections[0].rows) { assert.ok(r.title.length <= 24); assert.ok(!r.description || r.description.length <= 72); }
  for (const p of w.sent.filter(p => p.interactive?.type === 'button')) for (const b of p.interactive.action.buttons) assert.ok(b.reply.title.length <= 20);
});
test('Celular: tira e põe o 55', () => { assert.equal(localPhone('5592999990000'), '92999990000'); assert.equal(waPhone('92999990000'), '5592999990000'); assert.equal(waPhone('5592999990000'), '5592999990000'); });
test('Lembrete usa o modelo com 5 variáveis', () => {
  const p = reminderPayload({ customer: 'Carlos Mendes', starts_at: '2026-11-20T09:40:00', barber_name: 'Daniel Silva', service_name: 'Corte masculino' }, { template_name: 'lembrete_horario', template_lang: 'pt_BR' });
  assert.equal(p.template.name, 'lembrete_horario'); assert.deepEqual(p.template.components[0].parameters.map(x => x.text), ['Carlos', 'Sex, 20/11', '09:40', 'Daniel Silva', 'Corte masculino']);
});

let failed = 0;
for (const [n, f] of tests) { try { await f(); console.log('PASS', n); } catch (e) { failed++; console.log('FAIL', n, '-', e.message); } }
console.log(`${tests.length - failed} de ${tests.length} passaram`); process.exitCode = failed ? 1 : 0;
