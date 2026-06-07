'use strict';
const { classifyBillSeverity, billDueDateLabel, billDueDeltaDays } = require('../report-domain');

function billCheckupMessage(bill, today, severity) {
  const nome = bill.name;
  const dataLabel = billDueDateLabel(bill, today);
  if (!(Number(bill.amount) > 0)) return `A conta '${nome}' (vence ${dataLabel}) está com valor não informado.`;
  const delta = billDueDeltaDays(bill, today);
  if (delta == null) return `A conta '${nome}' está sem data de vencimento definida.`;
  if (severity === 'urgente') {
    return delta === 0
      ? `A conta '${nome}' vence hoje (${dataLabel}) e ainda não foi paga.`
      : `A conta '${nome}' venceu em ${dataLabel} e ainda não tem pagamento registrado.`;
  }
  return `A conta '${nome}' vence em ${delta}d (${dataLabel}).`;
}

// Checkup: agrupa contas (despesa) por severidade + diagnóstico por conta + headline.
function buildCheckup(bills, today) {
  const tiers = { urgente: [], importante: [], atencao: [], ok: [] };
  for (const b of (bills || []).filter((x) => (x.type || 'expense') === 'expense')) {
    const sev = classifyBillSeverity(b, today);
    tiers[sev].push({
      name: b.name,
      amount: Number(b.amount) || 0,
      hasValue: Number(b.amount) > 0,
      dueLabel: billDueDateLabel(b, today),
      message: billCheckupMessage(b, today, sev),
    });
  }
  const count = tiers.urgente.length + tiers.importante.length;
  const totalRelevante = [...tiers.urgente, ...tiers.importante]
    .filter((b) => b.hasValue).reduce((s, b) => s + b.amount, 0);
  const headline = count === 0
    ? 'Suas contas estão em ordem — nada vencido ou pendente de atenção agora. 👍'
    : `Encontrei ${count} ${count === 1 ? 'ponto que merece' : 'pontos que merecem'} atenção:`;
  return { tiers, totalRelevante, headline, count };
}

module.exports = { buildCheckup, billCheckupMessage };
