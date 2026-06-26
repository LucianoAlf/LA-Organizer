'use strict';
// Converte o "month" do marker set_bill_amount em competência YYYY-MM-01.
const { test } = require('node:test');
const assert = require('node:assert');
const { parseBillMonth } = require('./bill-month');

const HOJE = '2026-06-26'; // junho

test('YYYY-MM → competência', () => {
  assert.strictEqual(parseBillMonth('2026-08', HOJE), '2026-08-01');
});
test('YYYY-MM-DD → competência (1º dia do mês)', () => {
  assert.strictEqual(parseBillMonth('2026-08-15', HOJE), '2026-08-01');
});
test('nome PT futuro no ano corrente (agosto, hoje junho)', () => {
  assert.strictEqual(parseBillMonth('agosto', HOJE), '2026-08-01');
});
test('nome PT abreviado (ago)', () => {
  assert.strictEqual(parseBillMonth('ago', HOJE), '2026-08-01');
});
test('nome PT já passado no ano → próximo ano (fevereiro, hoje junho)', () => {
  assert.strictEqual(parseBillMonth('fevereiro', HOJE), '2027-02-01');
});
test('mês corrente (junho, hoje junho) → ano corrente', () => {
  assert.strictEqual(parseBillMonth('junho', HOJE), '2026-06-01');
});
test('inválido / vazio / null → null', () => {
  assert.strictEqual(parseBillMonth('xyz', HOJE), null);
  assert.strictEqual(parseBillMonth('', HOJE), null);
  assert.strictEqual(parseBillMonth(null, HOJE), null);
});
