const { test } = require('node:test');
const assert = require('node:assert');
const { stripAcquirer, categorizeMerchant } = require('./merchant-category');

test('stripAcquirer tira prefixo de adquirente e normaliza (lower + sem acento)', () => {
  assert.equal(stripAcquirer('PAG*IPIRANGA'), 'ipiranga');
  assert.equal(stripAcquirer('MERCPAGO*Drogaria Raia'), 'drogaria raia');
  assert.equal(stripAcquirer('PICPAY*MAGALU'), 'magalu');
  assert.equal(stripAcquirer('Pão de Açúcar'), 'pao de acucar');
  assert.equal(stripAcquirer('  Amazon   BR '), 'amazon br');
});

test('e-commerce → compras (desambigua mercadolivre, que tem "mercado")', () => {
  assert.equal(categorizeMerchant('AMAZON BR', 'expense'), 'compras');
  assert.equal(categorizeMerchant('MERCADOLIVRE*123ABC', 'expense'), 'compras');
  assert.equal(categorizeMerchant('Mercado Livre', 'expense'), 'compras');
  assert.equal(categorizeMerchant('MAGALU SAO PAULO', 'expense'), 'compras');
  assert.equal(categorizeMerchant('Shopee *Pedido', 'expense'), 'compras');
  assert.equal(categorizeMerchant('AMERICANAS.COM', 'expense'), 'compras');
});

test('redes sem palavra genérica → categoria certa', () => {
  assert.equal(categorizeMerchant('CARREFOUR', 'expense'), 'mercado');
  assert.equal(categorizeMerchant('PAO DE ACUCAR', 'expense'), 'mercado');
  assert.equal(categorizeMerchant('DROGASIL', 'expense'), 'farmacia');
  assert.equal(categorizeMerchant('RAIADROGASIL', 'expense'), 'farmacia');
  assert.equal(categorizeMerchant('PAG*IPIRANGA', 'expense'), 'combustivel');
  assert.equal(categorizeMerchant('MC DONALDS', 'expense'), 'alimentacao');
  assert.equal(categorizeMerchant('Burger King', 'expense'), 'alimentacao');
});

test('assinatura por nome próprio → assinaturas; amazon prime ganha de amazon→compras', () => {
  assert.equal(categorizeMerchant('AMAZON PRIME', 'expense'), 'assinaturas');
  assert.equal(categorizeMerchant('Prime Video', 'expense'), 'assinaturas');
  assert.equal(categorizeMerchant('YouTube Premium', 'expense'), 'assinaturas');
  assert.equal(categorizeMerchant('OPENAI *CHATGPT', 'expense'), 'assinaturas');
  assert.equal(categorizeMerchant('Google One', 'expense'), 'assinaturas');
});

test('merchant desconhecido ou ambíguo → null (não chuta)', () => {
  assert.equal(categorizeMerchant('FULANO DE TAL', 'expense'), null);
  assert.equal(categorizeMerchant('PRIME', 'expense'), null); // "prime" sozinho é ambíguo
  assert.equal(categorizeMerchant('', 'expense'), null);
});

test('income nunca casa merchant (merchant é despesa)', () => {
  assert.equal(categorizeMerchant('AMAZON BR', 'income'), null);
  assert.equal(categorizeMerchant('CARREFOUR', 'income'), null);
});

test('sem type informado → trata como despesa (casa)', () => {
  assert.equal(categorizeMerchant('DROGASIL'), 'farmacia');
});
