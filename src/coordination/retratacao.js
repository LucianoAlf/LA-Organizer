'use strict';
// retratacao.js — RECADO-CORRECAO-BARRADA-COMO-DUPLICATA (triagem 11/09 — 8f939d97).
//
// Fefê 10/08 20:57: recado pra Anne ("o responsável pediu pra adiar o depósito do cheque pra
// sexta"). 1 min depois: "avisa ela pra desconsiderar, o Clayton conseguiu falar com ela antes".
// O TOM propôs o texto certo, ela confirmou, e o dedup de relay (Jaro-Winkler ≥ 0,75 contra os
// recados dos últimos 30 min pro mesmo destinatário) barrou a CORREÇÃO como duplicata — dois
// textos longos sobre o mesmo cheque passam fácil desse limiar. A Anne nunca recebeu a correção.
//
// Recado que corrige/desmente/cancela o anterior é, por definição, DIFERENTE dele: nunca é
// duplicata. PURO.
const RETRATACAO_RE = /(?:^|[^\p{L}])(?:desconsider\w*|ignor[ae]\w*|esquec[ae]\w*|na\s+verdade|corrigindo|corre[çc][ãa]o|errat\w*|cancel[ae]\w*|n[ãa]o\s+precisa\s+mais|mudou|mudan[çc]a|atualiza[çc][ãa]o)(?![\p{L}])/iu;

function ehRetratacao(corpo) {
  return RETRATACAO_RE.test(String(corpo == null ? '' : corpo));
}

module.exports = { ehRetratacao, RETRATACAO_RE };
