// Robô de agendamento pelo WhatsApp e mensagem de lembrete. Lógica pura: o acesso ao banco e o envio
// chegam por "deps", então dá para testar sem a Meta nem o Supabase (qa/whatsapp-bot.mjs).
// Limites da Meta respeitados aqui: até 3 botões (título até 20 letras) e listas de até 10 linhas
// (título até 24, descrição até 72).

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SESSION_MINUTES = 120;
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const money = n => 'R$ ' + Number(n).toFixed(2).replace('.', ',');
const br = d => d.slice(8, 10) + '/' + d.slice(5, 7);
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = d => WEEK[new Date(d + 'T12:00:00Z').getUTCDay()];

// O sistema guarda o celular sem o 55 (igual ao site); a Meta manda com 55.
export function localPhone(waId) { const d = String(waId || '').replace(/\D/g, ''); return d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d; }
export function waPhone(phone) { const d = String(phone || '').replace(/\D/g, ''); return d.length === 10 || d.length === 11 ? '55' + d : d; }

export const text = body => ({ type: 'text', text: { body: cut(body, 4096) } });
export const buttons = (body, items) => ({ type: 'interactive', interactive: { type: 'button', body: { text: cut(body, 1024) },
  action: { buttons: items.slice(0, 3).map(b => ({ type: 'reply', reply: { id: b.id, title: cut(b.title, 20) } })) } } });
export const list = (body, button, rows) => ({ type: 'interactive', interactive: { type: 'list', body: { text: cut(body, 1024) },
  action: { button: cut(button, 20), sections: [{ title: 'Opções', rows: rows.slice(0, 10).map(r => ({ id: r.id, title: cut(r.title, 24), ...(r.description ? { description: cut(r.description, 72) } : {}) })) }] } } });

const MENU_WORDS = ['oi', 'olá', 'ola', 'menu', 'inicio', 'início', 'começar', 'comecar', 'recomeçar', 'recomecar', 'voltar', 'cancelar', 'bom dia', 'boa tarde', 'boa noite'];

/**
 * Trata uma mensagem recebida.
 * msg: { waId, profileName, text, replyId }
 * deps: { db:{session,save,services,barbers,slots,knownName,book,upcoming}, send(payload), today(), now(), shop, site }
 */
