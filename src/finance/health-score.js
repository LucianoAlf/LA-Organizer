// src/finance/health-score.js — PURO: Financial Health Score 0–100.
// Fase E. Combina 3 sinais que o TOM já tem (poupança do mês, uso de crédito, reserva/metas).
// Cada fator é "aplicável só com dado" — quem não tem cartão não é punido (peso renormaliza).
// Devolve o número + a MAIOR ALAVANCA (a pesquisa avisou: número solto é fraco; vem com o
// fator que mais puxa pra baixo). Sem I/O. (Alf 14/06)

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Taxa de poupança do mês: rate=(rec-desp)/rec. ≥0,20→100; 0→50; ≤-0,20→0 (linear, clamp).
function savingsScore(receitas, despesas) {
  const rate = (receitas - despesas) / receitas;
  return Math.round(clamp(((rate + 0.20) / 0.40) * 100, 0, 100));
}

// Uso do limite: u=used/limit. ≤0,30→100; 0,30..1,0 linear 100→0; ≥1,0→0.
function creditScore(used, limit) {
  const u = used / limit;
  if (u <= 0.30) return 100;
  return Math.round(clamp(((1 - u) / (1 - 0.30)) * 100, 0, 100));
}

// Reserva: sem meta→40 (oportunidade, não pune a zero); meta sem aporte→45; com aporte→50..100.
function reserveScore(goals) {
  const valid = (goals || []).filter((g) => Number(g.target_amount) > 0);
  if (!valid.length) return 40;
  const avg = valid.reduce((s, g) => s + clamp(Number(g.current_amount) / Number(g.target_amount), 0, 1), 0) / valid.length;
  if (avg === 0) return 45;
  return Math.round(clamp(50 + avg * 50, 50, 100));
}

// Hint honesto conforme a SEVERIDADE (faixa do próprio sub-score; sem acoplar números → puro).
function hintFor(key, score) {
  if (key === 'poupanca') return score === 0 ? 'você fechou o mês no vermelho — segura as despesas' : 'tá sobrando pouco no fim do mês';
  if (key === 'credito') return score === 0 ? 'o cartão tá no limite — priorize pagar a fatura' : 'a fatura do cartão tá puxando';
  return 'dá pra reforçar sua reserva';
}

function computeHealthScore({ receitas = 0, despesas = 0, credit = {}, goals = [] } = {}) {
  const rec = Number(receitas) || 0;
  const desp = Number(despesas) || 0;
  const used = Number(credit && credit.used) || 0;
  const limit = Number(credit && credit.limit) || 0;

  const factors = [
    { key: 'poupanca', label: 'Poupança', weight: 45, applicable: rec > 0, score: rec > 0 ? savingsScore(rec, desp) : 0 },
    { key: 'credito', label: 'Uso do cartão', weight: 30, applicable: limit > 0, score: limit > 0 ? creditScore(used, limit) : 0 },
    { key: 'reserva', label: 'Reserva', weight: 25, applicable: true, score: reserveScore(goals) },
  ];

  const apt = factors.filter((f) => f.applicable);
  if (!apt.length) return { score: null, band: null, factors, topLever: null };

  const wsum = apt.reduce((s, f) => s + f.weight, 0);
  const score = Math.round(apt.reduce((s, f) => s + f.score * f.weight, 0) / wsum);
  const band = score >= 75 ? '🟢' : score >= 50 ? '🟡' : '🔴';

  // Maior alavanca = fator aplicável com maior distância PONDERADA de 100. Omite se já saudável.
  let topLever = null;
  if (score < 90) {
    let best = null;
    for (const f of apt) {
      const gap = (100 - f.score) * f.weight;
      if (gap > 0 && (!best || gap > best.gap)) best = { f, gap };
    }
    if (best) topLever = { key: best.f.key, label: best.f.label, hint: hintFor(best.f.key, best.f.score) };
  }
  return { score, band, factors, topLever };
}

module.exports = { computeHealthScore, savingsScore, creditScore, reserveScore };
