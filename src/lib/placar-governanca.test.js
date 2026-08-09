'use strict';
// ETAPA 1 do protocolo: antes de olhar achado novo, o agente pergunta "dos KIs que EU fechei,
// quantos voltaram?". Sem a marca de autoria ele mediria o trabalho dos outros como se fosse
// dele — daí o filtro por [gov-agent] ser testado junto.

const test = require('node:test');
const assert = require('node:assert');
const { calcularPlacar, ehDoAgente, MARCA_AGENTE, LIMITE_PARADA } = require('./placar-governanca');

const ki = (codigo, over = {}) => ({
  codigo, corrigido_em: '2026-08-01T12:00:00Z',
  fix_resumo: `${MARCA_AGENTE} consertei assim`, ...over,
});
const finding = (promoted_code, incident_at, decision = 'regression') => ({
  promoted_code, incident_at, auto_triage: { decision },
});
// Triagem datada: o auditor julgou a reincidência em `decided_at`, contra o fix que existia
// NAQUELE momento.
const findingTriado = (promoted_code, incident_at, decided_at) => ({
  promoted_code, incident_at, auto_triage: { decision: 'regression', decided_at },
});

test('conta só os KIs marcados como do agente', () => {
  const kis = [ki('A'), ki('B'), ki('C', { fix_resumo: 'fix do Catraca, na mão' }), ki('D', { fix_resumo: null })];
  assert.strictEqual(calcularPlacar(kis, []).fechados, 2);
});

test('ehDoAgente exige a marca no início', () => {
  assert.strictEqual(ehDoAgente({ fix_resumo: '[gov-agent] x' }), true);
  assert.strictEqual(ehDoAgente({ fix_resumo: 'corrigido pelo [gov-agent]' }), false);
  assert.strictEqual(ehDoAgente({ fix_resumo: null }), false);
  assert.strictEqual(ehDoAgente(null), false);
});

test('reincidência só conta incidente DEPOIS do fix', () => {
  const kis = [ki('A', { corrigido_em: '2026-08-05T12:00:00Z' })];
  const antes = calcularPlacar(kis, [finding('A', '2026-08-04T10:00:00Z')]);
  assert.strictEqual(antes.reincidentes.length, 0, 'incidente anterior ao fix é cauda, não regressão');
  const depois = calcularPlacar(kis, [finding('A', '2026-08-06T10:00:00Z')]);
  assert.strictEqual(depois.reincidentes.length, 1);
  assert.strictEqual(depois.reincidentes[0].vezes, 1);
});

test('só conta finding triado como regressão', () => {
  const kis = [ki('A')];
  const r = calcularPlacar(kis, [finding('A', '2026-08-06T10:00:00Z', 'keep')]);
  assert.strictEqual(r.reincidentes.length, 0);
});

test('KI que voltou 2x entra em PARADA — não corrige mais essa família', () => {
  const kis = [ki('A')];
  const r = calcularPlacar(kis, [finding('A', '2026-08-06T10:00:00Z'), finding('A', '2026-08-07T10:00:00Z')]);
  assert.strictEqual(r.reincidentes[0].vezes, LIMITE_PARADA);
  assert.deepStrictEqual(r.emParada, ['A']);
});

test('reincidência de KI que NÃO é do agente não entra no placar dele', () => {
  const kis = [ki('X', { fix_resumo: 'fix manual' })];
  const r = calcularPlacar(kis, [finding('X', '2026-08-06T10:00:00Z')]);
  assert.strictEqual(r.fechados, 0);
  assert.strictEqual(r.reincidentes.length, 0);
});

test('taxa é reincidentes sobre fechados, e não divide por zero', () => {
  assert.strictEqual(calcularPlacar([], []).taxa, 0);
  const kis = [ki('A'), ki('B'), ki('C'), ki('D')];
  const r = calcularPlacar(kis, [finding('A', '2026-08-06T10:00:00Z')]);
  assert.strictEqual(r.taxa, 0.25);
});

test('entradas degeneradas não quebram', () => {
  for (const [a, b] of [[null, null], [undefined, []], [[], undefined], ['x', 'y']]) {
    const r = calcularPlacar(a, b);
    assert.strictEqual(typeof r.fechados, 'number');
    assert.ok(Array.isArray(r.emParada));
  }
});

test('KI sem corrigido_em não vira reincidência (não dá pra datar)', () => {
  const kis = [ki('A', { corrigido_em: null })];
  assert.strictEqual(calcularPlacar(kis, [finding('A', '2026-08-06T10:00:00Z')]).reincidentes.length, 0);
});

