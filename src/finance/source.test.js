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

// ---- Acento: match deve ignorar diacríticos (caso Rose 11/06: "Itaú" digitado vs "Itáu" salvo) ----
test('cartão com acento trocado casa (Itaú digitado vs Itáu salvo)', () => {
  const r = classifySource('Cartão Itaú Matheus', [], ['Cartão Itáu Matheus']);
  assert.strictEqual(r.kind, 'card');
  assert.strictEqual(r.cardName, 'Cartão Itáu Matheus');
});
test('carteira com acento casa nos dois sentidos', () => {
  assert.strictEqual(classifySource('itau', A, C).kind, 'account'); // sem acento digitado, salvo "Itaú"
});

// ---- Novos testes: type/method-aware ----
const ACC = ['Nubank', 'Itau'];
const CARD = ['Nubank'];

// receita nunca vai pro cartão
test('income + nome colidente → account (sem ambiguidade)', () => {
  const r = classifySource('nubank', ACC, CARD, { type: 'income' });
  assert.deepStrictEqual(r, { kind: 'account', accountName: 'Nubank' });
});
test('income + nome só de cartão → none (engine pergunta/usa principal)', () => {
  const r = classifySource('nubank', ['Itau'], CARD, { type: 'income' });
  assert.deepStrictEqual(r, { kind: 'none' });
});
// gasto com sinal explícito resolve direto
test('expense + colidente + method credito → card', () => {
  const r = classifySource('nubank', ACC, CARD, { type: 'expense', method: 'credito' });
  assert.deepStrictEqual(r, { kind: 'card', cardName: 'Nubank' });
});
test('expense + colidente + method debito → account', () => {
  const r = classifySource('nubank', ACC, CARD, { type: 'expense', method: 'debito' });
  assert.deepStrictEqual(r, { kind: 'account', accountName: 'Nubank' });
});
test('expense + colidente + method pix → account', () => {
  const r = classifySource('nubank', ACC, CARD, { type: 'expense', method: 'pix' });
  assert.deepStrictEqual(r, { kind: 'account', accountName: 'Nubank' });
});
// gasto sem sinal continua ambíguo (comportamento atual preservado)
test('expense + colidente + sem method → ambiguous', () => {
  const r = classifySource('nubank', ACC, CARD, { type: 'expense' });
  assert.deepStrictEqual(r, { kind: 'ambiguous', accountName: 'Nubank', cardName: 'Nubank' });
});
