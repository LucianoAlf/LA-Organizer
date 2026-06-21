// src/utils/batch-complete.test.js
// Testa o executor determinístico do fechamento em lote (BATCH-COMPLETE-CONFIRM-NOOP).
const { test } = require('node:test');
const assert = require('node:assert');
const { executeBatchComplete } = require('./batch-complete');

// supabase falso: registra os updates aplicados; failIds simula erro de escrita.
function fakeSupabase(updates, failIds = new Set()) {
  return {
    from() {
      let patch = null;
      const builder = {
        update(p) { patch = p; return builder; },
        eq(col, val) {
          if (failIds.has(val)) return Promise.resolve({ error: { message: 'boom' } });
          updates.push({ col, val, patch });
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
}

// resolve falso: map de short-id → task (ou ausente = null).
function fakeResolver(map) {
  return async (_collabId, sid) => (Object.prototype.hasOwnProperty.call(map, sid) ? map[sid] : null);
}

test('lote inteiro resolve → conclui todas, status/completed_by/completed_at corretos', async () => {
  const updates = [];
  const supabase = fakeSupabase(updates);
  const resolveTaskByShortId = fakeResolver({
    e591b0c0: { id: 'e591b0c0-full', title: 'Yuri boas-vindas' },
    '2d1b2b17': { id: '2d1b2b17-full', title: 'Hugo LAReport' },
  });
  const r = await executeBatchComplete({
    supabase, resolveTaskByShortId, collaboratorId: 'fabi',
    ids: ['e591b0c0', '2d1b2b17'], now: '2026-06-21T10:00:00.000Z',
  });
  assert.strictEqual(r.okCount, 2);
  assert.strictEqual(r.total, 2);
  assert.deepStrictEqual(r.okTitles, ['Yuri boas-vindas', 'Hugo LAReport']);
  assert.strictEqual(updates.length, 2);
  assert.strictEqual(updates[0].val, 'e591b0c0-full');
  assert.deepStrictEqual(updates[0].patch, {
    status: 'done', completed_at: '2026-06-21T10:00:00.000Z', completed_by: 'fabi',
  });
});

test('short-id stale (não resolve) → pula, conclui só o que existe', async () => {
  const updates = [];
  const supabase = fakeSupabase(updates);
  const resolveTaskByShortId = fakeResolver({ aaaaaaaa: { id: 'aaaaaaaa-full', title: 'Existe' } });
  const r = await executeBatchComplete({
    supabase, resolveTaskByShortId, collaboratorId: 'x', ids: ['aaaaaaaa', 'ffffffff'],
  });
  assert.strictEqual(r.okCount, 1);
  assert.strictEqual(r.total, 2);
  assert.deepStrictEqual(r.okTitles, ['Existe']);
  assert.strictEqual(updates.length, 1);
});

test('erro de escrita em uma → não conta como concluída', async () => {
  const updates = [];
  const supabase = fakeSupabase(updates, new Set(['bbbbbbbb-full']));
  const resolveTaskByShortId = fakeResolver({
    aaaaaaaa: { id: 'aaaaaaaa-full', title: 'OK' },
    bbbbbbbb: { id: 'bbbbbbbb-full', title: 'Falha' },
  });
  const r = await executeBatchComplete({
    supabase, resolveTaskByShortId, collaboratorId: 'x', ids: ['aaaaaaaa', 'bbbbbbbb'],
  });
  assert.strictEqual(r.okCount, 1);
  assert.deepStrictEqual(r.okTitles, ['OK']);
});

test('resolver lança exceção → trata como não-encontrado, segue o lote', async () => {
  const updates = [];
  const supabase = fakeSupabase(updates);
  const resolveTaskByShortId = async (_c, sid) => {
    if (sid === 'boom') throw new Error('db down');
    return { id: sid + '-full', title: 'T-' + sid };
  };
  const r = await executeBatchComplete({
    supabase, resolveTaskByShortId, collaboratorId: 'x', ids: ['boom', 'cccccccc'],
  });
  assert.strictEqual(r.okCount, 1);
  assert.deepStrictEqual(r.okTitles, ['T-cccccccc']);
});

test('ids vazio/ausente → no-op seguro', async () => {
  const updates = [];
  const supabase = fakeSupabase(updates);
  const resolveTaskByShortId = fakeResolver({});
  const r1 = await executeBatchComplete({ supabase, resolveTaskByShortId, collaboratorId: 'x', ids: [] });
  const r2 = await executeBatchComplete({ supabase, resolveTaskByShortId, collaboratorId: 'x', ids: undefined });
  assert.deepStrictEqual(r1, { okCount: 0, okTitles: [], total: 0 });
  assert.deepStrictEqual(r2, { okCount: 0, okTitles: [], total: 0 });
  assert.strictEqual(updates.length, 0);
});
