// RECUR-EDIT-DUEDATE-DROP (Alf 09/07) — mudar a DATA de uma tarefa recorrente não
// persistia: o executor recebia a data nova em anchor.due_date mas nunca gravava na
// coluna. due_date é POR-OCORRÊNCIA → grava só na âncora, nunca em massa nas futuras.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock encadeável do supabase: registra os payloads de .update() e é thenable
// (await resolve pra {data,error}) pra simular o PostgrestBuilder.
const updateCalls: Array<Record<string, unknown>> = [];
const eqFilters: Array<[string, unknown]> = [];

vi.mock('./supabase', () => {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    update(payload: Record<string, unknown>) { updateCalls.push(payload); return builder; },
    delete() { return builder; },
    insert() { return builder; },
    select() { return builder; },
    eq(col: string, val: unknown) { eqFilters.push([col, val]); return builder; },
    in() { return builder; },
    gte() { return builder; },
    is() { return builder; },
    neq() { return builder; },
    single() { return Promise.resolve({ data: null, error: null }); },
    then(resolve: (v: { data: Array<{ id: string }>; error: null }) => void) {
      resolve({ data: [{ id: 'inst' }], error: null });
    },
  });
  return { supabase: { from: () => builder } };
});

import { editTaskSeries } from './editTaskSeries';

beforeEach(() => { updateCalls.length = 0; eqFilters.length = 0; });

describe('editTaskSeries — grava a nova due_date na âncora', () => {
  const patch = { title: 'Recarga', context: 'work', due_time: null, eisenhower_quadrant: null };

  it('only_this: a âncora recebe due_date com a data editada', async () => {
    const res = await editTaskSeries(
      { id: 'inst', recurrence_parent_id: 'tpl', due_date: '2026-07-09' },
      'only_this', patch, undefined, undefined,
    );
    expect(res.ok).toBe(true);
    const withDue = updateCalls.find((c) => 'due_date' in c);
    expect(withDue).toBeTruthy();
    expect(withDue!.due_date).toBe('2026-07-09');
  });

  it('this_and_future: a âncora recebe due_date (as futuras seguem a regra, não empilham)', async () => {
    const res = await editTaskSeries(
      { id: 'inst', recurrence_parent_id: 'tpl', due_date: '2026-07-09' },
      'this_and_future', patch, undefined, undefined,
    );
    expect(res.ok).toBe(true);
    // due_date aparece exatamente UMA vez (só na âncora) — nunca no patch em massa.
    const dueUpdates = updateCalls.filter((c) => 'due_date' in c);
    expect(dueUpdates).toHaveLength(1);
    expect(dueUpdates[0].due_date).toBe('2026-07-09');
  });
});
