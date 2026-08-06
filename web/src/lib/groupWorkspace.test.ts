import { describe, it, expect } from 'vitest';
import {
  bucketizeGroupTasks, doneWhenLabel, packageInMonth, addDaysYmd,
  collapseRecurringSeries, collapseOpenSeries, recurrenceLabel,
  packageCountUnits, computeGroupStats, groupCountsFromRows,
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

// REGRESSÃO 02/07 → 05/08 (caso Rose, grupo Financeiro): o colapso de série passou
// a valer também pras CONCLUÍDAS. Como o representante da série é a próxima ocorrência
// ABERTA, toda conclusão sumia — "Feitas no mês" ficava estruturalmente 0 pra tarefa
// recorrente (e o engine SEMPRE materializa a próxima ao concluir).
describe('collapseOpenSeries — só as abertas colapsam (hoje=2026-08-05)', () => {
  const today = '2026-08-05';

  it('série com ocorrência concluída no mês + próxima aberta: a concluída NÃO some', () => {
    const rows = [
      t({ id: 'feita', status: 'done', due_date: '2026-08-01', completed_at: '2026-08-03T12:18:53Z', recurrence_parent_id: 'S' }),
      t({ id: 'proxima', due_date: '2026-09-01', recurrence_parent_id: 'S' }),
    ];
    const out = collapseOpenSeries(rows, today);
    expect(out.filter(x => x.status === 'done').map(x => x.id)).toEqual(['feita']);
    expect(bucketizeGroupTasks(out, today).doneRecent.map(x => x.id)).toEqual(['feita']);
  });

  it('anti-flood preservado: 30 ocorrências ABERTAS da mesma série = 1 linha', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      t({ id: `d${i}`, due_date: addDaysYmd('2026-08-06', i), recurrence_parent_id: 'S', series_rule: 'FREQ=DAILY' }));
    const out = collapseOpenSeries(rows, today);
    expect(out.length).toBe(1);
    expect(out[0].recurrence_series_size).toBe(30);
  });

  it('N conclusões da MESMA série contam N (ocorrência é fato, não série)', () => {
    const rows = [
      t({ id: 'f1', status: 'done', due_date: '2026-08-01', completed_at: '2026-08-01T10:00:00Z', recurrence_parent_id: 'S' }),
      t({ id: 'f2', status: 'done', due_date: '2026-08-02', completed_at: '2026-08-02T10:00:00Z', recurrence_parent_id: 'S' }),
      t({ id: 'f3', status: 'done', due_date: '2026-08-03', completed_at: '2026-08-03T10:00:00Z', recurrence_parent_id: 'S' }),
    ];
    expect(collapseOpenSeries(rows, today).filter(x => x.status === 'done').length).toBe(3);
  });

  it('não-recorrentes passam intactas e a ordem das abertas é preservada', () => {
    const rows = [t({ id: 'a', due_date: '2026-08-07' }), t({ id: 'b', due_date: '2026-08-09' })];
    expect(collapseOpenSeries(rows, today).map(x => x.id)).toEqual(['a', 'b']);
  });

  // Dado REAL do pool do grupo Financeiro em 05/08/2026 (9 linhas, todas de série).
  it('pool real do Financeiro: 6 abertas e 3 feitas (a tela mostrava 0 feitas)', () => {
    const rows = [
      t({ id: 'f1', status: 'done', due_date: '2026-08-01', completed_at: '2026-08-03T12:18:53Z', recurrence_parent_id: 'P1' }),
      t({ id: 'f2', status: 'done', due_date: '2026-08-03', completed_at: '2026-08-04T00:58:33Z', recurrence_parent_id: 'P2' }),
      t({ id: 'f3', status: 'done', due_date: '2026-08-03', completed_at: '2026-08-04T00:51:08Z', recurrence_parent_id: 'P3' }),
      t({ id: 'a1', due_date: '2026-08-31', recurrence_parent_id: 'P4' }),
      t({ id: 'a2', due_date: '2026-08-31', recurrence_parent_id: 'P5' }),
      t({ id: 'a3', due_date: '2026-08-31', recurrence_parent_id: 'P6' }),
      t({ id: 'a4', due_date: '2026-09-01', recurrence_parent_id: 'P1' }),
      t({ id: 'a5', due_date: '2026-09-02', recurrence_parent_id: 'P2' }),
      t({ id: 'a6', due_date: '2026-09-03', recurrence_parent_id: 'P3' }),
    ];
    const out = collapseOpenSeries(rows, today);
    const b = bucketizeGroupTasks(out, today);
    expect(b.overdue.length + b.dueSoon.length + b.later.length).toBe(6); // abertas
    expect(out.filter(x => x.status === 'done').length).toBe(3);          // feitas no mês
    expect(b.doneRecent.length).toBe(3);                                  // seção "Feitas recentemente"
  });
});

