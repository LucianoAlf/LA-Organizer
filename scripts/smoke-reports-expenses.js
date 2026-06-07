'use strict';
const assert = require('assert');
const { buildPeriodExpenses } = require('D:/la-organizer/_remote/src/finance/reports/expenses');

const report = {
  from: '2026-06-01', to: '2026-06-07', days: 7, receitas: 3000, despesas: 500, count: 4,
  byCategory: [
    { slug: 'mercado', total: 300, count: 2 },
    { slug: 'lazer', total: 200, count: 2 },
  ],
  label: 'Gastos de junho',
};
const m = buildPeriodExpenses(report, { despesas: 400 });
assert.strictEqual(m.total, 500, 'total');
assert.strictEqual(m.count, 4, 'count');
assert.ok(Math.abs(m.mediaDiaria - 500 / 7) < 1e-9, 'mediaDiaria = despesas/days');
assert.strictEqual(m.top5[0].label, 'Mercado', 'top label via CAT_META');
assert.strictEqual(m.top5[0].pct, 60, 'pct = total/despesas');
assert.strictEqual(m.porTipo.essenciais, 300, 'mercado = essencial'); // mercado ∈ ESSENTIAL
assert.strictEqual(m.porTipo.estilo, 200, 'lazer = estilo');
assert.strictEqual(m.porTipo.essPct, 60, 'essPct');
assert.ok(m.comparativo && m.comparativo.atual === 500 && m.comparativo.anterior === 400, 'comparativo');
assert.ok(m.comparativo.variation && typeof m.comparativo.variation.label === 'string', 'variation label');
assert.ok(Array.isArray(m.acoes), 'acoes array');

// sem prev → comparativo null
const m2 = buildPeriodExpenses({ ...report, byCategory: [] }, null);
assert.strictEqual(m2.comparativo, null, 'sem prev');
assert.deepStrictEqual(m2.top5, [], 'top5 vazio');

console.log('OK smoke-reports-expenses');
