'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { podeLiberarRecado, ultimaPergunta } = require('./confirm-coord-gate');

// Rafinha 29/08 11:07 — a pergunta literal do TOM (o "Confirma" dele caiu em CONFIRM_NOEXEC).
const RAFINHA = 'Mando pro Alf assim?\n\n_"Rafinha precisa de aprovação pra comprar 3 abafadores pra escola da Barra — situação urgente. Pode?"_\n\nConfirma?';

test('Rafinha: a pergunta é "Mando pro Alf assim?", não o "Pode?" de dentro do rascunho', () => {
  assert.strictEqual(ultimaPergunta(RAFINHA), 'Mando pro Alf assim?');
  assert.strictEqual(podeLiberarRecado(RAFINHA), true);
});

test('rascunho com palavra de ação ("cancela", "remarca") não veta a proposta — é texto do recado', () => {
  assert.strictEqual(podeLiberarRecado('Mando pro Yuri assim?\n\n_"Yuri, precisa remarcar a reunião de quinta pra sexta."_\n\nConfirma?'), true);
});

test('continua vetando ação do TOM fora do rascunho, e aspas curtas (nome) não somem', () => {
  assert.strictEqual(podeLiberarRecado('Cancelo a tarefa e aviso o Yuri? Confirma?'), false);
  assert.strictEqual(ultimaPergunta('Aviso o "Dudu"? Confirma?'), 'Aviso o "Dudu"?');
});
