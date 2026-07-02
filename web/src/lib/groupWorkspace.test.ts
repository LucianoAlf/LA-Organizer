import { describe, it, expect } from 'vitest';
import {
  bucketizeGroupTasks, doneWhenLabel, packageInMonth, addDaysYmd,
  collapseRecurringSeries, recurrenceLabel,
  type PoolTask, type PoolTaskStatus,
} from './groupWorkspace';

// Ensure PoolTaskStatus is used (type-check only)
type _CheckStatus = PoolTaskStatus;

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
  it('done sem completed_at NÃO aparece em nenhum bucket', () => {
    const r = bucketizeGroupTasks([
      t({ id: 'z', status: 'done', completed_at: null }),
    ], '2026-06-10');
    const allIds = [...r.overdue, ...r.dueSoon, ...r.later, ...r.doneRecent].map(x => x.id);
    expect(allIds).not.toContain('z');
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
  it('done sem due_date fica fora', () => {
    expect(packageInMonth({ status: 'done', due_date: null }, '2026-06')).toBe(false);
  });
});

describe('addDaysYmd', () => {
  it('soma atravessando o mês', () => expect(addDaysYmd('2026-06-28', 7)).toBe('2026-07-05'));
});

describe('collapseRecurringSeries (hoje=2026-07-02)', () => {
  const today = '2026-07-02';

  it('tarefas não-recorrentes passam intactas (ordem preservada)', () => {
    const rows = [t({ id: 'a', due_date: '2026-07-03' }), t({ id: 'b', due_date: '2026-07-05' })];
    const out = collapseRecurringSeries(rows, today);
    expect(out.map(x => x.id)).toEqual(['a', 'b']);
    expect(out.every(x => x.recurrence_series_size === undefined)).toBe(true);
  });

  it('série diária (template + instâncias) colapsa em 1 = próxima ocorrência', () => {
    const rows = [
      t({ id: 'tmpl', status: 'done', due_date: '2026-06-25', recurrence_rule: 'FREQ=DAILY', series_rule: 'FREQ=DAILY' }),
      t({ id: 'i1', due_date: '2026-07-01', status: 'done', completed_at: '2026-07-01T12:00:00Z', recurrence_parent_id: 'tmpl', series_rule: 'FREQ=DAILY' }),
      t({ id: 'i2', due_date: '2026-07-03', recurrence_parent_id: 'tmpl', series_rule: 'FREQ=DAILY' }),
      t({ id: 'i3', due_date: '2026-07-04', recurrence_parent_id: 'tmpl', series_rule: 'FREQ=DAILY' }),
    ];
    const out = collapseRecurringSeries(rows, today);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('i2');                    // próxima aberta >= hoje
    expect(out[0].recurrence_series_size).toBe(4);   // 4 dobradas
    expect(out[0].series_rule).toBe('FREQ=DAILY');
  });

  it('série toda concluída colapsa na done mais recente', () => {
    const rows = [
      t({ id: 'x', status: 'done', due_date: '2026-06-30', completed_at: '2026-06-30T10:00:00Z', recurrence_parent_id: 'p' }),
      t({ id: 'y', status: 'done', due_date: '2026-07-01', completed_at: '2026-07-01T10:00:00Z', recurrence_parent_id: 'p' }),
    ];
    const out = collapseRecurringSeries(rows, today);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('y');
  });

  it('duas séries distintas NÃO se fundem', () => {
    const rows = [
      t({ id: 'a1', due_date: '2026-07-03', recurrence_parent_id: 'A', series_rule: 'FREQ=DAILY' }),
      t({ id: 'a2', due_date: '2026-07-04', recurrence_parent_id: 'A', series_rule: 'FREQ=DAILY' }),
      t({ id: 'b1', due_date: '2026-07-03', recurrence_parent_id: 'B', series_rule: 'FREQ=WEEKLY;BYDAY=TH' }),
    ];
    const out = collapseRecurringSeries(rows, today);
    expect(out.length).toBe(2);
    expect(out.map(x => x.recurrence_parent_id).sort()).toEqual(['A', 'B']);
  });

  it('só atrasadas: pega a mais recente (maior due)', () => {
    const rows = [
      t({ id: 'o1', due_date: '2026-06-20', recurrence_parent_id: 'P', series_rule: 'FREQ=DAILY' }),
      t({ id: 'o2', due_date: '2026-06-28', recurrence_parent_id: 'P', series_rule: 'FREQ=DAILY' }),
    ];
    const out = collapseRecurringSeries(rows, today);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('o2');
  });

  it('colapso + bucketize: série diária aparece 1× em vence-em-breve', () => {
    const rows = [
      t({ id: 'plain', due_date: '2026-07-03' }),
      ...Array.from({ length: 30 }, (_, i) =>
        t({ id: `d${i}`, due_date: addDaysYmd('2026-07-03', i), recurrence_parent_id: 'S', series_rule: 'FREQ=DAILY' })),
    ];
    const collapsed = collapseRecurringSeries(rows, today);
    expect(collapsed.length).toBe(2); // 1 plain + 1 série
    const b = bucketizeGroupTasks(collapsed, today);
    const total = b.overdue.length + b.dueSoon.length + b.later.length;
    expect(total).toBe(2);
  });
});

describe('recurrenceLabel', () => {
  it('mapeia frequências comuns', () => {
    expect(recurrenceLabel('FREQ=DAILY')).toBe('diária');
    expect(recurrenceLabel('FREQ=WEEKLY;BYDAY=MO')).toBe('semanal');
    expect(recurrenceLabel('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('dias úteis');
    expect(recurrenceLabel('FREQ=MONTHLY;BYMONTHDAY=1')).toBe('mensal');
    expect(recurrenceLabel('FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=1')).toBe('anual');
  });
  it('intervalo > 1', () => {
    expect(recurrenceLabel('FREQ=DAILY;INTERVAL=2')).toBe('a cada 2d');
    expect(recurrenceLabel('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1')).toBe('a cada 3m');
  });
  it('null/vazio → null', () => {
    expect(recurrenceLabel(null)).toBeNull();
    expect(recurrenceLabel('')).toBeNull();
  });
});
