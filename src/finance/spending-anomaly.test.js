const { test } = require('node:test');
const assert = require('node:assert');
const { detectAnomaly } = require('./spending-anomaly');

test('poucos samples → não alarma', () => {
  const r = detectAnomaly({ amount: 50, history: [40, 45] });
  assert.equal(r.isAnomaly, false);
  assert.equal(r.reason, 'few_samples');
});

test('gasto ~2× com z alto → anomalia', () => {
  const r = detectAnomaly({ amount: 89, history: [40, 45, 50, 42] });
  assert.equal(r.isAnomaly, true);
  assert.ok(r.z >= 2);
  assert.ok(r.ratio >= 1.8);
});

test('gasto dentro do padrão → não alarma', () => {
  const r = detectAnomaly({ amount: 48, history: [40, 45, 50, 42] });
  assert.equal(r.isAnomaly, false);
});

test('histórico constante (sd=0): gasto bem acima → anomalia', () => {
  const r = detectAnomaly({ amount: 90, history: [50, 50, 50] });
  assert.equal(r.isAnomaly, true);
  assert.equal(r.z, null);
});

test('valor inválido → não alarma', () => {
  assert.equal(detectAnomaly({ amount: 0, history: [10, 20, 30] }).isAnomaly, false);
});
