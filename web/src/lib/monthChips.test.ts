import { describe, it, expect } from 'vitest';
import { taskChipTone, eventChipTone, ymdInSP, buildMonthDayMap } from './monthChips';

describe('taskChipTone', () => {
  it('done → done', () => expect(taskChipTone({ status: 'done', due_date: '2026-06-01' }, '2026-06-28')).toBe('done'));
  it('vencida e não-done → overdue', () => expect(taskChipTone({ status: 'pending', due_date: '2026-06-10' }, '2026-06-28')).toBe('overdue'));
  it('no prazo → open', () => expect(taskChipTone({ status: 'pending', due_date: '2026-06-28' }, '2026-06-28')).toBe('open'));
  it('sem due_date → open', () => expect(taskChipTone({ status: 'pending', due_date: null }, '2026-06-28')).toBe('open'));
});

describe('eventChipTone', () => {
  it('cancelado → null', () => expect(eventChipTone({ status: 'cancelled' })).toBeNull());
  it('done → eventDone', () => expect(eventChipTone({ status: 'done' })).toBe('eventDone'));
  it('agendado → event', () => expect(eventChipTone({ status: 'scheduled' })).toBe('event'));
});

describe('ymdInSP', () => {
  it('02:00Z do dia 28 ainda é dia 27 em SP (UTC-3)', () =>
    expect(ymdInSP('2026-06-28T02:00:00.000Z')).toBe('2026-06-27'));
  it('12:00Z do dia 15 é dia 15 em SP', () =>
    expect(ymdInSP('2026-06-15T12:00:00.000Z')).toBe('2026-06-15'));
});

describe('buildMonthDayMap', () => {
  const tasks = [
    { id: 't1', title: 'Conta', status: 'pending', due_date: '2026-06-10' },
    { id: 't2', title: 'Sem data', status: 'pending', due_date: null },
  ] as any;
  const events = [
    { id: 'e1', title: 'Reunião', status: 'scheduled', start_at: '2026-06-10T17:00:00.000Z' },
    { id: 'e2', title: 'Cancelado', status: 'cancelled', start_at: '2026-06-10T18:00:00.000Z' },
  ] as any;
  const map = buildMonthDayMap(tasks, events, '2026-06-28');

  it('agrupa por dia e ignora tarefa sem data + evento cancelado', () => {
    expect(map.get('2026-06-10')!.map(c => c.id)).toEqual(['e-e1', 't-t1']);
    expect([...map.keys()]).toEqual(['2026-06-10']);
  });
  it('evento vem antes da tarefa no mesmo dia', () => {
    const day = map.get('2026-06-10')!;
    expect(day[0].kind).toBe('event');
    expect(day[1].kind).toBe('task');
  });
});