// ── RECONSERTO APAGA A REINCIDÊNCIA (achado ao rodar contra o banco real, 08/08) ────────────
// `corrigido_em` é MUTÁVEL: reconsertar o KI sobrescreve a data. Comparando só incident_at vs
// corrigido_em, todo reconserto empurra o fix pra frente dos incidentes antigos e apaga a
// reincidência que motivou o próprio reconserto. Resultado: `emParada` — a ÚNICA trava contra
// o agente consertar a mesma família pra sempre — nunca dispararia.
// Os dois casos reais do banco (TOM-AFIRMA-DEPOIS-DESMENTE e FECHAMENTO-COBRA-AMANHA) caíam
// exatamente aqui: triagem às 08:00, reconserto às 19:10 no mesmo dia.
test('reconserto posterior à triagem NÃO apaga a reincidência já julgada', () => {
  const kis = [ki('A', { corrigido_em: '2026-08-08T19:10:00Z' })];
  const f = [
    findingTriado('A', '2026-08-05T22:12:00Z', '2026-08-08T08:00:00Z'),
    findingTriado('A', '2026-08-06T17:06:00Z', '2026-08-08T08:00:00Z'),
  ];
  const r = calcularPlacar(kis, f);
  assert.strictEqual(r.reincidentes.length, 1, 'a triagem é anterior ao fix: ela julgou o fix ANTERIOR');
  assert.strictEqual(r.reincidentes[0].vezes, 2);
  assert.deepStrictEqual(r.emParada, ['A'], 'sem isso a trava de 2 reincidências morre calada');
});

// A contrapartida: triagem DEPOIS do fix atual, com incidente anterior, segue sendo cauda de
// detecção. Sem esta metade, todo achado velho viraria regressão e o agente pararia à toa.
test('triagem posterior ao fix com incidente anterior continua sendo cauda', () => {
  const kis = [ki('A', { corrigido_em: '2026-08-05T12:00:00Z' })];
  const r = calcularPlacar(kis, [findingTriado('A', '2026-08-04T10:00:00Z', '2026-08-06T08:00:00Z')]);
  assert.strictEqual(r.reincidentes.length, 0);
});

test('sem decided_at cai na comparação por incident_at', () => {
  const kis = [ki('A', { corrigido_em: '2026-08-05T12:00:00Z' })];
  assert.strictEqual(calcularPlacar(kis, [finding('A', '2026-08-04T10:00:00Z')]).reincidentes.length, 0);
  assert.strictEqual(calcularPlacar(kis, [finding('A', '2026-08-06T10:00:00Z')]).reincidentes.length, 1);
});

// ── A MARCA COM DATA (achado pelo próprio agente, 09/08) ───────────────────────────────────
// O protocolo manda duas coisas que colidem: "fix_resumo começando com [gov-agent]" e "data
// sempre em BRT". O agente resolveu escrevendo "[gov-agent 09/08] ..." — e ehDoAgente exigia
// o colchete fechado logo após o nome, então NUNCA casava. Placar zerado com 2 consertos reais
// no banco: a ETAPA 1 inteira (e a trava de parada que depende dela) morria em silêncio.
// Aceitar a variante com data é mais robusto que exigir que o LLM escreva exatamente igual.
test('a marca vale com data junto — [gov-agent 09/08]', () => {
  assert.strictEqual(ehDoAgente({ fix_resumo: '[gov-agent 09/08] normalizei os dois' }), true);
  assert.strictEqual(ehDoAgente({ fix_resumo: '[gov-agent] sem data' }), true);
  assert.strictEqual(ehDoAgente({ fix_resumo: '  [gov-agent 2026-08-09] com espaço antes' }), true);
});

test('mas segue sendo PREFIXO — menção no meio do texto não conta', () => {
  assert.strictEqual(ehDoAgente({ fix_resumo: 'corrigido pelo [gov-agent]' }), false);
  assert.strictEqual(ehDoAgente({ fix_resumo: 'vi que o [gov-agent 09/08] mexeu aqui' }), false);
});

test('não casa com nome parecido que não é a marca', () => {
  assert.strictEqual(ehDoAgente({ fix_resumo: '[gov-agente] outro' }), false);
  assert.strictEqual(ehDoAgente({ fix_resumo: '[gov-agentx] outro' }), false);
});
