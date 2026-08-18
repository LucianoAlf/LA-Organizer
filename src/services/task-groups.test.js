const { test } = require('node:test');
const assert = require('node:assert');
const { createTaskGroup, weekendAdjustRrule } = require('./task-groups');

// supabase fake: captura inserts em 'tasks', gera ids sequenciais.
function fakeSupabase(captured) {
  let n = 0;
  return {
    from() {
      return {
        insert(row) {
          return { select() { return {
            single() {
              const id = `id-${++n}`;
              captured.push({ ...row, id });
              return Promise.resolve({ data: { id }, error: null });
            },
            maybeSingle() {
              const id = `id-${++n}`;
              captured.push({ ...row, id });
              return Promise.resolve({ data: { id }, error: null });
            },
          }; } };
        },
        select() { return { eq() { return {
          single() { return Promise.resolve({ data: captured[0] || null }); },
          maybeSingle() { return Promise.resolve({ data: captured[0] || null }); },
        }; } }; },
      };
    },
  };
}

test('weekendAdjustRrule monta BYSETPOS até o group_day', () => {
  assert.strictEqual(
    weekendAdjustRrule(4),
    'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYMONTHDAY=1,2,3,4;BYSETPOS=-1'
  );
});

test('createTaskGroup simples: mãe is_group + filhas com parent_task_id', async () => {
  const captured = [];
  const deps = { materializeSeries: async () => {} };
  const res = await createTaskGroup({
    supabase: fakeSupabase(captured), groupId: 'g1', createdBy: 'u1', deps,
    input: { title: 'Preparar reunião', recurrence: null, subtasks: [
      { title: 'Reservar sala', dueDate: '2026-06-20' },
      { title: 'Enviar pauta', dueDate: '2026-06-19' },
    ] },
  });
  const mother = captured.find((t) => t.is_group);
  assert.ok(mother);
  assert.strictEqual(mother.assigned_group_id, 'g1');
  const kids = captured.filter((t) => t.parent_task_id === mother.id);
  assert.strictEqual(kids.length, 2);
  assert.strictEqual(res.groupId, mother.id);
});

test('createTaskGroup mensal: template (recurrence_rule) + instância (recurrence_parent_id) + filhas dos dois', async () => {
  const captured = [];
  let materialized = null;
  const deps = { materializeSeries: async (_t, tpl) => { materialized = tpl; } };
  const res = await createTaskGroup({
    supabase: fakeSupabase(captured), groupId: 'g1', createdBy: 'u1', deps,
    input: { title: 'Conciliação de Cartões', recurrence: 'monthly', groupDay: 1, subtasks: [
      { title: 'Cartão 8516 (Barra)', day: 12 },
      { title: 'Cartão 2270 (EMLA)', day: 12 },
    ] },
  });
  const tpl = captured.find((t) => t.is_group && t.recurrence_rule);
  const inst = captured.find((t) => t.is_group && t.recurrence_parent_id === tpl.id);
  assert.ok(tpl && inst);
  assert.strictEqual(tpl.recurrence_rule, 'FREQ=MONTHLY;BYMONTHDAY=1');
  assert.strictEqual(inst.recurrence_rule, undefined); // instância visível não tem rrule
  const tplKids = captured.filter((t) => t.parent_task_id === tpl.id);
  const instKids = captured.filter((t) => t.parent_task_id === inst.id);
  assert.strictEqual(tplKids.length, 2);
  assert.strictEqual(instKids.length, 2);
  assert.ok(instKids.every((k) => tplKids.some((tk) => tk.id === k.recurrence_parent_id)));
  assert.strictEqual(materialized.id, tpl.id);
  assert.strictEqual(res.groupId, inst.id);
});

test('createTaskGroup mensal: is_recurrence_template marca molde+blueprint, instância fica false', async () => {
  const captured = [];
  const deps = { materializeSeries: async () => {} };
  await createTaskGroup({
    supabase: fakeSupabase(captured), groupId: 'g1', createdBy: 'u1', deps,
    input: { title: 'Conciliação de Cartões', recurrence: 'monthly', groupDay: 1, subtasks: [
      { title: 'Dia 3', day: 3 }, { title: 'Dia 15', day: 15 },
    ] },
  });
  const tpl = captured.find((t) => t.is_group && t.recurrence_rule);
  const inst = captured.find((t) => t.is_group && t.recurrence_parent_id === tpl.id);
  const tplKids = captured.filter((t) => t.parent_task_id === tpl.id);
  const instKids = captured.filter((t) => t.parent_task_id === inst.id);
  // molde + filhas-blueprint = template (invisíveis ao predicado de "vivo")
  assert.strictEqual(tpl.is_recurrence_template, true, 'molde deve ser template');
  assert.ok(tplKids.length === 2 && tplKids.every((k) => k.is_recurrence_template === true), 'filhas-blueprint devem ser template');
  // mãe-instância + filhas-instância = NÃO template (DEFAULT false; nunca marcadas)
  assert.notStrictEqual(inst.is_recurrence_template, true, 'mãe-instância NÃO é template');
  assert.ok(instKids.length === 2 && instKids.every((k) => k.is_recurrence_template !== true), 'filhas-instância NÃO são template');
});

test('createTaskGroup mensal weekend_adjust usa a rrule de dia-útil', async () => {
  const captured = [];
  await createTaskGroup({
    supabase: fakeSupabase(captured), groupId: 'g1', createdBy: 'u1',
    deps: { materializeSeries: async () => {} },
    input: { title: 'Aplicar cashbacks', recurrence: 'monthly', groupDay: 4, weekendAdjust: 'previous_friday',
      subtasks: [{ title: 'Recreio', day: 4 }] },
  });
  const tpl = captured.find((t) => t.is_group && t.recurrence_rule);
  assert.strictEqual(tpl.recurrence_rule, 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYMONTHDAY=1,2,3,4;BYSETPOS=-1');
});

const { addSubtasksToGroup } = require('./task-groups');

test('addSubtasksToGroup mensal: insere filha no template e na instância', async () => {
  const captured = [];
  let n = 0;
  const instance = { id: 'inst-1', title: 'Conciliação de Cartões', due_date: '2026-06-01', recurrence_parent_id: 'tpl-1', recurrence_rule: null, assigned_group_id: 'g1', created_by: 'u1' };
  const template = { id: 'tpl-1', due_date: '2026-06-01' };
  const supabase = {
    from() {
      return {
        select() { return {
          eq(_col, val) { return {
            single() { return Promise.resolve({ data: val === 'inst-1' ? instance : template }); },
            maybeSingle() { return Promise.resolve({ data: val === 'inst-1' ? instance : template }); },
          }; },
        }; },
        insert(row) { return { select() { return { single() { const id = `new-${++n}`; captured.push({ ...row, id }); return Promise.resolve({ data: { id }, error: null }); } }; } }; },
      };
    },
  };
  const res = await addSubtasksToGroup({
    supabase, groupId: 'inst-1',
    subtasks: [{ title: 'Cartão Novo (CG)', day: 15 }],
  });
  const tplKid = captured.find((t) => t.parent_task_id === 'tpl-1');
  const instKid = captured.find((t) => t.parent_task_id === 'inst-1');
  assert.ok(tplKid && instKid);
  assert.strictEqual(instKid.recurrence_parent_id, tplKid.id);
  assert.strictEqual(res.added.length, 1);
});