// Decisão Alf 05/08: os contadores passam a enxergar os PACOTES mensais contando as
// FILHAS (o trabalho real, cada uma com prazo próprio), nunca mãe + filhas junto.
describe('packageCountUnits', () => {
  it('pacote COM filhas: conta as filhas e ignora a mãe (sem dobra)', () => {
    const u = packageCountUnits([{
      status: 'pending', due_date: '2026-08-06', completed_at: null,
      subtasks: [
        { status: 'pending', due_date: '2026-08-06', completed_at: null },
        { status: 'done', due_date: '2026-08-09', completed_at: '2026-08-09T10:00:00Z' },
      ],
    }]);
    expect(u.length).toBe(2);
    expect(u.map(x => x.due_date)).toEqual(['2026-08-06', '2026-08-09']);
  });

  it('pacote SEM filhas: conta a própria mãe como 1 unidade', () => {
    const u = packageCountUnits([{ status: 'pending', due_date: '2026-09-01', completed_at: null, subtasks: [] }]);
    expect(u.length).toBe(1);
    expect(u[0].due_date).toBe('2026-09-01');
  });

  it('mãe concluída com filhas PENDENTES: as filhas seguem contando como abertas', () => {
    const u = packageCountUnits([{
      status: 'done', due_date: '2026-08-01', completed_at: '2026-08-03T12:00:00Z',
      subtasks: [{ status: 'pending', due_date: '2026-08-12', completed_at: null }],
    }]);
    expect(u.length).toBe(1);
    expect(u[0].status).toBe('pending');
  });
});

describe('computeGroupStats — pool + pacotes (hoje=2026-08-05)', () => {
  const today = '2026-08-05';
  const monthStart = '2026-08-01T03:00:00.000Z';

  it('sem pacotes, é só o pool', () => {
    const s = computeGroupStats(
      [{ id: 'a', status: 'pending', due_date: '2026-08-07', completed_at: null }], [], today, monthStart);
    expect(s).toEqual({ abertas: 1, venceEmBreve: 1, atrasadas: 0, feitasNoMes: 0 });
  });

  it('conclusão de mês ANTERIOR não conta em feitasNoMes', () => {
    const s = computeGroupStats(
      [{ id: 'a', status: 'done', due_date: '2026-07-30', completed_at: '2026-07-30T10:00:00Z' }], [], today, monthStart);
    expect(s.feitasNoMes).toBe(0);
  });

  // Estado REAL do grupo Financeiro em 05/08/2026 (banco, 9 linhas de pool + 4 pacotes).
  it('grupo Financeiro 05/08: 19 abertas / 5 vence em breve / 0 atrasadas / 6 feitas', () => {
    const pool = [
      { id: 'f1', status: 'done', due_date: '2026-08-01', completed_at: '2026-08-03T12:18:53Z', recurrence_parent_id: 'P1' },
      { id: 'f2', status: 'done', due_date: '2026-08-03', completed_at: '2026-08-04T00:58:33Z', recurrence_parent_id: 'P2' },
      { id: 'f3', status: 'done', due_date: '2026-08-03', completed_at: '2026-08-04T00:51:08Z', recurrence_parent_id: 'P3' },
      { id: 'a1', status: 'pending', due_date: '2026-08-31', completed_at: null, recurrence_parent_id: 'P4' },
      { id: 'a2', status: 'pending', due_date: '2026-08-31', completed_at: null, recurrence_parent_id: 'P5' },
      { id: 'a3', status: 'pending', due_date: '2026-08-31', completed_at: null, recurrence_parent_id: 'P6' },
      { id: 'a4', status: 'pending', due_date: '2026-09-01', completed_at: null, recurrence_parent_id: 'P1' },
      { id: 'a5', status: 'pending', due_date: '2026-09-02', completed_at: null, recurrence_parent_id: 'P2' },
      { id: 'a6', status: 'pending', due_date: '2026-09-03', completed_at: null, recurrence_parent_id: 'P3' },
    ];
    const kid = (status: string, due: string, done?: string) =>
      ({ status, due_date: due, completed_at: done ?? null });
    const pkgs = [
      // Cashbacks (mãe done 01/08) — 3 filhas concluídas hoje
      { status: 'done', due_date: '2026-08-01', completed_at: '2026-08-05T23:14:21Z', subtasks: [
        kid('done', '2026-08-03', '2026-08-05T23:14:21Z'),
        kid('done', '2026-08-03', '2026-08-05T23:09:04Z'),
        kid('done', '2026-08-03', '2026-08-05T23:09:05Z')] },
      // Conciliação (mãe done 01/08) — 6 filhas PENDENTES, 2 delas vencendo 12/08
      { status: 'done', due_date: '2026-08-01', completed_at: '2026-08-03T12:18:52Z', subtasks: [
        kid('pending', '2026-08-12'), kid('pending', '2026-08-12'), kid('pending', '2026-08-17'),
        kid('pending', '2026-08-25'), kid('pending', '2026-08-25'), kid('pending', '2026-08-27')] },
      // Depósito de Cheques (mãe pending 06/08) — 4 filhas, 3 vencendo <= 12/08
      { status: 'pending', due_date: '2026-08-06', completed_at: null, subtasks: [
        kid('pending', '2026-08-06'), kid('pending', '2026-08-09'),
        kid('pending', '2026-08-12'), kid('pending', '2026-08-21')] },
      // Repasses Maquininha (mãe pending 31/08) — 3 filhas em 30/08
      { status: 'pending', due_date: '2026-08-31', completed_at: null, subtasks: [
        kid('pending', '2026-08-30'), kid('pending', '2026-08-30'), kid('pending', '2026-08-30')] },
    ];
    expect(computeGroupStats(pool, pkgs, today, monthStart)).toEqual({
      abertas: 19,       // 6 do pool (séries colapsadas) + 13 filhas abertas
      venceEmBreve: 5,   // 0 do pool + 5 filhas ate 12/08
      atrasadas: 0,
      feitasNoMes: 6,    // 3 do pool + 3 filhas do Cashbacks
    });
  });
});

