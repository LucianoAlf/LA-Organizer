import { describe, it, expect } from 'vitest';
import { bucketizeGroupTasks, doneWhenLabel, packageInMonth, addDaysYmd, type PoolTask } from './groupWorkspace';

const t = (p: Partial<PoolTask>): PoolTask => ({
  id: Math.random().toString(36).slice(2), title: 'x', status: 'pending',
  due_date: null, due_time: null, completed_at: null, created_by: null,
  creator_name: null, completed_by_name: null, description: null, ...p,
});

describe('bucketizeGroupTasks (hoje=2026-06-10)', () => {
  const today = '2026-06-10';
  it('separa atrasada / vence em breve / mais pra frente / sem prazo / feitas', () => {
    const r = bucketizeGroupTasks([
      t({ id: 'a', due_date: '2026-06-08' }),
      t({ id: 'b', due_date: '2026-06-10' }),
      t({ id: 'c', due_date: '2026-06-17' }),
      t({ id: 'd', due_date: '2026-06-18' }),
      t({ id: 'e', due_date: null }),
      t({ id: 'f', status: 'done', completed_at: '2026-06-10T17:02:00Z' }),
    ], today);
    expect(r.overdue.map(x => x.id)).toEqual(['a']);
    expect(r.dueSoon.map(x => x.id)).toEqual(['b', 'c']);
    expect(r.later.map(x => x.id)).toEqual(['d', 'e']);
    expect(r.doneRecent.map(x => x.id)).toEqual(['f']);
  });
  it('doneRecent: desc por completed_at, máx 10', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      t({ id: `d${i}`, status: 'done', completed_at: `2026-06-0${(i % 9) + 1}T0${i % 10}:00:00Z` }));
    const r = bucketizeGroupTasks(many, '2026-06-10');
    expect(r.doneRecent.length).toBe(10);
    const ts = r.doneRecent.map(x => x.completed_at!);
    expect([...ts].sort().reverse()).toEqual(ts);
  });
  it('ordena abertas por due asc (sem prazo no fim de later)', () => {
    const r = bucketizeGroupTasks([
      t({ id: 'p', due_date: null }), t({ id: 'q', due_date: '2026-06-20' }),
    ], '2026-06-10');
    expect(r.later.map(x => x.id)).toEqual(['q', 'p']);
  });
});

describe('doneWhenLabel (BRT)', () => {
  const now = '2026-06-10T23:30:00.000Z'; // 20:30 BRT de 10/06
  it('hoje → "hoje HH:MM"', () => expect(doneWhenLabel('2026-06-10T17:02:00Z', now)).toBe('hoje 14:02'));
  it('ontem → "ontem"', () => expect(doneWhenLabel('2026-06-09T15:00:00Z', now)).toBe('ontem'));
  it('antes → DD/MM', () => expect(doneWhenLabel('2026-06-01T15:00:00Z', now)).toBe('01/06'));
});

describe('packageInMonth (ym=2026-06)', () => {
  const m = (p: Record<string, unknown>) => ({ status: 'pending', due_date: null, ...p } as { status: string; due_date: string | null });
  it('due no mês entra (aberto ou done)', () => {
    expect(packageInMonth(m({ due_date: '2026-06-01', status: 'done' }), '2026-06')).toBe(true);
  });
  it('aberto atrasado de mês anterior entra', () => {
    expect(packageInMonth(m({ due_date: '2026-05-15' }), '2026-06')).toBe(true);
  });
  it('done de mês anterior fica fora; ciclo futuro fica fora', () => {
    expect(packageInMonth(m({ due_date: '2026-05-01', status: 'done' }), '2026-06')).toBe(false);
    expect(packageInMonth(m({ due_date: '2026-07-01' }), '2026-06')).toBe(false);
  });
  it('sem prazo aberto entra', () => expect(packageInMonth(m({}), '2026-06')).toBe(true));
});

describe('addDaysYmd', () => {
  it('soma atravessando o mês', () => expect(addDaysYmd('2026-06-28', 7)).toBe('2026-07-05'));
});
