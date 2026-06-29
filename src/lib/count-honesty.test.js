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
