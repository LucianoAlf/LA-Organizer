// src/services/vision.test.js — testa buildVisionPrompt (lógica pura do prompt).
const { test } = require('node:test');
const assert = require('node:assert');
const { buildVisionPrompt } = require('./vision');

test('inclui a legenda do usuário quando presente', () => {
  const p = buildVisionPrompt('gastei no posto');
  assert.match(p, /gastei no posto/);
});

test('sem legenda: não quebra e não inventa legenda', () => {
  const p = buildVisionPrompt('');
  assert.doesNotMatch(p, /legenda/i);
});

test('instrui extração financeira dos campos-chave', () => {
  const p = buildVisionPrompt('');
  for (const campo of ['valor', 'estabelecimento', 'forma de pagamento', 'data']) {
    assert.match(p, new RegExp(campo, 'i'), `falta instrução de "${campo}"`);
  }
});

test('instrui o sinal COMPROVANTE FINANCEIRO e transcrição literal de números', () => {
  const p = buildVisionPrompt('');
  assert.match(p, /COMPROVANTE FINANCEIRO/);
  assert.match(p, /literal/i);
});

test('mantém a descrição factual genérica pra imagem não-financeira', () => {
  const p = buildVisionPrompt('');
  assert.match(p, /descrev|descreve/i);
});
