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

// GOVFIN-RECURRING-ALERTA-ETERNO (15/08, Rose): sem janela de recência, isNewSubscription e
// priceCreep ficam verdadeiros enquanto a contagem de ocorrências não mudar — a checagem só
// olha "tem exatamente 2 (ou 3+) ocorrências estáveis nos últimos N meses", nunca QUANDO a
// última aconteceu. Uma assinatura mensal com só 2 cobranças passa ~30 dias como "2 ocorrências"
// até a 3ª chegar — o alerta "entrou nas suas recorrências" repetia TODO dia nesse intervalo
// inteiro. Caso real: Google Canva cobrou em 27/06 e 27/07, e o TOM mandou "Fica de olho, Canva
// entrou nas recorrências" de 27/07 até 15/08 — 19 dias seguidos da mesma frase pra Rose.
//
// refYmd ('YYYY-MM-DD') ativa a janela: só alerta se a ÚLTIMA ocorrência caiu nos últimos
// JANELA_DIAS_ALERTA dias. Omitido preserva o comportamento antigo (sem filtro de recência) —
// é o que os testes sem `refYmd` continuam exercendo. Produção (dispatcher.js) SEMPRE passa.
const JANELA_DIAS_ALERTA = 7;

function diffDias(refYmd, dataYmd) {
  const [y1, m1, d1] = String(refYmd).split('-').map(Number);
  const [y2, m2, d2] = String(dataYmd).split('-').map(Number);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
}

// transactions: [{ descricao|description, valor|amount, data|transaction_date }]
function detectRecurring(transactions, refYmd) {
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
    const lastDate = occ[occ.length - 1].date;
    const recente = !refYmd || diffDias(refYmd, lastDate) <= JANELA_DIAS_ALERTA;
    out.push({
      merchant,
      occurrences: occ.length,
      lastAmount: last,
      prevAmount: prev,
      deltaPct: prev ? Math.round(((last - prev) / prev) * 100) : 0,
      priceCreep: occ.length >= 3 && prevStable && priceUp && recente,
      isNewSubscription: occ.length === 2 && allStable && recente,
    });
  }
  return out;
}

module.exports = { normalizeMerchant, detectRecurring };
