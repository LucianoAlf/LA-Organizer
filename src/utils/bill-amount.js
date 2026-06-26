'use strict';
// FONTE DE VERDADE ÚNICA do "quanto vale a conta fixa nesse mês" (feature override mensal).
// override válido (>0) tem prioridade sobre o amount base. Espelhado em TS no PWA
// (web/src/lib/financeiro.ts resolveBillAmount) com paridade testada — as 4 superfícies
// (previsão / exibição / pagamento / lembrete do TOM) chamam ESTE helper pra não divergirem.

// Número finito e > 0, senão null (ignora override ruim/zerado).
function _posNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Valor da conta no mês: override válido > amount base. Sem override → base.
function resolveBillAmount(bill, override) {
  const ov = override ? _posNum(override.amount) : null;
  if (ov != null) return ov;
  return Number(bill && bill.amount) || 0;
}

// Aplica overrides (mapa por bill.id) numa lista; retorna cópias só onde o valor mudou
// (memo-friendly), sem mutar os originais. overridesByBillId: { [bill_id]: { amount } }.
function resolveBillsForMonth(bills, overridesByBillId) {
  const map = overridesByBillId || {};
  return (bills || []).map((b) => {
    const amount = resolveBillAmount(b, map[b.id]);
    return amount === Number(b.amount) ? b : { ...b, amount };
  });
}

module.exports = { resolveBillAmount, resolveBillsForMonth };
