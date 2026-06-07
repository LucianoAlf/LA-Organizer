'use strict';
const { shiftDays } = require('../report-domain');
const { CAT_META } = require('../../services/finance-format');

function _status(b) { b = Number(b) || 0; return b < 0 ? '🔴' : (b === 0 ? '🟡' : '✅'); }
function _label(r, fallback) {
  return r.description || (CAT_META[r.category] || {}).label || fallback;
}

// acc: { name, icon, balance }; txns: linhas recentes desc; today: 'YYYY-MM-DD'
function buildAccountDetail(acc, txns, today) {
  const rows = txns || [];
  const lastIn = rows.find((r) => r.type === 'income') || null;
  const lastOut = rows.find((r) => r.type === 'expense') || null;
  const cut = shiftDays(today, -7);
  let in7 = 0, out7 = 0;
  for (const r of rows) {
    if (String(r.transaction_date) < cut) continue;
    const a = Number(r.amount) || 0;
    if (r.type === 'income') in7 += a; else out7 += a;
  }
  return {
    name: acc.name, icon: acc.icon, balance: Number(acc.balance) || 0, status: _status(acc.balance),
    movement: {
      lastIn: lastIn ? { desc: _label(lastIn, 'Entrada'), amount: Number(lastIn.amount) || 0, date: lastIn.transaction_date } : null,
      lastOut: lastOut ? { desc: _label(lastOut, 'Gasto'), amount: Number(lastOut.amount) || 0, date: lastOut.transaction_date } : null,
      var7d: { in: in7, out: out7, net: in7 - out7 },
    },
  };
}

module.exports = { buildAccountDetail };
