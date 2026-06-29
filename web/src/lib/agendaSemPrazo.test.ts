import { describe, it, expect } from 'vitest';
import { isNoPrazoOpen, filterNoPrazo } from './agendaSemPrazo';

const T = (o: Partial<Parameters<typeof isNoPrazoOpen>[0]>) => ({
  due_date: null, status: 'pending', parent_task_id: null, is_group: false, ...o,
});

describe('isNoPrazoOpen', () => {
  it('aberta + sem due + topo + não-grupo → true', () => expect(isNoPrazoOpen(T({}))).toBe(true));
  it('due_date vazio "" também conta como sem prazo', () => expect(isNoPrazoOpen(T({ due_date: '' }))).toBe(true));
  it('com due_date → false', () => expect(isNoPrazoOpen(T({ due_date: '2026-06-30' }))).toBe(false));
  it('done → false', () => expect(isNoPrazoOpen(T({ status: 'done' }))).toBe(false));
  it('cancelled → false', () => expect(isNoPrazoOpen(T({ status: 'cancelled' }))).toBe(false));
  it('filha de checklist (parent_task_id) → false', () => expect(isNoPrazoOpen(T({ parent_task_id: 'abc' }))).toBe(false));
  it('grupo (is_group) → false', () => expect(isNoPrazoOpen(T({ is_group: true }))).toBe(false));
});

describe('filterNoPrazo', () => {
  const list = [
    T({ context: 'work', sort_position: 2, created_at: '2026-06-01' }),
    T({ context: 'personal', sort_position: 1 }),
    T({ context: 'work', due_date: '2026-07-01' }), // datada → fora
    T({ context: 'work', status: 'done' }),         // done → fora
    T({ context: 'work', parent_task_id: 'p' }),     // filha → fora
  ];
  it('só abertas sem prazo de topo', () => {
    expect(filterNoPrazo(list).length).toBe(2);
  });
  it('filtra por context', () => {
    expect(filterNoPrazo(list, 'work').length).toBe(1);
    expect(filterNoPrazo(list, 'personal').length).toBe(1);
  });
  it('ordena por sort_position', () => {
    const out = filterNoPrazo(list);
    expect(out[0].context).toBe('personal'); // sort_position 1 < 2
  });
  it('lista vazia/nula → []', () => {
    expect(filterNoPrazo([] as ReturnType<typeof T>[])).toEqual([]);
  });
});
