import { afterEach, describe, expect, it, vi } from 'vitest';
import { localYmd, todaySP, ymdAddDays } from './date';

describe('localYmd', () => {
  it('usa o dia civil de São Paulo, não o UTC (22h30 BRT ainda é o mesmo dia)', () => {
    const d = new Date('2026-06-10T22:30:00-03:00');
    expect(d.toISOString().slice(0, 10)).toBe('2026-06-11'); // o padrão antigo deslocava
    expect(localYmd(d)).toBe('2026-06-10');
  });

  it('meia-noite local fica no mesmo dia', () => {
    expect(localYmd(new Date('2026-06-10T00:00:00-03:00'))).toBe('2026-06-10');
  });

  it('madrugada UTC ainda é o dia anterior em SP', () => {
    expect(localYmd(new Date('2026-06-11T02:59:59Z'))).toBe('2026-06-10');
  });
});

describe('todaySP', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('depois das 21h BRT continua sendo hoje, não amanhã', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T22:00:00-03:00'));
    expect(todaySP()).toBe('2026-06-10');
  });
});

describe('ymdAddDays', () => {
  it('soma dias direto na string YMD', () => {
    expect(ymdAddDays('2026-06-10', 1)).toBe('2026-06-11');
    expect(ymdAddDays('2026-06-01', -1)).toBe('2026-05-31');
  });
});
