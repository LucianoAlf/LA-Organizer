const test = require('node:test');
const assert = require('node:assert');
const { summarizeUncoveredGroups, daysLate } = require('./uncovered-groups');

test('daysLate básico', () => {
  assert.equal(daysLate('2026-06-18', '2026-06-22'), 4);
  assert.equal(daysLate('2026-06-22', '2026-06-22'), 0); // hoje não é atraso
  assert.equal(daysLate('2026-06-25', '2026-06-22'), 0); // futuro
});

test('grupo sem cobertura com atrasada real (>=2d) é flagrado', () => {
  const r = summarizeUncoveredGroups({
    groups: [{ id: 'g1', name: 'MKT' }],
    coveredGroupIds: new Set(),
    tasksByGroup: new Map([['g1', [{ due_date: '2026-06-18' }, { due_date: '2026-06-19' }]]]),
    today: '2026-06-22',
  });
  assert.equal(r.count, 1);
  assert.deepEqual(r.groups, [{ name: 'MKT', overdue: 2 }]);
});

test('grupo coberto (preset overdue ligado) NÃO é flagrado', () => {
  const r = summarizeUncoveredGroups({
    groups: [{ id: 'g1', name: 'Financeiro' }],
    coveredGroupIds: new Set(['g1']),
    tasksByGroup: new Map([['g1', [{ due_date: '2026-06-18' }]]]),
    today: '2026-06-22',
  });
  assert.equal(r.count, 0);
});

test('atraso < 2d NÃO conta', () => {
  const r = summarizeUncoveredGroups({
    groups: [{ id: 'g1', name: 'X' }],
    coveredGroupIds: new Set(),
    tasksByGroup: new Map([['g1', [{ due_date: '2026-06-21' }]]]),
    today: '2026-06-22',
  });
  assert.equal(r.count, 0);
});

test('grupo sem tarefa NÃO é flagrado', () => {
  const r = summarizeUncoveredGroups({
    groups: [{ id: 'g1', name: 'Vazio' }],
    coveredGroupIds: new Set(),
    tasksByGroup: new Map(),
    today: '2026-06-22',
  });
  assert.equal(r.count, 0);
});

test('ordena desc por nº de atrasadas', () => {
  const r = summarizeUncoveredGroups({
    groups: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    coveredGroupIds: new Set(),
    tasksByGroup: new Map([
      ['a', [{ due_date: '2026-06-18' }]],
      ['b', [{ due_date: '2026-06-18' }, { due_date: '2026-06-17' }, { due_date: '2026-06-16' }]],
    ]),
    today: '2026-06-22',
  });
  assert.deepEqual(r.groups.map((g) => g.name), ['B', 'A']);
});
