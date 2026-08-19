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

// supabase fake do novo contrato: devolve LINHAS (fix_resumo) e registra o filtro `or`.
function fakeRows(rows, sink = {}) {
  return {
    from(tabela) { sink.tabela = tabela; return this; },
    select(cols) { sink.cols = cols; return this; },
    or(expr) { sink.or = expr; return Promise.resolve({ data: rows, error: null }); },
  };
}
const doAgente = (n) => Array.from({ length: n }, (_, i) => ({ fix_resumo: `[gov-agent 19/08] fix ${i}` }));

// O CERNE do fix de 19/08: os dois eixos passam a ser do BANCO. AUTORIA pela marca
// `[gov-agent…]`, TEMPO por `created_at` (default do banco). Antes o eixo era `corrigido_em`,
// campo escrito à mão pelo LLM: em 19/08 ele pôs a data pura "2026-08-19" → 00:00 → gte contra
// o início do ciclo (11:0x) deu 0 → a trava publicou "o texto diz 1, a fonte tem 0".
test('contarCorrigidosDesde conta pela MARCA do agente e ancora em created_at', async () => {
  const sink = {};
  const n = await contarCorrigidosDesde(fakeRows(doAgente(1), sink), '2026-08-19T11:00:00.000Z');
  assert.strictEqual(n, 1);
  assert.strictEqual(sink.tabela, 'tom_known_issues');
  assert.match(sink.cols, /fix_resumo/);
  assert.match(sink.or, /created_at\.gte\.2026-08-19T11:00:00\.000Z/);
});

// Regressão do 16/08: KI inserido pelo humano-catraca DENTRO da janela não pode inflar.
// Antes só o tempo separava os atores; agora a marca separa, que é a regra do protocolo.
test('contarCorrigidosDesde ignora KI sem a marca (inserção do humano-catraca)', async () => {
  const rows = [...doAgente(1), { fix_resumo: 'corrigi na mão' }, { fix_resumo: null }];
  assert.strictEqual(await contarCorrigidosDesde(fakeRows(rows), '2026-08-16T11:00:00Z'), 1);
});

// O caso literal de 19/08: `corrigido_em` com data pura não alcança o floor, mas o KI foi
// CRIADO no ciclo — o OR pega pelo created_at e a contagem volta a bater.
test('contarCorrigidosDesde alcança o KI de corrigido_em data-pura pelo created_at', async () => {
  const sink = {};
  await contarCorrigidosDesde(fakeRows(doAgente(1), sink), '2026-08-19T11:00:00.000Z');
  assert.match(sink.or, /corrigido_em\.gte\./); // re-conserto de KI antigo segue alcançável
});

// Anti-vacuidade: consulta que falha devolve INDEFINIDO (null), nunca 0. 0 conferido seria a
// própria doença que a camada 2 existe pra pegar.
test('contarCorrigidosDesde: erro na consulta → null (nunca 0)', async () => {
  const sbErro = { from() { throw new Error('sem banco'); } };
  assert.strictEqual(await contarCorrigidosDesde(sbErro, '2026-08-16T11:00:00Z'), null);
});

test('contarCorrigidosDesde: erro do PostgREST → null', async () => {
  const sbErr = {
    from() { return this; }, select() { return this; },
    or() { return Promise.resolve({ data: null, error: { message: 'boom' } }); },
  };
  assert.strictEqual(await contarCorrigidosDesde(sbErr, '2026-08-16T11:00:00Z'), null);
});

// Sem floor não há como escopar por ciclo → abstém (null), não cai num default silencioso.
test('contarCorrigidosDesde: sem desdeIso → null', async () => {
  const sink = {};
  assert.strictEqual(await contarCorrigidosDesde(fakeRows(doAgente(9), sink), null), null);
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
