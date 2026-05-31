const { test } = require('node:test');
const assert = require('node:assert');
const { resolveTxnTarget } = require('./txn-target');

const cands = [
  { id: 't1', amount: 30, category: 'transporte', description: 'Uber', transaction_date: '2026-05-31' },
  { id: 't2', amount: 80, category: 'alimentacao', description: 'Mercado', transaction_date: '2026-05-31' },
  { id: 't3', amount: 30, category: 'lazer', description: 'Cinema', transaction_date: '2026-05-31' },
];

test('"essa"/vazio → o mais recente', () => {
  assert.deepStrictEqual(resolveTxnTarget('exclui essa', cands), { kind: 'one', txn: cands[0] });
  assert.deepStrictEqual(resolveTxnTarget('', cands), { kind: 'one', txn: cands[0] });
  assert.deepStrictEqual(resolveTxnTarget('apaga a última', cands), { kind: 'one', txn: cands[0] });
});
test('nome único → one', () => {
  assert.deepStrictEqual(resolveTxnTarget('a do mercado', cands), { kind: 'one', txn: cands[1] });
});
test('nome ambíguo / valor repetido → many', () => {
  const r = resolveTxnTarget('a de 30', cands);
  assert.strictEqual(r.kind, 'many');
  assert.strictEqual(r.candidates.length, 2);
});
test('valor único → one', () => {
  assert.deepStrictEqual(resolveTxnTarget('era 80', cands), { kind: 'one', txn: cands[1] });
});
test('sem candidatos → none', () => {
  assert.deepStrictEqual(resolveTxnTarget('exclui essa', []), { kind: 'none' });
});
test('texto sem ref → assume o recente', () => {
  assert.deepStrictEqual(resolveTxnTarget('muda a categoria pra lazer', cands), { kind: 'one', txn: cands[0] });
});
