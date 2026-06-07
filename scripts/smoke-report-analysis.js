'use strict';
const assert = require('assert');
const { classifyExpenseType, calcVariation, buildTomTip, buildQuickActions } = require('../src/finance/report-analysis');

assert.strictEqual(classifyExpenseType('moradia'), 'essential');
assert.strictEqual(classifyExpenseType('alimentacao'), 'essential');
assert.strictEqual(classifyExpenseType('lazer'), 'lifestyle');
assert.strictEqual(classifyExpenseType('viagens'), 'lifestyle');
assert.strictEqual(classifyExpenseType('outros'), 'other');

assert.deepStrictEqual(calcVariation(120, 100), { delta:20, pct:20, label:'⬆️ +20%' });
assert.deepStrictEqual(calcVariation(80, 100), { delta:-20, pct:-20, label:'⬇️ -20%' });
assert.deepStrictEqual(calcVariation(100, 100), { delta:0, pct:0, label:'➡️ 0%' });
assert.strictEqual(calcVariation(50, 0).pct, 100);
assert.strictEqual(calcVariation(0, 0).pct, 0);

assert.ok(/vermelho/.test(buildTomTip({ saldoProjetado:-100 })));
assert.ok(/vencida/.test(buildTomTip({ saldoProjetado:500, overdueCount:2 })));
assert.ok(/Alimentação/.test(buildTomTip({ saldoProjetado:500, overdueCount:0, topCategoria:'Alimentação', topPct:60 })));
assert.ok(/sa[úu]vel|meta|reserva/i.test(buildTomTip({ saldoProjetado:500, overdueCount:0 })));
assert.ok(Array.isArray(buildQuickActions()) && buildQuickActions().length >= 2);
console.log('PASS — report-analysis OK.');
