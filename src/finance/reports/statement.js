'use strict';
const { CAT_META } = require('../../services/finance-format');

// acc: { name, icon } | null; rows: linhas desc; opts: { label, limit=12, sourceMap? }
function buildStatement(acc, rows, opts = {}) {
  const limit = opts.limit || 12;
  const all = rows || [];
  const shown = all.slice(0, limit);
  let totalIn = 0, totalOut = 0;
  for (const r of all) {
    const a = Number(r.amount) || 0;
    if (r.type === 'income') totalIn += a; else totalOut += a;
  }
  const items = shown.map((r) => {
    const meta = CAT_META[r.category] || {};
    return {
      type: r.type, amount: Number(r.amount) || 0, date: r.transaction_date,
      desc: r.description || meta.label || r.category || 'Lançamento',
      emoji: meta.emoji || '📦',
      source: opts.sourceMap ? (opts.sourceMap[r.account_id] || opts.sourceMap[r.card_id] || '') : '',
    };
  });
  return {
    name: acc ? acc.name : null, icon: acc ? acc.icon : null,
    label: opts.label || 'Extrato',
    items, count: all.length, shown: shown.length, hasMore: all.length > shown.length,
    totalIn, totalOut,
  };
}

module.exports = { buildStatement };
