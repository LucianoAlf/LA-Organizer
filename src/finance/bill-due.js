'use strict';
// Pura: decide se uma conta deve aparecer no lembrete de vencimento.
// ctx = { dom (dia do mês hoje), todayStr, horizonStr (hoje+days), monthStart (1º dia do mês) }
function isBillDue(bill, ctx) {
  if (bill.recurrence === 'once') {
    if (bill.last_paid_at) return false;
    return !!bill.due_date && bill.due_date <= ctx.horizonStr; // inclui atrasadas e a vencer
  }
  // monthly (default)
  if (bill.last_paid_at && bill.last_paid_at >= ctx.monthStart) return false;
  const aVencer = bill.due_day >= ctx.dom && bill.due_day <= ctx.dom + ctxDays(ctx);
  const atrasada = bill.due_day < ctx.dom;
  return aVencer || atrasada;
}
function ctxDays(ctx) {
  const a = new Date(ctx.todayStr + 'T00:00:00Z'), b = new Date(ctx.horizonStr + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}
module.exports = { isBillDue };
