import { describe, it, expect } from 'vitest';
import { resolveBillAmount, resolveBillsForMonth } from '../financeiro';

// Paridade com src/utils/bill-amount.test.js (backend). Mesmos casos, mesmo resultado.
describe('resolveBillAmount', () => {
  it('sem override → valor base', () => {
    expect(resolveBillAmount({ amount: 330 }, null)).toBe(330);
    expect(resolveBillAmount({ amount: 330 }, undefined)).toBe(330);
  });
  it('override válido → valor do override', () => {
    expect(resolveBillAmount({ amount: 330 }, { amount: 350 })).toBe(350);
  });
  it('amount base string (numeric do Postgres) → Number', () => {
    expect(resolveBillAmount({ amount: '330.50' }, null)).toBe(330.5);
  });
  it('override inválido (≤0 / NaN / null) → ignora, usa base', () => {
    expect(resolveBillAmount({ amount: 330 }, { amount: 0 })).toBe(330);
    expect(resolveBillAmount({ amount: 330 }, { amount: -5 })).toBe(330);
    expect(resolveBillAmount({ amount: 330 }, { amount: null as unknown as number })).toBe(330);
    expect(resolveBillAmount({ amount: 330 }, { amount: 'abc' })).toBe(330);
  });
});

describe('resolveBillsForMonth', () => {
  it('aplica override por id e NÃO muta o original', () => {
    const bills = [{ id: 'a', amount: 330 }, { id: 'b', amount: 100 }];
    const out = resolveBillsForMonth(bills, { a: { amount: 350 } });
    expect(out.find((b) => b.id === 'a')!.amount).toBe(350);
    expect(out.find((b) => b.id === 'b')!.amount).toBe(100);
    expect(bills[0].amount).toBe(330);
  });
  it('sem overrides → todos no base', () => {
    const out = resolveBillsForMonth([{ id: 'a', amount: 330 }], {});
    expect(out[0].amount).toBe(330);
  });
});
