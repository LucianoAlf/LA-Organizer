'use strict';
// REMARCOU-E-NAO-TOCOU (30/09). "muda pra 20h" numa tarefa cujo lembrete JÁ disparou: o reschedule
// gravava o remind_at novo e deixava reminded_at preenchido — e o checkReminders só olha
// `reminded_at IS NULL`. O horário novo nunca tocava. Mesmo re-armado, o cooldown de 6h (aviso
// anterior de qualquer horário) ainda segurava o remarcado pra dentro de 6h.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fachada.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fachada';
process.env.UAZAPI_URL = process.env.UAZAPI_URL || 'http://fachada.local';
process.env.UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || 'fachada';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'fachada';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fachada';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// NENHUM WhatsApp sai daqui.
const dms = [];
const proactiveLink = require('../services/proactive-link');
proactiveLink.sendAndLink = async (_sb, args) => { dms.push(args); return { ok: true }; };
require('../services/whatsapp').sendMessage = async () => { throw new Error('teste tentou mandar WhatsApp'); };

const dispatcher = require('./dispatcher');
const { rearmaAoRemarcar, pisoDoCooldown } = require('../lib/rearma-lembrete');

function banco(inicial) {
  const T = { tasks: [], task_reminders: [], collaborators: [], notifications: [], conversation_history: [], ...inicial };
  function q(tabela) {
    const preds = [];
    let op = 'select', payload = null;
    const alvo = () => (T[tabela] || []).filter((r) => preds.every((p) => p(r)));
    const exec = () => {
      if (op === 'insert') { const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ ...r })); T[tabela].push(...rows); return { data: rows, error: null }; }
      if (op === 'update') { const rs = alvo(); rs.forEach((r) => Object.assign(r, payload)); return { data: rs, error: null }; }
      return { data: alvo().map((r) => ({ ...r })), error: null };
    };
    const b = {
      select() { return b; },
      eq(c, v) { preds.push((r) => r[c] === v); return b; },
      in(c, vs) { preds.push((r) => vs.includes(r[c])); return b; },
      is(c, v) { preds.push((r) => (r[c] ?? null) === v); return b; },
      not(c, o, v) {
        if (o === 'is' && v === null) preds.push((r) => r[c] != null);
        else if (o === 'in') { const vs = String(v).replace(/[()"]/g, '').split(','); preds.push((r) => !vs.includes(r[c])); }
        return b;
      },
      lte(c, v) { preds.push((r) => r[c] != null && new Date(r[c]) <= new Date(v)); return b; },
      like(c, pat) { const re = new RegExp('^' + pat.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 's'); preds.push((r) => re.test(String(r[c] || ''))); return b; },
      gte(c, v) { preds.push((r) => r[c] != null && new Date(r[c]) >= new Date(v)); return b; },
      order() { return b; }, limit() { return b; },
      insert(r) { op = 'insert'; payload = r; return b; },
      update(p) { op = 'update'; payload = p; return b; },
      maybeSingle() { const r = exec(); return Promise.resolve({ data: (r.data || [])[0] || null, error: null }); },
      then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
    };
    return b;
  }
  return { T, sb: { from: (t) => q(t) } };
}

const DONO = { id: 'c1', full_name: 'Dona Um', phone: 'tel-1', is_active: true };
const TAREFA = { id: 't1', title: 'Pagar boleto', description: null, assigned_to: 'c1', assigned_group_id: null, status: 'pending', context: 'work', due_date: '2026-09-29', created_by: 'c1', creator: null };
// NOTIFICATIONS-CALADA (30/09): o cooldown lê o ENVIO (conversation_history), não mais notifications.
const AVISO_12H = { collaborator_id: 'c1', direction: 'outbound', ref_type: 'task', ref_id: 't1', content: '🔔 *Lembrete:* Pagar boleto', created_at: '2026-09-29T15:00:20.000Z' };

test('rearmaAoRemarcar: futuro re-arma; passado não mexe (não reenvia lembrete velho)', () => {
  const now = new Date('2026-09-29T15:30:00Z');
  assert.deepStrictEqual(rearmaAoRemarcar('2026-09-29T20:00:00-03:00', now), { reminded_at: null });
  assert.deepStrictEqual(rearmaAoRemarcar('2026-09-29T09:00:00-03:00', now), {});
  assert.deepStrictEqual(rearmaAoRemarcar('lixo', now), {});
});

test('pisoDoCooldown: aviso do agendamento anterior não segura o horário remarcado', () => {
  assert.strictEqual(pisoDoCooldown('2026-09-29T11:00:00.000Z', '2026-09-29T17:00:00.000Z'), '2026-09-29T16:59:00.000Z');
  assert.strictEqual(pisoDoCooldown('2026-09-29T11:00:00.000Z', '2026-09-29T09:00:00.000Z'), '2026-09-29T11:00:00.000Z');
});

test('das 12h já disparou, "muda pra 14h": às 14h o lembrete TOCA', async () => {
  dms.length = 0;
  // estado do banco depois do reschedule novo: remind_at 14h, reminded_at re-armado (null)
  const re = rearmaAoRemarcar('2026-09-29T14:00:00-03:00', new Date('2026-09-29T15:30:00Z'));
  const { T, sb } = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-29T17:00:00.000Z', reminded_at: '2026-09-29T15:00:20.000Z', ...re }], collaborators: [{ ...DONO }], conversation_history: [{ ...AVISO_12H }] });
  await dispatcher.checkReminders(new Date('2026-09-29T17:00:30Z'), { supabase: sb });
  assert.strictEqual(dms.length, 1, 'o horário remarcado não tocou');
  assert.strictEqual(T.tasks[0].reminded_at, '2026-09-29T17:00:30.000Z');
});

test('re-armar no reschedule é o que segura o caso fora da janela de resgate (2h): quiet/DND/cron parado', async () => {
  // Sem re-armar (código antigo), passada a janela de 2h do resgate o remarcado fica preso pra sempre.
  dms.length = 0;
  const velho = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-29T17:00:00.000Z', reminded_at: '2026-09-29T15:00:20.000Z' }], collaborators: [{ ...DONO }] });
  await dispatcher.checkReminders(new Date('2026-09-29T19:30:00Z'), { supabase: velho.sb });
  assert.strictEqual(dms.length, 0);
  // Re-armado pelo reschedule, sai assim que a porta abre.
  const novo = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-29T17:00:00.000Z', reminded_at: null }], collaborators: [{ ...DONO }] });
  await dispatcher.checkReminders(new Date('2026-09-29T19:30:00Z'), { supabase: novo.sb });
  assert.strictEqual(dms.length, 1);
});

test('controle do cooldown (Carol 23/05): tarefa reaberta SEM horário novo não dispara 2x em 6h', async () => {
  dms.length = 0;
  const { sb } = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-29T15:00:00.000Z', reminded_at: null }], collaborators: [{ ...DONO }], conversation_history: [{ ...AVISO_12H }] });
  await dispatcher.checkReminders(new Date('2026-09-29T16:00:00Z'), { supabase: sb });
  assert.strictEqual(dms.length, 0);
});

test('carimbo do T-1 PESSOAL ("📌 amanhã está marcado", véspera 09h) não come o lembrete de hora do dia', async () => {
  dms.length = 0;
  const { T, sb } = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-29T17:00:00.000Z', reminded_at: '2026-09-28T12:00:30.000Z' }], collaborators: [{ ...DONO }] });
  await dispatcher.checkReminders(new Date('2026-09-29T17:00:30Z'), { supabase: sb });
  assert.strictEqual(dms.length, 1);
  assert.strictEqual(T.tasks[0].reminded_at, '2026-09-29T17:00:30.000Z');
  await dispatcher.checkReminders(new Date('2026-09-29T17:02:30Z'), { supabase: sb });
  assert.strictEqual(dms.length, 1, 'disparou duas vezes');
});

test('sem lembrete velho: carimbo anterior + horário vencido há mais de 2h não é despejado', async () => {
  dms.length = 0;
  const { sb } = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-29T12:00:00.000Z', reminded_at: '2026-09-28T12:00:30.000Z' }], collaborators: [{ ...DONO }] });
  await dispatcher.checkReminders(new Date('2026-09-29T17:00:30Z'), { supabase: sb });
  assert.strictEqual(dms.length, 0);
});

test('NOTIFICATIONS-CALADA: o insert recusado pelo CHECK (23514) depois do envio é logado, não calado', async () => {
  dms.length = 0;
  const { sb } = banco({ tasks: [{ ...TAREFA, remind_at: '2026-09-29T17:00:00.000Z', reminded_at: null }], collaborators: [{ ...DONO }] });
  const from0 = sb.from;
  sb.from = (t) => (t === 'notifications'
    ? { insert: async () => ({ data: null, error: { code: '23514', message: 'violates check constraint "notifications_notification_type_check"' } }) }
    : from0(t));
  const orig = console.error; const linhas = [];
  console.error = (...a) => linhas.push(a.join(' '));
  try { await dispatcher.checkReminders(new Date('2026-09-29T17:00:30Z'), { supabase: sb }); } finally { console.error = orig; }
  assert.strictEqual(dms.length, 1, 'o lembrete saiu');
  assert.ok(linhas.some((l) => /insert FALHOU tipo=task_reminder onde=checkReminders code=23514/.test(l)), linhas.join(' | '));
});

// Contrato da fiação no engine (applyTaskActions usa o supabase global).
const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: todo site que remarca remind_at passa pela regra única (nenhum zera às cegas)', () => {
  assert.strictEqual((ENGINE.match(/update\.reminded_at = null/g) || []).length, 0, 'sobrou re-arme incondicional');
  assert.strictEqual((ENGINE.match(/rearmaAoRemarcar\(/g) || []).length, 3, 'reschedule por marker + deslocamento + extensão');
  assert.match(ENGINE, /update\.remind_at = a\.new_remind_at;\s*\n(?:\s*\/\/.*\n)*\s*Object\.assign\(update, require\('\.\/lib\/rearma-lembrete'\)\.rearmaAoRemarcar\(update\.remind_at\)\);/);
});
