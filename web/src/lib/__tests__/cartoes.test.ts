import { describe, it, expect } from 'vitest';
import { addMonthsToCompetencia, splitInstallments } from '../cartoes';

describe('addMonthsToCompetencia', () => {
  it('soma meses virando o ano', () => {
    expect(addMonthsToCompetencia('2026-11-01', 3)).toBe('2027-02-01');
  });
  it('zero meses é identidade', () => {
    expect(addMonthsToCompetencia('2026-05-01', 0)).toBe('2026-05-01');
  });
});

describe('splitInstallments', () => {
  it('divide exato', () => {
    expect(splitInstallments(100, 4)).toEqual([25, 25, 25, 25]);
  });
  it('joga o resto (centavos) na última parcela', () => {
    expect(splitInstallments(100, 3)).toEqual([33.33, 33.33, 33.34]);
  });
  it('1 parcela = valor cheio', () => {
    expect(splitInstallments(120, 1)).toEqual([120]);
  });
});
