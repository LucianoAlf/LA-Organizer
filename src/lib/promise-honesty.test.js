'use strict';
// PROMISE-NOMARKER-DOWNGRADE (audit 01/07, Reunião Time Gestão ×2) — rodar:
//   node --test src/lib/promise-honesty.test.js
// Buraco: ACTIONABLE_NO_MARKER detecta + auto-retry falha (NO_MARKER), mas a reply visual
// segue intocada ("Não toca na reply visual", Sprint 28.2) → o user recebe a promessa vazia
// do Codex ("Vou criar na agenda e disparar pros 8") como se fosse verdade. O chokepoint não
// pega (gate é verbo de CONCLUSÃO, não promessa futura). Este lib rebaixa: tira a(s) linha(s)
// de promessa (mesma REPLY_PROMISE_RE do engine — uma fonte de verdade) + anexa aviso honesto.
const test = require('node:test');
const assert = require('node:assert');
const { downgradeEmptyPromise, REPLY_PROMISE_RE } = require('./promise-honesty');

const CODEX_REUNIAO =
  'Beleza, Alf — agora sim: sexta 03/07, 9h, *Reunião Time Gestão*.\n' +
  '\n' +
  '📅 *Reunião Time Gestão*\n' +
  '🗓️ Sexta 03/07 · 9h–10h\n' +
  '📋 Pauta: Atividades e Calendário do Segundo Semestre\n' +
  '\n' +
  'Vou criar na agenda e disparar pros 8 confirmarem presença.';

test('caso real (Codex, 01/07): "Vou criar na agenda e disparar pros 8" → rebaixado', () => {
  const r = downgradeEmptyPromise(CODEX_REUNIAO);
  assert.strictEqual(r.fired, true, 'promessa vazia tem que ser rebaixada');
  assert.ok(!/vou criar na agenda/i.test(r.reply), 'a linha da promessa vazia some');
  assert.match(r.reply, /N[ÃA]O foi executad/i, 'entra o aviso honesto');
  assert.match(r.reply, /Beleza, Alf/, 'linha neutra permanece');
});

test('sem promessa → não age (reply intacto)', () => {
  const s = 'Show! A reunião tá marcada lá pra sexta.';
  const r = downgradeEmptyPromise(s);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.reply, s);
});

test('reply 100% promessa vira só o aviso honesto', () => {
  const r = downgradeEmptyPromise('Vou criar a tarefa e te lembro às 9h.');
  assert.strictEqual(r.fired, true);
  assert.match(r.reply, /N[ÃA]O foi executad/i);
});

test('CONTROLE: recusa honesta ("não consigo criar por aqui") não dispara', () => {
  const s = 'Não consigo criar isso por aqui — faz pelo app.';
  const r = downgradeEmptyPromise(s);
  assert.strictEqual(r.fired, false, '"criar" bare não é promessa (RE exige "vou criar"/"criando"/"criei")');
});

test('CONTROLE: o próprio disclaimer não re-dispara (idempotente)', () => {
  const once = downgradeEmptyPromise('Vou criar a tarefa agora.');
  const twice = downgradeEmptyPromise(once.reply);
  assert.strictEqual(twice.fired, false, 'rodar 2x não pode duplicar aviso');
});

test('REPLY_PROMISE_RE exportada casa o vocabulário do engine (amostra)', () => {
  for (const s of ['vou criar', 'criando', 'criei', 'reagendei pra sexta', 'marquei para amanhã', 'te lembro às 9h']) {
    assert.ok(REPLY_PROMISE_RE.test(s), s);
  }
});
