// src/coordination/confirm-coord-gate.test.js
// Rodar: node --test src/coordination/confirm-coord-gate.test.js
//
// COORD-GATE-VETADO-PELO-PREAMBULO (Alf 19/08 13:10 BRT) — o gate de permissão passou a
// explicar a regra antes de propor o recado: "…quem pode REMARCAR é o dono, Yuri — convidado
// não altera a agenda dos outros. Quer que eu mande um recado propondo a mudança?".
// podeLiberarRecado rodava o veto ACAO_SOBRE_EXISTENTE no TEXTO INTEIRO, achava "remarcar"
// no PREÂMBULO e vetava — então o "Sim" não pré-confirmava e o recado era re-estagiado:
// "Aviso o Yuri? Confirma?" + segundo "Sim". Duas confirmações pro mesmo consentimento.
//
// A regra certa: o "sim" responde a PERGUNTA, não o preâmbulo. Veto e proposta passam a ser
// avaliados na última frase interrogativa — e nos DOIS a mesma frase, pra não afrouxar o
// fail-closed (proposta limpa numa frase, veto em outra, continua vetando).
const { test } = require('node:test');
const assert = require('node:assert');
const { podeLiberarRecado } = require('./confirm-coord-gate');
const { buildOwnerGateMessage } = require('../lib/event-owner-gate');

test('CASO REAL: preâmbulo com "remarcar" não veta a proposta de recado', () => {
  const pergunta = buildOwnerGateMessage('reschedule', 'Reunião MKT - NBG!', 'Yuri');
  assert.strictEqual(podeLiberarRecado(pergunta), true);
});
test('CASO REAL: o mesmo vale pra cancelamento', () => {
  assert.strictEqual(podeLiberarRecado(buildOwnerGateMessage('cancel', 'Reunião X', 'Yuri')), true);
});

// O fail-closed continua fechado quando a AÇÃO está na própria pergunta.
test('FAIL-CLOSED: ação sobre item existente DENTRO da pergunta segue vetada', () => {
  assert.strictEqual(podeLiberarRecado('Reagendo a reunião e aviso o time?'), false);
  assert.strictEqual(podeLiberarRecado('Cancelo a tarefa e mando recado pro João?'), false);
});
test('FAIL-CLOSED: pergunta sem proposta de recado não libera', () => {
  assert.strictEqual(podeLiberarRecado('Sobre a Reunião X: quer que eu apague tudo?'), false);
  assert.strictEqual(podeLiberarRecado('Confirma?'), false);
});
test('sem "?" nenhum, avalia o texto inteiro (comportamento antigo)', () => {
  assert.strictEqual(podeLiberarRecado('Aviso o Yuri'), true);
  assert.strictEqual(podeLiberarRecado('Reagendo e aviso o Yuri'), false);
});
test('entrada degenerada nunca libera', () => {
  for (const v of [null, undefined, '', '   ', 42]) {
    assert.strictEqual(podeLiberarRecado(v), false);
  }
});
// Regressão do comportamento original (Fatia 8): proposta simples de recado segue liberando.
test('ZERO-REGRESSÃO: propostas simples de recado continuam liberando', () => {
  assert.strictEqual(podeLiberarRecado('Mando um agradecimento pro Rodrigo?'), true);
  assert.strictEqual(podeLiberarRecado('Aviso a Fabi?'), true);
  assert.strictEqual(podeLiberarRecado('Aviso 3 pessoas?'), true);
});
