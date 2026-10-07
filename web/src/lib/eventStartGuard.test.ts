// EVENTO-CRIADO-NO-PASSADO (Alf 05/10): dados REAIS da Mentoria Levi (d898903f).
import { describe, it, expect } from 'vitest';
import { isStartInPast, pastStartLabel } from './eventStartGuard';

// created_at real: 2026-10-05T22:14:15Z (19:14 BRT); início gravado: 05/10 09:00 BRT.
const CREATED = Date.parse('2026-10-05T22:14:15.543Z');
const START_GRAVADO = '2026-10-05T09:00:00-03:00';

describe('isStartInPast', () => {
  it('caso real: 05/10 09:00 criado às 19:14 → já passou', () => {
    expect(isStartInPast(START_GRAVADO, CREATED)).toBe(true);
  });
  it('o que ele queria (07/10 09:00) não passou', () => {
    expect(isStartInPast('2026-10-07T09:00:00-03:00', CREATED)).toBe(false);
  });
  it('folga de 15 min pra reunião que acabou de começar', () => {
    const now = Date.parse('2026-10-07T15:10:00-03:00');
    expect(isStartInPast('2026-10-07T15:00:00-03:00', now)).toBe(false);
    expect(isStartInPast('2026-10-07T14:50:00-03:00', now)).toBe(true);
  });
  it('vazio/ilegível não é passado', () => {
    expect(isStartInPast('', CREATED)).toBe(false);
    expect(isStartInPast('lixo', CREATED)).toBe(false);
  });
});

describe('pastStartLabel', () => {
  it('fuso de SP', () => {
    expect(pastStartLabel(START_GRAVADO)).toBe('05/10 09:00');
    expect(pastStartLabel('2026-10-05T12:00:00+00:00')).toBe('05/10 09:00');
  });
});
