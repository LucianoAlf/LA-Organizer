// src/finance/recurring-detect.js — PURO: normaliza merchant + detecta assinaturas/recorrência e mudança de preço.
// Fase C (proativo). Sem ML: agrupa por merchant normalizado, exige intervalo ~mensal. (Alf 14/06)

function normalizeMerchant(desc) {
  return String(desc || '')
    .toLowerCase()
    .replace(/\(\s*\d{1,2}\s*\/\s*\d{1,2}\s*\)/g, '') // (1/6)
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, '')             // 1/6
    .replace(/[*#].*$/, '')                           // sufixo após * ou #
    .replace(/\b\d{3,}\b/g, '')                       // ids longos
    .replace(/[^a-z0-9à-ú ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// transactions: [{ descricao|description, valor|amount, data|transaction_date }]
function detectRecurring(transactions) {
  const groups = new Map();
  for (const t of (transactions || [])) {
    const m = normalizeMerchant(t.descricao != null ? t.descricao : t.description);
    if (!m) continue;
    const amount = Math.abs(Number(t.valor != null ? t.valor : t.amount) || 0);
    const date = t.data || t.transaction_date;
    if (amount <= 0 || !date) continue;
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push({ amount, date });
  }
  const out = [];
  for (const [merchant, occ] of groups) {
    if (occ.length < 2) continue;
    occ.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const gaps = [];
    for (let i = 1; i < occ.length; i++) {
      gaps.push((new Date(occ[i].date) - new Date(occ[i - 1].date)) / 864e5);
    }
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (avgGap < 20 || avgGap > 40) continue; // só recorrência ~mensal

    const amounts = occ.map((o) => o.amount);
    const last = amounts[amounts.length - 1];
    const prev = amounts[amounts.length - 2];
    const spread = (arr) => {
      const a = arr.reduce((s, v) => s + v, 0) / arr.length;
      return a > 0 ? (Math.max(...arr) - Math.min(...arr)) / a : 1;
    };
    // ASSINATURA = mensalidade de valor ESTÁVEL. Gasto variável (mercado/uber/posto) oscila → NÃO é assinatura.
    // priceCreep: ≥3 ocorrências, as anteriores estáveis (≤10% de spread) e a última subiu ≥5%.
    // isNewSubscription: 2ª ocorrência com valores ~iguais (≤10%). Quedas NÃO viram alerta (ruído).
    const prevStable = spread(amounts.slice(0, -1)) <= 0.10;
    const allStable = spread(amounts) <= 0.10;
    const priceUp = prev > 0 && last > prev && (last - prev) / prev >= 0.05;
    out.push({
      merchant,
      occurrences: occ.length,
      lastAmount: last,
      prevAmount: prev,
      deltaPct: prev ? Math.round(((last - prev) / prev) * 100) : 0,
      priceCreep: occ.length >= 3 && prevStable && priceUp,
      isNewSubscription: occ.length === 2 && allStable,
    });
  }
  return out;
}

module.exports = { normalizeMerchant, detectRecurring };
