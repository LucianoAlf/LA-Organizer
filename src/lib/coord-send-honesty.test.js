'use strict';
// COORD-SEND-CONFAB-STRIP (Ana 30/06) — rodar: node --test src/lib/coord-send-honesty.test.js
const test = require('node:test');
const assert = require('node:assert');
const { stripOptimisticSendLines, claimsSent } = require('./coord-send-honesty');

test('Ana: "📨 Avisado! Mandando pro grupo ADM GERAL agora." é removido por inteiro', () => {
  const out = stripOptimisticSendLines('📨 Avisado! Mandando pro grupo ADM GERAL agora.');
  assert.strictEqual(out, '', 'a única linha era falsa afirmação de envio → some');
});

test('Ana (integração): sem contradição — só o aviso honesto sobra', () => {
  const clean = stripOptimisticSendLines('📨 Avisado! Mandando pro grupo ADM GERAL agora.');
  const DISCLAIMER = '_⚠️ Tive um problema técnico e não consegui enviar o recado — ninguém foi avisado ainda. Me passa de novo pra quem e o quê você quer mandar?_';
  const reply = clean ? `${clean}\n\n${DISCLAIMER}` : DISCLAIMER;
  // a prosa OTIMISTA some; o disclaimer honesto (que contém "ninguém foi avisado") fica.
  assert.ok(!/Avisado!/.test(reply), 'a afirmação otimista "Avisado!" some');
  assert.ok(!/Mandando/i.test(reply), 'não pode dizer "Mandando agora"');
  assert.ok(!/📨/.test(reply), 'o emoji de envio otimista some junto com a linha');
  assert.match(reply, /ninguém foi avisado/, 'o aviso honesto permanece');
});

test('Daiana 05/06: "📨 Avisei a Anne" removido', () => {
  assert.strictEqual(stripOptimisticSendLines('📨 Avisei a Anne'), '');
});

test('claimsSent detecta a mentira (gate)', () => {
  assert.strictEqual(claimsSent('Avisado! Mandando agora'), true);
  assert.strictEqual(claimsSent('Beleza, vou ver isso'), false);
});

test('linha NEUTRA é preservada; só a de envio some', () => {
  const out = stripOptimisticSendLines('Beleza, Ana!\n📨 Avisado! Mandando pro grupo agora.');
  assert.strictEqual(out, 'Beleza, Ana!');
});

test('gerúndio "Enviando pro grupo" também some', () => {
  assert.strictEqual(stripOptimisticSendLines('Enviando pro grupo ADM agora!'), '');
});

test('CONTROLE: pergunta legítima de rascunho NÃO é send-claim (não some indevido)', () => {
  // "Quer que eu avise a Vitoria com esse texto?" é uma PERGUNTA, não afirmação de envio.
  // Contém "avise" (subjuntivo) — garantir que o RE não casa formas de pergunta.
  const s = 'Quer que eu avise a Vitoria com esse texto?';
  assert.strictEqual(claimsSent(s), false, '"avise" (pedido) não é afirmação de envio');
  assert.strictEqual(stripOptimisticSendLines(s), s);
});

test('CONTROLE: texto vazio/nulo é seguro', () => {
  assert.strictEqual(stripOptimisticSendLines(''), '');
  assert.strictEqual(stripOptimisticSendLines(null), '');
  assert.strictEqual(claimsSent(null), false);
});
