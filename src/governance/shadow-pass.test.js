const { test } = require('node:test');
const assert = require('node:assert');
const { shadowPass } = require('./shadow-pass');

function deps(overrides = {}) {
  const updates = []; const markers = [];
  const supabase = { from(tbl) { return {
    update(patch){ return { eq: async (c, v) => { updates.push({ tbl, patch, id: v }); return {}; } }; },
    insert: async (row) => { markers.push(row); return {}; },
  }; } };
  return Object.assign({
    supabase,
    isReproducible: () => ({ ok: true, motivo: 'ok' }),
    runShadow: async () => ({ transcript: { turns: [{ userText: 'x', reply: '✅ ativado', markers: ['PREFS_UPDATE:executed'], persisted: {} }] }, erro: null }),
    judgeShadow: async () => ({ verdict: 'reprovado', reason: 'confabulou' }),
    _updates: updates, _markers: markers,
  }, overrides);
}

test('reprovado reabre o finding e barra', async () => {
  const d = deps();
  const out = await shadowPass([{ id: 'f1', summary: 'x', fix_intent: 'y' }], d);
  assert.strictEqual(out[0].verdict, 'reprovado');
  assert.strictEqual(out[0].barrou, true);
  const reopen = d._updates.find((u) => u.tbl === 'tom_audit_findings' && u.patch.status === 'novo');
  assert.ok(reopen, 'finding reaberto');
});
test('irreproduzível → inconclusivo, NÃO barra, não roda judge', async () => {
  let judged = false;
  const d = deps({ isReproducible: () => ({ ok: false, motivo: 'grupo' }), judgeShadow: async () => { judged = true; return { verdict: 'reprovado' }; } });
  const out = await shadowPass([{ id: 'f1' }], d);
  assert.strictEqual(out[0].verdict, 'inconclusivo');
  assert.strictEqual(out[0].barrou, false);
  assert.strictEqual(judged, false, 'judge não roda em irreproduzível');
});
test('aprovado não barra e não reabre', async () => {
  const d = deps({ judgeShadow: async () => ({ verdict: 'aprovado', reason: 'ok' }) });
  const out = await shadowPass([{ id: 'f1' }], d);
  assert.strictEqual(out[0].barrou, false);
  assert.ok(!d._updates.some((u) => u.patch && u.patch.status === 'novo'), 'não reabriu');
});
test('erro do runner → inconclusivo (não barra)', async () => {
  const d = deps({ runShadow: async () => ({ transcript: { turns: [] }, erro: 'boom' }) });
  const out = await shadowPass([{ id: 'f1' }], d);
  assert.strictEqual(out[0].verdict, 'inconclusivo');
  assert.strictEqual(out[0].barrou, false);
});
