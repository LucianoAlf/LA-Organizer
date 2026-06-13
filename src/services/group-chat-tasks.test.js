// src/services/group-chat-tasks.test.js
// Dedup/update anti-duplicação (GROUPCHAT-TASK-DUP-WEEKDAY) + A (dedup de recorrente)
// + B (ação cancel). Mock encadeável do supabase-js que respeita assigned_group_id/ilike
// e registra inserts/updates (necessário p/ testar o cancel, que é await terminal).
const assert = require('node:assert');
const { test } = require('node:test');
const { applyGroupChatTaskActions, titleSimilarity } = require('./group-chat-tasks');

function makeDb({ tasks = [], events = [] } = {}) {
  function builder() {
    const st = { filters: {}, op: 'select' };
    function resolve() {
      const rows = tasks.filter((t) => {
        if (st.filters.assigned_group_id && t.assigned_group_id !== st.filters.assigned_group_id) return false;
        if (st.filters.id && t.id !== st.filters.id) return false;
        if (st.filters.recurrence_parent_id && t.recurrence_parent_id !== st.filters.recurrence_parent_id) return false;
        if (st.filters.neq_status && t.status === st.filters.neq_status) return false;
        if (st.filters.ilike_title && String(t.title).toLowerCase() !== st.filters.ilike_title) return false;
        return true;
      });
      if (st.op === 'update') {
        rows.forEach((r) => { Object.assign(r, st.patch); events.push({ kind: 'update', id: r.id, patch: st.patch }); });
        return Promise.resolve({ data: rows.map((r) => ({ id: r.id, title: r.title })), error: null });
      }
      if (st.op === 'insert') {
        const row = { id: `new-${tasks.length + 1}`, ...st.row };
        tasks.push(row); events.push({ kind: 'insert', row });
        return Promise.resolve({ data: [row], error: null });
      }
      return Promise.resolve({ data: rows, error: null });
    }
    const b = {
      select() { return b; },
      eq(c, v) { st.filters[c] = v; return b; },
      neq(c, v) { st.filters['neq_' + c] = v; return b; },
      gte() { return b; },
      ilike(c, v) { st.filters['ilike_' + c] = String(v).toLowerCase(); return b; },
      is() { return b; },
      limit() { return b; },
      update(patch) { st.op = 'update'; st.patch = patch; return b; },
      insert(row) { st.op = 'insert'; st.row = row; return b; },
      maybeSingle() { return resolve().then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
      single() { return resolve().then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
      then(res, rej) { return resolve().then(res, rej); },
    };
    return b;
  }
  return { from: () => builder() };
}

const G = (extra) => ({ assigned_group_id: 'g1', status: 'pending', created_at: new Date().toISOString(), ...extra });

test('titleSimilarity: paráfrase quase-igual ~1, cartões diferentes baixo', () => {
  const a = 'Anne separar cheque Dev Ch Dep 341 001030 e Alf redepositar';
  const b = 'Anne: separar cheque Dev Ch Dep 341 001030 para Alf redepositar';
  assert.ok(titleSimilarity(a, b) >= 0.9);
  assert.ok(titleSimilarity('Cartão 8641 (Recreio)', 'Cartão 8434 (Kids CG)') < 0.5);
});

test('correção de data ATUALIZA no lugar — não cria 2ª tarefa (não-recorrente)', async () => {
  const events = [];
  const tasks = [G({ id: 't1', title: 'Anne separar cheque Dev Ch Dep 341 001030 e Alf redepositar', due_date: '2026-06-16' })];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'create', title: 'Anne: separar cheque Dev Ch Dep 341 001030 para Alf redepositar', due_date: '2026-06-15' }],
  });
  assert.strictEqual(events.filter((e) => e.kind === 'insert').length, 0);
  assert.strictEqual(r.created.length, 0);
  assert.strictEqual(r.updated.length, 1);
  assert.strictEqual(r.updated[0].changed.due_date, '2026-06-15');
});

test('tarefa genuinamente diferente é criada', async () => {
  const events = [];
  const tasks = [G({ id: 't1', title: 'Cartão 8641 (Recreio)', due_date: '2026-06-17' })];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'create', title: 'Cartão 8434 (Kids CG)', due_date: '2026-06-25' }],
  });
  assert.strictEqual(events.filter((e) => e.kind === 'insert').length, 1);
  assert.strictEqual(r.created.length, 1);
});

test('duas creates iguais no MESMO batch → 1 insere, 2ª dedup', async () => {
  const events = [];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [
      { action: 'create', title: 'Pedir nota fiscal ao fornecedor', due_date: '2026-06-20' },
      { action: 'create', title: 'Pedir nota fiscal pro fornecedor', due_date: '2026-06-20' },
    ],
  });
  assert.strictEqual(events.filter((e) => e.kind === 'insert').length, 1);
  assert.strictEqual(r.created.length, 1);
  assert.strictEqual(r.updated.length, 1);
});

test('A: create recorrente recente de título parecido ATUALIZA a série (não duplica)', async () => {
  const events = [];
  const tasks = [G({ id: 'rec-1', title: 'Depósito de cheques Vencto 20', due_date: '2026-06-21', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=21' })];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'create', title: 'Depósito de cheques Vencto 20', due_date: '2026-06-21', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=20' }],
  });
  assert.strictEqual(events.filter((e) => e.kind === 'insert').length, 0, 'não insere nova série');
  const upd = events.find((e) => e.kind === 'update' && e.id === 'rec-1');
  assert.ok(upd && upd.patch.recurrence_rule === 'FREQ=MONTHLY;BYMONTHDAY=20');
  assert.ok(r.updated.length >= 1);
});

test('B: cancel soft remove tarefa recente do grupo por título', async () => {
  const events = [];
  const tasks = [G({ id: 'dup-1', title: 'Tarefa errada', is_group: false })];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'cancel', title: 'Tarefa errada' }],
  });
  assert.ok(events.find((e) => e.kind === 'update' && e.id === 'dup-1' && e.patch.status === 'cancelled'));
  assert.strictEqual((r.cancelled || []).length, 1);
  assert.strictEqual(r.cancelled[0].id, 'dup-1');
});

test('B: cancel não pega tarefa de outro grupo', async () => {
  const events = [];
  const tasks = [{ id: 'x', title: 'Outra', status: 'pending', assigned_group_id: 'OUTRO', created_at: new Date().toISOString() }];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'cancel', title: 'Outra' }],
  });
  assert.strictEqual((r.cancelled || []).length, 0);
  assert.ok(r.failed.some((f) => f.why === 'not_found_or_too_old'));
});
