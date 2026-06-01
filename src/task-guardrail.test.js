const { test } = require('node:test');
const assert = require('node:assert');
const { splitBulkIdenticalCreates } = require('./task-guardrail');

function mk(title) { return { action: 'create', title }; }

test('lote com >10 creates de título idêntico é bloqueado', () => {
  const actions = Array.from({ length: 12 }, () => mk('Dar presença dos alunos'));
  const { allowed, blocked } = splitBulkIdenticalCreates(actions, 10);
  assert.strictEqual(allowed.length, 0);
  assert.strictEqual(blocked.length, 12);
  assert.strictEqual(blocked[0].title, 'Dar presença dos alunos');
});

test('normaliza título (case/espaço) ao agrupar', () => {
  const actions = [
    ...Array.from({ length: 6 }, () => mk('  DAR Presença dos Alunos ')),
    ...Array.from({ length: 6 }, () => mk('dar presença dos alunos')),
  ];
  const { allowed, blocked } = splitBulkIdenticalCreates(actions, 10);
  assert.strictEqual(allowed.length, 0);
  assert.strictEqual(blocked.length, 12);
});

test('lote pequeno (<=10) passa normalmente', () => {
  const actions = Array.from({ length: 8 }, () => mk('Comprar lâmpada'));
  const { allowed, blocked } = splitBulkIdenticalCreates(actions, 10);
  assert.strictEqual(allowed.length, 8);
  assert.strictEqual(blocked.length, 0);
});

test('títulos distintos não somam entre si', () => {
  const actions = [
    ...Array.from({ length: 7 }, () => mk('Tarefa A')),
    ...Array.from({ length: 7 }, () => mk('Tarefa B')),
  ];
  const { allowed, blocked } = splitBulkIdenticalCreates(actions, 10);
  assert.strictEqual(allowed.length, 14);
  assert.strictEqual(blocked.length, 0);
});

test('não-creates (reschedule/complete) nunca são bloqueados', () => {
  const actions = Array.from({ length: 12 }, () => ({ action: 'reschedule', id: 'x', new_due_date: '2026-06-02' }));
  const { allowed, blocked } = splitBulkIdenticalCreates(actions, 10);
  assert.strictEqual(allowed.length, 12);
  assert.strictEqual(blocked.length, 0);
});
