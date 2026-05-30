import { test, expect } from 'vitest';
import { futureValue, monthsToGoalSimple, monthsToGoalWithInterest, formatMonths, ANNUAL_RATE_ESTIMATE_PCT, MONTHLY_RATE_ESTIMATE } from './finance-utils';

test('paridade: 300/mes 10 anos a 10,5%/ano ~62k (mesma faixa do projection.js)', () => {
  const i = Math.pow(1.105, 1 / 12) - 1;
  const fv = futureValue(300, i, 120);
  expect(fv).toBeGreaterThan(60000);
  expect(fv).toBeLessThan(66000);
});
test('futureValue taxa zero = soma simples', () => {
  expect(futureValue(300, 0, 12)).toBe(3600);
});
test('monthsToGoalSimple 20000 / 500/mes = 40 meses', () => {
  expect(monthsToGoalSimple(20000, 0, 500)).toBe(40);
});
test('monthsToGoalSimple com current_amount', () => {
  expect(monthsToGoalSimple(20000, 5000, 500)).toBe(30);
});
test('monthsToGoalWithInterest < simples', () => {
  expect(monthsToGoalWithInterest(20000, 0, 500, 0.0083)).toBeLessThan(monthsToGoalSimple(20000, 0, 500));
});
test('formatMonths 40 = "3 anos e 4 meses"', () => {
  expect(formatMonths(40)).toBe('3 anos e 4 meses');
});
test('formatMonths 12 = "1 ano"', () => {
  expect(formatMonths(12)).toBe('1 ano');
});
test('constante exposta: 10,5%/ano', () => {
  expect(ANNUAL_RATE_ESTIMATE_PCT).toBe(10.5);
  // MONTHLY_RATE_ESTIMATE = (1.105)^(1/12) - 1 ~ 0.008355
  expect(MONTHLY_RATE_ESTIMATE).toBeGreaterThan(0.0083);
  expect(MONTHLY_RATE_ESTIMATE).toBeLessThan(0.0084);
});
