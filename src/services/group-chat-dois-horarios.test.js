'use strict';
// DOIS-HORARIOS-UM-LEMBRETE (Kailane, grupo Administrativo e Comercial Barra, 22/09 20:58 UTC).
// Pedido real: "tom, me lembra na semana que vem dia 29/09 terça feira às 09h e às 15h de lembrarmos
// de pedir para o Jairo pai do Jairinho de assinar uma cláusula do contrato."
// TOM: "Na terça (29/09) eu te aviso às *09h* e às *15h*…"; marker_logs: TASK_UPDATE ok=2 grupo
// (chips: criada + "atualizada"). Banco (tasks 6d3af71f): UM remind_at, 29/09 18:00Z = 15h. O 09h
// foi sobrescrito pelo dedup da 2ª create, e nenhuma linha em task_reminders.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fachada.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fachada';
process.env.UAZAPI_URL = process.env.UAZAPI_URL || 'http://fachada.local';
process.env.UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || 'fachada';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'fachada';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fachada';

const test = require('node:test');
const assert = require('node:assert');
const { applyGroupChatTaskActions } = require('./group-chat-tasks');
const { horariosDoChip } = require('../lib/horarios-do-chip');

// Banco em memória que APLICA os filtros (o defeito é de escrita: o teste precisa ver o que ficou).
function banco(inicial = {}) {
  const T = { tasks: [], task_reminders: [], group_chat_messages: [], work_groups: [], work_group_members: [], ...inicial };
  let seq = 0;
  function q(tabela) {
    const preds = [];
    let op = 'select', payload = null;
    const alvo = () => (T[tabela] || []).filter((r) => preds.every((p) => p(r)));
    const exec = () => {
      if (op === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `${tabela}-${++seq}`, created_at: new Date().toISOString(), ...r }));
        (T[tabela] = T[tabela] || []).push(...rows);
        return { data: rows, error: null };
      }
      if (op === 'update') { const rs = alvo(); rs.forEach((r) => Object.assign(r, payload)); return { data: rs, error: null }; }
      return { data: alvo(), error: null };
    };
    const b = {
      select() { return b; }, order() { return b; }, limit() { return b; }, or() { return b; },
      eq(c, v) { preds.push((r) => r[c] === v); return b; },
      neq(c, v) { preds.push((r) => r[c] !== v); return b; },
      in(c, vs) { preds.push((r) => vs.includes(r[c])); return b; },
      is(c, v) { preds.push((r) => (r[c] ?? null) === v); return b; },
      not(c, o, v) { if (o === 'is' && v === null) preds.push((r) => r[c] != null); return b; },
      gte(c, v) { if (/_at$/.test(c) && c !== 'created_at') preds.push((r) => r[c] != null && new Date(r[c]) >= new Date(v)); return b; },
      lte(c, v) { preds.push((r) => r[c] != null && new Date(r[c]) <= new Date(v)); return b; },
      ilike(c, v) { const p = String(v).toLowerCase(); const re = new RegExp('^' + p.split('%').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'); preds.push((r) => re.test(String(r[c] || '').toLowerCase())); return b; },
      insert(r) { op = 'insert'; payload = r; return b; },
      update(p) { op = 'update'; payload = p; return b; },
      maybeSingle() { const r = exec(); return Promise.resolve({ data: (r.data || [])[0] || null, error: null }); },
      single() { return b.maybeSingle(); },
      then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
    };
    return b;
  }
  return { T, sb: { from: (t) => q(t) } };
}

const BARRA = '5489691c-24e5-4eda-9232-c049a3aaf2db';
const KAILANE = 'aebb3c03-1fda-4c4e-9db0-bcfd7badf745';
const TITULO = 'Lembrar Jairo (pai do Jairinho) de assinar cláusula do contrato — pasta amarela';
const H09 = '2026-09-29T09:00:00-03:00';
const H15 = '2026-09-29T15:00:00-03:00';

test('turno real (duas creates, 09h e 15h): UMA tarefa, os DOIS horários gravados', async () => {
  const { T, sb } = banco();
  const r = await applyGroupChatTaskActions({ supabase: sb, groupId: BARRA, senderCollabId: KAILANE, actions: [
    { action: 'create', title: TITULO, due_date: '2026-09-29', remind_at: H09 },
    { action: 'create', title: TITULO, due_date: '2026-09-29', remind_at: H15 },
  ] });
  assert.strictEqual(T.tasks.length, 1);
  assert.strictEqual(T.tasks[0].remind_at, '2026-09-29T12:00:00.000Z', 'o 09h foi sobrescrito');
  assert.deepStrictEqual(T.task_reminders.map((x) => [x.task_id, x.remind_at]), [[T.tasks[0].id, '2026-09-29T18:00:00.000Z']]);
  assert.deepStrictEqual(r.updated[0].changed.lembretes, ['2026-09-29T12:00:00.000Z', '2026-09-29T18:00:00.000Z']);
  assert.strictEqual(horariosDoChip(r.updated[0].changed.lembretes), '🔔 29/09 09h e 15h');
});

test('forma ensinada no prompt (UMA create com reminders_at): mesmo resultado', async () => {
  const { T, sb } = banco();
  const r = await applyGroupChatTaskActions({ supabase: sb, groupId: BARRA, senderCollabId: KAILANE, actions: [
    { action: 'create', title: TITULO, due_date: '2026-09-29', reminders_at: [H15, H09] },
  ] });
  assert.strictEqual(T.tasks.length, 1);
  assert.strictEqual(T.tasks[0].remind_at, '2026-09-29T12:00:00.000Z');
  assert.deepStrictEqual(T.task_reminders.map((x) => x.remind_at), ['2026-09-29T18:00:00.000Z']);
  assert.deepStrictEqual(r.created[0].lembretes, ['2026-09-29T12:00:00.000Z', '2026-09-29T18:00:00.000Z']);
});

