import { describe, it, expect } from 'vitest';
import { PRESETS, defaultSetting, validateSetting, nextRunLabel, type GroupNotificationSetting } from './groupNotifications';

describe('groupNotifications', () => {
  it('PRESETS na ordem da tela', () => {
    expect(PRESETS.map((p) => p.preset)).toEqual(['daily_morning', 'weekly', 'monthly', 'overdue']);
  });

  it('defaultSetting traz fallback por preset', () => {
    expect(defaultSetting('daily_morning')).toMatchObject({ enabled: true, weekdays: [1, 2, 3, 4, 5], time_local: '08:00' });
    expect(defaultSetting('weekly')).toMatchObject({ weekdays: [1], time_local: '08:00' });
    expect(defaultSetting('monthly')).toMatchObject({ day_of_month: 1, time_local: '08:00' });
    expect(defaultSetting('overdue')).toMatchObject({ weekdays: [1, 2, 3, 4, 5], time_local: '09:00' });
  });

  it('validateSetting normaliza weekdays (únicos, ordenados) e clampa day_of_month', () => {
    const s = validateSetting({ preset: 'daily_morning', enabled: true, weekdays: [5, 1, 1, 3], day_of_month: 99, time_local: '8:00' });
    expect(s.weekdays).toEqual([1, 3, 5]);
    expect(s.day_of_month).toBeLessThanOrEqual(28);
    expect(s.time_local).toBe('08:00');
  });

  it('validateSetting: weekly mantém só 1 weekday', () => {
    const s = validateSetting({ preset: 'weekly', enabled: true, weekdays: [3, 5], day_of_month: null, time_local: '08:00' });
    expect(s.weekdays).toHaveLength(1);
  });
});

describe('nextRunLabel', () => {
  const mk = (patch: Partial<GroupNotificationSetting>): GroupNotificationSetting =>
    ({ ...defaultSetting('daily_morning'), ...patch });

  it('desligado → null', () => {
    expect(nextRunLabel(mk({ enabled: false }), new Date(2026, 5, 14, 10, 0))).toBeNull();
  });
  it('diário seg–sex antes das 8h numa segunda → hoje', () => {
    expect(nextRunLabel(mk({ preset: 'daily_morning', weekdays: [1, 2, 3, 4, 5], time_local: '08:00' }), new Date(2026, 5, 15, 7, 0))).toBe('hoje · 08:00');
  });
  it('diário seg–sex depois das 8h numa segunda → amanhã', () => {
    expect(nextRunLabel(mk({ preset: 'daily_morning', weekdays: [1, 2, 3, 4, 5], time_local: '08:00' }), new Date(2026, 5, 15, 9, 0))).toBe('amanhã · 08:00');
  });
  it('semanal segunda num domingo → amanhã', () => {
    expect(nextRunLabel(mk({ preset: 'weekly', weekdays: [1], time_local: '08:00' }), new Date(2026, 5, 14, 10, 0))).toBe('amanhã · 08:00');
  });
  it('mensal dia 1 no meio do mês → 01/07', () => {
    expect(nextRunLabel(mk({ preset: 'monthly', weekdays: [], day_of_month: 1, time_local: '08:00' }), new Date(2026, 5, 15, 10, 0))).toContain('01/07 · 08:00');
  });
  it('sem dias marcados → null', () => {
    expect(nextRunLabel(mk({ preset: 'overdue', weekdays: [], time_local: '09:00' }), new Date(2026, 5, 15, 7, 0))).toBeNull();
  });
});
