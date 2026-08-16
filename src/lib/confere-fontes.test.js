// src/lib/confere-fontes.test.js
// Rodar: node --test src/lib/confere-fontes.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { contarCorrigidosDesde, contarAcervoAberto } = require('./confere-fontes');

// supabase fake: registra a coluna/filtros e devolve um count fixo.
function fakeSb(count, sink = {}) {
  return {
    from(tabela) { sink.tabela = tabela; return this; },
    select(cols, opts) { sink.cols = cols; sink.opts = opts; return this; },
    gte(col, val) { sink.gteCol = col; sink.gteVal = val; return Promise.resolve({ count }); },
    in(col, vals) { sink.inCol = col; sink.inVals = vals; return Promise.resolve({ count }); },
  };
}

// O CERNE do fix: a janela é um PARÂMETRO (o início do ciclo), não "agora − 24h" fixo lá
// dentro. Sem isto a fonte contava as inserções manuais da véspera e acusava o número certo
// do agente (caso 16/08: "1" virou "não bateu, a fonte tem 6").
test('contarCorrigidosDesde usa o floor recebido no gte(corrigido_em)', async () => {
  const sink = {};
  const n = await contarCorrigidosDesde(fakeSb(1, sink), '2026-08-16T11:00:00.000Z');
  assert.strictEqual(n, 1);
  assert.strictEqual(sink.tabela, 'tom_known_issues');
  assert.strictEqual(sink.gteCol, 'corrigido_em');
  assert.strictEqual(sink.gteVal, '2026-08-16T11:00:00.000Z'); // o floor do CICLO, não um 24h interno
});

// Anti-vacuidade: consulta que falha devolve INDEFINIDO (null), nunca 0. 0 conferido seria a
// própria doença que a camada 2 existe pra pegar.
test('contarCorrigidosDesde: erro na consulta → null (nunca 0)', async () => {
  const sbErro = { from() { throw new Error('sem banco'); } };
  assert.strictEqual(await contarCorrigidosDesde(sbErro, '2026-08-16T11:00:00Z'), null);
});

test('contarCorrigidosDesde: count não-numérico → null', async () => {
  const sbNaN = { from() { return this; }, select() { return this; }, gte() { return Promise.resolve({ count: null }); } };
  assert.strictEqual(await contarCorrigidosDesde(sbNaN, '2026-08-16T11:00:00Z'), null);
});

// Sem floor não há como escopar por ciclo → abstém (null), não cai num default silencioso.
test('contarCorrigidosDesde: sem desdeIso → null', async () => {
  const sink = {};
  assert.strictEqual(await contarCorrigidosDesde(fakeSb(9, sink), null), null);
  assert.strictEqual(sink.tabela, undefined); // nem chega a consultar
});

test('contarAcervoAberto conta novo/confirmado e devolve o total', async () => {
  const sink = {};
  const n = await contarAcervoAberto(fakeSb(158, sink));
  assert.strictEqual(n, 158);
  assert.strictEqual(sink.tabela, 'tom_audit_findings');
  assert.deepStrictEqual(sink.inVals, ['novo', 'confirmado']);
});

test('contarAcervoAberto: erro → null', async () => {
  const sbErro = { from() { throw new Error('x'); } };
  assert.strictEqual(await contarAcervoAberto(sbErro), null);
});
