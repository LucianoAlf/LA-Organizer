'use strict';
// #2D2 — guard de honestidade de contagem (confab de falha parcial). Caso Leo 28/06.
// Rodar: node --test src/lib/count-honesty.test.js
const test = require('node:test');
const assert = require('node:assert');
const { enforceCountHonesty, _claimedCount } = require('./count-honesty');

const EV = (persistedCount) => ({ domain: 'event', persistedCount, meta: true });

// ── DISPARA: o incidente real (claimed 2 > persisted 1) ──────────────────────
test('Leo: "Dando baixa na tarefa e nos dois eventos" + ok=1 → rebaixa', () => {
  const r = enforceCountHonesty('Fechou com chave de ouro! Dando baixa na tarefa e nos dois eventos.', EV(1));
  assert.strictEqual(r.fired, true, JSON.stringify(r));
  assert.strictEqual(r.claimed, 2);
  assert.ok(!/dois eventos/i.test(r.reply), 'frase de contagem exagerada devia sumir: ' + r.reply);
  assert.ok(/s[óo] 1 entrou/i.test(r.reply), 'devia ter nota honesta: ' + r.reply);
  assert.ok(/baixa na tarefa/i.test(r.reply), 'parte verdadeira (tarefa) deve sobreviver: ' + r.reply);
});
test('dígito: "Cancelei os 3 eventos" + ok=1 → rebaixa', () => {
  const r = enforceCountHonesty('Cancelei os 3 eventos!', EV(1));
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.claimed, 3);
});
test('ambos: "Dei baixa em ambos os compromissos" + ok=1 → rebaixa', () => {
  const r = enforceCountHonesty('Dei baixa em ambos os compromissos.', EV(1));
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.claimed, 2);
});
test('stem com sufixo: "Reagendei as 3 reuniões" + ok=1 → rebaixa (não pode falhar no \\b)', () => {
  const r = enforceCountHonesty('Reagendei as 3 reuniões.', EV(1));
  assert.strictEqual(r.fired, true, JSON.stringify(r));
  assert.strictEqual(r.claimed, 3);
  assert.ok(/1 reuni[ãa]o/i.test(r.reply), 'devia singularizar p/ 1 reunião: ' + r.reply);
});

// ── NÃO DISPARA: protege a voz (controles negativos) ─────────────────────────
test('claimed == persisted: "fechei os 2 eventos" + ok=2 → NÃO dispara', () => {
  assert.strictEqual(enforceCountHonesty('Fechei os 2 eventos!', EV(2)).fired, false);
});
test('claimed < persisted: "cancelei 1 evento" + ok=2 → NÃO dispara', () => {
  assert.strictEqual(enforceCountHonesty('Cancelei 1 evento.', EV(2)).fired, false);
});
test('sem contagem explícita: "Dando baixa nos eventos" + ok=1 → NÃO dispara (vago)', () => {
  assert.strictEqual(enforceCountHonesty('Dando baixa nos eventos.', EV(1)).fired, false);
});
test('contagem informativa SEM verbo de ação: "Você tem 3 eventos hoje" → NÃO dispara', () => {
  assert.strictEqual(enforceCountHonesty('Você tem 3 eventos hoje.', EV(1)).fired, false);
});
test('contagem de OUTRO domínio (tarefas) não conta como evento: "criei 3 tarefas" dom=event → NÃO dispara', () => {
  assert.strictEqual(enforceCountHonesty('Criei 3 tarefas!', EV(1)).fired, false);
});
test('"todos os eventos" (sem numeral) → NÃO dispara', () => {
  assert.strictEqual(enforceCountHonesty('Cancelei todos os eventos.', EV(1)).fired, false);
});
test('razão honesta "Cancelei 3 de 4 eventos" + ok=3 → NÃO dispara (não destruir a voz)', () => {
  const r = enforceCountHonesty('Cancelei 3 de 4 eventos.', EV(3));
  assert.strictEqual(r.fired, false, JSON.stringify(r));
});

