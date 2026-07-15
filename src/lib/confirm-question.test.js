'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isActionConfirmQuestion } = require('./confirm-question');

// REDE 1 / recência (audit 15/07) — detecta se a ÚLTIMA virada do TOM foi uma
// pergunta-de-CONFIRMAÇÃO de ação ("Tá certo isso?"). É o sinal de ESTADO que separa
// confab ("Fechou" após propor reagendamento) de banter ("Fechou, valeu!"). Puro,
// não-load-bearing (nothingPersisted é o eixo primário). Conservador: exige "?" + intenção
// de confirmação — pergunta de info ("qual horário?") NÃO conta (evita coord_response_wrong_bind).

test('caso Matheus: "…Tá certo isso?" → true', () => {
  const last = 'Entendi do áudio:\n\n• Atualizar relatórios clínica → amanhã\n\nTá certo isso?';
  assert.strictEqual(isActionConfirmQuestion(last), true);
});

test('confirma/pode ser/isso mesmo/fica assim → true', () => {
  assert.strictEqual(isActionConfirmQuestion('Confirma que reagendo pra amanhã?'), true);
  assert.strictEqual(isActionConfirmQuestion('Pode ser às 9h?'), true);
  assert.strictEqual(isActionConfirmQuestion('É isso mesmo?'), true);
  assert.strictEqual(isActionConfirmQuestion('Fica assim então?'), true);
});

test('pergunta de INFO não conta (não é confirmação de ação)', () => {
  assert.strictEqual(isActionConfirmQuestion('Qual horário você prefere?'), false);
  assert.strictEqual(isActionConfirmQuestion('Quer que eu te lembre depois?'), false);
});

test('sem "?" não conta (afirmação, não pergunta)', () => {
  assert.strictEqual(isActionConfirmQuestion('Beleza, crio separado.'), false);
  assert.strictEqual(isActionConfirmQuestion('✅ Reagendei tudo.'), false);
});

test('robustez: vazio/nulo', () => {
  assert.strictEqual(isActionConfirmQuestion(''), false);
  assert.strictEqual(isActionConfirmQuestion(null), false);
  assert.strictEqual(isActionConfirmQuestion(undefined), false);
});
