'use strict';
const assert = require('assert');
const { buildDailySummary, buildWeeklySummary, buildMonthlyClosing } = require('D:/la-organizer/_remote/src/finance/reports/summaries');

const rep = { from: '2026-06-07', to: '2026-06-07', days: 1, receitas: 400, despesas: 175.8, count: 2, byCategory: [{ slug: 'mercado', total: 152.3, count: 1 }, { slug: 'transporte', total: 23.5, count: 1 }] };

const d = buildDailySummary({ label: 'Balanço de hoje', report: rep, saldoTotal: 1958.03 });
assert.strictEqual(d.resultado, 400 - 175.8, 'resultado dia');
assert.strictEqual(d.saldoTotal, 1958.03);
assert.strictEqual(d.temAtividade, true);
assert.strictEqual(d.top[0].label, 'Mercado', 'top via CAT_META');
assert.strictEqual(buildDailySummary({ label: 'x', report: { receitas: 0, despesas: 0, count: 0, byCategory: [] }, saldoTotal: 5 }).temAtividade, false, 'sem atividade');

const w = buildWeeklySummary({ label: 'Resumo da semana', report: { ...rep, days: 7, despesas: 600 }, prev: { despesas: 500 } });
assert.strictEqual(w.resultado, 400 - 600, 'resultado semana');
assert.ok(w.comparativo && w.comparativo.anterior === 500 && typeof w.comparativo.variation.label === 'string', 'comparativo semana');
assert.ok(w.porTipo.essenciais > 0, 'porTipo'); // mercado+transporte são essenciais
assert.ok(Array.isArray(w.acoes), 'acoes');
assert.strictEqual(buildWeeklySummary({ label: 'x', report: { receitas: 0, despesas: 0, count: 0, byCategory: [] }, prev: null }).comparativo, null, 'sem prev');

const cNeg = buildMonthlyClosing({ label: 'Fechamento de maio', report: { receitas: 5000, despesas: 5300, count: 40, byCategory: [{ slug: 'moradia', total: 1500, count: 1 }] }, prev: { despesas: 4800 }, goals: [{ name: 'Viagem', pct: 40 }] });
assert.strictEqual(cNeg.resultado, -300, 'resultado fechamento');
assert.ok(/vermelho/i.test(cNeg.tip), 'tip vermelho quando resultado<0');
assert.deepStrictEqual(cNeg.metas, [{ name: 'Viagem', pct: 40 }], 'metas passthrough');
const cPos = buildMonthlyClosing({ label: 'Fechamento de abril', report: { receitas: 5000, despesas: 4000, count: 30, byCategory: [] }, prev: null, goals: [] });
assert.ok(/azul/i.test(cPos.tip), 'tip azul quando resultado>=0');

console.log('OK smoke-reports-summaries');
