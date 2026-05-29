const { test } = require('node:test');
const assert = require('node:assert');
const { crossedThreshold, buildBudgetAlert } = require('./budget-alert');

test('crossedThreshold: cruza 70 quando vai de 60% pra 72%', () => {
  assert.strictEqual(crossedThreshold(300, 360, 500), 70);
});
test('crossedThreshold: nao re-alerta dentro da mesma faixa', () => {
  assert.strictEqual(crossedThreshold(360, 390, 500), null);
});
test('crossedThreshold: cruza 80 ao ir de 78% pra 85%', () => {
  assert.strictEqual(crossedThreshold(390, 425, 500), 80);
});
test('crossedThreshold: salto grande mostra so a faixa mais alta', () => {
  assert.strictEqual(crossedThreshold(300, 525, 500), 100);
});
test('crossedThreshold: limite zero/ausente nao alerta', () => {
  assert.strictEqual(crossedThreshold(0, 100, 0), null);
  assert.strictEqual(crossedThreshold(0, 100, null), null);
});
test('buildBudgetAlert: 80% inclui sugestao da categoria', () => {
  const msg = buildBudgetAlert('alimentacao', 425, 500, 80);
  assert.match(msg, /80%/);
  assert.match(msg, /marmita/i);
});
test('buildBudgetAlert: threshold null retorna string vazia', () => {
  assert.strictEqual(buildBudgetAlert('lazer', 100, 500, null), '');
});
