'use strict';
// RAIZ 1 — Fatia 4: backstop anti-molde-recorrente-duplicado na CRIAÇÃO (1:1/PWA).
// O dedup vivia só no GRUPO (findDuplicatePackage); o 1:1 (delegação) criava 2 moldes
// idênticos numa rajada (Gabi/Jereh "quadruplicou"). Helper PURO, espelha a similaridade
// por tokens do grupo. Caller passa os moldes ATIVOS do mesmo dono; helper decide o dup.
const { test } = require('node:test');
const assert = require('node:assert');
const { findDuplicateRecurrenceTemplate } = require('./recur-template-dedup');

const RULE = 'FREQ=MONTHLY;BYMONTHDAY=5';
const tpl = (o) => ({ id: 'x', title: 'T', recurrence_rule: RULE, recurrence_parent_id: null, series_ended_at: null, status: 'pending', ...o });

test('mesmo título + mesma rule, ativo → acha o duplicado', () => {
  const dup = findDuplicateRecurrenceTemplate([tpl({ id: 'a', title: 'Aluguel' })], { title: 'aluguel', recurrence_rule: RULE });
  assert.strictEqual(dup && dup.id, 'a');
});

test('título SIMILAR (não idêntico) + mesma rule → acha', () => {
  const dup = findDuplicateRecurrenceTemplate([tpl({ id: 'a', title: 'Pagar aluguel do apartamento' })], { title: 'pagar aluguel apartamento', recurrence_rule: RULE });
  assert.ok(dup, 'título similar deve casar');
});

test('mesmo título mas rule DIFERENTE → NÃO é dup (série distinta)', () => {
  const dup = findDuplicateRecurrenceTemplate([tpl({ id: 'a', title: 'Aluguel', recurrence_rule: 'FREQ=WEEKLY' })], { title: 'Aluguel', recurrence_rule: RULE });
  assert.strictEqual(dup, null);
});

test('título distinto + mesma rule → null', () => {
  const dup = findDuplicateRecurrenceTemplate([tpl({ id: 'a', title: 'Aluguel' })], { title: 'Internet', recurrence_rule: RULE });
  assert.strictEqual(dup, null);
});

test('série ENCERRADA (series_ended_at set) não conta como dup', () => {
  const dup = findDuplicateRecurrenceTemplate([tpl({ id: 'a', title: 'Aluguel', series_ended_at: '2026-06-01T00:00:00Z' })], { title: 'Aluguel', recurrence_rule: RULE });
  assert.strictEqual(dup, null);
});

test('molde CANCELADO não conta como dup', () => {
  const dup = findDuplicateRecurrenceTemplate([tpl({ id: 'a', title: 'Aluguel', status: 'cancelled' })], { title: 'Aluguel', recurrence_rule: RULE });
  assert.strictEqual(dup, null);
});

test('candidato sem rule (não-recorrente) → null (não deduplica não-recorrente)', () => {
  const dup = findDuplicateRecurrenceTemplate([tpl({ id: 'a', title: 'Aluguel' })], { title: 'Aluguel', recurrence_rule: null });
  assert.strictEqual(dup, null);
});

test('inputs vazios/nulos → null, não estoura', () => {
  assert.strictEqual(findDuplicateRecurrenceTemplate([], { title: 'X', recurrence_rule: RULE }), null);
  assert.strictEqual(findDuplicateRecurrenceTemplate(null, null), null);
  assert.strictEqual(findDuplicateRecurrenceTemplate(undefined, undefined), null);
});
