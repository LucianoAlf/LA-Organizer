'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { afirmacaoComAcrescimo: a } = require('./afirmacao-com-acrescimo');
const { detectUserConfirmation } = require('../services/user-confirmation');

// Peterson 13/07 12:00 (525d947c) — a fala real, já sem o scaffold de citação.
const PETERSON = 'Isso, avisa a eles que estáo no Grupo “Produção L.A Drum Games” \nOnde vamos falar sobre os assintos de produção e Funções da equipe.';

test('Peterson: o detector de "sim" não reconhece (é o bug) — e o novo reconhece a confirmação com acréscimo', () => {
  assert.strictEqual(detectUserConfirmation(PETERSON), null);
  const r = a(PETERSON);
  assert.ok(r);
  assert.match(r.acrescimo, /^avisa a eles que estáo no Grupo/);
});

test('outras afirmações com conteúdo', () => {
  assert.ok(a('pode, e acrescenta que a reunião é às 8h'));
  assert.ok(a('Sim! Manda também que é pra levar o rider impresso'));
});

test('NÃO é: "sim" pelado, afirmação curta, negação, espera', () => {
  assert.strictEqual(a('Isso'), null);
  assert.strictEqual(a('Sim'), null);
  assert.strictEqual(a('Isso, pode mandar'), null);
  assert.strictEqual(a('Isso, não manda ainda não'), null);
  assert.strictEqual(a('Sim, mas espera eu criar o grupo primeiro'), null);
  assert.strictEqual(a('Não, avisa só a Krissya que o grupo é amanhã'), null);
  assert.strictEqual(a(''), null);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: recado estagiado + afirmação com acréscimo → pré-confirmado; a intent antiga fecha depois do envio', () => {
  assert.match(ENG, /const _amend = afirmacaoComAcrescimo\(_confirmText\);\s*\n\s*if \(_amend\) \{\s*\n\s*_metrics\.recado_preconfirmed = true;\s*\n\s*_metrics\.recado_amend_intent = target\.id;/);
  assert.match(ENG, /if \(okCount > 0 && _metrics\.recado_amend_intent\) \{/);
  assert.match(ENG, /\[CONFIRMACAO_COM_ACRESCIMO\]/);
});
