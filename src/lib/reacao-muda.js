'use strict';
// reacao-muda.js — REACAO-SOZINHA-CONFIRMA-O-QUE-NAO-GRAVOU (Bianca 20/08).
//
// O chokepoint de honestidade (optimistic-confirm) julga AFIRMAÇÃO DE TEXTO. Quando o
// turno sai só com `<<REACT>>✅<<END>>` e reply vazio, não há texto pra julgar — e o ✅
// vira uma confirmação de escrita que não aconteceu, invisível pra todo o resto do
// sistema (conversation_history grava "[reação: ✅]", que nenhum guard lê como claim).
//
// Este guard cobre exatamente esse eixo: reação como única saída de um turno em que um
// marker de DOMÍNIO foi TENTADO e nada foi persistido. Fail-open de propósito — na
// dúvida não fala, porque inventar fala do TOM é pior que calar.
function reacaoSozinhaMente(ctx) {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return false;
  const semTexto = !String(ctx.reply == null ? '' : ctx.reply).trim();
  return semTexto && !!ctx.temReacao && !!ctx.markerAttempted && !!ctx.nothingPersisted;
}

module.exports = { reacaoSozinhaMente };
