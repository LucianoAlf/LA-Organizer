// src/services/group-chat-tasks.test.js — dedup/update anti-duplicação (GROUPCHAT-TASK-DUP-WEEKDAY)
const assert = require('node:assert');
const { test } = require('node:test');
const { applyGroupChatTaskActions, titleSimilarity } = require('./group-chat-tasks');

// Fake supabase mínimo: candidates pré-carregadas; registra inserts/updates.
function makeSupabase(candidates) {
  const store = { inserts: [], updates: [] };
  let n = 0;
  function builder() {
    return {
      _op: 'select', _row: null, _patch: null, _star: false,
      select(cols) { if (cols === '*') this._star = true; return this; },
      eq() { return this; }, neq() { return this; }, gte() { return this; }, ilike() { return this; },
      insert(row) { this._op = 'insert'; this._row = row; return this; },
      update(patch) { this._op = 'update'; this._patch = patch; return this; },
      limit() { return Promise.resolve({ data: candidates }); },
      single() { store.inserts.push(this._row); return Promise.resolve({ data: { id: 'new' + (++n), title: this._row.title }, error: null }); },
      maybeSingle() {
        if (this._op === 'update') { store.updates.push(this._patch); return Promise.resolve({ data: { id: 'upd', title: 'upd' } }); }
        return Promise.resolve({ data: null }); // fullTpl (select *) → null → pula materialize
      },
      then(res, rej) { return Promise.resolve({ data: candidates }).then(res, rej); },
    };
  }
  return { sb: { from() { return builder(); } }, store };
}

test('titleSimilarity: paráfrase quase-igual ~1, cartões diferentes baixo', () => {
  const a = 'Anne separar cheque Dev Ch Dep 341 001030 e Alf redepositar';
  const b = 'Anne: separar cheque Dev Ch Dep 341 001030 para Alf redepositar';
  assert.ok(titleSimilarity(a, b) >= 0.9, 'paráfrase deve ser ~idêntica');
  assert.ok(titleSimilarity('Cartão 8641 (Recreio)', 'Cartão 8434 (Kids CG)') < 0.5, 'cartões distintos não casam');
});

test('correção de data ATUALIZA no lugar — não cria 2ª tarefa', async () => {
  const cand = [{ id: 't1', title: 'Anne separar cheque Dev Ch Dep 341 001030 e Alf redepositar', due_date: '2026-06-16' }];
  const { sb, store } = makeSupabase(cand);
  const r = await applyGroupChatTaskActions({
    supabase: sb, groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'create', title: 'Anne: separar cheque Dev Ch Dep 341 001030 para Alf redepositar', due_date: '2026-06-15' }],
  });
  assert.equal(store.inserts.length, 0, 'não deve inserir nova');
  assert.equal(r.created.length, 0);
  assert.equal(r.updated.length, 1);
  assert.equal(r.updated[0].changed.due_date, '2026-06-15');
});

test('tarefa genuinamente diferente é criada', async () => {
  const cand = [{ id: 't1', title: 'Cartão 8641 (Recreio)', due_date: '2026-06-17' }];
  const { sb, store } = makeSupabase(cand);
  const r = await applyGroupChatTaskActions({
    supabase: sb, groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'create', title: 'Cartão 8434 (Kids CG)', due_date: '2026-06-25' }],
  });
  assert.equal(store.inserts.length, 1);
  assert.equal(r.created.length, 1);
  assert.equal(r.updated.length, 0);
});

test('duas creates iguais no MESMO batch → 1 insere, 2ª dedup', async () => {
  const { sb, store } = makeSupabase([]);
  const r = await applyGroupChatTaskActions({
    supabase: sb, groupId: 'g1', senderCollabId: 'c1',
    actions: [
      { action: 'create', title: 'Pedir nota fiscal ao fornecedor', due_date: '2026-06-20' },
      { action: 'create', title: 'Pedir nota fiscal pro fornecedor', due_date: '2026-06-20' },
    ],
  });
  assert.equal(store.inserts.length, 1, 'só a 1ª insere');
  assert.equal(r.created.length, 1);
  assert.equal(r.updated.length, 1, 'a 2ª é absorvida como já-feita');
});

test('recorrente NUNCA entra no dedup-update (insere mesmo com título parecido)', async () => {
  const cand = [{ id: 't1', title: 'Conciliação de Cartões', due_date: '2026-06-01' }];
  const { sb, store } = makeSupabase(cand);
  const r = await applyGroupChatTaskActions({
    supabase: sb, groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'create', title: 'Conciliação de Cartões', due_date: '2026-07-01', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=1' }],
  });
  assert.equal(store.inserts.length, 1);
  assert.equal(r.created.length, 1);
});
