'use strict';
// Regras puras de relatório. `today` é SEMPRE injetado ('YYYY-MM-DD'), nunca new Date() interno.
const { isBillPaidThisCycle, billDueDom } = require('./bills-query');

function _ymdMs(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Dias restantes do mês APÓS hoje (último dia do mês − dia de hoje).
function diasRestantesDoMes(today) {
  const [y, m, d] = String(today).split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.max(0, lastDay - d);
}

// Delta em dias entre o vencimento e hoje. Negativo = vencida; 0 = hoje; positivo = futuro.
// Monthly: usa due_day no mês de `today`. Once: usa due_date.
function billDueDeltaDays(bill, today) {
  const todayMs = _ymdMs(today);
  let dueMs;
  if (bill.recurrence === 'once') {
    if (!bill.due_date) return null;            // once sem data → sem vencimento definido
    dueMs = _ymdMs(bill.due_date);
  } else {
    const [y, m] = String(today).split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const dd = Math.min(Number(bill.due_day), lastDay); // clampa due_day > fim do mês (ex: 31 em fev)
    dueMs = Date.UTC(y, m - 1, dd);
  }
  if (Number.isNaN(dueMs)) return null;
  return Math.round((dueMs - todayMs) / 86400000);
}

function billRelativeLabel(bill, today) {
  const delta = billDueDeltaDays(bill, today);
  if (delta == null) return '';
  if (delta === 0) return 'vence hoje';
  return delta > 0 ? `em ${delta}d` : `há ${-delta}d`;
}

// Severidade de uma conta. opts.zeroValueTier permite calibrar (default 'importante').
function classifyBillSeverity(bill, today, opts = {}) {
  const monthStart = String(today).slice(0, 7) + '-01';
  if (isBillPaidThisCycle(bill, monthStart)) return 'ok';
  const hasValue = Number(bill.amount) > 0;
  if (!hasValue) return opts.zeroValueTier || 'importante'; // valor zerado = dado incompleto
  const delta = billDueDeltaDays(bill, today);
  if (delta == null) return 'importante';   // sem vencimento definido = dado incompleto
  if (delta <= 0) return 'urgente';   // vencida ou vence hoje
  if (delta <= 7) return 'importante';
  if (delta <= 15) return 'atencao';
  return 'ok';
}

// Rótulo DD/MM do vencimento (monthly = due_day no mês de today, clampado; once = due_date).
function billDueDateLabel(bill, today) {
  if (bill.recurrence === 'once') {
    if (!bill.due_date) return '—';
    return String(bill.due_date).slice(8, 10) + '/' + String(bill.due_date).slice(5, 7);
  }
  const m = Number(String(today).slice(5, 7));
  const y = Number(String(today).slice(0, 4));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dd = Math.min(Number(bill.due_day), lastDay);
  return String(dd).padStart(2, '0') + '/' + String(m).padStart(2, '0');
}

module.exports = { diasRestantesDoMes, billDueDeltaDays, billRelativeLabel, classifyBillSeverity, isBillPaidThisCycle, billDueDom, billDueDateLabel };
