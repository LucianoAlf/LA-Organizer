const { test } = require('node:test');
const assert = require('node:assert');
const { classify } = require('./reconcile');
const T = (o) => ({ id: 'x', pluggy_account_id: 'acc1', direction: 'out', amount: 50, posted_date: '2026-06-10', description: '', pluggy_category: null, ...o });

test('matched: app txn mesmo valor/data/direção → matched + id', () => {
  const r = classify(T({ amount: 50, posted_date: '2026-06-10' }), { appTxns: [{ id: 'app1', direction: 'out', amount: 50, transaction_date: '2026-06-11' }], peers: [] });
  assert.equal(r.status, 'matched'); assert.equal(r.matchedId, 'app1');
});
test('matched respeita janela: data > 3 dias NÃO casa', () => {
  const r = classify(T({ amount: 50, posted_date: '2026-06-10' }), { appTxns: [{ id: 'app1', direction: 'out', amount: 50, transaction_date: '2026-06-20' }], peers: [] });
  assert.notEqual(r.status, 'matched');
});
test('noise: rendimento e IOF', () => {
  assert.equal(classify(T({ direction: 'in', amount: 0.05, pluggy_category: 'Proceeds interests and dividends' }), {}).status, 'noise');
  assert.equal(classify(T({ pluggy_category: 'Tax on financial operations', amount: 3 }), {}).status, 'noise');
});
test('internal por categoria', () => {
  assert.equal(classify(T({ pluggy_category: 'Same person transfer' }), {}).status, 'internal');
  assert.equal(classify(T({ pluggy_category: 'Credit card payment', direction: 'in' }), {}).status, 'internal');
  assert.equal(classify(T({ pluggy_category: 'Investments', direction: 'in' }), {}).status, 'internal');
});
test('internal por descrição de fatura', () => {
  assert.equal(classify(T({ description: 'Pagamento de fatura', pluggy_category: 'Transfers' }), {}).status, 'internal');
  assert.equal(classify(T({ description: 'PGTO FATURA CARTAO C6', pluggy_category: 'Investments' }), {}).status, 'internal');
});
test('internal por contraparte (saída numa conta = entrada em outra ±2d)', () => {
  const txn = T({ id: 'o1', direction: 'out', amount: 2100, posted_date: '2026-06-10', pluggy_account_id: 'accA', pluggy_category: 'Transfers' });
  const peers = [txn, { id: 'i1', direction: 'in', amount: 2100, posted_date: '2026-06-11', pluggy_account_id: 'accB' }];
  assert.equal(classify(txn, { peers }).status, 'internal');
});
test('pending: gasto externo sem match', () => {
  assert.equal(classify(T({ pluggy_category: 'Food delivery', amount: 53.91, description: 'IFD*JATOBA' }), { appTxns: [], peers: [] }).status, 'pending');
});
test('matched tem precedência sobre internal', () => {
  const r = classify(T({ amount: 100, posted_date: '2026-06-10', pluggy_category: 'Same person transfer' }), { appTxns: [{ id: 'a1', direction: 'out', amount: 100, transaction_date: '2026-06-10' }], peers: [] });
  assert.equal(r.status, 'matched');
});
test('não casa o mesmo app txn duas vezes', () => {
  const ctx = { appTxns: [{ id: 'a1', direction: 'out', amount: 30, transaction_date: '2026-06-10' }], peers: [] };
  assert.equal(classify(T({ id: 't1', amount: 30, posted_date: '2026-06-10' }), ctx).status, 'matched');
  assert.notEqual(classify(T({ id: 't2', amount: 30, posted_date: '2026-06-10' }), ctx).status, 'matched');
});
