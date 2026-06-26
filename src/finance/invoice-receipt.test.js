'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectInvoicePaymentReceipt, parseBrlNumber } = require('./invoice-receipt');

// Comprovante REAL que o Alf mandou em 22/06 (OCR via vision.js), que caiu no no-op.
const ALF_RECEIPT = [
  '[O usuário ACABOU DE ENVIAR uma imagem agora — primeira vez vendo este arquivo. Análise automática:]',
  'COMPROVANTE FINANCEIRO: valor total: R$ 6.295,54; estabelecimento/loja/app: Nu/Nubank; data: 22 JUN 2026; forma de pagamento: ilegível; itens principais resumidos: "Fatura do cartão Nubank".',
  'Também aparecem os campos: Documento: "Fatura do cartão Nubank"; Pagador: "Luciano Teixeira"; Agência: "0001"; Conta: "8268548-6".',
].join('\n');

test('detecta comprovante de pagamento de fatura de cartão (caso Alf/Nubank)', () => {
  const r = detectInvoicePaymentReceipt(ALF_RECEIPT);
  assert.ok(r, 'deveria detectar o comprovante de fatura');
  assert.strictEqual(r.cardHint, 'Nubank');
  assert.strictEqual(r.amount, 6295.54);
});

test('extrai cartão Itaú e valor pt-BR com milhar', () => {
  const t = 'COMPROVANTE FINANCEIRO: valor total: R$ 1.234,56; Documento: "Fatura do cartão Itaú".';
  const r = detectInvoicePaymentReceipt(t);
  assert.ok(r);
  assert.strictEqual(r.cardHint, 'Itaú');
  assert.strictEqual(r.amount, 1234.56);
});

test('NÃO dispara em comprovante de gasto comum (sem fatura/cartão)', () => {
  const t = 'COMPROVANTE FINANCEIRO: valor total: R$ 50,00; estabelecimento/loja/app: Pizzaria 114; itens: "rodízio".';
  assert.strictEqual(detectInvoicePaymentReceipt(t), null);
});

test('NÃO dispara em Pix/transferência', () => {
  const t = 'COMPROVANTE FINANCEIRO: valor total: R$ 300,00; tipo: Pix; favorecido: João da Silva.';
  assert.strictEqual(detectInvoicePaymentReceipt(t), null);
});

test('NÃO dispara em import de fatura (FATURA_JSON = lista de compras, não comprovante)', () => {
  const t = '[FATURA_JSON]{"isInvoice":true,"emissor":"Nubank","total":6295.54,"itens":[]}[/FATURA_JSON]\nFatura Nubank · 40 compras';
  assert.strictEqual(detectInvoicePaymentReceipt(t), null);
});

test('NÃO dispara sem valor (não dá pra pagar sem total)', () => {
  const t = 'COMPROVANTE FINANCEIRO: Documento: "Fatura do cartão Nubank"; valor: ilegível.';
  assert.strictEqual(detectInvoicePaymentReceipt(t), null);
});

test('texto vazio ou prosa solta (sem COMPROVANTE FINANCEIRO) → null', () => {
  assert.strictEqual(detectInvoicePaymentReceipt(''), null);
  assert.strictEqual(detectInvoicePaymentReceipt(null), null);
  assert.strictEqual(detectInvoicePaymentReceipt('oi tom, paguei a fatura do nubank'), null);
});

test('parseBrlNumber: pt-BR milhar+decimal', () => {
  assert.strictEqual(parseBrlNumber('6.295,54'), 6295.54);
  assert.strictEqual(parseBrlNumber('1.234,56'), 1234.56);
  assert.strictEqual(parseBrlNumber('50,00'), 50);
  assert.strictEqual(parseBrlNumber('300'), 300);
});
