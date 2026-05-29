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
