// src/finance/reconcile.js — PURO: classifica 1 movimento do staging Pluggy.
// Precedência: matched (usuário lançou) > noise (rendimento/IOF) > internal (transf
// própria / pagamento de fatura / investimento) > pending (gasto-receita externo). (Fase D / D2)
const NOISE = new Set(['Proceeds interests and dividends', 'Tax on financial operations']);
const INTERNAL = new Set(['Same person transfer', 'Credit card payment', 'Investments']);
const RE_FATURA = /pagamento de fatura|pgto\s*fatura|fatura\s*cart[aã]o|inclusao de pagamento/i;

function daysBetween(a, b) { return (new Date(a) - new Date(b)) / 86400000; }

function findMatch(txn, appTxns) {
  return (appTxns || []).find((a) => !a._used && a.direction === txn.direction
    && Math.abs(Number(a.amount) - Number(txn.amount)) < 0.01
    && Math.abs(daysBetween(a.transaction_date, txn.posted_date)) <= 3) || null;
}
function hasInternalPeer(txn, peers) {
  const opp = txn.direction === 'out' ? 'in' : 'out';
  return (peers || []).some((p) => p.id !== txn.id && p.direction === opp
    && Math.abs(Number(p.amount) - Number(txn.amount)) < 0.01
    && p.pluggy_account_id !== txn.pluggy_account_id
    && Math.abs(daysBetween(p.posted_date, txn.posted_date)) <= 2);
}
function classify(txn, ctx = {}) {
  const m = findMatch(txn, ctx.appTxns);
  if (m) { m._used = true; return { status: 'matched', matchedId: m.id }; }
  if (NOISE.has(txn.pluggy_category)) return { status: 'noise' };
  if (INTERNAL.has(txn.pluggy_category) || RE_FATURA.test(txn.description || '')) return { status: 'internal' };
  if (hasInternalPeer(txn, ctx.peers)) return { status: 'internal' };
  return { status: 'pending' };
}
module.exports = { classify, findMatch, hasInternalPeer, daysBetween };
