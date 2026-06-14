// src/finance/merchant-category.js — PURO: lookup de merchants BR por NOME PRÓPRIO.
// Fase E. Complementa as keywords genéricas de categories.data.js no caminho de
// categorização (mapCategory). Ganho real: merchants que vêm "sujos" na fatura/extrato
// (MERCPAGO*DROGARIARAIA, PAG*IPIRANGA, AMAZON BR, MAGALU...) e hoje caem em "outros",
// + desambiguar casos que a keyword genérica erraria (MERCADOLIVRE tem "mercado" mas é
// compras, não supermercado). Só nomes FORTES/inequívocos — ambíguos ficam na keyword.
// Slugs-alvo são os JÁ existentes em categories.data.js. (Alf 14/06)

// Prefixos de adquirente/gateway que poluem o nome do merchant. Removidos antes do match.
const ACQUIRER_RE = /^(pagseguro|pagbank|mercpago|merc pago|picpay|pagstar|getnet|sumup|cielo|stone|ebanx|pags|pag|mp|ifd|rede)\s*\*/;

function stripAcquirer(desc) {
  let s = String(desc || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acento (diacríticos combinantes)
    .toLowerCase();
  s = s.replace(ACQUIRER_RE, ''); // "pag*", "mercpago*"...
  s = s.replace(/\*/g, ' ');      // demais "*" viram espaço
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Ordem IMPORTA: assinaturas antes de e-commerce (amazon prime > amazon→compras).
const MERCHANT_RULES = [
  // --- assinaturas (nome próprio) ---
  { slug: 'assinaturas', re: /amazon\s?prime|prime\s?video/ },
  { slug: 'assinaturas', re: /youtube\s?premium/ },
  { slug: 'assinaturas', re: /deezer|paramount|globoplay|hbo\s?max|hbomax|mubi|crunchyroll/ },
  { slug: 'assinaturas', re: /apple\.?com\/?bill|applecombill|itunes|google\s?one|icloud|dropbox/ },
  { slug: 'assinaturas', re: /canva|chatgpt|openai|anthropic|claude\.ai|notion|figma/ },
  // --- e-commerce / marketplace → compras ---
  { slug: 'compras', re: /amazon|amzn/ },
  { slug: 'compras', re: /mercado\s?livre|mercadolivre|\bmeli\b/ },
  { slug: 'compras', re: /magalu|magazine\s?luiza/ },
  { slug: 'compras', re: /americanas|submarino|shoptime/ },
  { slug: 'compras', re: /shopee|aliexpress|shein|netshoes|casas?\s?bahia|ponto\s?frio|dafiti|kabum/ },
  // --- mercado (redes sem a palavra "mercado/super") ---
  { slug: 'mercado', re: /carrefour/ },
  { slug: 'mercado', re: /pao de acucar|paodeacucar/ },
  { slug: 'mercado', re: /\bassai\b|makro|sams\s?club|st marche|zaffari|comper/ },
  // --- farmácia (sem "drogaria/farmacia" no nome) ---
  { slug: 'farmacia', re: /drogasil|panvel|ultrafarma|pague\s?menos|venancio|pacheco/ },
  // --- combustível (sem "posto" no nome) ---
  { slug: 'combustivel', re: /ipiranga|petrobras|br\s?mania|brmania|ale\s?combust/ },
  // --- transporte (uber/99 já são keyword) ---
  { slug: 'transporte', re: /cabify|indriver|in\s?driver/ },
  // --- restaurante (sentado, redes conhecidas) ---
  { slug: 'restaurante', re: /outback|coco\s?bambu|madero|fogo\s?de\s?chao/ },
  // --- alimentação (fast food + delivery; ifood/rappi já são keyword) ---
  { slug: 'alimentacao', re: /mc\s?donalds?|mcdonald|burger\s?king|\bbobs\b|subway|\bkfc\b|habibs|giraffas|spoleto|starbucks|china\s?in\s?box|divino\s?fogao|ze\s?delivery|zedelivery|\bdaki\b/ },
];

// categorizeMerchant(desc, type) → slug | null. Merchant é DESPESA: income nunca casa.
function categorizeMerchant(desc, type) {
  if (type === 'income') return null;
  const s = stripAcquirer(desc);
  if (!s) return null;
  for (const { re, slug } of MERCHANT_RULES) {
    if (re.test(s)) return slug;
  }
  return null;
}

module.exports = { stripAcquirer, categorizeMerchant, MERCHANT_RULES };
