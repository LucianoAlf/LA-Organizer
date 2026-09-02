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

// INFRA CAÍDA ≠ VEREDITO (rodada 31/08). O judge que aborta (Codex exit 1: refresh token
// revogado) devolvia `inconclusivo` igual a qualquer outro, e a linha de update sobrescrevia o
// verified_note — que é justamente onde mora a prova do fechamento. Resultado real: 1193b03b,
// db8ff165 e 725c940e ficaram `status=corrigido` carregando "inconclusivo: judge falhou".
test('judge que NÃO rodou (infra) não sobrescreve o verified_note', async () => {
  const d = deps({ judgeShadow: async () => ({ verdict: 'inconclusivo', infraError: true, reason: 'judge NÃO rodou (falha de infra): Codex saiu com código 1' }) });
  const out = await shadowPass([{ id: 'f1', summary: 'x', fix_intent: 'y', verified_note: 'PROVA: antes=X depois=Y' }], d);
  assert.strictEqual(out[0].infraError, true, 'o runner precisa conseguir gritar');
  const clobber = d._updates.find((u) => u.tbl === 'tom_audit_findings' && 'verified_note' in u.patch);
  assert.strictEqual(clobber, undefined, 'a prova do fechamento não pode ser apagada por um passe que não rodou');
});

test('CONTROLE: inconclusivo LEGÍTIMO (judge rodou e não concluiu) segue gravando a nota', async () => {
  const d = deps({ judgeShadow: async () => ({ verdict: 'inconclusivo', reason: 'cenário não reproduz o contexto' }) });
  await shadowPass([{ id: 'f1', summary: 'x', fix_intent: 'y' }], d);
  const nota = d._updates.find((u) => u.tbl === 'tom_audit_findings' && 'verified_note' in u.patch);
  assert.ok(nota, 'veredito de verdade continua sendo registrado');
  assert.match(nota.patch.verified_note, /inconclusivo: cenário não reproduz/);
});

test('CONTROLE: infra caída ainda deixa rastro no marker_logs', async () => {
  const d = deps({ judgeShadow: async () => ({ verdict: 'inconclusivo', infraError: true, reason: 'falha de infra' }) });
  await shadowPass([{ id: 'f1', summary: 'x', fix_intent: 'y' }], d);
  assert.strictEqual(d._markers.length, 1, 'a falha não pode sumir de todo lugar');
});

// 02/09: a sombra sobrescrevia a prova do corretor com "inconclusivo: não reproduzível" —
// 89d9734e (o fix do próprio dia) e 7701ee2f ficaram `corrigido` carregando só a nota da
// sombra. O passe infra (acima) já preservava; os outros ramos não. Regra: a sombra ANEXA,
// nunca substitui — a prova vem primeiro e inteira, o veredito da sombra vem depois.
test('inconclusivo por irreproduzível ANEXA à prova anterior em vez de apagá-la', async () => {
  const d = deps({ isReproducible: () => ({ ok: false, motivo: 'sem fala literal' }) });
  await shadowPass([{ id: 'f1', summary: 'x', fix_intent: 'y', verified_note: 'PROVA: antes=X depois=Y' }], d);
  const u = d._updates.find((x) => x.tbl === 'tom_audit_findings' && 'verified_note' in x.patch);
  assert.ok(u, 'a nota da sombra continua sendo gravada');
  assert.ok(u.patch.verified_note.startsWith('PROVA: antes=X depois=Y'), 'a prova do corretor vem primeiro e inteira');
  assert.match(u.patch.verified_note, /\n\[shadow [0-9-]+\] inconclusivo: não reproduzível: sem fala literal/);
});

test('reprovado reabre, mas preserva a prova refutada junto da refutação', async () => {
  const d = deps();
  await shadowPass([{ id: 'f1', summary: 'x', fix_intent: 'y', verified_note: 'PROVA: antes=X depois=Y' }], d);
  const reopen = d._updates.find((x) => x.tbl === 'tom_audit_findings' && x.patch.status === 'novo');
  assert.ok(reopen.patch.verified_note.startsWith('PROVA: antes=X depois=Y'));
  assert.match(reopen.patch.verified_note, /reprovado: confabulou/);
});

test('sem nota anterior, a nota da sombra entra sozinha (sem quebra de linha órfã)', async () => {
  const d = deps({ judgeShadow: async () => ({ verdict: 'aprovado', reason: 'ok' }) });
  await shadowPass([{ id: 'f1', summary: 'x', fix_intent: 'y' }], d);
  const u = d._updates.find((x) => x.tbl === 'tom_audit_findings' && 'verified_note' in x.patch);
  assert.match(u.patch.verified_note, /^\[shadow /);
});
