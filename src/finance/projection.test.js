const { test } = require('node:test');
const assert = require('node:assert');
const { futureValue, monthsToGoalSimple, monthsToGoalWithInterest, formatMonths } = require('./projection');

test('futureValue: aporte com juros (M = P*((1+i)^n -1)/i)', () => {
  const fv = futureValue(300, 0.0083, 12);
  assert.ok(fv > 3750 && fv < 3790, `fv inesperado: ${fv}`);
});
test('futureValue: taxa zero = soma simples', () => {
  assert.strictEqual(futureValue(300, 0, 12), 3600);
});
test('monthsToGoalSimple: 20000 guardando 500/mes = 40 meses', () => {
  assert.strictEqual(monthsToGoalSimple(20000, 0, 500), 40);
});
test('monthsToGoalSimple: ja tem current_amount', () => {
  assert.strictEqual(monthsToGoalSimple(20000, 5000, 500), 30);
});
test('monthsToGoalWithInterest: com juros leva menos meses que o simples', () => {
  const simple = monthsToGoalSimple(20000, 0, 500);
  const comJuros = monthsToGoalWithInterest(20000, 0, 500, 0.0083);
  assert.ok(comJuros < simple, `com juros (${comJuros}) deveria ser < simples (${simple})`);
});
test('formatMonths: 40 meses vira "3 anos e 4 meses"', () => {
  assert.strictEqual(formatMonths(40), '3 anos e 4 meses');
});
test('formatMonths: 12 meses vira "1 ano"', () => {
  assert.strictEqual(formatMonths(12), '1 ano');
});
test('simulação 300/mês 10 anos a 10,5%/ano ~62k (> 36000 sem juros)', () => {
  const i = Math.pow(1.105, 1 / 12) - 1;
  const fv = futureValue(300, i, 120);
  assert.ok(fv > 36000, `com juros deveria passar de 36000, veio ${fv}`);
  assert.ok(fv > 60000 && fv < 66000, `esperado ~62k, veio ${fv}`);
});
