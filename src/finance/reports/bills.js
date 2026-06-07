'use strict';
// Builders de relatórios de contas → ReportModel (objeto, agnóstico de canal).
const { isBillPaidThisCycle, billDueDom, billRelativeLabel, billDueDeltaDays, classifyBillSeverity } = require('../report-domain');

function _expenseBills(bills) {
  return (bills || []).filter((b) => (b.type || 'expense') === 'expense');
}
function _item(b, today) {
  return {
    name: b.name,
    amount: Number(b.amount) || 0,
    due_day: billDueDom(b),
    recurrence: b.recurrence || 'monthly',
    rel: billRelativeLabel(b, today),
  };
}
const _byDueDay = (a, b) => (a.due_day || 99) - (b.due_day || 99);
const _sum = (arr) => arr.reduce((s, b) => s + (Number(b.amount) || 0), 0);

// RELAÇÃO COMPLETA: todas as contas fixas (despesa), agrupadas por status.
function buildFixedBills(bills, today) {
  const monthStart = String(today).slice(0, 7) + '-01';
  const groups = { vencidas: [], pendentes: [], pagas: [], semValor: [] };
  for (const b of _expenseBills(bills)) {
    const item = _item(b, today);
    if (isBillPaidThisCycle(b, monthStart)) groups.pagas.push(item);
    else if (!(Number(b.amount) > 0)) groups.semValor.push(item);
    else if (classifyBillSeverity(b, today) === 'urgente') groups.vencidas.push(item);
    else groups.pendentes.push(item);
  }
  for (const k of Object.keys(groups)) groups[k].sort(_byDueDay);
  const totals = {
    vencidas: _sum(groups.vencidas),
    pendentes: _sum(groups.pendentes),
    pagas: _sum(groups.pagas),
    aPagar: _sum(groups.vencidas) + _sum(groups.pendentes),
  };
  return { groups, totals, count: _expenseBills(bills).length };
}

// SÓ O QUE FALTA PAGAR: contas em aberto agrupadas por urgência + faturas de cartão.
// opts.dueDay: filtra por um dia ("o que vence dia 10") → devolve { filtered, totalPendente }.
function buildBillsToPay(bills, cardInvoices, today, opts = {}) {
  const monthStart = String(today).slice(0, 7) + '-01';
  const open = _expenseBills(bills).filter((b) => !isBillPaidThisCycle(b, monthStart));

  if (opts.dueDay != null) {
    const filtered = open.filter((b) => billDueDom(b) === Number(opts.dueDay)).map((b) => _item(b, today)).sort(_byDueDay);
    return { filtered, totalPendente: _sum(filtered), dueDay: Number(opts.dueDay) };
  }

  const vencidas = [], proximos7 = [], restanteMes = [];
  for (const b of open) {
    const item = _item(b, today);
    const delta = billDueDeltaDays(b, today);
    if (delta <= 0) vencidas.push(item);
    else if (delta <= 7) proximos7.push(item);
    else restanteMes.push(item);
  }
  vencidas.sort(_byDueDay); proximos7.sort(_byDueDay); restanteMes.sort(_byDueDay);
  const cards = (cardInvoices || []).map((ci) => ({
    name: `Fatura ${ci.cardName}`, amount: Number(ci.remaining) || 0, due_day: ci.dueDay != null ? Number(ci.dueDay) : null, rel: '',
  }));
  const totalPendente = _sum(vencidas) + _sum(proximos7) + _sum(restanteMes) + _sum(cards);
  return { vencidas, proximos7, restanteMes, cards, totalPendente };
}

module.exports = { buildFixedBills, buildBillsToPay };