describe('groupCountsFromRows — lista /grupos usa a MESMA regra do workspace', () => {
  const today = '2026-08-05';
  const monthStart = '2026-08-01T03:00:00.000Z';
  const G = 'g1';
  const row = (p: Record<string, unknown>) => ({
    id: String(p.id), assigned_group_id: G, status: 'pending', due_date: null, completed_at: null, ...p,
  } as Parameters<typeof groupCountsFromRows>[0][number]);

  it('separa pool / mãe de pacote / filha e não conta mãe+filha em dobro', () => {
    const rows = [
      row({ id: 'pool1', due_date: '2026-08-07' }),                                  // pool: vence em breve
      row({ id: 'mae', is_group: true, due_date: '2026-08-06' }),                     // pacote do mês
      row({ id: 'k1', parent_task_id: 'mae', due_date: '2026-08-06' }),               // filha: vence em breve
      row({ id: 'k2', parent_task_id: 'mae', due_date: '2026-08-25' }),               // filha: mais pra frente
      row({ id: 'k3', parent_task_id: 'mae', status: 'done', completed_at: '2026-08-04T10:00:00Z' }),
    ];
    expect(groupCountsFromRows(rows, [G], today, monthStart)[G])
      .toEqual({ abertas: 3, venceEmBreve: 2, atrasadas: 0, feitasNoMes: 1 }); // mãe NÃO entra
  });

  it('mãe-TEMPLATE (recurrence_rule) e pacote de outro mês ficam de fora', () => {
    const rows = [
      row({ id: 'tmpl', is_group: true, recurrence_rule: 'FREQ=MONTHLY', due_date: '2026-08-01' }),
      row({ id: 'ktmpl', parent_task_id: 'tmpl', due_date: '2026-08-08' }),
      row({ id: 'setembro', is_group: true, due_date: '2026-09-01' }),
      row({ id: 'kset', parent_task_id: 'setembro', due_date: '2026-09-02' }),
    ];
    expect(groupCountsFromRows(rows, [G], today, monthStart)[G])
      .toEqual({ abertas: 0, venceEmBreve: 0, atrasadas: 0, feitasNoMes: 0 });
  });

  it('grupo sem nenhuma linha volta zerado (não quebra)', () => {
    expect(groupCountsFromRows([], ['vazio'], today, monthStart).vazio)
      .toEqual({ abertas: 0, venceEmBreve: 0, atrasadas: 0, feitasNoMes: 0 });
  });

  it('não vaza linha de um grupo pro outro', () => {
    const rows = [
      row({ id: 'a', due_date: '2026-08-07' }),
      row({ id: 'b', assigned_group_id: 'g2', due_date: '2026-08-07' }),
    ];
    const r = groupCountsFromRows(rows, [G, 'g2'], today, monthStart);
    expect(r[G].abertas).toBe(1);
    expect(r.g2.abertas).toBe(1);
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
