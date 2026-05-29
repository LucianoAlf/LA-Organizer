// Deteccao de cruzamento de threshold de orcamento (spec D3) + mensagens (PRD §6.3). Puro, stateless.

const THRESHOLDS = [
  { pct: 100, emoji: '☠️' },
  { pct: 80,  emoji: '🔴' },
  { pct: 70,  emoji: '⚠️' },
]; // ordem decrescente: retornamos a faixa mais alta cruzada

const SUGGESTIONS = {
  alimentacao: 'Já pensou em levar marmita essa semana?',
  transporte:  'Dá pra ir de ônibus ou carona nos próximos dias?',
  lazer:       'Calma aí — deixa um pouco pro final do mês.',
  outros:      'Tá gastando bastante com coisas diversas — revisa se precisa mesmo.',
};

// Retorna o maior threshold (70/80/100) cruzado por esta transacao, ou null.
function crossedThreshold(prevTotal, newTotal, limit) {
  if (!limit || limit <= 0) return null;
  const prevPct = (prevTotal / limit) * 100;
  const newPct = (newTotal / limit) * 100;
  for (const t of THRESHOLDS) {
    if (prevPct < t.pct && newPct >= t.pct) return t.pct;
  }
  return null;
}

function buildBudgetAlert(category, newTotal, limit, threshold) {
  if (!threshold) return '';
  const t = THRESHOLDS.find((x) => x.pct === threshold);
  const emoji = t ? t.emoji : '⚠️';
  const head = `${emoji} ${threshold}% do orçamento de ${category} (R$${newTotal}/R$${limit}).`;
  if (threshold >= 80 && SUGGESTIONS[category]) return `${head} ${SUGGESTIONS[category]}`;
  return head;
}

module.exports = { crossedThreshold, buildBudgetAlert, THRESHOLDS, SUGGESTIONS };
