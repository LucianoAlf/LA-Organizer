import { describe, it, expect } from 'vitest';
import {
  projectedInstances, shouldWarnUnboundedRecurrence, GUARD_SPAM_THRESHOLD,
} from './recurrenceGuard';

const START = '2026-07-02';

describe('projectedInstances (30d a partir de 2026-07-02)', () => {
  it('diária floda o horizonte (>= limiar)', () => {
    expect(projectedInstances('FREQ=DAILY', START)).toBeGreaterThanOrEqual(GUARD_SPAM_THRESHOLD);
  });
  it('semanal (1 dia) gera poucas (< limiar)', () => {
    expect(projectedInstances('FREQ=WEEKLY;BYDAY=TH', START)).toBeLessThan(GUARD_SPAM_THRESHOLD);
  });
  it('dias úteis floda (>= limiar)', () => {
    expect(projectedInstances('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', START)).toBeGreaterThanOrEqual(GUARD_SPAM_THRESHOLD);
  });
  it('mensal gera 1 (< limiar)', () => {
    expect(projectedInstances('FREQ=MONTHLY;BYMONTHDAY=1', START)).toBeLessThan(GUARD_SPAM_THRESHOLD);
  });
  it('rule/start inválido → 0', () => {
    expect(projectedInstances(null, START)).toBe(0);
    expect(projectedInstances('FREQ=DAILY', '')).toBe(0);
    expect(projectedInstances('lixo-nao-rrule', START)).toBe(0);
  });
});

describe('shouldWarnUnboundedRecurrence', () => {
  it('diária sem fim → avisa, cadência "diária"', () => {
    const w = shouldWarnUnboundedRecurrence('FREQ=DAILY', START);
    expect(w).not.toBeNull();
    expect(w!.cadence).toBe('diária');
    expect(w!.count).toBeGreaterThanOrEqual(GUARD_SPAM_THRESHOLD);
  });
  it('dias úteis sem fim → avisa, cadência "dias úteis"', () => {
    const w = shouldWarnUnboundedRecurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', START);
    expect(w).not.toBeNull();
    expect(w!.cadence).toBe('dias úteis');
  });
  it('semanal (1 dia) → não avisa (poucas ocorrências)', () => {
    expect(shouldWarnUnboundedRecurrence('FREQ=WEEKLY;BYDAY=TH', START)).toBeNull();
  });
  it('mensal → não avisa', () => {
    expect(shouldWarnUnboundedRecurrence('FREQ=MONTHLY;BYMONTHDAY=1', START)).toBeNull();
  });
  it('diária COM fim (UNTIL) → não avisa (usuário limitou)', () => {
    expect(shouldWarnUnboundedRecurrence('FREQ=DAILY;UNTIL=20260705T000000Z', START)).toBeNull();
  });
  it('diária COM COUNT → não avisa', () => {
    expect(shouldWarnUnboundedRecurrence('FREQ=DAILY;COUNT=3', START)).toBeNull();
  });
  it('sem recorrência → não avisa', () => {
    expect(shouldWarnUnboundedRecurrence(null, START)).toBeNull();
    expect(shouldWarnUnboundedRecurrence('', START)).toBeNull();
  });
});
