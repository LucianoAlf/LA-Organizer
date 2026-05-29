const { test } = require('node:test');
const assert = require('node:assert');
const { mapCategory, normalizeParams } = require('./categorize');

test('mapCategory: palavra-chave de alimentacao', () => {
  assert.strictEqual(mapCategory('iFood'), 'alimentacao');
  assert.strictEqual(mapCategory('paguei o mercado'), 'alimentacao');
});
test('mapCategory: transporte e moradia', () => {
  assert.strictEqual(mapCategory('uber pro trampo'), 'transporte');
  assert.strictEqual(mapCategory('aluguel'), 'moradia');
});
test('mapCategory: fallback outros', () => {
  assert.strictEqual(mapCategory('comprei um negocio aleatorio'), 'outros');
});
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
