const test = require('node:test');
const assert = require('node:assert');
const { buildLaunchPreview } = require('./launch-confirm');

const cardItem = (over = {}) => ({
  op: 'card_purchase',
  source: { kind: 'card', id: 'c1', name: 'Latam PASS' },
  txn: { type: 'expense', amount: 62.92, description: 'Cheirin', category: 'alimentacao', installments: 1, date: '2026-06-04', ...over },
});

test('preview: 1 item cartão mostra valor, categoria e fonte', () => {
  const out = buildLaunchPreview([cardItem()]);
  assert.match(out, /Cheirin/);
  assert.match(out, /62,92/);
  assert.match(out, /Latam PASS/);
  assert.match(out, /sim/i); // pede confirmação
});

test('preview: parcelado mostra "em 3x"', () => {
  const out = buildLaunchPreview([cardItem({ amount: 350.04, installments: 3, description: 'Sofá' })]);
  assert.match(out, /em 3x/);
});

test('preview: vários itens, fonte única aparece UMA vez', () => {
  const out = buildLaunchPreview([cardItem(), cardItem({ description: 'Polo', amount: 38.98 })]);
  assert.match(out, /Cheirin/);
  assert.match(out, /Polo/);
  assert.strictEqual((out.match(/Latam PASS/g) || []).length, 1);
});

test('preview: receita usa sinal +', () => {
  const out = buildLaunchPreview([{
    op: 'cash', source: { kind: 'account', id: 'a1', name: 'Itaú' },
    txn: { type: 'income', amount: 1000, description: 'Projeto', category: 'salario', installments: 1, date: '2026-06-16' },
  }]);
  assert.match(out, /\+R\$\s?1\.000,00/);
});

test('preview: mostra a data dd/mm quando informada', () => {
  assert.match(buildLaunchPreview([cardItem({ date: '2026-06-21' })]), /21\/06/);
});

test('preview: sem data → "hoje"', () => {
  assert.match(buildLaunchPreview([cardItem({ date: undefined })]), /hoje/);
});

test('preview: lista vazia → null', () => {
  assert.strictEqual(buildLaunchPreview([]), null);
});
