'use strict';
// finance-continuation.js — RECUSA-FALSA-CAI-COM-SKILL (Rose 16/07 01:50, reincidiu no Matheus).
//
// A rede que intercepta a RECUSA FALSA de lançamento ("não consigo executar o lançamento por
// aqui") no engine só dispara quando skill_active==='financeiro-pessoal'. Mas o pickSkill decide
// a skill por PALAVRA de dinheiro no turno: a Rose cruzou a fatura inteira (40 itens) e disse
// "lança pra mim o que falta pfvr, tom" — sem palavra de dinheiro, a skill caiu, a rede caiu
// junto, e a recusa falsa (mentira de capacidade — o TOM ACABOU de lançar 40 itens) foi ao ar.
//
// O financeProposalOpen já cobre o follow-up de comprovante ("grava?/quanto foi"). Este cobre a
// CONTINUAÇÃO de um fluxo de FATURA/LANÇAMENTO em lote: outbound recente falando de itens que
// faltam lançar / cruzamento / prévia, + o usuário pedindo pra lançar/seguir. Narrow de propósito
// (exige o sinal de fatura no outbound recente) pra não carregar finança em turno não-relacionado.

// Sinal, no OUTBOUND recente, de que há um fluxo de fatura/lançamento em lote ABERTO.
const INVOICE_FLOW_RE = /faltam?\s+lan[çc]ar|falta\s+lan[çc]ar|j[áa]\s+lan[çc]ad[oa]s?|cruzamento|itens\s+(?:da\s+fatura|que\s+faltam)|pr[ée]via\s+de\s+confirma|lan[çc]ar[^.!?]{0,40}r\$|r\$[^.!?]{0,40}(?:a\s+)?lan[çc]ar/i;
// Intenção do usuário de mandar lançar / seguir com o que ficou pendente.
const LAUNCH_INTENT_RE = /\blan[çc]a(?:r|)\b|\bo\s+que\s+falta\b|pode\s+lan[çc]ar|manda\s+a\s+pr[ée]via|lan[çc]a\s+(?:isso|esse|esses|tudo|o\s+resto)/i;

/**
 * O turno é continuação de um fluxo de fatura/lançamento (mesmo sem palavra de dinheiro)?
 * @param {{userText:string, recentOutbound:string}} ctx  recentOutbound já em lowercase
 * @returns {boolean}
 */
function financeInvoiceContinuation(ctx) {
  if (!ctx || typeof ctx !== 'object') return false;
  const out = String(ctx.recentOutbound || '');
  const usr = String(ctx.userText || '');
  if (!INVOICE_FLOW_RE.test(out)) return false;      // exige fluxo de fatura ABERTO no outbound
  return LAUNCH_INTENT_RE.test(usr);                  // + o usuário pedindo pra lançar/seguir
}

module.exports = { financeInvoiceContinuation, INVOICE_FLOW_RE, LAUNCH_INTENT_RE };
