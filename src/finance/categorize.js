// Mapeamento de categoria por palavra-chave (type-aware) + normalizer de aliases.
// Keywords e categorias vêm do módulo único categories.data.js. Puro, sem I/O.
const { CATEGORIES, fallbackSlug } = require('./categories.data');
const { categorizeMerchant } = require('./merchant-category');

// Categorias genéricas: só casam se NENHUMA específica casar (ex: "Compras" tem
// keyword "loja"/"compra", greedy — não pode roubar "supermercado"→mercado).
const GENERIC_SLUGS = new Set(['compras']);

// mapCategory(text, type): casa keyword DENTRO do tipo (income/expense). Sem type,
// considera todas. 2 passadas: específicas primeiro, genéricas depois. Fallback por
// tipo (outros / outras_receitas).
function mapCategory(text, type) {
  const t = String(text || '').toLowerCase();
  // Passada de alta precisão (Fase E): merchant BR por nome próprio. Cobre fatura "suja"
  // (PAG*IPIRANGA, MERCPAGO*DROGASIL) e desambigua (MERCADOLIVRE tem "mercado" mas é compras).
  const byMerchant = categorizeMerchant(text, type);
  if (byMerchant) return byMerchant;
  const inType = (c) => !type || c.type === type;
  for (const c of CATEGORIES) {
    if (!inType(c) || GENERIC_SLUGS.has(c.slug)) continue;
    if (c.keywords.some((w) => t.includes(w))) return c.slug;
  }
  for (const c of CATEGORIES) {
    if (!inType(c) || !GENERIC_SLUGS.has(c.slug)) continue;
    if (c.keywords.some((w) => t.includes(w))) return c.slug;
  }
  return fallbackSlug(type);
}

function normalizeParams(raw = {}) {
  const out = { ...raw };
  const pick = (...keys) => keys.map((k) => raw[k]).find((v) => v !== undefined);
  const amount = pick('amount', 'valor', 'value', 'price');
  if (amount !== undefined) out.amount = Number(amount);
  let type = pick('type', 'tipo', 'kind');
  if (raw.gasto || raw.despesa) type = 'expense';
  if (raw.receita || raw.ganho || raw.renda) type = 'income';
  if (type) out.type = type;
  const category = pick('category', 'categoria', 'cat');
  if (category) out.category = category;
  const description = pick('description', 'desc', 'nota', 'note');
  if (description !== undefined) out.description = description;
  return out;
}

module.exports = { mapCategory, normalizeParams };