export async function handleMessage(msg, deps) {
  const { db } = deps, phone = localPhone(msg.waId), say = p => deps.send(p);
  const input = (msg.replyId || String(msg.text || '').trim()).slice(0, 200), lower = input.toLowerCase();
  let s = await db.session(phone);
  const fresh = !s || (Date.parse(deps.nowIso()) - Date.parse(s.updated_at)) / 60000 > SESSION_MINUTES;
  if (fresh) s = { step: 'start', data: {} };
  const go = async (step, data) => { s = { step, data }; await db.save(phone, step, data); };
  const first = n => String(n || '').trim().split(/\s+/)[0];

  const menu = async (lead = '') => {
    const name = s.data.name || await db.knownName(phone) || msg.profileName;
    await go('menu', { name: s.data.name });
    return say(buttons((lead ? lead + '\n\n' : '') + `Olá${name ? ', ' + first(name) : ''}! Aqui é a Barbearia ${deps.shop}. Como posso ajudar?`,
      [{ id: 'agendar', title: 'Agendar horário' }, { id: 'meus', title: 'Meus horários' }, { id: 'site', title: 'Agendar pelo site' }]));
  };
  const askService = async () => {
    const services = (await db.services()).slice(0, 10);
    if (!services.length) return menu('No momento não há serviços disponíveis para agendar.');
    await go('service', { name: s.data.name });
    return say(list('Qual serviço você quer?', 'Ver serviços', services.map(x => ({ id: 'svc:' + x.id, title: x.name, description: money(x.price) + ' · ' + x.duration + ' min' }))));
  };
  const askBarber = async data => {
    const barbers = (await db.barbers()).slice(0, 9);
    await go('barber', data);
    return say(list('Com quem você quer cortar?', 'Ver barbeiros', [{ id: 'bar:any', title: 'Sem preferência', description: 'O primeiro barbeiro livre' }, ...barbers.map(b => ({ id: 'bar:' + b.id, title: b.name, description: b.specialty || '' }))]));
  };
  const freeSlots = async (date, data) => {
    if (data.barber !== 'any') return db.slots(date, data.barber, data.service);
    const all = new Set();
    for (const b of await db.barbers()) for (const t of await db.slots(date, b.id, data.service)) all.add(t);
    return [...all].sort();
  };
  const askDay = async data => {
    const today = deps.today(), rows = [];
    for (let i = 0; i < 21 && rows.length < 10; i++) {
      const d = addDays(today, i), n = (await freeSlots(d, data)).length;
      if (n) rows.push({ id: 'day:' + d, title: weekday(d) + ', ' + br(d), description: (i === 0 ? 'Hoje · ' : i === 1 ? 'Amanhã · ' : '') + n + (n > 1 ? ' horários livres' : ' horário livre') });
    }
    if (!rows.length) return menu('Não encontrei horários livres nas próximas 3 semanas para essa escolha.');
    await go('day', data);
    return say(list('Qual dia fica melhor?', 'Ver dias', rows));
  };
  const askTime = async (data, offset = 0) => {
    const times = await freeSlots(data.date, data);
    if (!times.length) return askDay({ ...data, date: undefined });
    const page = times.slice(offset, offset + (times.length - offset > 10 ? 9 : 10));
    const rows = page.map(t => ({ id: 'time:' + t, title: t }));
    if (offset + page.length < times.length) rows.push({ id: 'more:' + (offset + page.length), title: 'Ver mais horários', description: 'Mais tarde no mesmo dia' });
    await go('time', data);
    return say(list(`Horários livres em ${weekday(data.date)}, ${br(data.date)} (Manaus):`, 'Ver horários', rows));
  };
  const askConfirm = async data => {
    const services = await db.services(), svc = services.find(x => x.id === data.service);
    const barber = data.barber === 'any' ? 'Sem preferência' : (await db.barbers()).find(b => b.id === data.barber)?.name || '';
    await go('confirm', data);
    return say(buttons(`Confere para mim:\n\n${svc?.name || 'Serviço'} · ${money(svc?.price || 0)}\nBarbeiro: ${barber}\nDia: ${weekday(data.date)}, ${br(data.date)} às ${data.time} (Manaus)\nNome: ${data.name}`,
      [{ id: 'ok', title: 'Confirmar' }, { id: 'agendar', title: 'Recomeçar' }]));
  };

  // Palavras de início valem em qualquer passo
  // Conversa nova ou palavra de início: menu. Exceção: botão do menu tocado depois que a conversa expirou.
  if ((fresh && !['agendar', 'meus', 'site'].includes(input)) || MENU_WORDS.includes(lower)) return menu();
  if (input === 'agendar') return askService();
  if (input === 'site') { await go('menu', s.data); return say(text(`Pelo site você agenda, altera e cancela quando quiser: ${deps.site}/agendar.html`)); }
  if (input === 'meus') {
    const rows = await db.upcoming(phone);
    await go('menu', s.data);
    if (!rows.length) return say(buttons('Você não tem horários marcados com este celular.', [{ id: 'agendar', title: 'Agendar horário' }]));
    return say(text('Seus próximos horários:\n\n' + rows.map(r => `• ${weekday(r.starts_at.slice(0, 10))}, ${br(r.starts_at.slice(0, 10))} às ${r.starts_at.slice(11, 16)} · ${r.service_name} com ${r.barber_name}\n  Código: ${r.id}`).join('\n') +
      `\n\nPara alterar ou cancelar, use "Já agendei antes de criar a conta" em ${deps.site}/conta.html com o código e este celular, ou fale com a barbearia.`));
  }

  const data = { ...s.data };
  if (s.step === 'service' && input.startsWith('svc:')) { if (!(await db.services()).some(x => x.id === input.slice(4))) return askService(); return askBarber({ ...data, service: input.slice(4) }); }
  if (s.step === 'barber' && input.startsWith('bar:')) {
    const id = input.slice(4);
    if (id !== 'any' && !(await db.barbers()).some(b => b.id === id)) return askBarber(data);
    return askDay({ ...data, barber: id });
  }
  if (s.step === 'day' && input.startsWith('day:')) return askTime({ ...data, date: input.slice(4) });
  if (s.step === 'time' && input.startsWith('more:')) return askTime(data, Number(input.slice(5)) || 0);
  if (s.step === 'time' && input.startsWith('time:')) {
    const time = input.slice(5);
    if (!(await freeSlots(data.date, data)).includes(time)) return askTime(data);
    const name = data.name || await db.knownName(phone);
    if (name) return askConfirm({ ...data, time, name });
    await go('name', { ...data, time });
    return say(text('Para confirmar, qual é o seu nome?'));
  }
  if (s.step === 'name') {
    const name = input.replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 80 || /^\d+$/.test(name)) return say(text('Me diga seu nome, por favor (por exemplo: João Silva).'));
    return askConfirm({ ...data, name });
  }
  if (s.step === 'confirm' && input === 'ok') {
    try {
      const id = await db.book({ phone, name: data.name, date: data.date, time: data.time, barber: data.barber === 'any' ? null : data.barber, service: data.service });
      await go('menu', { name: data.name });
      return say(text(`Agendado! ✅\n\n${weekday(data.date)}, ${br(data.date)} às ${data.time} (Manaus).\nCódigo da reserva: ${id}\n\nNa véspera você recebe um lembrete aqui. Para ver seus horários, mande "menu".`));
    } catch (e) {
      await say(text((e && e.message ? e.message : 'Não consegui confirmar agora.') + ' Vamos escolher outro horário.'));
      return askTime(data);
    }
  }
  // Resposta que não serve para o passo atual: repete a pergunta
  const again = { service: askService, barber: () => askBarber(data), day: () => askDay(data), time: () => askTime(data), confirm: () => askConfirm(data) }[s.step];
  if (again) return again();
  return menu();
}

// Lembrete da véspera, no modelo aprovado pela Meta: {{1}} nome, {{2}} dia, {{3}} hora, {{4}} barbeiro, {{5}} serviço.
export function reminderPayload(row, settings) {
  const date = String(row.starts_at).slice(0, 10), time = String(row.starts_at).slice(11, 16);
  return { type: 'template', template: { name: settings.template_name, language: { code: settings.template_lang },
    components: [{ type: 'body', parameters: [String(row.customer).split(/\s+/)[0], weekday(date) + ', ' + br(date), time, row.barber_name, row.service_name].map(t => ({ type: 'text', text: cut(t, 60) })) }] } };
}
