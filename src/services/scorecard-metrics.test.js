// src/services/scorecard-metrics.test.js
// Trava a propagação de `closure_rate: null` (§7.3, Task 5) nos DOIS readers que não
// tinham guard: `diffMetrics` (usado por computeDelta) e `generateInsight`.
//
// A doença é a mesma do "100% de zero": em JS `null` coage pra 0 em aritmética SEM
// gerar NaN pra denunciar — `null - 0.5 === -0.5` e `Math.round(null * 100) === 0`.
// Resultado: delta de queda FABRICADO e insight "Fechamento baixo (0%)" pra quem não
// tem nota nenhuma. O operador mente calado (mesma família do `\b` ASCII).
//
// Rodar: node --test src/services/scorecard-metrics.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { diffMetrics, generateInsight } = require('./scorecard-metrics');
const { renderForLeader } = require('./scorecard-render');

// ── Fixtures ──────────────────────────────────────────────────────────────
const metrics = (overrides = {}) => ({
  closure_rate: null, tasks_closed: 0, tasks_overdue: 0, tasks_stuck: 0,
  top_bottlenecks: [], ...overrides,
});
const prev = (overrides = {}) => ({
  closure_rate: 0.5, tasks_closed: 4, tasks_overdue: 4, tasks_stuck: 0, ...overrides,
});

// ── FIX 2 — diffMetrics ──────────────────────────────────────────────────
test('diffMetrics: sem nota ESTA semana → closure_rate_delta null (não fabrica queda de 50pp)', () => {
  // `null - 0.5 === -0.5` em JS: o líder "caiu 50pp" sem ter caído nada — ele
  // simplesmente não teve sinal medível essa semana.
  const d = diffMetrics(metrics({ tasks_overdue: 0 }), prev());
  assert.strictEqual(d.closure_rate_delta, null, `fabricou delta: ${d.closure_rate_delta}`);
});

test('diffMetrics: sem nota na semana ANTERIOR → closure_rate_delta null (mente na direção oposta)', () => {
  // `0.5 - null === 0.5`: inventaria uma SUBIDA de 50pp contra uma semana sem nota.
  const d = diffMetrics(metrics({ closure_rate: 0.5, tasks_closed: 4 }), prev({ closure_rate: null }));
  assert.strictEqual(d.closure_rate_delta, null, `fabricou delta: ${d.closure_rate_delta}`);
});

test('diffMetrics: sem nota nas DUAS semanas → closure_rate_delta null (null - null === 0 = "estável" falso)', () => {
  const d = diffMetrics(metrics(), prev({ closure_rate: null }));
  assert.strictEqual(d.closure_rate_delta, null, `fabricou delta: ${d.closure_rate_delta}`);
});

test('diffMetrics: as 3 contagens seguem normais mesmo sem nota (não discrimina — guarda de não-regressão)', () => {
  // closed/overdue/stuck são deltas de CONTAGEM: nunca são null, não têm o problema.
  // Este teste passa antes e depois do fix; existe pra travar o fix EXAGERADO (anular
  // o objeto inteiro quando falta nota).
  const d = diffMetrics(metrics({ tasks_stuck: 1 }), prev({ tasks_stuck: 3 }));
  assert.strictEqual(d.closed_delta, -4);
  assert.strictEqual(d.overdue_delta, -4);
  assert.strictEqual(d.stuck_delta, -2);
});

test('diffMetrics: duas notas reais → delta normal (o guard não pode apagar sinal real; não discrimina)', () => {
  const d = diffMetrics(metrics({ closure_rate: 0.8, tasks_closed: 4 }), prev());
  assert.strictEqual(d.closure_rate_delta, 0.3);
});

test('diffMetrics: 0% REAL vs 50% → -0.5 (0 é nota, não ausência — trava o fix errado com `!rate`/`||`)', () => {
  // Não discrimina old/new, mas discrimina o fix ERRADO: quem usasse falsy (`!current
  // .closure_rate`) anularia o delta de quem fechou 0 de 3 — uma queda REAL de 50pp.
  const d = diffMetrics(metrics({ closure_rate: 0, tasks_overdue: 3 }), prev());
  assert.strictEqual(d.closure_rate_delta, -0.5);
});

// ── FIX 2 — a cadeia real: diffMetrics → renderForLeader ─────────────────
test('INTEGRAÇÃO: sem nota → o texto do líder não diz "50pp abaixo" nem "Estável"', () => {
  // O guard existente em renderForLeader (`delta.closure_rate_delta != null`) NÃO salva:
  // o delta não é null, está ERRADO (-0.5). Só o fix na origem resolve.
  const delta = diffMetrics(metrics({ tasks_overdue: 2 }), prev());
  const txt = renderForLeader(
    { ...metrics({ tasks_overdue: 2 }), delta_vs_prev: delta },
    { full_name: 'Rose Silva', preferred_name: null },
  );
  assert.strictEqual(/pp/.test(txt), false, `inventou variação em pp pra quem não tem nota:\n${txt}`);
  assert.strictEqual(/Estável/.test(txt), false, `disse "Estável" sem ter os dois termos:\n${txt}`);
});

