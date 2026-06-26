'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createSubtasks } = require('./subtasks');

function fakeSupabase(captured) {
  return {
    from: () => ({
      insert: (rows) => {
        captured.rows = rows;
        return { select: () => ({ data: rows.map((_, i) => ({ id: 'c' + i })), error: null }) };
      },
    }),
  };
}

test('cria filhas herdando context/assigned do pai, is_group=false', async () => {
  const cap = {};
  const parent = { id: 'p', parent_task_id: null, context: 'personal', assigned_to: 'u1', assigned_group_id: null };
  const r = await createSubtasks({ supabase: fakeSupabase(cap), parentId: 'p', texts: ['a', 'b'], parent, createdBy: 'u1' });
  assert.equal(r.created, 2);
  assert.equal(cap.rows.length, 2);
  assert.equal(cap.rows[0].parent_task_id, 'p');
  assert.equal(cap.rows[0].is_group, false);
  assert.equal(cap.rows[0].context, 'personal');
  assert.equal(cap.rows[0].assigned_to, 'u1');
  assert.equal(cap.rows[1].sort_position, 2);
});

test('herda assigned_group_id do pai (grupo)', async () => {
  const cap = {};
  const parent = { id: 'g', parent_task_id: null, context: 'work', assigned_to: null, assigned_group_id: 'grp1' };
  await createSubtasks({ supabase: fakeSupabase(cap), parentId: 'g', texts: ['x'], parent, createdBy: 'u1' });
  assert.equal(cap.rows[0].assigned_group_id, 'grp1');
  assert.equal(cap.rows[0].context, 'work');
});

test('ignora textos vazios; lista vazia => 0', async () => {
  const cap = {};
  const parent = { id: 'p', parent_task_id: null, context: 'personal' };
  const r = await createSubtasks({ supabase: fakeSupabase(cap), parentId: 'p', texts: ['  ', '', 'ok'], parent, createdBy: 'u1' });
  assert.equal(r.created, 1);
  const r2 = await createSubtasks({ supabase: fakeSupabase({}), parentId: 'p', texts: [], parent, createdBy: 'u1' });
  assert.equal(r2.created, 0);
});

test('recusa filho-de-filho (1 nivel so)', async () => {
  const parent = { id: 'c', parent_task_id: 'p', context: 'personal' };
  await assert.rejects(
    () => createSubtasks({ supabase: fakeSupabase({}), parentId: 'c', texts: ['x'], parent, createdBy: 'u1' }),
    /nested|nivel|child-of-child/i,
  );
});
