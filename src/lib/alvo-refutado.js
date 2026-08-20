'use strict';
// alvo-refutado.js — ALVO-REFUTADO-VOLTA-IGUAL (caso Rafinha 19/08 12:49).
//
// Cadeia medida: lembrete do EVENTO "Carlinho Eletricista" → áudio do Rafinha transcrito
// com erro ("o Carlinhos" virou "o carrinho") → o TOM amarrou "finalizado" às 2 tarefas de
// spot do Recreio e perguntou se podia fechá-las → o Rafinha REFUTOU ("Não, o Carlinhos
// está em Campo Grande. Isso você pode fechar aí") → o TOM abriu uma intent NOVA com as
// MESMAS duas tarefas e perguntou de novo. A trava A2 (batch-complete não-ancorado) segurou
// a escrita errada, mas a pergunta voltou idêntica: beco sem saída pra quem já disse "não".
//
// A resposta dele tem as DUAS coisas — refuta a interpretação E autoriza fechar algo. Um
// detector binário sim/não erra dos dois lados. A regra que vale é mais estreita: se a
// pessoa ABRIU negando e a proposta nova mira o MESMO conjunto que ela acabou de recusar,
// esse alvo está queimado — perguntar de novo por ele é insistir, não confirmar.
//
// NÃO bloqueia fechar: bloqueia repetir o alvo REFUTADO. Puro.

// Negação de ABERTURA: a pessoa começa refutando o que o TOM acabou de afirmar.
// Ancorado em `^` de propósito — "não" no meio da frase costuma ser outra coisa
// ("fecha a do Recreio, a outra não").
const ABRE_NEGANDO = /^\s*[^\p{L}]*(n[ãa]o|nada\s+disso|nada\s+a\s+ver|errado|negativ[oa]|nops?|que\s+nada|de\s+jeito\s+nenhum|nem\s+vem)\b/iu;

function abreComNegacao(texto) {
  const t = String(texto == null ? '' : texto)
    // a transcrição de áudio chega com prefixo do pipeline; a negação vem depois dele
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .trim();
  if (!t) return false;
  return ABRE_NEGANDO.test(t);
}

function _conjunto(ids) {
  if (!Array.isArray(ids)) return null;
  const limpos = ids.map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
  return limpos.length ? new Set(limpos) : null;
}

// Mesmo ALVO = mesmo conjunto de ids (ordem não importa). Subconjunto não conta:
// se o TOM reduziu a proposta, é proposta nova e merece a pergunta normal.
function mesmoAlvo(a, b) {
  const sa = _conjunto(a);
  const sb = _conjunto(b);
  if (!sa || !sb || sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/**
 * A proposta nova está insistindo num alvo que a pessoa acabou de recusar?
 * @param {{inboundText:string, idsPropostos:string[], idsRecusados:string[]}} ctx
 * @returns {boolean}
 */
function alvoFoiRefutado(ctx) {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return false;
  if (!abreComNegacao(ctx.inboundText)) return false;
  return mesmoAlvo(ctx.idsPropostos, ctx.idsRecusados);
}

// Fala do gate: não inventa alvo nenhum e devolve a escolha pra pessoa.
function mensagemAlvoRefutado() {
  return 'Você disse que não era isso — então não vou insistir nas mesmas. Me diz o que fechar (pode citar o nome) que eu fecho.';
}

module.exports = { abreComNegacao, mesmoAlvo, alvoFoiRefutado, mensagemAlvoRefutado };
