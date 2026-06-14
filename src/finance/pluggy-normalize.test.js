const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeTxn } = require('./pluggy-normalize');

test('conta: DEBIT (valor negativo) → out; CREDIT (positivo) → in', () => {
  const out = normalizeTxn({ id: 't1', accountId: 'a1', date: '2026-06-03T00:00:00Z', amount: -1414.99, type: 'DEBIT', description: 'PGTO FATURA' }, 'account', '2026-06-14');
  assert.equal(out.direction, 'out');
  assert.equal(out.amount, 1414.99);
  assert.equal(out.postedDate, '2026-06-03');
  const inc = normalizeTxn({ id: 't2', accountId: 'a1', date: '2026-06-10T00:00:00Z', amount: 700, type: 'CREDIT', description: 'PIX RECEBIDO' }, 'account', '2026-06-14');
  assert.equal(inc.direction, 'in');
  assert.equal(inc.amount, 700);
});

test('cartão: DEBIT com valor POSITIVO (compra) → out (a pegadinha)', () => {
  const buy = normalizeTxn({ id: 't3', accountId: 'c1', date: '2026-06-09T00:00:00Z', amount: 6.98, type: 'DEBIT', description: 'IFD*IFOOD' }, 'card', '2026-06-14');
  assert.equal(buy.direction, 'out');
  assert.equal(buy.amount, 6.98);
});

test('cartão: CREDIT (estorno/pagamento) → in', () => {
  const est = normalizeTxn({ id: 't4', accountId: 'c1', date: '2026-06-05T00:00:00Z', amount: 50, type: 'CREDIT', description: 'ESTORNO' }, 'card', '2026-06-14');
  assert.equal(est.direction, 'in');
});

test('parcela futura (date > hoje) → isFuture true', () => {
  const fut = normalizeTxn({ id: 't5', accountId: 'c1', date: '2026-07-15T00:00:00Z', amount: 56.5, type: 'DEBIT', description: 'ANUIDADE 12/12' }, 'card', '2026-06-14');
  assert.equal(fut.isFuture, true);
});

test('type ausente → fallback pelo sinal do amount', () => {
  const n = normalizeTxn({ id: 't6', accountId: 'a1', date: '2026-06-01T00:00:00Z', amount: -10, type: '', description: 'X' }, 'account', '2026-06-14');
  assert.equal(n.direction, 'out');
});

test('passa o id e accountId; raw preservado', () => {
  const n = normalizeTxn({ id: 'abc', accountId: 'xyz', date: '2026-06-01', amount: 5, type: 'DEBIT' }, 'card', '2026-06-14');
  assert.equal(n.pluggyTransactionId, 'abc');
  assert.equal(n.pluggyAccountId, 'xyz');
  assert.equal(n.raw.id, 'abc');
});
