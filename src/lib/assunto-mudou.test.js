'use strict';
// CONFIRM-NOEXEC-ASSUNTO-MUDOU (Rafinha 01/10 13:26 BRT, achado 97588478).
// 13:19 o TOM perguntou da FOTO do piso (intent genérica, sem executor). A Rafinha mudou de
// assunto: mandou 5 eventos, o TOM propôs lembretes ("Vou te avisar às 13h em cada uma…") e ela
// respondeu "Isso aí". O "sim" foi amarrado à pergunta da foto — 7 min, dentro da janela de 20 —
// e o ramo sem executor mandou o LLM "assumir que não conseguiu": "Confirmei a foto aqui, mas na
// verdade isso não ficou gravado". Ela teve que colar a lista de novo.
const { test } = require('node:test');
const assert = require('node:assert');
const _fs = require('fs');
const _path = require('path');
const { conversaSeguiuOutroAssunto } = require('./confirmacao-atrasada');

const FOTO = 'Beleza, já tá anotado pra 16/12. Só confirma, essa foto do piso é a referência do que precisa trocar?';
const ASKED = '2026-10-01T13:19:31-03:00';
const LEMBRETES = 'Beleza, só lembrete então — sem frescura de local/modalidade. Vou te avisar às 13h em cada uma dessas datas:\n\n• 📅 08/10 — Evento Barra Word Canto';
const h = (dir, content, hhmm) => ({ direction: dir, content, created_at: `2026-10-01T${hhmm}-03:00` });

const RAFINHA = [
  h('outbound', FOTO, '13:19:33'),
  h('inbound', 'Coloca na agenda esses eventos aí tom', '13:24:24'),
  h('outbound', '📅 Peguei os 3 eventos! Pra criar certinho, preciso de mais 3 coisas', '13:24:49'),
  h('inbound', 'Dia 8/10 - evento barra word canto', '13:24:50'),
  h('inbound', 'Só me lembra nessas datas tom', '13:25:25'),
  h('outbound', LEMBRETES, '13:25:47'),
  h('inbound', 'Isso aí', '13:26:24'),
];

test('Rafinha 01/10: ela falou de outra coisa e o TOM propôs outra → o "Isso aí" não é da foto', () => {
  assert.strictEqual(conversaSeguiuOutroAssunto({ pergunta: FOTO, askedAt: ASKED, historico: RAFINHA }), true);
});

test('controle: a última fala do TOM é a pergunta → o "sim" é dela', () => {
  const hist = [h('outbound', FOTO, '13:19:33'), h('inbound', 'Isso', '13:20:00')];
  assert.strictEqual(conversaSeguiuOutroAssunto({ pergunta: FOTO, askedAt: ASKED, historico: hist }), false);
});

test('controle: só um RITUAL falou no meio, a pessoa não → não decide nada (vale a regra antiga)', () => {
  const hist = [h('outbound', FOTO, '13:19:33'), h('outbound', '🌙 Fechamento do dia', '13:20:00'), h('inbound', 'Sim', '13:21:00')];
  assert.strictEqual(conversaSeguiuOutroAssunto({ pergunta: FOTO, askedAt: ASKED, historico: hist }), false);
});

test('controle: o TOM REPETIU a pergunta depois do desvio → o "sim" é dela', () => {
  const hist = [h('outbound', FOTO, '13:19:33'), h('inbound', 'Peraí', '13:20:00'), h('outbound', `${FOTO}\n\n_me responde sim ou não_`, '13:20:10'), h('inbound', 'Sim', '13:21:00')];
  assert.strictEqual(conversaSeguiuOutroAssunto({ pergunta: FOTO, askedAt: ASKED, historico: hist }), false);
});

test('histórico vazio ou sem a fala atual → false (fail-closed: mantém o comportamento de hoje)', () => {
  assert.strictEqual(conversaSeguiuOutroAssunto({ pergunta: FOTO, askedAt: ASKED, historico: [] }), false);
  assert.strictEqual(conversaSeguiuOutroAssunto({ pergunta: FOTO, askedAt: ASKED }), false);
});

test('engine: o ramo SEM executor consulta o assunto antes de mandar o LLM negar', () => {
  const ENG = _fs.readFileSync(_path.join(__dirname, '..', 'engine.js'), 'utf8');
  const i = ENG.indexOf('conversaSeguiuOutroAssunto(');
  assert.ok(i > 0, 'engine.js não chama conversaSeguiuOutroAssunto');
  const hint = ENG.indexOf('const ctxHint = `\\n\\n[CONTEXTO INTERNO');
  assert.ok(hint > 0 && i < hint, 'a checagem precisa vir ANTES da injeção do ctxHint');
  assert.match(ENG.slice(i - 1500, i + 1500), /CONFIRM_ASSUNTO_MUDOU/);
});
