'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { dedupRecurringSeries } = require('./recurring-dedup');

// Helpers de fixture
const inst = (id, parent, due, extra = {}) => ({ id, recurrence_parent_id: parent, recurrence_rule: null, due_date: due, title: `t-${id}`, ...extra });
const tmpl = (id, due, extra = {}) => ({ id, recurrence_parent_id: null, recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', due_date: due, title: `tmpl-${id}`, ...extra });
const plain = (id, due) => ({ id, recurrence_parent_id: null, recurrence_rule: null, due_date: due, title: `p-${id}` });

test('colapsa instâncias da mesma série numa só (mantém a primeira na ordem recebida)', () => {
  const out = dedupRecurringSeries([
    inst('a', 'S1', '2026-06-19'),
    inst('b', 'S1', '2026-06-22'),
    inst('c', 'S1', '2026-06-23'),
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'a');
});

test('remove o molde (template) e mantém uma instância', () => {
  const out = dedupRecurringSeries([
    tmpl('TPL', '2026-06-12'),
    inst('a', 'TPL', '2026-06-19'),
    inst('b', 'TPL', '2026-06-22'),
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'a');
});

test('tarefas não-recorrentes passam intactas e na ordem', () => {
  const out = dedupRecurringSeries([plain('x', '2026-06-19'), plain('y', '2026-06-20')]);
  assert.deepStrictEqual(out.map((t) => t.id), ['x', 'y']);
});

test('múltiplas séries intercaladas → uma por série, ordem preservada', () => {
  const out = dedupRecurringSeries([
    inst('a1', 'S1', '2026-06-19'),
    plain('p1', '2026-06-19'),
    inst('b1', 'S2', '2026-06-19'),
    inst('a2', 'S1', '2026-06-22'),
    inst('b2', 'S2', '2026-06-23'),
  ]);
  assert.deepStrictEqual(out.map((t) => t.id), ['a1', 'p1', 'b1']);
});

test('array vazio → vazio', () => {
  assert.deepStrictEqual(dedupRecurringSeries([]), []);
});

test('entradas null/undefined são puladas; não-array → []', () => {
  assert.deepStrictEqual(dedupRecurringSeries([null, plain('z', '2026-06-19'), undefined]).map((t) => t.id), ['z']);
  assert.deepStrictEqual(dedupRecurringSeries(null), []);
  assert.deepStrictEqual(dedupRecurringSeries(undefined), []);
});
