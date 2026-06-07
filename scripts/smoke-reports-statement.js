'use strict';
const assert = require('assert');
const { buildStatement } = require('D:/la-organizer/_remote/src/finance/reports/statement');

const rows = [
  { type: 'expense', amount: 152.3, description: 'Mercado', category: 'mercado', transaction_date: '2026-06-06', account_id: 'a1' },
  { type: 'income', amount: 3000, description: null, category: 'salario', transaction_date: '2026-06-05', account_id: 'a1' },
  { type: 'expense', amount: 40, description: 'Uber', category: 'transporte', transaction_date: '2026-06-04', account_id: 'a2' },
];
const m = buildStatement({ name: 'Nubank', icon: '💜' }, rows, { label: 'Extrato de junho', limit: 12 });
assert.strictEqual(m.name, 'Nubank');
assert.strictEqual(m.count, 3, 'count = total');
assert.strictEqual(m.shown, 3, 'shown');
assert.strictEqual(m.hasMore, false);
assert.strictEqual(m.totalIn, 3000, 'totalIn soma todas');
assert.ok(Math.abs(m.totalOut - 192.3) < 1e-9, 'totalOut soma todas');
assert.strictEqual(m.items[1].desc, 'Salário', 'desc nulo → label da categoria via CAT_META'); // salario → "Salário"
assert.ok(m.items[0].emoji && m.items[0].emoji !== '', 'emoji por categoria');
assert.strictEqual(m.items[0].source, '', 'sem sourceMap → source vazio (conta no header)');

// truncamento + sourceMap (extrato de todas as contas)
const many = Array.from({ length: 14 }, (_, i) => ({ type: 'expense', amount: 10, description: `T${i}`, category: 'mercado', transaction_date: '2026-06-01', account_id: i % 2 ? 'a1' : 'a2' }));
const m2 = buildStatement(null, many, { label: 'Extrato', limit: 12, sourceMap: { a1: 'Nubank', a2: 'Itaú' } });
assert.strictEqual(m2.count, 14);
assert.strictEqual(m2.shown, 12, 'trunca em 12');
assert.strictEqual(m2.hasMore, true);
assert.strictEqual(m2.name, null, 'sem conta');
assert.ok(['Nubank', 'Itaú'].includes(m2.items[0].source), 'source por linha via sourceMap');

console.log('OK smoke-reports-statement');
