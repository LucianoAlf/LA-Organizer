const { test } = require('node:test');
const assert = require('node:assert');
const { createGroupNote, appendGroupNote, groupNotesContext } = require('./group-notes');

function fakeDb({ notes = [] } = {}) {
  const ev = [];
  function b() {
    const st = { filters: {}, op: 'select' };
    function resolve() {
      let rows = notes.filter((n) => (!st.filters.group_id || n.group_id === st.filters.group_id)
        && (!st.filters.ilike_title || n.title.toLowerCase() === st.filters.ilike_title));
      if (st.op === 'insert') { const row = { id: `n${notes.length + 1}`, ...st.row }; notes.push(row); ev.push(['insert', row]); return Promise.resolve({ data: { id: row.id }, error: null }); }
      if (st.op === 'update') { rows.forEach((r) => { Object.assign(r, st.patch); ev.push(['update', r.id, st.patch]); }); return Promise.resolve({ data: rows, error: null }); }
      return Promise.resolve({ data: rows, error: null });
    }
    const q = {
      select() { return q; }, eq(c, v) { st.filters[c] = v; return q; }, neq() { return q; },
      order() { return q; }, ilike(c, v) { st.filters['ilike_' + c] = String(v).toLowerCase(); return q; }, limit() { return q; },
      insert(row) { st.op = 'insert'; st.row = row; return q; }, update(p) { st.op = 'update'; st.patch = p; return q; },
      single() { return resolve().then((r) => ({ data: r.data, error: null })); },
      maybeSingle() { return resolve().then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
      then(res, rej) { return resolve().then(res, rej); },
    };
    return q;
  }
  return { sb: { from: () => b() }, ev, notes };
}

test('createGroupNote insere com category/tags/created_by', async () => {
  const { sb, ev } = fakeDb();
  await createGroupNote({ supabase: sb, groupId: 'g1', createdBy: 'u1', note: { title: 'Acesso Zoho', category: 'Acessos', tags: ['Zoho'], body: 'login: x' } });
  const ins = ev.find((e) => e[0] === 'insert')[1];
  assert.strictEqual(ins.group_id, 'g1'); assert.strictEqual(ins.category, 'Acessos');
  assert.deepStrictEqual(ins.tags, ['Zoho']); assert.strictEqual(ins.created_by, 'u1');
});

test('appendGroupNote concatena no body por título', async () => {
  const notes = [{ id: 'n1', group_id: 'g1', title: 'Contas', body: 'linha 1' }];
  const { sb, ev } = fakeDb({ notes });
  await appendGroupNote({ supabase: sb, groupId: 'g1', updatedBy: 'u1', title: 'Contas', body: 'linha 2' });
  const up = ev.find((e) => e[0] === 'update');
  assert.ok(up[2].body.includes('linha 1') && up[2].body.includes('linha 2'));
});

test('groupNotesContext: índice de todas + body só das pinned', async () => {
  const notes = [
    { id: 'n1', group_id: 'g1', title: 'CNPJs', category: 'Fiscal', tags: ['fiscal'], body: 'X', pinned: true },
    { id: 'n2', group_id: 'g1', title: 'Reunião', category: 'Reuniões', tags: [], body: 'Y', pinned: false },
  ];
  const { sb } = fakeDb({ notes });
  const ctx = await groupNotesContext({ supabase: sb, groupId: 'g1' });
  assert.ok(ctx.includes('CNPJs') && ctx.includes('Reunião'));     // índice tem as duas
  assert.ok(ctx.includes('X'));                                     // body da pinned
  assert.ok(!ctx.includes('Y'));                                    // body da não-pinned fica fora
});
