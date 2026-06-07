'use strict';
// Pura: seleciona as contas (pf_bills) A PAGAR (em aberto), opcionalmente filtrando
// pelo dia de vencimento. Reusa a noção de "pago neste ciclo" do bill-due.js.
// Usada pela action query_bills ("o que pago dia 10?", "minhas contas fixas").

function isBillPaidThisCycle(bill, monthStart) {
  if (bill.recurrence === 'once') return !!bill.last_paid_at;
  return !!bill.last_paid_at && bill.last_paid_at >= monthStart; // monthly
}

// Dia do mês do vencimento: due_day (monthly) ou o dia extraído do due_date (once).
function billDueDom(bill) {
  if (bill.recurrence === 'once') {
    return bill.due_date ? parseInt(String(bill.due_date).slice(8, 10), 10) : null;
  }
  return bill.due_day != null ? Number(bill.due_day) : null;
}

// bills: linhas de pf_bills (active). opts.dueDay: filtra pelo dia; opts.monthStart: '1º do mês' (YYYY-MM-DD).
function billsToPay(bills, { dueDay = null, monthStart } = {}) {
  const items = (bills || [])
    .filter((b) => (b.type || 'expense') === 'expense')        // contas a pagar (não receitas)
    .filter((b) => !isBillPaidThisCycle(b, monthStart))        // só em aberto
    .filter((b) => dueDay == null || billDueDom(b) === Number(dueDay))
    .map((b) => ({
      name: b.name,
      amount: Number(b.amount) || 0,
      due_day: billDueDom(b),
      recurrence: b.recurrence || 'monthly',
      category: b.category || null,
    }))
    .sort((a, b) => (a.due_day || 99) - (b.due_day || 99));
  const total = items.reduce((s, b) => s + b.amount, 0);
  return { items, total, count: items.length };
}

module.exports = { billsToPay, isBillPaidThisCycle, billDueDom };
