'use strict';
// Clayton 26/09 09:03–09:04. O TOM propôs "Quer que eu peça pra Fefê te mandar a lista dos que
// já venceram?", o Clayton disse "Ok" — e o TOM montou o recado e perguntou DE NOVO ("Aviso a Fefê
// assim? Confirma?"). Ele respondeu "Obrigado", "Entendi" (nenhum é "sim") e o recado nunca saiu.
// O gate da Fatia 8 (o "sim" à proposta já vale como confirmação) não reconhecia "peça pra X" como
// proposta de recado. Pergunta REAL abaixo.
const { test } = require('node:test');
const assert = require('node:assert');
const { podeLiberarRecado } = require('./confirm-coord-gate');

const CLAYTON = 'Clayton, não tenho essa lista aqui. As tarefas de *Renovação* da Fefê aparecem só com o título, sem os nomes dos alunos, e não quero chutar nenhum. Os alunos com contrato vencido estão na consulta de renovação do LA Report, do Recreio. Quer que eu peça pra Fefê te mandar a lista dos que já venceram?';

test('caso real do Clayton: "Quer que eu peça pra Fefê…?" é proposta de recado — o "Ok" já confirma', () => {
  assert.strictEqual(podeLiberarRecado(CLAYTON), true);
});

test('as outras formas de pedir a alguém', () => {
  for (const q of ['Peço pra Rose te mandar o comprovante?', 'Quer que eu peça à Ana o horário novo?', 'Posso pedir pro Ramon confirmar a sala?', 'Quer que eu peça ao Hugo o link? Confirma?']) {
    assert.strictEqual(podeLiberarRecado(q), true, q);
  }
});

test('pedir pra alguém MEXER em item existente continua vetado (fail-closed)', () => {
  for (const q of ['Quer que eu peça pra Fefê cancelar a aula de amanhã?', 'Peço pra Rose lançar a fatura do Nubank?', 'Posso pedir pro Ramon concluir a tarefa da sala?']) {
    assert.strictEqual(podeLiberarRecado(q), false, q);
  }
});

test('"peça" que não é pedido a uma pessoa não libera', () => {
  assert.strictEqual(podeLiberarRecado('Quer que eu separe essa peça pra você?'), false);
  assert.strictEqual(podeLiberarRecado('Qual peça do violão quebrou?'), false);
});
