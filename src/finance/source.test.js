const { test } = require('node:test');
const assert = require('node:assert');
const { classifySource } = require('./source');

const A = ['Dinheiro', 'Conta Itaú'];
const C = ['Nubank'];

test('vazio → none', () => assert.strictEqual(classifySource('', A, C).kind, 'none'));
test('método de pagamento → none', () => {
  for (const m of ['pix', 'débito', 'debito', 'transferência', 'ted', 'boleto'])
    assert.strictEqual(classifySource(m, A, C).kind, 'none', m);
});
test('dinheiro/espécie → cash', () => {
  assert.strictEqual(classifySource('dinheiro', A, C).kind, 'cash');
  assert.strictEqual(classifySource('em espécie', A, C).kind, 'cash');
});
test('match só cartão → card', () => {
  const r = classifySource('nubank', A, C);
  assert.strictEqual(r.kind, 'card');
  assert.strictEqual(r.cardName, 'Nubank');
});
test('match só carteira → account', () => {
  const r = classifySource('itaú', A, C);
  assert.strictEqual(r.kind, 'account');
  assert.strictEqual(r.accountName, 'Conta Itaú');
});
test('match nos dois → ambiguous', () => {
  const r = classifySource('nubank', ['Nubank'], ['Nubank']);
  assert.strictEqual(r.kind, 'ambiguous');
  assert.strictEqual(r.accountName, 'Nubank');
  assert.strictEqual(r.cardName, 'Nubank');
});
test('desconhecido → none', () => assert.strictEqual(classifySource('xpto', A, C).kind, 'none'));
