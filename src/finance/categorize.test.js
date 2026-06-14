const { test } = require('node:test');
const assert = require('node:assert');
const { mapCategory, normalizeParams } = require('./categorize');

// ---- mapCategory (type-aware, plataforma≠categoria) ----
test('plataforma→uso dominante: ifood→alimentacao (não delivery)', () => {
  assert.strictEqual(mapCategory('gastei no ifood', 'expense'), 'alimentacao');
});
test('uber→transporte', () => {
  assert.strictEqual(mapCategory('uber pro trabalho', 'expense'), 'transporte');
});
test('salão→beleza, posto→combustivel, mercado→mercado (categoria própria agora)', () => {
  assert.strictEqual(mapCategory('cortei o cabelo no salão', 'expense'), 'beleza');
  assert.strictEqual(mapCategory('abasteci no posto', 'expense'), 'combustivel');
  assert.strictEqual(mapCategory('compras no supermercado', 'expense'), 'mercado');
});
test('type-aware: aluguel income vs expense', () => {
  assert.strictEqual(mapCategory('recebi aluguel', 'income'), 'aluguel_recebido');
  assert.strictEqual(mapCategory('paguei o aluguel', 'expense'), 'moradia');
});
test('comissão (income)', () => {
  assert.strictEqual(mapCategory('comissão de venda loja', 'income'), 'comissao');
});
test('fallback por tipo: desconhecido expense→outros, income→outras_receitas', () => {
  assert.strictEqual(mapCategory('xyz nada a ver', 'expense'), 'outros');
  assert.strictEqual(mapCategory('xyz nada a ver', 'income'), 'outras_receitas');
});
test('sem type: considera todas, fallback outros', () => {
  assert.strictEqual(mapCategory('iFood'), 'alimentacao');
  assert.strictEqual(mapCategory('comprei um negocio aleatorio'), 'outros');
});

// ---- merchant BR por nome próprio (Fase E) ----
test('merchant lookup: fatura "suja" cai na categoria certa, não em outros', () => {
  assert.strictEqual(mapCategory('PAG*IPIRANGA', 'expense'), 'combustivel');
  assert.strictEqual(mapCategory('MERCPAGO*DROGASIL', 'expense'), 'farmacia');
  assert.strictEqual(mapCategory('CARREFOUR SAO PAULO', 'expense'), 'mercado');
  assert.strictEqual(mapCategory('AMAZON BR', 'expense'), 'compras');
});
test('merchant lookup desambigua: MERCADOLIVRE→compras (não mercado), AMAZON PRIME→assinaturas', () => {
  assert.strictEqual(mapCategory('MERCADOLIVRE*123', 'expense'), 'compras');
  assert.strictEqual(mapCategory('AMAZON PRIME', 'expense'), 'assinaturas');
});

// ---- normalizeParams (aliases) ----
test('normalizeParams: aliases valor/tipo/categoria', () => {
  const out = normalizeParams({ valor: 45, gasto: true, cat: 'alimentacao', nota: 'iFood' });
  assert.strictEqual(out.amount, 45);
  assert.strictEqual(out.type, 'expense');
  assert.strictEqual(out.category, 'alimentacao');
  assert.strictEqual(out.description, 'iFood');
});
test('normalizeParams: receita/ganho vira income', () => {
  const out = normalizeParams({ value: 2800, receita: true });
  assert.strictEqual(out.type, 'income');
  assert.strictEqual(out.amount, 2800);
});
