'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  resolveProjectByName, canChangeStatus, summarizeOpenWork,
  buildStatusConfirm, buildStatusResult, STATUS_BY_ACTION,
} = require('./project-status');

const PROJS = [
  { id: 'p1', name: 'Marketing', status: 'active', created_by: 'u1' },
  { id: 'p2', name: 'Marketing Digital', status: 'planning', created_by: 'u2' },
  { id: 'p3', name: 'Folha de Pagamento', status: 'paused', created_by: 'u1' },
];

test('resolve: nome exato → match único mesmo com prefixo de outro', () => {
  assert.deepStrictEqual(resolveProjectByName(PROJS, 'Marketing', null),
    { status: 'match', project: PROJS[0] });
});

test('resolve: nome parcial que casa 1 → match', () => {
  assert.deepStrictEqual(resolveProjectByName(PROJS, 'folha', null),
    { status: 'match', project: PROJS[2] });
});

test('resolve: parcial ambíguo → ambiguous com candidatos', () => {
  const r = resolveProjectByName(PROJS, 'market', null);
  assert.strictEqual(r.status, 'ambiguous');
  assert.deepStrictEqual(r.candidates, [{ id: 'p1', name: 'Marketing' }, { id: 'p2', name: 'Marketing Digital' }]);
});

test('resolve: nome inexistente → none', () => {
  assert.deepStrictEqual(resolveProjectByName(PROJS, 'Inventário', null), { status: 'none' });
});

test('resolve por quote (sem nameHint): quote cita 1 projeto vivo → match', () => {
  const quote = '✅ Tarefas feitas: • *Folha de Pagamento* — concluídas 🎉';
  assert.deepStrictEqual(resolveProjectByName(PROJS, null, quote),
    { status: 'match', project: PROJS[2] });
});

test('resolve por quote: quote cita 2 projetos → ambiguous', () => {
  const quote = '• *Marketing* • *Folha de Pagamento*';
  assert.strictEqual(resolveProjectByName(PROJS, null, quote).status, 'ambiguous');
});

test('resolve: sem hint e sem quote → none', () => {
  assert.deepStrictEqual(resolveProjectByName(PROJS, null, null), { status: 'none' });
});

test('resolve: lista vazia → none', () => {
  assert.deepStrictEqual(resolveProjectByName([], 'Marketing', null), { status: 'none' });
});

test('autoridade: criador pode', () => {
  assert.strictEqual(canChangeStatus({ id: 'u1' }, PROJS[0], []), true);
});

test('autoridade: líder do criador pode', () => {
  assert.strictEqual(canChangeStatus({ id: 'boss' }, PROJS[0], ['boss']), true);
});

test('autoridade: estranho não pode', () => {
  assert.strictEqual(canChangeStatus({ id: 'rando' }, PROJS[0], ['boss']), false);
});

test('summarize: agrupa abertas por pessoa, ignora done/cancelled, ordena desc', () => {
  const tasks = [
    { status: 'pending', assignee_name: 'Ana' },
    { status: 'in_progress', assignee_name: 'Ana' },
    { status: 'done', assignee_name: 'Ana' },
    { status: 'pending', assignee_name: 'Beto' },
    { status: 'cancelled', assignee_name: 'Caio' },
  ];
  assert.deepStrictEqual(summarizeOpenWork(tasks),
    { total: 3, byPerson: [{ name: 'Ana', count: 2 }, { name: 'Beto', count: 1 }] });
});

test('summarize: vazio → total 0', () => {
  assert.deepStrictEqual(summarizeOpenWork([]), { total: 0, byPerson: [] });
});

test('confirm complete sem abertas → 🎉, sem ⚠️', () => {
  assert.strictEqual(buildStatusConfirm(PROJS[0], 'complete', { total: 0, byPerson: [] }),
    'Fecho o projeto *Marketing*? 🎉');
});

test('confirm cancel sem abertas → sem 🎉', () => {
  assert.strictEqual(buildStatusConfirm(PROJS[0], 'cancel', { total: 0, byPerson: [] }),
    'Cancelo o projeto *Marketing*?');
});

test('confirm com abertas → ⚠️ + contagem + pessoas antes da pergunta', () => {
  const s = { total: 3, byPerson: [{ name: 'Ana', count: 2 }, { name: 'Beto', count: 1 }] };
  assert.strictEqual(buildStatusConfirm(PROJS[0], 'complete', s),
    '⚠️ Ainda tem 3 tarefas abertas (Ana, Beto).\n\nFecho o projeto *Marketing*?');
});

test('confirm com 1 aberta → singular', () => {
  const s = { total: 1, byPerson: [{ name: 'Ana', count: 1 }] };
  assert.match(buildStatusConfirm(PROJS[0], 'complete', s), /1 tarefa aberta \(Ana\)/);
});

test('result complete sem abertas', () => {
  assert.strictEqual(buildStatusResult(PROJS[0], 'complete', { total: 0, byPerson: [] }),
    '✅ Projeto *Marketing* concluído!');
});

test('result cancel com abertas → nota honesta', () => {
  const s = { total: 2, byPerson: [{ name: 'Ana', count: 2 }] };
  assert.strictEqual(buildStatusResult(PROJS[0], 'cancel', s),
    'Projeto *Marketing* cancelado.\n\n_Deixei as 2 tarefas abertas como estavam._');
});

test('STATUS_BY_ACTION', () => {
  assert.strictEqual(STATUS_BY_ACTION.complete, 'completed');
  assert.strictEqual(STATUS_BY_ACTION.cancel, 'cancelled');
});
