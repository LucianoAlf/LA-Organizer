'use strict';
// afirmacao-com-acrescimo.js — CONFIRM-REASK-SUPERSEDE (Peterson 13/07 — finding 525d947c).
//
// 11:03 o TOM estagiou o recado e perguntou "Aviso 6 pessoas (Jereh, Krissya, …)? Confirma?".
// 12:00 "Isso, avisa a eles que estão no Grupo 'Produção L.A Drum Games' onde vamos falar sobre os
// assuntos de produção" — CONFIRMA e ACRESCENTA. O detector de confirmação só aceita "sim" curto →
// null → o LLM re-emitia o recado e ele era estagiado DE NOVO: a mesma pergunta pela 3ª vez.
// Aqui: afirmação no início + conteúdo de verdade (≥ 3 palavras) = confirmação com acréscimo.
// Negação/espera no começo do resto ("isso, não manda ainda", "sim, mas espera") NÃO é. PURO.

const ABRE = /^(?:isso(?:\s+mesmo|\s+a[ií])?|sim|pode(?:\s+sim)?|manda(?:\s+sim)?|beleza|ok|okay|exato|perfeito|confirmo|confirmado|claro|fechado|bora)\b[\s,!.;:—–-]+/i;
const SEGURA = /^(?:mas\s+)?(?:n[ãa]o|nao|espera|pera|aguarda|depois|ainda\s+n[ãa]o)\b/i;
const MIN_PALAVRAS = 3;

/** @returns {{acrescimo: string} | null} */
function afirmacaoComAcrescimo(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const m = t.match(ABRE);
  if (!m) return null;
  const resto = t.slice(m[0].length).trim();
  if (resto.split(/\s+/).filter(Boolean).length < MIN_PALAVRAS) return null;
  if (SEGURA.test(resto)) return null;
  return { acrescimo: resto };
}

module.exports = { afirmacaoComAcrescimo };
