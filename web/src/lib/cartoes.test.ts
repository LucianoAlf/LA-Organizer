import { describe, it, expect } from 'vitest';
import {
  currentCycleSummary, daysUntilClosing,
  dueLabelForCompetencia, competenciaFor,
} from './cartoes';

// UTC puro pra bater com competenciaFor/dueDateForCompetencia (getters UTC).
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('daysUntilClosing — dias até o próximo fechamento', () => {
  it('antes do fechamento: conta até o dia deste mês', () => {
    expect(daysUntilClosing(7, utc(2026, 7, 5))).toBe(2);   // 5 → 7 jul
  });
  it('no dia do fechamento: 0 (fecha hoje)', () => {
    expect(daysUntilClosing(7, utc(2026, 7, 7))).toBe(0);
  });
  it('depois do fechamento: pula pro mês seguinte', () => {
    expect(daysUntilClosing(7, utc(2026, 7, 12))).toBe(26); // 12 jul → 7 ago
  });
});

describe('currentCycleSummary — ciclo da fatura ABERTA (tile da lista)', () => {
  // BUG Rose 12/07: Cartão Nubank Rose (fecha 7, vence 14). A fatura de julho já fechou
  // dia 07/07 → a fatura ABERTA é agosto, vence 14/08. O tile mostrava "14/07" (usava só
  // o dia de vencimento, ignorando o fechamento).
  it('Nubank Rose (fecha 7 / vence 14) em 12/07: vence 14/08, NÃO 14/07', () => {
    const r = currentCycleSummary({ closing_day: 7, due_day: 14 }, utc(2026, 7, 12));
    expect(r.dueLabel).toBe('14/08');
    expect(r.dueLabel).not.toBe('14/07');
    expect(r.closesInDays).toBe(26);
  });

  it('bate EXATAMENTE com o vencimento do detalhe (fonte única = competência corrente)', () => {
    const card = { closing_day: 7, due_day: 14 };
    const today = utc(2026, 7, 12);
    const comp = competenciaFor(today, card.closing_day); // = 2026-08-01
    expect(currentCycleSummary(card, today).dueLabel)
      .toBe(dueLabelForCompetencia(comp, card.closing_day, card.due_day));
  });

  it('antes do fechamento (fecha 20 / vence 1) em 12/07: fatura de julho, vence 01/08', () => {
    const r = currentCycleSummary({ closing_day: 20, due_day: 1 }, utc(2026, 7, 12));
    expect(r.dueLabel).toBe('01/08'); // vence dia 1 < fecha dia 20 → mês seguinte ao fechamento
    expect(r.closesInDays).toBe(8);   // 12 → 20 jul
  });

  it('Itaú Rose (fecha 4 / vence 11) em 12/07: vence 11/08, fecha em 23d', () => {
    const r = currentCycleSummary({ closing_day: 4, due_day: 11 }, utc(2026, 7, 12));
    expect(r.dueLabel).toBe('11/08');
    expect(r.closesInDays).toBe(23); // 12 jul → 4 ago
  });
});
