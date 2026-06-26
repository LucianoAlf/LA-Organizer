'use strict';
// TDD — rede anti-órfão: lembrete de tarefa de preparo de evento (remindEventTasks)
// não pode cobrar tarefa cujo school_event foi CANCELADO. Bug Alf 24/06:
// "Show de Encerramento do Semestre" cancelado seguia cobrando ensaio/repertório/divulgar.
const test = require('node:test');
const assert = require('node:assert');
const { isEventTaskActive } = require('./event-task-active');

test('evento ativo → lembra (true)', () => {
  assert.strictEqual(isEventTaskActive({ event: { status: 'active' } }), true);
});

test('evento CANCELADO → NÃO lembra (false) — o fix', () => {
  assert.strictEqual(isEventTaskActive({ event: { status: 'cancelled' } }), false);
});

test('evento ausente (deletado/null) → NÃO lembra (defensivo)', () => {
  assert.strictEqual(isEventTaskActive({ event: null }), false);
  assert.strictEqual(isEventTaskActive({ event: undefined }), false);
  assert.strictEqual(isEventTaskActive({}), false);
});

test('só cancelled exclui — outros status (ex.: completed) ainda lembram', () => {
  assert.strictEqual(isEventTaskActive({ event: { status: 'completed' } }), true);
});

test('task null/undefined → false (não estoura)', () => {
  assert.strictEqual(isEventTaskActive(null), false);
  assert.strictEqual(isEventTaskActive(undefined), false);
});
