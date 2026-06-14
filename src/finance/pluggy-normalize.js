// src/finance/pluggy-normalize.js — PURO: normaliza 1 transação Pluggy crua.
// Direção vem do campo `type` (DEBIT=out, CREDIT=in) — vale p/ conta E cartão.
// O sinal do amount NÃO decide direção (no cartão a compra vem positiva). amount = absoluto.
// (Fase D / D1 — Alf 14/06)
function normalizeTxn(raw, accountKind, todayYmd) {
  const postedDate = String(raw.date || '').slice(0, 10);
  const type = String(raw.type || '').toUpperCase();
  let direction;
  if (type === 'DEBIT') direction = 'out';
  else if (type === 'CREDIT') direction = 'in';
  else direction = Number(raw.amount) < 0 ? 'out' : 'in'; // fallback sem type
  return {
    pluggyTransactionId: raw.id,
    pluggyAccountId: raw.accountId,
    postedDate,
    amount: Math.abs(Number(raw.amount) || 0),
    direction,
    description: raw.description || '',
    category: raw.category || null,
    isFuture: todayYmd ? postedDate > todayYmd : false,
    accountKind,
    raw,
  };
}
module.exports = { normalizeTxn };
