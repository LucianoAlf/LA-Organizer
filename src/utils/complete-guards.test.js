'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isFutureCompletion } = require('./complete-guards');

// "agora" fixo: 09/06/2026 20:20 BRT = 23:20Z (o instante do Incidente C)
const NOW = new Date('2026-06-09T23:20:00Z');

test('due_date AMANHÃ (date-only) → bloqueia (caso Reunião ADM)', () => {
  assert.strictEqual(isFutureCompletion({ dueDate: '2026-06-10', now: NOW }), true);
});
test('due_date HOJE → libera', () => {
  assert.strictEqual(isFutureCompletion({ dueDate: '2026-06-09', now: NOW }), false);
});
test('due_date ONTEM → libera (atrasada concluída é normal)', () => {
  assert.strictEqual(isFutureCompletion({ dueDate: '2026-06-08', now: NOW }), false);
});
test('start_at amanhã 10h BRT → bloqueia (evento futuro)', () => {
  assert.strictEqual(isFutureCompletion({ startAt: '2026-06-10T13:00:00Z', now: NOW }), true);
});
test('start_at hoje 14h BRT (timestamp) → libera', () => {
  assert.strictEqual(isFutureCompletion({ startAt: '2026-06-09T17:00:00Z', now: NOW }), false);
});
test('pegadinha de timezone: 01:00Z de 10/06 = 22:00 BRT de 09/06 → HOJE → libera', () => {
  assert.strictEqual(isFutureCompletion({ startAt: '2026-06-10T01:00:00Z', now: NOW }), false);
});
test('sem data nenhuma → libera (nunca bloqueia tarefa sem prazo)', () => {
  assert.strictEqual(isFutureCompletion({ now: NOW }), false);
});
test('data inválida → libera (defensivo)', () => {
  assert.strictEqual(isFutureCompletion({ dueDate: 'banana', now: NOW }), false);
});
test('dueDate tem precedência sobre startAt', () => {
  assert.strictEqual(isFutureCompletion({ dueDate: '2026-06-09', startAt: '2026-06-12T12:00:00Z', now: NOW }), false);
});
