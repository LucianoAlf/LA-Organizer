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
test('marker_logs recebe result VÁLIDO pelo CHECK (verdict mapeado) + verdict no reason', async () => {
  const d = deps(); // judge reprovado por padrão
  await shadowPass([{ id: 'f1', summary: 'x', fix_intent: 'y' }], d);
  const mk = d._markers[0];
  assert.ok(mk, 'inseriu marker');
  assert.strictEqual(mk.marker_type, 'SHADOW');
  assert.strictEqual(mk.result, 'rejected'); // reprovado→rejected (satisfaz marker_logs_result_check)
  assert.match(mk.reason, /reprovado/);
});
test('mapeia aprovado→executed e inconclusivo→skipped no marker_logs', async () => {
  const da = deps({ judgeShadow: async () => ({ verdict: 'aprovado', reason: 'ok' }) });
  await shadowPass([{ id: 'f1' }], da);
  assert.strictEqual(da._markers[0].result, 'executed');
  const di = deps({ isReproducible: () => ({ ok: false, motivo: 'grupo' }) });
  await shadowPass([{ id: 'f1' }], di);
  assert.strictEqual(di._markers[0].result, 'skipped');
});
test('finding cujo runShadow rejeita não impede o próximo de ser processado', async () => {
  let chamada = 0;
  const d = deps({
    runShadow: async () => {
      chamada += 1;
      if (chamada === 1) throw new Error('estourou');
      return { transcript: { turns: [{ userText: 'x', reply: 'ok', markers: [], persisted: {} }] }, erro: null };
    },
    judgeShadow: async () => ({ verdict: 'aprovado', reason: 'ok' }),
  });
  const out = await shadowPass([{ id: 'f1' }, { id: 'f2' }], d);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].verdict, 'inconclusivo');
  assert.strictEqual(out[0].barrou, false);
  assert.strictEqual(out[1].verdict, 'aprovado');
});
