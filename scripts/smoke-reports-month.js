'use strict';
const assert = require('assert');
const { buildMonthAnalysis } = require('../src/finance/reports/month');
const data = {
  monthLabel:'abril', despesas:2759, receitas:8000, despesasPrev:2000,
  byCategory:[{slug:'alimentacao',total:2239,count:8},{slug:'transporte',total:320,count:4},{slug:'lazer',total:200,count:1}],
  saldoAtual:10161, aPagar:4329, overdueCount:0, goals:[{name:'Europa',pct:3,current:500,target:15000}],
};
const m = buildMonthAnalysis(data);
assert.strictEqual(m.comparativo.variation.label, '⬆️ +38%');         // (2759-2000)/2000≈37.95→38
assert.strictEqual(m.ranking[0].label, 'Alimentação');                 // via CAT_META
assert.strictEqual(m.ranking[0].pct, Math.round(2239/2759*100));       // 81
assert.strictEqual(m.ranking.length, 3);
assert.strictEqual(m.porTipo.essenciais, 2239 + 320);                  // aliment+transporte (essenciais)
assert.strictEqual(m.porTipo.estilo, 200);                            // lazer (estilo de vida)
assert.strictEqual(m.projecao.saldoProjetado, 10161 - 4329);          // 5832
assert.strictEqual(m.metas[0].name, 'Europa');
assert.ok(typeof m.tip === 'string' && m.tip.length > 0);
console.log('PASS — buildMonthAnalysis OK.');
