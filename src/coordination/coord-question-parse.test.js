'use strict';
// coord-question-parse.test.js — Fatia 3 (confirmação parse-on-open, coordenação).
// Extrai {recipient_name, message_body} da PERGUNTA DE CONFIRMAÇÃO do TOM, pra o hook genérico
// abrir o intent com coordination.items estruturado (o "sim" despacha determinístico). FAIL-CLOSED:
// só retorna objeto quando destinatário E texto EXPLÍCITO estão presentes; senão null.
//
// Rodar: node --test src/coordination/coord-question-parse.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCoordinationConfirmQuestion } = require('./coord-question-parse');

// ── caso real 14/08 (Yuri): "Segue o texto:" + citação entre aspas ──────────────
test('Yuri: extrai destinatário e texto explícito citado', () => {
  const reply = 'Aviso o Yuri pedindo o motivo? Segue o texto:\n\n> "Oi Yuri, vi que cancelou o *Criar banco de vídeos*. Qual foi o motivo?"\n\nConfirma?';
  const r = parseCoordinationConfirmQuestion(reply);
  assert.ok(r, 'deveria extrair');
  assert.strictEqual(r.recipient_name, 'Yuri');
  assert.match(r.message_body, /^Oi Yuri, vi que cancelou o Criar banco de vídeos\. Qual foi o motivo\?$/,
    'texto sem markdown, sem "> ", fiel');
});

test('texto entre aspas simples sem "Segue o texto" também conta', () => {
  const reply = 'Aviso a Mayra? "Passa o relatório de agosto até sexta." Confirma?';
  const r = parseCoordinationConfirmQuestion(reply);
  assert.ok(r);
  assert.strictEqual(r.recipient_name, 'Mayra');
  assert.strictEqual(r.message_body, 'Passa o relatório de agosto até sexta.');
});

// ── FAIL-CLOSED: mensagem implícita (sem texto delimitado) → null ───────────────
test('Krissya implícito (sem citação) → null', () => {
  assert.strictEqual(parseCoordinationConfirmQuestion('Aviso a Krissya amanhã às 18h40 pra pegar os fones em CG? Confirma?'), null);
});
test('Alf implícito ("sobre os calendários") → null', () => {
  assert.strictEqual(parseCoordinationConfirmQuestion('Aviso o Alf sobre os calendários das escolas? Confirma?'), null);
});

// ── não-coordenação / negação / vazio → null ───────────────────────────────────
test('confirmação de FECHAMENTO (não coordenação) → null', () => {
  assert.strictEqual(parseCoordinationConfirmQuestion('Confirma o fechamento destas 2 tarefas: *Renovação*, *Report*?'), null);
});
test('negação "Não aviso ninguém agora." → null', () => {
  assert.strictEqual(parseCoordinationConfirmQuestion('Não aviso ninguém agora. "texto qualquer"'), null);
});
test('texto vazio entre aspas → null (não estagia recado vazio)', () => {
  assert.strictEqual(parseCoordinationConfirmQuestion('Aviso o Yuri? "" Confirma?'), null);
});
test('vazio/nulo → null sem lançar', () => {
  for (const v of [null, undefined, '', '   ', 42, {}]) {
    assert.strictEqual(parseCoordinationConfirmQuestion(v), null);
  }
});
