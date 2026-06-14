// src/finance/spending-anomaly.js — PURO: detecta gasto fora do padrão do merchant/categoria (Z-score).
// Fase C (proativo). Exige amostra mínima pra não alarmar sem base. Sem I/O. (Alf 14/06)
function detectAnomaly({ amount, history, minSamples = 3, zThreshold = 2 }) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return { isAnomaly: false };
  const vals = (history || []).map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (vals.length < minSamples) return { isAnomaly: false, reason: 'few_samples' };
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length);
  const r2 = (n) => Math.round(n * 100) / 100;
  if (sd === 0) {
    // histórico todo igual: anomalia só se for bem acima do valor fixo
    return { isAnomaly: a > avg * 1.5, avg: r2(avg), ratio: r2(a / avg), z: null };
  }
  const z = (a - avg) / sd;
  return {
    isAnomaly: z >= zThreshold && a > avg,
    z: Math.round(z * 10) / 10,
    avg: r2(avg),
    ratio: Math.round((a / avg) * 10) / 10,
  };
}

module.exports = { detectAnomaly };
