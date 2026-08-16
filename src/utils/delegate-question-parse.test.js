'use strict';
// delegate-question-parse.test.js — Fatia 5 (confirmação parse-on-open, delegação).
// Extrai {task_title, to_name} da pergunta de delegação do TOM, nos 2 templates (destinatário
// antes OU depois do título). Só extração; a resolução título→id (fail-closed) reusa complete-
// titles-resolve. Rodar: node --test src/utils/delegate-question-parse.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseDelegateConfirmQuestion } = require('./delegate-question-parse');

test('template A — destinatário ANTES, título em negrito+aspas (caso 16/08 Mayra)', () => {
  const r = parseDelegateConfirmQuestion('Delego pra Mayra com prazo 03/09 — *"Lembrar de enviar o link de Pix recorrente para o pai da Amelie"*. Confirma?');
  assert.deepStrictEqual(r, { task_title: 'Lembrar de enviar o link de Pix recorrente para o pai da Amelie', to_name: 'Mayra' });
});

test('template B — título ANTES, destinatário depois de "pro" (caso 28/07 Alf)', () => {
  const r = parseDelegateConfirmQuestion('Delego a tarefa *Comprar material de iluminação para o Sonoramente* pro Alf e tiro da sua fila? Confirma?');
  assert.deepStrictEqual(r, { task_title: 'Comprar material de iluminação para o Sonoramente', to_name: 'Alf' });
});

test('"para" também casa o destinatário', () => {
  const r = parseDelegateConfirmQuestion('Delego a tarefa *Revisar contrato* para João Pedro. Confirma?');
  assert.deepStrictEqual(r, { task_title: 'Revisar contrato', to_name: 'João Pedro' });
});

// ── não-delegação / negação / faltando peça → null ─────────────────────────────
test('fechamento (não delegação) → null', () => {
  assert.strictEqual(parseDelegateConfirmQuestion('Confirma o fechamento desta tarefa: *X*?'), null);
});
test('negação "Não delego" → null', () => {
  assert.strictEqual(parseDelegateConfirmQuestion('Não delego a tarefa *X* pro Alf.'), null);
});
test('sem título em negrito → null', () => {
  assert.strictEqual(parseDelegateConfirmQuestion('Delego pra Mayra a tarefa de amanhã. Confirma?'), null);
});
test('sem destinatário (sem pra/pro/para) → null', () => {
  assert.strictEqual(parseDelegateConfirmQuestion('Delego a tarefa *Comprar tinta* hoje. Confirma?'), null);
});
test('vazio/nulo/não-string → null sem lançar', () => {
  for (const v of [null, undefined, '', '   ', 42, {}]) {
    assert.strictEqual(parseDelegateConfirmQuestion(v), null);
  }
});
