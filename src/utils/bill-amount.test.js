'use strict';
// Helper puro: valor de uma conta fixa num mês = override válido (>0) > valor base.
// Fonte de verdade ÚNICA consumida por previsão/exibição/pagamento/lembrete (paridade com o TS).
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveBillAmount, resolveBillsForMonth } = require('./bill-amount');

test('sem override → valor base', () => {
  assert.strictEqual(resolveBillAmount({ amount: 330 }, null), 330);
  assert.strictEqual(resolveBillAmount({ amount: 330 }, undefined), 330);
});

test('override válido → valor do override', () => {
  assert.strictEqual(resolveBillAmount({ amount: 330 }, { amount: 350 }), 350);
});

test('amount base string (numeric do Postgres) → Number', () => {
  assert.strictEqual(resolveBillAmount({ amount: '330.50' }, null), 330.5);
});

test('override com amount inválido (≤0 / NaN / null) → ignora, usa base', () => {
  assert.strictEqual(resolveBillAmount({ amount: 330 }, { amount: 0 }), 330);
  assert.strictEqual(resolveBillAmount({ amount: 330 }, { amount: -5 }), 330);
  assert.strictEqual(resolveBillAmount({ amount: 330 }, { amount: null }), 330);
  assert.strictEqual(resolveBillAmount({ amount: 330 }, { amount: 'abc' }), 330);
});

test('resolveBillsForMonth aplica override por bill.id e NÃO muta o original', () => {
  const bills = [{ id: 'a', amount: 330 }, { id: 'b', amount: 100 }];
  const out = resolveBillsForMonth(bills, { a: { amount: 350 } });
  assert.strictEqual(out.find((b) => b.id === 'a').amount, 350);
  assert.strictEqual(out.find((b) => b.id === 'b').amount, 100);
  assert.strictEqual(bills[0].amount, 330, 'não muta o array original');
});

test('resolveBillsForMonth sem overrides → todos no base', () => {
  const out = resolveBillsForMonth([{ id: 'a', amount: 330 }], {});
  assert.strictEqual(out[0].amount, 330);
});
