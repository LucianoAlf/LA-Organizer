// src/finance/proactive-messages.js — PURO: textos dos alertas proativos (previsão, recorrência, anomalia).
// Fase C. Sem I/O. (Alf 14/06)
function brl(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function titleCase(s) {
  return String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildForecastLine(cardName, fc) {
  if (!fc || !fc.alert) return null;
  const dia = fc.daysToClose === 0 ? 'fecha hoje'
    : fc.daysToClose === 1 ? 'fecha amanhã'
      : `fecha em ${fc.daysToClose} dias`;
  return `💳 A fatura do *${cardName}* ${dia} e já está em *R$ ${brl(fc.openTotal)}* — ${fc.pctOver}% acima da sua média (R$ ${brl(fc.avg)}).`;
}

function buildRecurringLines(items) {
  const lines = [];
  for (const it of (items || [])) {
    if (!it) continue;
    // só assinatura de valor estável: nova ou que subiu (price creep). Queda e gasto variável = ruído, fora.
    if (it.isNewSubscription) {
      lines.push(`🆕 *${titleCase(it.merchant)}* (R$ ${brl(it.lastAmount)}/mês) entrou nas suas recorrências.`);
    } else if (it.priceCreep) {
      lines.push(`🔁 *${titleCase(it.merchant)}* subiu de R$ ${brl(it.prevAmount)} → *R$ ${brl(it.lastAmount)}* (+${it.deltaPct}%).`);
    }
  }
  return lines;
}

function buildAnomalyNote(anom) {
  if (!anom || !anom.isAnomaly) return null;
  const x = anom.ratio && anom.ratio >= 1.2 ? `~${anom.ratio}×` : 'bem acima';
  return `⚠️ Tá ${x} o seu normal aí (média R$ ${brl(anom.avg)}) — tudo certo?`;
}

module.exports = { buildForecastLine, buildRecurringLines, buildAnomalyNote };