// ── robustez ─────────────────────────────────────────────────────────────────
test('entradas inválidas não quebram', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.strictEqual(enforceCountHonesty(v, EV(1)).fired, false);
  }
  assert.strictEqual(enforceCountHonesty('Cancelei 3 eventos', { domain: 'event', meta: true }).fired, false); // persisted ausente
  assert.strictEqual(enforceCountHonesty('Cancelei 3 eventos', { domain: 'xpto', persistedCount: 1, meta: true }).fired, false);
});
test('retrocompat: sem meta retorna string', () => {
  assert.strictEqual(typeof enforceCountHonesty('Cancelei os 3 eventos', { domain: 'event', persistedCount: 1 }), 'string');
});

// ── _claimedCount unitário ───────────────────────────────────────────────────
test('_claimedCount: extrai numeral por extenso e dígito', () => {
  assert.strictEqual(_claimedCount('nos dois eventos', 'event').count, 2);
  assert.strictEqual(_claimedCount('os 4 compromissos', 'event').count, 4);
  assert.strictEqual(_claimedCount('ambas as reuniões', 'event').count, 2);
  assert.strictEqual(_claimedCount('os eventos', 'event'), null);
});

// ── #2D2-b — confab de contagem no FECHAMENTO EM LOTE DE TAREFAS (Fabi 30/06) ──
const { enforceTaskCountHonesty, _claimedTaskDone } = require('./count-honesty');

test('Fabi: "As 3 fechadas, Fabi!" + ok=2 → rebaixa pra "2 de 3 fechadas" + nota', () => {
  const reply = 'As 3 fechadas, Fabi!\n\n• *Feedback 1ª aula Recreio*\n• *Pesquisa barra*\n• *Pesquisa 1ª aula — Mateus*';
  const r = enforceTaskCountHonesty(reply, { okCount: 2, meta: true });
  assert.strictEqual(r.fired, true, JSON.stringify(r));
  assert.strictEqual(r.claimed, 3);
  assert.match(r.reply, /2 de 3 fechadas, Fabi!/);
  assert.match(r.reply, /Falei em 3 mas só 2 fechou de verdade/);
  assert.ok(!/As 3 fechadas/.test(r.reply), 'o título mentiroso "As 3 fechadas" tem que sumir');
});

test('numeral por extenso: "as duas concluídas" + ok=1 → "1 de 2 concluídas"', () => {
  const r = enforceTaskCountHonesty('Prontinho, as duas concluídas!', { okCount: 1, meta: true });
  assert.strictEqual(r.fired, true);
  assert.match(r.reply, /1 de 2 concluídas/);
});

// ── NÃO DISPARA (controles negativos) ────────────────────────────────────────
test('não exagerou: "As 3 fechadas" + ok=3 → no-op', () => {
  assert.strictEqual(enforceTaskCountHonesty('As 3 fechadas, Fabi!', { okCount: 3, meta: true }).fired, false);
});
test('razão já honesta: "2 de 3 fechadas" → no-op (não re-rebaixa)', () => {
  assert.strictEqual(enforceTaskCountHonesty('2 de 3 fechadas!', { okCount: 2, meta: true }).fired, false);
});
test('"1 fechada" não é exagero de lote → no-op', () => {
  assert.strictEqual(enforceTaskCountHonesty('1 fechada, beleza!', { okCount: 0, meta: true }).fired, false);
});
test('número sem particípio de conclusão não dispara ("3 alunos")', () => {
  assert.strictEqual(enforceTaskCountHonesty('Avisei os 3 alunos da Barra', { okCount: 1, meta: true }).fired, false);
});
test('okCount ausente → no-op (defensivo)', () => {
  assert.strictEqual(enforceTaskCountHonesty('As 3 fechadas!', { meta: true }).fired, false);
});
test('retrocompat: sem meta retorna string', () => {
  assert.strictEqual(typeof enforceTaskCountHonesty('As 3 fechadas!', { okCount: 1 }), 'string');
});
test('entradas inválidas não quebram', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.strictEqual(enforceTaskCountHonesty(v, { okCount: 1, meta: true }).fired, false);
  }
});
test('_claimedTaskDone unitário', () => {
  assert.strictEqual(_claimedTaskDone('As 3 fechadas').count, 3);
  assert.strictEqual(_claimedTaskDone('as duas concluídas').count, 2);
  assert.strictEqual(_claimedTaskDone('1 fechada'), null);
  assert.strictEqual(_claimedTaskDone('os 3 alunos'), null);
});
