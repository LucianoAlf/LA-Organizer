'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { friendlyInventoryError } = require('./inventory-error-message');

// Tokens REAIS do inventario-validators.js → mensagem amigável (não jargão).
const CASES = [
  ['action_invalida: upsert_room', /ação/i],   // caso Dai (LLM inventou upsert_room)
  ['nome obrigatório', /nome/i],
  ['sala obrigatória', /sala/i],
  ['item_obrigatorio', /item/i],
  ['sala_destino_obrigatoria', /destino/i],
  ['descricao_obrigatoria', /manuten/i],
  ['produto_obrigatorio', /produto/i],
  ['unidade_obrigatoria', /unidade/i],
  ['quantidade_invalida', /quant/i],
  ['tipo_invalido: x', /entrada|saída/i],
];

for (const [code, expect] of CASES) {
  test(`código "${code}" → mensagem amigável`, () => {
    const msg = friendlyInventoryError([code]);
    assert.match(msg, expect);
    // NUNCA vaza o token cru
    assert.ok(!/Faltam dados|Pedido inválido|_obrigatori|_invalid|action_invalida|params_ausente|payload_invalido/.test(msg),
      `vazou jargão: ${msg}`);
  });
}

test('código desconhecido → genérico (sem jargão)', () => {
  const msg = friendlyInventoryError(['frobnicate_xyz']);
  assert.match(msg, /inventário/i);
  assert.ok(!/frobnicate/.test(msg));
});

test('params_ausente / payload_invalido → genérico', () => {
  assert.match(friendlyInventoryError(['params_ausente']), /inventário/i);
  assert.match(friendlyInventoryError(['payload_invalido']), /inventário/i);
});

test('aceita STRING (não só array)', () => {
  const msg = friendlyInventoryError('nome obrigatório');
  assert.match(msg, /nome/i);
});

test('array com 2 erros → ambas as mensagens, sem duplicar', () => {
  const msg = friendlyInventoryError(['produto_obrigatorio', 'unidade_obrigatoria']);
  assert.match(msg, /produto/i);
  assert.match(msg, /unidade/i);
});

test('mesmo código repetido → não duplica linha', () => {
  const msg = friendlyInventoryError(['item_obrigatorio', 'item_obrigatorio']);
  assert.equal(msg.split('\n').length, 1);
});

test('vazio / null → genérico', () => {
  assert.match(friendlyInventoryError([]), /inventário/i);
  assert.match(friendlyInventoryError(null), /inventário/i);
  assert.match(friendlyInventoryError(''), /inventário/i);
});
