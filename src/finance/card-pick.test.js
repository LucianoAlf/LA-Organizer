// src/finance/card-pick.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { payloadCardPick } = require('./card-pick');

// TASK-COMPLETE-ALVO-NAO-ACHADO tem um irmão financeiro: pay_invoice/query_invoice/
// card_refund perguntavam "Qual cartão?" com texto solto, SEM estado. Cada resposta
// seguinte precisava que o LLM reconstruísse o alvo do zero a partir do texto puro — e
// falhava sempre que a resposta não repetia o nome do cartão ("Fatura de agosto", "Tom").
// Rose repetiu "Cartão Nubank" 3 vezes e levou a mesma pergunta 3 vezes (caso real, 14/08).
//
// payloadCardPick monta o estado que falta: form/action/candidates gravados em
// pending-intents, no MESMO padrão já usado (e funcionando) por card_purchase.
test('monta form/action/candidates e preserva os params conhecidos', () => {
  const p = payloadCardPick('pay_invoice', { amount: 100, from_account: 'mercado pago' }, [
    { id: 'c1', name: 'Cartão Nubank' },
  ]);
  assert.strictEqual(p.form, 'card_pick');
  assert.strictEqual(p.action, 'pay_invoice');
  assert.strictEqual(p.params.amount, 100);
  assert.strictEqual(p.params.from_account, 'mercado pago');
  assert.deepStrictEqual(p.candidates, [{ kind: 'card', id: 'c1', name: 'Cartão Nubank' }]);
});

test('sem cartões, candidates fica vazio — o chamador decide o texto (sem cartão cadastrado)', () => {
  assert.deepStrictEqual(payloadCardPick('query_invoice', {}, []).candidates, []);
});

test('params ausente não quebra', () => {
  const p = payloadCardPick('card_refund', null, [{ id: 'c1', name: 'X' }]);
  assert.deepStrictEqual(p.params, {});
});

// O payload não pode carregar o `card` ambíguo/errado do turno anterior — quem resolve o
// pick sobrescreve com o nome exato escolhido; guardar o valor velho aqui seria armadilha.
test('não força um campo card específico — o resume é quem decide', () => {
  const p = payloadCardPick('pay_invoice', { card: 'mercado pago' }, [{ id: 'c1', name: 'Cartão Nubank' }]);
  assert.strictEqual(p.params.card, 'mercado pago'); // preservado tal qual veio; resume sobrescreve
});
