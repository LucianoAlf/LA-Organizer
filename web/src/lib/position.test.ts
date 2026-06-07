import { describe, it, expect } from 'vitest';
import { computePosition } from './cartoes';

describe('computePosition', () => {
  it('soma saldos + limite disponível (clampa negativo)', () => {
    const accs = [{ balance: 5221 }, { balance: 4820 }, { balance: -30 }];
    const cu = [{ usage: { available: 1000 } }, { usage: { available: -50 } }];
    const p = computePosition(accs, cu);
    expect(p.totalSaldo).toBe(10011);
    expect(p.limiteDisponivel).toBe(1000);
    expect(p.totalDisponivel).toBe(11011);
  });
});
