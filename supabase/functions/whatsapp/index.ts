// Edge Function "whatsapp": webhook da API oficial (robô de agendamento) e envio dos lembretes.
// Rotas:  GET  /whatsapp            verificação do webhook pela Meta
//         POST /whatsapp            mensagens recebidas (assinadas pela Meta com o App Secret)
//         POST /whatsapp/lembretes  chamada a cada 5 minutos pelo pg_cron (Authorization: Bearer CRON_SECRET)
// Segredos (supabase secrets set ...): WHATSAPP_TOKEN, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, CRON_SECRET,
// SHOP_NAME, SITE_URL. SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem em toda Edge Function.
// Publicar com:  supabase functions deploy whatsapp --no-verify-jwt   (a Meta não manda JWT; a assinatura protege)
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleMessage, reminderPayload, localPhone, waPhone } from './bot.js';

const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const headers = { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const manausNow = () => new Date(Date.now() - 4 * 3600e3).toISOString();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function settings() {
  const { data, error } = await db.from('whatsapp_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  return data;
}
async function send(cfg: any, to: string, payload: unknown) {
  const res = await fetch(`https://graph.facebook.com/${cfg.graph_version}/${cfg.phone_number_id}/messages`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env('WHATSAPP_TOKEN'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...(payload as object) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || 'Meta respondeu ' + res.status);
  return json?.messages?.[0]?.id as string | undefined;
}
// Comparação em tempo constante da assinatura X-Hub-Signature-256.
async function validSignature(raw: string, header: string | null) {
  const secret = env('WHATSAPP_APP_SECRET');
  if (!secret || !header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const hex = [...mac].map(b => b.toString(16).padStart(2, '0')).join(''), given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// Acesso ao banco usado pelo robô (service_role: só as funções e tabelas abaixo).
const deps = (cfg: any, to: string) => ({
  shop: env('SHOP_NAME') || 'Daniel Silva', site: env('SITE_URL').replace(/\/$/, ''),
  today: () => manausNow().slice(0, 10), nowIso: () => new Date().toISOString(),
  send: (p: unknown) => send(cfg, to, p),
  db: {
    async session(phone: string) { const { data } = await db.from('wa_sessions').select('step,data,updated_at').eq('phone', phone).maybeSingle(); return data; },
    async save(phone: string, step: string, data: unknown) { await db.from('wa_sessions').upsert({ phone, step, data, updated_at: new Date().toISOString() }); },
    async services() { const { data } = await db.from('services').select('id,name,price,duration').eq('active', true).order('name'); return data ?? []; },
    async barbers() { const { data } = await db.from('barbers').select('id,name,specialty').eq('active', true).order('name'); return data ?? []; },
    async slots(date: string, barber: string, service: string) { const { data, error } = await db.rpc('available_slots', { p_date: date, p_barber: barber, p_service: service }); if (error) throw error; return (data ?? []).map((r: any) => r.slot); },
    async knownName(phone: string) {
      const { data: c } = await db.from('customer_directory').select('name').eq('phone', phone).maybeSingle(); if (c?.name) return c.name;
      const { data: p } = await db.from('customer_profiles').select('name').eq('phone', phone).limit(1).maybeSingle(); return p?.name || null;
    },
    async book(b: any) { const { data, error } = await db.rpc('bot_book', { p_phone: b.phone, p_name: b.name, p_date: b.date, p_time: b.time, p_barber: b.barber, p_service: b.service }); if (error) throw new Error(error.code === '23P01' ? 'Esse horário acabou de ser ocupado.' : error.message); return data; },
    async upcoming(phone: string) {
      const { data } = await db.from('bookings').select('id,phone,service_name,barber_name,starts_at').eq('status', 'confirmed').gte('starts_at', manausNow().slice(0, 19)).order('starts_at').limit(500);
      return (data ?? []).filter((r: any) => String(r.phone).replace(/\D/g, '') === phone).slice(0, 5);
    },
  },
});

async function lembretes(req: Request) {
  if (req.headers.get('Authorization') !== 'Bearer ' + env('CRON_SECRET') || !env('CRON_SECRET')) return reply({ error: 'não autorizado' }, 401);
  const cfg = await settings();
  if (!cfg.enabled || !cfg.reminders_enabled || !cfg.phone_number_id || !env('WHATSAPP_TOKEN')) return reply({ ok: true, enviados: 0, motivo: 'desligado' });
  const { data: rows, error } = await db.rpc('whatsapp_due_reminders', { p_limit: 20 });
  if (error) throw error;
  let sent = 0; const errors: string[] = [];
  for (const r of rows ?? []) {
    try {
      const id = await send(cfg, waPhone(r.phone), reminderPayload(r, cfg));
      await db.from('message_log').insert({ kind: 'reminder', booking_id: r.booking_id, phone: r.phone, channel: 'api', provider_id: id ?? null, created_by: null });
      sent++;
    } catch (e) { errors.push(r.customer + ': ' + (e as Error).message); }
    await sleep(300); // a API oficial não exige intervalo; isto só evita rajadas
  }
  const result = `${sent} lembrete(s) enviado(s)` + (errors.length ? ` · ${errors.length} erro(s): ${errors[0]}` : '');
  await db.from('whatsapp_settings').update({ last_run_at: new Date().toISOString(), last_result: result.slice(0, 500) }).eq('id', 1);
  return reply({ ok: true, enviados: sent, erros: errors });
}

Deno.serve(async req => {
  const url = new URL(req.url);
  try {
    if (url.pathname.endsWith('/lembretes') && req.method === 'POST') return await lembretes(req);
    if (req.method === 'GET') { // verificação do webhook
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && env('WHATSAPP_VERIFY_TOKEN') && url.searchParams.get('hub.verify_token') === env('WHATSAPP_VERIFY_TOKEN');
      return ok ? new Response(url.searchParams.get('hub.challenge') ?? '', { headers: { 'X-Content-Type-Options': 'nosniff' } }) : reply({ error: 'token inválido' }, 403);
    }
    if (req.method !== 'POST') return reply({ error: 'método não permitido' }, 405);
    const raw = await req.text();
    if (!(await validSignature(raw, req.headers.get('X-Hub-Signature-256')))) return reply({ error: 'assinatura inválida' }, 401);
    const cfg = await settings();
    if (!cfg.enabled || !cfg.bot_enabled || !cfg.phone_number_id) return reply({ ok: true, motivo: 'robô desligado' });
    const body = JSON.parse(raw);
    for (const entry of body.entry ?? []) for (const change of entry.changes ?? []) {
      const value = change.value ?? {}, names = new Map((value.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        if (!/^[0-9]{10,15}$/.test(localPhone(m.from))) continue;
        const replyId = m.interactive?.button_reply?.id || m.interactive?.list_reply?.id || m.button?.payload || null;
        // Erro numa conversa não derruba as outras; responder 200 evita a Meta reenviar e o cliente receber em dobro.
        try { await handleMessage({ waId: m.from, profileName: names.get(m.from) ?? null, text: m.text?.body ?? '', replyId }, deps(cfg, m.from)); }
        catch (e) { console.error('conversa', m.from.slice(-4), e); }
      }
    }
    return reply({ ok: true });
  } catch (e) {
    console.error(e);
    return reply({ error: 'erro interno' }, 500);
  }
});
