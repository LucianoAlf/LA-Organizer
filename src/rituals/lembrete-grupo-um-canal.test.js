'use strict';
// UM-CANAL-POR-TAREFA-DE-GRUPO (decisão do Alf, 30/09).
// Tarefa de grupo com dois horários (Kailane, Barra: "dia 29/09 às 09h e às 15h"): o 1º horário
// fica em tasks.remind_at e sai pelo checkReminders; o 2º fica em task_reminders e sai pelo
// checkTaskReminders. Antes: 09h = DM pra CADA membro, 15h = post no grupo. Agora: grupo vinculado
// → exatamente um post no grupo por horário, zero DM. Tarefa pessoal: nada muda.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fachada.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fachada';
process.env.UAZAPI_URL = process.env.UAZAPI_URL || 'http://fachada.local';
process.env.UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || 'fachada';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'fachada';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fachada';

const test = require('node:test');
const assert = require('node:assert');

// NENHUM WhatsApp sai deste teste: os dois primitivos de envio viram gravadores ANTES do dispatcher.
const dms = [];
const proactiveLink = require('../services/proactive-link');
proactiveLink.sendAndLink = async (_sb, args) => { dms.push(args); return { ok: true }; };
const whatsapp = require('../services/whatsapp');
whatsapp.sendMessage = async () => { throw new Error('teste tentou mandar WhatsApp de verdade'); };

const dispatcher = require('./dispatcher');
const { horarioCobertoPorLinha } = require('./group-task-reminder');

