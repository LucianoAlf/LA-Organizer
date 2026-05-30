// Selic viva do Banco Central (SGS serie 432 = Meta Selic % a.a.) + cache + fallback. (spec D4)
// Numero financeiro confiavel: o engine cita a Selic real; se a API cair, usa cache ou constante.
const BCB_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json';

// Factory testavel: injeta fetch/now/ttl pra teste; default usa globais reais.
function makeSelicClient({ fetchImpl = fetch, ttlMs = 86400000, now = () => Date.now(), fallbackAnnual = 10.5 } = {}) {
  const cache = { annual: null, expireAt: 0 };

  async function getAnnualRate() {
    if (cache.annual != null && now() < cache.expireAt) return cache.annual;
    try {
      const resp = await fetchImpl(BCB_URL);
      if (!resp.ok) throw new Error(`BCB HTTP ${resp.status}`);
      const arr = await resp.json();
      const v = Number(String(arr?.[0]?.valor).replace(',', '.'));
      if (!isFinite(v) || v <= 0) throw new Error('valor invalido');
      cache.annual = v;
      cache.expireAt = now() + ttlMs;
      return v;
    } catch (err) {
      console.error('[Selic]', err.message);
      return cache.annual != null ? cache.annual : fallbackAnnual;
    }
  }

  async function getMonthlyRate() {
    const a = await getAnnualRate();
    return Math.pow(1 + a / 100, 1 / 12) - 1; // taxa mensal equivalente (decimal)
  }

  return { getAnnualRate, getMonthlyRate };
}

const _default = makeSelicClient();
module.exports = {
  makeSelicClient,
  getAnnualRate: _default.getAnnualRate,
  getMonthlyRate: _default.getMonthlyRate,
};