// ── FIX 1 — generateInsight ──────────────────────────────────────────────
// NOTA: `generateInsight` é async e chama ai.chat. Estes testes exercitam SÓ o caminho
// "sem nota", que retorna ANTES do LLM — nenhum mock, nenhuma rede. O caminho COM nota
// (LLM + fallback) segue sem cobertura local; ver report.
test('generateInsight: sem nota → null (não inventa insight nem chama o LLM)', async () => {
  const r = await generateInsight(
    { full_name: 'Rose Silva' },
    metrics({ tasks_overdue: 2 }),
    { is_first_week: true },
  );
  assert.strictEqual(r, null, `inventou insight pra quem não tem nota: ${JSON.stringify(r)}`);
});

test('generateInsight: sem nota NUNCA produz a frase "Fechamento baixo (0%)" do fallback', async () => {
  // O fallback determinístico fazia `closurePct < 50` com closurePct = Math.round(null*100) = 0.
  const r = await generateInsight(
    { full_name: 'Rose Silva' },
    metrics({ tasks_overdue: 2 }),
    { is_first_week: true },
  );
  assert.strictEqual(r === null || !/0%/.test(String(r)), true, `insight com 0% fabricado: ${r}`);
});

test('generateInsight: sem nota → null mesmo com delta de semana anterior (não é só o ramo is_first_week)', async () => {
  const r = await generateInsight(
    { full_name: 'Rose Silva' },
    metrics({ tasks_overdue: 2 }),
    { closure_rate_delta: null, closed_delta: -4, overdue_delta: -2, stuck_delta: 0 },
  );
  assert.strictEqual(r, null, `inventou insight: ${JSON.stringify(r)}`);
});

// ── FIX A — sem nota não INVENTA número, mas o que é verdadeiro SEM número segue dito ──
test('generateInsight: sem nota + 3 travadas → diz a frase de travamento (verdadeira sem nota) e NÃO inventa %', async () => {
  // "Travamentos crônicos" não depende de closure_rate nenhum: é a leitura de
  // coordination_request_count >= 3 ("cobrar mais não resolve, muda de tática"). Matar
  // essa frase junto com o "0%" seria perder a informação mais acionável do relatório.
  const r = await generateInsight(
    { full_name: 'Rose Silva' },
    metrics({ tasks_stuck: 3 }),
    { is_first_week: true },
  );
  assert.match(String(r), /Travamentos crônicos em 3 itens/, `perdeu a frase de travamento: ${JSON.stringify(r)}`);
  assert.strictEqual(/%/.test(String(r)), false, `inventou número pra quem não tem nota: ${r}`);
});

test('generateInsight: sem nota + 0 travadas → null (não sobra nada verdadeiro pra dizer sem número)', async () => {
  // Guarda de não-regressão do fix da rodada anterior: o ramo novo do stuck não pode
  // virar uma porta pra insight fabricado quando não há travamento.
  const r = await generateInsight(
    { full_name: 'Rose Silva' },
    metrics({ tasks_overdue: 2, tasks_stuck: 0 }),
    { is_first_week: true },
  );
  assert.strictEqual(r, null, `inventou insight sem nota e sem travamento: ${JSON.stringify(r)}`);
});

test('generateInsight: sem nota NUNCA chama o LLM (o prompt diria "Fechamento: 0%")', async () => {
  // LIMITAÇÃO DECLARADA: este spy troca `ai.chat` no objeto do require cache (singleton).
  // Funciona porque scorecard-metrics.js faz `const ai = require('../ai/provider')` e chama
  // `ai.chat(...)` pela propriedade. Se alguém refatorar pra `const { chat } = require(...)`,
  // o spy para de enxergar a chamada e este teste vira falso-verde — não há como detectar
  // isso de dentro. É o assert mais fraco do arquivo; os de COMPORTAMENTO acima é que mandam.
  // O spy nunca chama a rede (não delega pro original), então é seguro rodar na VPS, que
  // tem API key — sem ele, uma regressão do guard gastaria chamada de LLM de verdade no teste.
  const ai = require('../ai/provider');
  const orig = ai.chat;
  let called = 0;
  ai.chat = async () => { called++; return { text: 'RESPOSTA_DO_LLM_SENTINELA' }; };
  try {
    const comStuck = await generateInsight({ full_name: 'Rose Silva' }, metrics({ tasks_stuck: 3 }), { is_first_week: true });
    const semStuck = await generateInsight({ full_name: 'Rose Silva' }, metrics({ tasks_overdue: 2 }), { is_first_week: true });
    assert.strictEqual(called, 0, `chamou o LLM ${called}x no caminho sem nota`);
    assert.strictEqual(/SENTINELA/.test(String(comStuck) + String(semStuck)), false, 'o texto veio do LLM');
  } finally {
    ai.chat = orig;
  }
});

test('generateInsight: COM nota o LLM continua sendo chamado (o guard não pode matar o caminho normal)', async () => {
  // Contra-prova do teste acima: garante que o `called === 0` de lá mede o GUARD e não um
  // spy quebrado que nunca contaria nada. Mesmo mecanismo, resultado oposto.
  const ai = require('../ai/provider');
  const orig = ai.chat;
  let called = 0;
  ai.chat = async () => { called++; return { text: 'Fechamento em recuperação, ritmo melhor que a semana passada.' }; };
  try {
    const r = await generateInsight(
      { full_name: 'Rose Silva' },
      metrics({ closure_rate: 0.75, tasks_closed: 3, tasks_overdue: 1 }),
      { is_first_week: true },
    );
    assert.strictEqual(called, 1, 'o caminho COM nota deixou de chamar o LLM');
    assert.match(String(r), /Fechamento em recuperação/, `não devolveu o texto do LLM: ${r}`);
  } finally {
    ai.chat = orig;
  }
});
