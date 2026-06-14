// src/finance/forecast-invoice.js — PURO: decide o alerta "fatura acima da média e perto de fechar".
// Fase C (proativo). Sem I/O. Thresholds ajustáveis. (Alf 14/06)
function forecastInvoiceAlert({ openTotal, closedTotals, daysToClose, threshold = 0.20, windowDays = 5 }) {
  const closed = (closedTotals || []).map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (closed.length < 2) return null;                                   // sem histórico confiável
  if (daysToClose == null || daysToClose < 0 || daysToClose > windowDays) return null;
  const avg = closed.reduce((s, v) => s + v, 0) / closed.length;
  if (avg <= 0 || Number(openTotal) < avg * (1 + threshold)) return null;
  return {
    alert: true,
    openTotal: Number(openTotal),
    avg: Math.round(avg * 100) / 100,
    pctOver: Math.round(((Number(openTotal) - avg) / avg) * 100),
    daysToClose,
  };
}

module.exports = { forecastInvoiceAlert };
