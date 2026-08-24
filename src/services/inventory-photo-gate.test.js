'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isLikelyNonInventoryImage } = require('./inventory-photo-gate');

// INVENTORY-PHOTO-CROSSDOMAIN (audit 24/08)

test('comprovante na legenda → NÃO captura (true)', () => {
  assert.equal(isLikelyNonInventoryImage('comprovante do pix pro fornecedor', ''), true);
});

test('vision descreve nota fiscal → NÃO captura (true)', () => {
  assert.equal(isLikelyNonInventoryImage('', 'Imagem de uma nota fiscal com itens e valor total R$ 320,00'), true);
});

test('boleto / recibo / extrato → NÃO captura', () => {
  assert.equal(isLikelyNonInventoryImage('boleto', ''), true);
  assert.equal(isLikelyNonInventoryImage('', 'um recibo de pagamento'), true);
  assert.equal(isLikelyNonInventoryImage('extrato do mês', ''), true);
});

test('foto de item (guitarra) → CAPTURA (false)', () => {
  assert.equal(isLikelyNonInventoryImage('guitarra tagima pra sala 7', 'a red electric guitar on a stand'), false);
});

test('foto de item citando preço (R$) NÃO é barrada (default positivo)', () => {
  assert.equal(isLikelyNonInventoryImage('teclado yamaha R$ 2000 pra sala 8', 'a black digital piano'), false);
});

test('sem legenda nem visão → captura (false)', () => {
  assert.equal(isLikelyNonInventoryImage('', ''), false);
  assert.equal(isLikelyNonInventoryImage(null, null), false);
});
