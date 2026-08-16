'use strict';
// complete-question-parse.test.js — Fatia 4 (confirmação parse-on-open, complete/fechamento).
// Extrai os TÍTULOS (em *negrito*) da pergunta de fechamento do TOM ("Confirma o fechamento
// destas 2 tarefas: *X*, *Y*?"), pra o hook resolver título→id e estagiar batch_complete.
// Só extração aqui; a resolução (fail-closed) é o outro módulo.
//
// Rodar: node --test src/utils/complete-question-parse.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCompleteConfirmQuestion } = require('./complete-question-parse');

test('duas tarefas (caso 11/08 Renovação/Report)', () => {
  const r = parseCompleteConfirmQuestion('Confirma o fechamento destas 2 tarefas: *Renovação*, *Não esquecer de verificar o report*?');
  assert.deepStrictEqual(r, { titles: ['Renovação', 'Não esquecer de verificar o report'] });
});

test('uma tarefa ("desta tarefa")', () => {
  const r = parseCompleteConfirmQuestion('Confirma o fechamento desta tarefa: *Onboard professora nova*?');
  assert.deepStrictEqual(r, { titles: ['Onboard professora nova'] });
});

test('nove tarefas, várias em negrito', () => {
  const r = parseCompleteConfirmQuestion('Confirma o fechamento destas 9 tarefas: *A*, *B*, *C*, *D*?');
  assert.deepStrictEqual(r, { titles: ['A', 'B', 'C', 'D'] });
});

// ── não-fechamento / negação / sem negrito → null ──────────────────────────────
test('coordenação (não é fechamento) → null', () => {
  assert.strictEqual(parseCompleteConfirmQuestion('Aviso o Yuri? "texto". Confirma?'), null);
});
test('confirmação genérica sem "fechamento" → null', () => {
  assert.strictEqual(parseCompleteConfirmQuestion('Confirma isso aí?'), null);
});
test('fechamento SEM títulos em negrito → null (fail-closed: não adivinha)', () => {
  assert.strictEqual(parseCompleteConfirmQuestion('Confirma o fechamento destas 2 tarefas: Renovação, Report?'), null);
});
test('negação "Não confirmo o fechamento" → null', () => {
  assert.strictEqual(parseCompleteConfirmQuestion('Não confirmo o fechamento desta tarefa: *X*?'), null);
});
test('título com marca de repetição "(2×)" fica cru (resolução decide/fail-closa)', () => {
  const r = parseCompleteConfirmQuestion('Confirma o fechamento destas 2 tarefas: *Presença Emusys (2×)*, *Ligar Rose*?');
  assert.deepStrictEqual(r, { titles: ['Presença Emusys (2×)', 'Ligar Rose'] });
});
test('vazio/nulo/não-string → null sem lançar', () => {
  for (const v of [null, undefined, '', '   ', 42, {}]) {
    assert.strictEqual(parseCompleteConfirmQuestion(v), null);
  }
});