test('create + reschedule só-de-horário no MESMO pedido soma o 2º lembrete (não move o 1º)', async () => {
  const { T, sb } = banco();
  await applyGroupChatTaskActions({ supabase: sb, groupId: BARRA, senderCollabId: KAILANE, actions: [
    { action: 'create', title: TITULO, due_date: '2026-09-29', remind_at: H09 },
    { action: 'reschedule', title: TITULO, new_remind_at: H15 },
  ] });
  assert.strictEqual(T.tasks[0].remind_at, '2026-09-29T12:00:00.000Z');
  assert.deepStrictEqual(T.task_reminders.map((x) => x.remind_at), ['2026-09-29T18:00:00.000Z']);
});

test('teto: 4 horários → 3 gravados e o 4º volta como recusado (nunca some calado)', async () => {
  const { T, sb } = banco();
  const r = await applyGroupChatTaskActions({ supabase: sb, groupId: BARRA, senderCollabId: KAILANE, actions: [
    { action: 'create', title: TITULO, due_date: '2026-09-29', reminders_at: [H09, '2026-09-29T11:00:00-03:00', H15, '2026-09-29T17:00:00-03:00'] },
  ] });
  assert.strictEqual(T.task_reminders.length, 2);
  assert.strictEqual(r.created[0].lembretes.length, 3);
  assert.strictEqual(r.created[0].lembretesRecusados, 1);
});

test('controle: correção em OUTRA mensagem (tarefa já existia) continua sobrescrevendo — caso Rose 12/06', async () => {
  const { T, sb } = banco({ tasks: [{ id: 't-velha', title: TITULO, assigned_group_id: BARRA, status: 'pending', due_date: '2026-09-29', remind_at: '2026-09-29T12:00:00.000Z', created_at: new Date().toISOString() }] });
  await applyGroupChatTaskActions({ supabase: sb, groupId: BARRA, senderCollabId: KAILANE, actions: [
    { action: 'create', title: TITULO, due_date: '2026-09-29', remind_at: H15 },
  ] });
  assert.strictEqual(T.tasks.length, 1);
  assert.strictEqual(T.tasks[0].remind_at, '2026-09-29T18:00:00.000Z');
  assert.strictEqual(T.task_reminders.length, 0);
});

test('controle: um horário só → sem linha em task_reminders e chip de sempre', async () => {
  const { T, sb } = banco();
  const r = await applyGroupChatTaskActions({ supabase: sb, groupId: BARRA, senderCollabId: KAILANE, actions: [
    { action: 'create', title: TITULO, due_date: '2026-09-29', remind_at: H09 },
  ] });
  assert.strictEqual(T.task_reminders.length, 0);
  assert.strictEqual(r.created[0].lembretes, undefined);
});

// ── DISPATCHER: cada horário sai na sua hora ──────────────────────────────────
test('dispatcher: o das 09h sai às 09h (remind_at da tarefa) e o das 15h sai às 15h (task_reminders), uma vez cada', async () => {
  const dispatcher = require('../rituals/dispatcher');
  const { T, sb } = banco({ work_groups: [{ id: BARRA, name: 'Administrativo e Comercial Barra', wa_group_jid: 'grupo@g.us' }] });
  await applyGroupChatTaskActions({ supabase: sb, groupId: BARRA, senderCollabId: KAILANE, actions: [
    { action: 'create', title: TITULO, due_date: '2026-09-29', remind_at: H09 },
    { action: 'create', title: TITULO, due_date: '2026-09-29', remind_at: H15 },
  ] });
  const tarefa = T.tasks[0];
  Object.assign(tarefa, { description: null, assigned_to: null, context: 'work', reminded_at: null, creator: null, parent_task_id: null, due_time: null });
  // o dublê embute a tarefa na linha de task_reminders, como o select `tasks(...)` do PostgREST
  T.task_reminders.forEach((x) => { x.sent_at = null; x.label = null; x.created_at = '2026-09-22T20:58:51Z'; x.tasks = tarefa; });

  // 09:00:30 BRT — o das 15h NÃO sai; o das 09h sai pelo checkReminders (tarefa de grupo)
  await dispatcher.checkTaskReminders({ supabase: sb, now: new Date('2026-09-29T12:00:30Z') });
  assert.strictEqual(T.group_chat_messages.length, 0, 'o das 15h saiu adiantado');
  assert.strictEqual(T.task_reminders[0].sent_at, null);
  await dispatcher.checkReminders(new Date('2026-09-29T12:00:30Z'), { supabase: sb });
  assert.ok(tarefa.reminded_at, 'o das 09h não saiu');

  // 15:00:30 BRT — o das 15h sai UMA vez, no grupo
  await dispatcher.checkTaskReminders({ supabase: sb, now: new Date('2026-09-29T18:00:30Z') });
  assert.strictEqual(T.group_chat_messages.length, 1);
  assert.ok(T.group_chat_messages[0].content.includes('Jairo'));
  assert.ok(T.task_reminders[0].sent_at);
  await dispatcher.checkTaskReminders({ supabase: sb, now: new Date('2026-09-29T18:05:00Z') });
  assert.strictEqual(T.group_chat_messages.length, 1, 'o das 15h saiu duas vezes');
});
