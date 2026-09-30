'use strict';
// GROUP-REMINDAT-COMIDO-PELO-T1 (Kailane 22/09 → 29/09, grupo Administrativo e Comercial Barra).
//
// Ela pediu no grupo: "me lembra dia 29/09 às 09h e às 15h de pedir pro Jairo assinar a cláusula".
// A tarefa de grupo nasceu com remind_at = 29/09 15:00 BRT. Em 28/09 09:00 o aviso T-1
// (`remindGroupTasks`, "vence amanhã") mandou a mensagem e gravou `reminded_at` — e `reminded_at`
// é a MESMA coluna que `checkReminders` usa como trava de "já disparou" (`.is('reminded_at', null)`).
// Resultado: o lembrete explícito das 15h de 29/09 nunca saiu. Às 16:21 ela cobrou no grupo.
//
// Medido em 30/09: das 20 tarefas de grupo com remind_at, 15 tiveram reminded_at gravado ANTES do
// remind_at (14 às 09:00 do dia anterior). O ramo de grupo do checkReminders nasceu em 02/09
// (GROUP-REMINDAT-IGNORADO) e nunca alcançou tarefa com prazo a partir de amanhã.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fachada.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fachada';
process.env.UAZAPI_URL = process.env.UAZAPI_URL || 'http://fachada.local';
process.env.UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || 'fachada';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'fachada';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fachada';

const test = require('node:test');
const assert = require('node:assert');
const dispatcher = require('./dispatcher');

// Dublê que APLICA os filtros sobre linhas em memória (não só os registra): o defeito é de
// seleção, então o teste tem que responder "a linha é selecionada?".
function sbFake(tasks) {
  const updates = [];
  function consultaTasks() {
    const preds = [];
    const q = {
      select() { return q; },
      not(col, op, val) {
        if (op === 'is' && val === null) preds.push((r) => r[col] !== null && r[col] !== undefined);
        else if (op === 'in') { const vs = String(val).replace(/[()"]/g, '').split(','); preds.push((r) => !vs.includes(r[col])); }
        return q;
      },
      is(col, val) { preds.push((r) => (r[col] ?? null) === val); return q; },
      lte(col, val) { preds.push((r) => r[col] !== null && new Date(r[col]) <= new Date(val)); return q; },
      gte(col, val) { preds.push((r) => r[col] !== null && new Date(r[col]) >= new Date(val)); return q; },
      in(col, vals) { preds.push((r) => vals.includes(r[col])); return q; },
      eq(col, val) { preds.push((r) => r[col] === val); return q; },
      limit() { return Promise.resolve({ data: tasks.filter((r) => preds.every((p) => p(r))), error: null }); },
      update(patch) { return { eq: async (col, val) => { updates.push({ [col]: val, ...patch }); return { error: null }; } }; },
    };
    return q;
  }
  // eq() devolve algo "thenable" com maybeSingle: o ramo de grupo agora lê work_groups (destino do
  // lembrete — UM-CANAL-POR-TAREFA-DE-GRUPO, 30/09) e task_reminders (horário já coberto por linha).
  const nada = () => ({ then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej), maybeSingle: async () => ({ data: null, error: null }) });
  const vazio = { select() { return vazio; }, eq: nada, in() { return Promise.resolve({ data: [], error: null }); } };
  return { updates, sb: { from(t) { return t === 'tasks' ? consultaTasks() : vazio; } } };
}

// Linha real (tasks 6d3af71f, lida em 30/09).
const JAIRO = {
  id: '6d3af71f-e665-4233-86b5-66d865e0646e',
  title: 'Lembrar Jairo (pai do Jairinho) de assinar cláusula do contrato — pasta amarela',
  description: null, assigned_to: null, assigned_group_id: '5489691c-24e5-4eda-9232-c049a3aaf2db',
  remind_at: '2026-09-29T18:00:00+00:00', reminded_at: '2026-09-28T12:00:51.59+00:00',
  status: 'pending', context: 'work', due_date: '2026-09-29', created_by: 'aebb3c03-1fda-4c4e-9db0-bcfd7badf745', creator: null,
};

test('lembrete de hora marcada em tarefa de grupo dispara mesmo depois do aviso T-1', async () => {
  const f = sbFake([{ ...JAIRO }]);
  await dispatcher.checkReminders(new Date('2026-09-29T18:00:30Z'), { supabase: f.sb });
  assert.ok(f.updates.some((u) => u.id === JAIRO.id && u.reminded_at === '2026-09-29T18:00:30.000Z'),
    'o T-1 de 28/09 consumiu o lembrete das 15h de 29/09');
});

test('controle: depois de disparar na hora, não dispara de novo', async () => {
  const f = sbFake([{ ...JAIRO, reminded_at: '2026-09-29T18:00:30.000Z' }]);
  await dispatcher.checkReminders(new Date('2026-09-29T18:05:00Z'), { supabase: f.sb });
  assert.deepStrictEqual(f.updates, []);
});

test('controle: remind_at vencido há mais de 2h não é despejado atrasado', async () => {
  const f = sbFake([{ ...JAIRO }]);
  await dispatcher.checkReminders(new Date('2026-09-30T11:00:00Z'), { supabase: f.sb });
  assert.deepStrictEqual(f.updates, []);
});

// REMARCOU-E-NAO-TOCOU (30/09): o resgate passou a valer pra tarefa INDIVIDUAL também — o T-1
// pessoal e a remarcação pelo PWA carimbavam reminded_at ANTES do horário (replay 60d: 28 presas).
// A trava que importa é "já disparou NESTE horário" (reminded_at >= remind_at), abaixo.
test('controle: tarefa INDIVIDUAL que já disparou NESTE horário não re-dispara', async () => {
  const f = sbFake([{ ...JAIRO, assigned_group_id: null, assigned_to: 'x', reminded_at: '2026-09-29T18:00:20.000Z' }]);
  await dispatcher.checkReminders(new Date('2026-09-29T18:05:00Z'), { supabase: f.sb });
  assert.deepStrictEqual(f.updates, []);
});

test('controle do dublê: sem T-1 (reminded_at nulo) o caminho de 02/09 já disparava', async () => {
  const f = sbFake([{ ...JAIRO, reminded_at: null }]);
  await dispatcher.checkReminders(new Date('2026-09-29T18:00:30Z'), { supabase: f.sb });
  assert.ok(f.updates.some((u) => u.id === JAIRO.id));
});