// Banco em memória que APLICA os filtros; task_reminders.select com `tasks(` faz o join.
function banco(inicial) {
  const T = { tasks: [], task_reminders: [], work_groups: [], work_group_members: [], collaborators: [], group_chat_messages: [], notifications: [], ...inicial };
  function q(tabela) {
    const preds = [];
    let op = 'select', payload = null, cols = '';
    const alvo = () => (T[tabela] || []).filter((r) => preds.every((p) => p(r)));
    const exec = () => {
      if (op === 'insert') { const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ ...r })); T[tabela].push(...rows); return { data: rows, error: null }; }
      if (op === 'update') { const rs = alvo(); rs.forEach((r) => Object.assign(r, payload)); return { data: rs, error: null }; }
      let rs = alvo().map((r) => ({ ...r }));
      if (tabela === 'task_reminders' && /tasks\(/.test(cols)) rs = rs.map((r) => ({ ...r, tasks: T.tasks.find((t) => t.id === r.task_id) || null }));
      if (tabela === 'work_group_members' && /collaborator:/.test(cols)) rs = rs.map((m) => ({ ...m, collaborator: T.collaborators.find((c) => c.id === m.collaborator_id) }));
      return { data: rs, error: null };
    };
    const b = {
      select(c) { cols = String(c || ''); return b; },
      eq(c, v) { preds.push((r) => r[c] === v); return b; },
      in(c, vs) { preds.push((r) => vs.includes(r[c])); return b; },
      is(c, v) { preds.push((r) => (r[c] ?? null) === v); return b; },
      not(c, o, v) {
        if (o === 'is' && v === null) preds.push((r) => r[c] != null);
        else if (o === 'in') { const vs = String(v).replace(/[()"]/g, '').split(','); preds.push((r) => !vs.includes(r[c])); }
        return b;
      },
      lte(c, v) { preds.push((r) => r[c] != null && new Date(r[c]) <= new Date(v)); return b; },
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

const BARRA = '5489691c-24e5-4eda-9232-c049a3aaf2db';
const TAREFA = {
  id: '6d3af71f-e665-4233-86b5-66d865e0646e',
  title: 'Lembrar Jairo (pai do Jairinho) de assinar cláusula do contrato — pasta amarela',
  description: null, assigned_to: null, assigned_group_id: BARRA, parent_task_id: null,
  remind_at: '2026-09-29T12:00:00.000Z', reminded_at: null, status: 'pending', context: 'work',
  due_date: '2026-09-29', due_time: null, created_by: 'k', creator: null,
};
const MEMBROS = [
  { id: 'c1', full_name: 'Membro Um', phone: 'tel-1', is_active: true },
  { id: 'c2', full_name: 'Membro Dois', phone: 'tel-2', is_active: true },
  { id: 'c3', full_name: 'Membro Tres', phone: 'tel-3', is_active: true },
];
function cenario({ vinculado = true, linhas = [{ id: 'r15', task_id: TAREFA.id, remind_at: '2026-09-29T18:00:00.000Z', label: null, sent_at: null, created_at: '2026-09-22T21:00:00Z' }] } = {}) {
  return banco({
    tasks: [{ ...TAREFA }],
    task_reminders: linhas.map((l) => ({ ...l })),
    work_groups: [{ id: BARRA, name: 'Administrativo e Comercial Barra', wa_group_jid: vinculado ? 'grupo@g.us' : null }],
    work_group_members: MEMBROS.map((m) => ({ group_id: BARRA, collaborator_id: m.id })),
    collaborators: MEMBROS.map((m) => ({ ...m })),
  });
}
async function rodaNoHorario(sb, iso) {
  const now = new Date(iso);
  await dispatcher.checkReminders(now, { supabase: sb });
  await dispatcher.checkTaskReminders({ supabase: sb, now });
}

test('grupo vinculado, 09h (remind_at) + 15h (task_reminders): exatamente 2 posts no grupo e 0 DM', async () => {
  dms.length = 0;
  const { T, sb } = cenario();
  await rodaNoHorario(sb, '2026-09-29T12:00:30Z');
  await rodaNoHorario(sb, '2026-09-29T12:02:30Z'); // tick seguinte não repete
  await rodaNoHorario(sb, '2026-09-29T18:00:30Z');
  await rodaNoHorario(sb, '2026-09-29T18:02:30Z');
  assert.strictEqual(dms.length, 0, `membros receberam DM: ${dms.length}`);
  assert.strictEqual(T.group_chat_messages.length, 2);
  assert.ok(T.group_chat_messages.every((m) => m.group_id === BARRA && m.role === 'tom' && m.sender_id === null));
  assert.ok(T.group_chat_messages.every((m) => m.content.includes(TAREFA.title)));
});

test('grupo vinculado com o horário ESPELHADO (create 1:1 grava remind_at E a linha): 1 post, não 2', async () => {
  dms.length = 0;
  const { T, sb } = cenario({ linhas: [{ id: 'r09', task_id: TAREFA.id, remind_at: '2026-09-29T12:00:00+00:00', label: null, sent_at: null, created_at: '2026-09-22T21:00:00Z' }] });
  await rodaNoHorario(sb, '2026-09-29T12:00:30Z');
  await rodaNoHorario(sb, '2026-09-29T12:02:30Z');
  assert.strictEqual(T.group_chat_messages.length, 1);
  assert.strictEqual(dms.length, 0);
});

test('ZERO-REGRESSÃO: grupo SEM vínculo segue no fan-out por DM, uma rodada por horário', async () => {
  dms.length = 0;
  const { T, sb } = cenario({ vinculado: false });
  await rodaNoHorario(sb, '2026-09-29T12:00:30Z');
  const nas09 = dms.map((d) => d.content);
  await rodaNoHorario(sb, '2026-09-29T18:00:30Z');
  assert.strictEqual(T.group_chat_messages.length, 0);
  assert.strictEqual(dms.length, 6, '3 membros × 2 horários');
  assert.ok(nas09.every((c) => c.startsWith('🔔 *Lembrete (grupo):* ')), 'o texto de sempre do 1º horário');
});

test('tarefa PESSOAL não muda: 1 DM pro dono, nada no grupo', async () => {
  dms.length = 0;
  const { T, sb } = banco({
    tasks: [{ ...TAREFA, assigned_group_id: null, assigned_to: 'c1', title: 'Pagar boleto', context: 'work' }],
    collaborators: MEMBROS.map((m) => ({ ...m })),
  });
  await dispatcher.checkReminders(new Date('2026-09-29T12:00:30Z'), { supabase: sb });
  assert.strictEqual(dms.length, 1);
  assert.strictEqual(dms[0].collaboratorId, 'c1');
  assert.strictEqual(dms[0].content, '🔔 *Lembrete:* Pagar boleto');
  assert.strictEqual(T.group_chat_messages.length, 0);
});

test('SOMAR-HORARIO-1A1: one-shot sem prazo com horário a mais pendente NÃO se conclui no 1º', async () => {
  dms.length = 0;
  const { T, sb } = banco({
    tasks: [{ ...TAREFA, assigned_group_id: null, assigned_to: 'c1', title: 'Tomar remédio', due_date: null }],
    task_reminders: [{ id: 'r20', task_id: TAREFA.id, remind_at: '2026-09-29T23:00:00Z', label: null, sent_at: null, created_at: '2026-09-29T11:00:00Z' }],
    collaborators: MEMBROS.map((m) => ({ ...m })),
  });
  await dispatcher.checkReminders(new Date('2026-09-29T12:00:30Z'), { supabase: sb });
  assert.strictEqual(dms.length, 1);
  assert.strictEqual(T.tasks[0].status, 'pending', 'concluiu às 12h e o 20h seria pulado');
  // controle: sem linha pendente, o one-shot segue se concluindo como sempre
  const b2 = banco({ tasks: [{ ...TAREFA, assigned_group_id: null, assigned_to: 'c1', title: 'Tomar remédio', due_date: null }], collaborators: MEMBROS.map((m) => ({ ...m })) });
  await dispatcher.checkReminders(new Date('2026-09-29T12:00:30Z'), { supabase: b2.sb });
  assert.strictEqual(b2.T.tasks[0].status, 'done');
});

test('horarioCobertoPorLinha: mesmo instante (±1 min) cobre; outro horário não', () => {
  assert.strictEqual(horarioCobertoPorLinha('2026-09-29T12:00:00Z', [{ remind_at: '2026-09-29T09:00:00-03:00' }]), true);
  assert.strictEqual(horarioCobertoPorLinha('2026-09-29T12:00:00Z', [{ remind_at: '2026-09-29T18:00:00Z' }]), false);
  assert.strictEqual(horarioCobertoPorLinha('2026-09-29T12:00:00Z', []), false);
  assert.strictEqual(horarioCobertoPorLinha(null, [{ remind_at: '2026-09-29T12:00:00Z' }]), false);
});
