// src/finance/parse-installments.js — rede de segurança PURA pra parcelamento de cartão.
//
// Problema (Rose 13/06): o LLM às vezes lança "comprei em 3x" como 1 parcela à vista
// (installments=1) em vez de 3 parcelas. O motor (insertCardPurchase) parcela certo SE
// installments vier ≥2 — então a falha é só de extração do LLM. Esta rede capta o número
// de parcelas DIRETO do texto do usuário e corrige o marker antes de persistir.
//
// Conservador de propósito: só dispara quando há SINAL CLARO de parcelamento
// ("Nx", "N vezes", "N parcelas", "parcelei/dividi em N"). Nunca inventa parcela de
// "comprei 3 camisetas" ou "em 3 lojas".

// Extrai o nº de parcelas do texto. Retorna inteiro ∈ [2,99] ou null.
function extractInstallments(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase();

  // 1) "Nx" / "N x" — no contexto de cartão é quase sempre parcela (10x, 3 x, 12x sem juros)
  let m = t.match(/\b(\d{1,2})\s*x\b/);
  if (m) { const n = parseInt(m[1], 10); if (n >= 2 && n <= 99) return n; }

  // 2) "N vezes" / "N parcela(s)"
  m = t.match(/\b(\d{1,2})\s*(?:vezes|parcelas?)\b/);
  if (m) { const n = parseInt(m[1], 10); if (n >= 2 && n <= 99) return n; }

  // 3) "parcelei/parcelado/dividi/dividido em N"
  m = t.match(/\b(?:parcel\w*|dividi\w*)\s+em\s+(\d{1,2})\b/);
  if (m) { const n = parseInt(m[1], 10); if (n >= 2 && n <= 99) return n; }

  return null;
}

// Rede de segurança: se o marker NÃO veio parcelado (installments<2) mas o texto do
// usuário indica parcelas, corrige. Se o LLM já parcelou (≥2), RESPEITA o que ele mandou
// (ele pode ter lido melhor o contexto). Retorna { installments, corrected }.
function reconcileInstallments(paramInstallments, userText) {
  const cur = Math.max(1, parseInt(paramInstallments || 1, 10) || 1);
  if (cur >= 2) return { installments: cur, corrected: false };
  const detected = extractInstallments(userText);
  if (detected && detected >= 2) return { installments: detected, corrected: true };
  return { installments: cur, corrected: false };
}

module.exports = { extractInstallments, reconcileInstallments };
