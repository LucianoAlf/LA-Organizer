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

// CASO RAFINHA 29/08 14:07 (finding bd84ca6b) ------------------------------
// O TOM perguntou 'Mando pro Alf assim? _"..."_ Confirma?', o Rafinha respondeu 'Confirma',
// a intent foi resolvida como confirmed -- e um segundo depois o TOM disse 'Nao consegui
// processar aqui, me manda de novo'. A Fatia 3 EXISTIA e nao disparou: o parser so conhecia
// o verbo 'Aviso o/a X', e a forma real do TOM e 'Mando pro X'. Sem extracao, o payload fica
// so-texto e a execucao volta a depender do LLM -- que confabulou 'perdi o fio'.
// Ele ainda repetiu 'Aviso o Luciano? Confirma?' duas vezes: dai o 'ta ficando sem memoria'.
const NL = String.fromCharCode(10);

test('caso real: "Mando pro Alf assim?" com texto entre aspas extrai destinatario e recado', () => {
  const q = 'Mando pro Alf assim?' + NL + NL
    + '_"Rafinha precisa de aprovacao pra comprar 3 abafadores pra escola da Barra - situacao urgente. Pode?"_'
    + NL + NL + 'Confirma?';
  const r = parseCoordinationConfirmQuestion(q);
  assert.ok(r, 'tinha que extrair');
  assert.strictEqual(r.recipient_name, 'Alf');
  assert.ok(r.message_body.startsWith('Rafinha precisa de aprovacao'), r.message_body);
});

test('variantes do mesmo verbo com destinatario e texto explicitos', () => {
  for (const q of [
    'Mando pra Krissya: "o pedido foi aprovado". Confirma?',
    'Mando para o Alf assim? "preciso de liberacao" Confirma?',
    'Encaminho pro Rafinha: "chegou o material". Confirma?',
  ]) assert.ok(parseCoordinationConfirmQuestion(q), q);
});

// O FAIL-CLOSED nao pode cair junto: mandar recado ERRADO pra pessoa real e pior que o drop.
test('CONTROLE: sem texto explicito continua null (mensagem implicita)', () => {
  assert.strictEqual(parseCoordinationConfirmQuestion('Aviso o Luciano? Confirma?'), null);
  assert.strictEqual(parseCoordinationConfirmQuestion('Mando pro Alf sobre os calendarios?'), null);
});
test('CONTROLE: negacao desqualifica', () => {
  assert.strictEqual(parseCoordinationConfirmQuestion('Nao mando pro Alf: "nada". Confirma?'), null);
});
test('CONTROLE: nome em minuscula nao vira destinatario', () => {
  assert.strictEqual(parseCoordinationConfirmQuestion('Mando pro alf: "texto". Confirma?'), null);
});
