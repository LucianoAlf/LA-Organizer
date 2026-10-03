'use strict';
// veto-pergunta.js — UMA régua de "é pergunta/pedido de confirmação, então não acusa" para as DUAS
// portas de honestidade. PURO.
//
// POR QUE (03/10/2026 — a oferta condicional voltou pela 3ª porta: 16/08, 31/08, 02/10)
// A porta de BAIXO (enforceNoMarkerHonesty) tinha dois vetos de pergunta: o turno em
// `awaitingConfirm` e a linha acusada que é pergunta (pergunta-nao-e-afirmacao.js, 27/09). A de
// CIMA (downgradeEmptyPromise) não tinha nenhum dos dois. Caso Rafinha 02/10 19:21 UTC:
//   "...(id 132)? Confirma esse que eu registro o defeito nele e já lanço a compra da manta..."
// O "registro" casava a REPLY_PROMISE_RE, a frase do pedido sumia e entrava "Me diz de novo o que
// você quer que eu faça" — o TOM mandando a pessoa se repetir logo depois de pedir o ok que a regra
// de confirmar-antes-de-agir manda ele pedir. A frase de pedido termina em PONTO, não em "?", então
// nem o `hasTrailingQuestion` do engine nem o "termina em ?" da porta de baixo a enxergavam.
//
// O QUE ESTA RÉGUA NÃO FAZ (Bianca 09/08, HABIT-UPDATE-SILENT-LIE): pergunta não lava afirmação.
// "Registrei tudo, certo?" e "Tá anotado, beleza?" continuam sendo claims — a frase que AFIRMA
// escrita no passado nunca é pedido, com ou sem "?". E o veto é por FRASE acusada: uma pergunta
// ao lado não protege a afirmação falsa da frase vizinha (Rafinha 01/10: "anotei mais esses 2"
// era falso e as perguntas eram de verdade — sai uma, ficam as outras).
//
// A fronteira de 09/09 (portas-honestidade-fronteira.test.js) segue valendo: os DETECTORES das
// portas continuam diferentes. O que vira um só é o VETO — quem pergunta não está afirmando, nas duas.

// Escrita afirmada no passado/particípio, em 1ª pessoa ou de estado. "salvo" fica de fora de
// propósito: "Salvo como X ou Y?" (Hugo 25/09) é o presente, "eu salvo?".
const AFIRMA_ESCRITA_RE = /(?<![\p{L}])(?:criei|registrei|anotei|agendei|reagendei|marquei|salvei|guardei|lancei|cadastrei|atualizei|adicionei|coloquei|movi|conclu[íi]|finalizei|fechei|dei\s+baixa|anotad[oa]s?|registrad[oa]s?|adicionad[oa]s?|cadastrad[oa]s?|lan[çc]ad[oa]s?|agendad[oa]s?)(?![\p{L}])/giu;
const NEG_ANTES_RE = /\b(?:n[ãa]o|nem|nunca)\s+(?:[\p{L}]+\s+)?$/iu;

// Pedido de confirmação SEM "?": a frase ABRE com o imperativo de confirmar ("Confirma esse que eu
// registro", "Me confirma de novo que eu ajusto", "Só me confirma e eu registro"). A ação que vem
// depois é condicionada ao "sim" da pessoa — é a oferta condicional, com o gatilho "confirma".
// "Confirmado, ..." / "Confirmei ..." não casam (`confirm[ae]\b`).
const PEDIDO_CONFIRMACAO_RE = /^[^\p{L}\d]*(?:(?:e|ent[aã]o|a[ií]|s[óo]|[ée]\s+s[óo])\s+)?(?:me\s+)?(?:confirm[ae]|pode\s+(?:me\s+)?confirmar)(?![\p{L}])/iu;
const TERMINA_EM_PERGUNTA_RE = /\?\s*[*_~)\]"'”»]*\s*$/u;

function _afirmaEscrita(frase) {
  const re = new RegExp(AFIRMA_ESCRITA_RE.source, AFIRMA_ESCRITA_RE.flags);
  let m;
  while ((m = re.exec(frase)) !== null) {
    if (!NEG_ANTES_RE.test(frase.slice(Math.max(0, m.index - 18), m.index))) return true;
  }
  return false;
}

function fraseEhPedidoDeConfirmacao(frase) {
  const f = String(frase == null ? '' : frase).trim();
  if (!f) return false;
  if (_afirmaEscrita(f)) return false;
  return TERMINA_EM_PERGUNTA_RE.test(f) || PEDIDO_CONFIRMACAO_RE.test(f);
}

// Mesma segmentação das duas portas: linha, depois frase (o split de frase é o de promise-honesty).
function frasesDe(texto) {
  const out = [];
  for (const linha of String(texto == null ? '' : texto).split('\n')) {
    for (const frase of linha.split(/(?<=[.!?…])\s+/)) {
      if (frase.trim()) out.push({ frase, linha });
    }
  }
  return out;
}

function textoTemPergunta(texto) {
  return frasesDe(texto).some(({ frase }) => fraseEhPedidoDeConfirmacao(frase));
}

// A decisão única. `ehAcusada(frase, linha)` é o DETECTOR de cada porta (eles seguem diferentes —
// fronteira de 09/09); o veto é o mesmo:
//   * awaitingConfirm → o turno inteiro é pergunta de confirmação: ninguém acusa;
//   * toda frase acusada é pedido de confirmação → nada foi afirmado: ninguém acusa.
// `perguntaPendente`: sobra pergunta de verdade fora das frases acusadas — quem rebaixa não pode
// mandar a pessoa "dizer de novo" o que o TOM acabou de perguntar.
function vetoDePergunta(texto, opts = {}) {
  const o = opts || {};
  const ehAcusada = typeof o.ehAcusada === 'function' ? o.ehAcusada : () => false;
  if (o.awaitingConfirm) return { veto: true, motivo: 'awaiting_confirm', perguntaPendente: true };
  const frases = frasesDe(texto);
  const acusadas = frases.filter(({ frase, linha }) => ehAcusada(frase, linha));
  const perguntaPendente = frases.some(({ frase, linha }) => !ehAcusada(frase, linha) && fraseEhPedidoDeConfirmacao(frase));
  if (acusadas.length && acusadas.every(({ frase }) => fraseEhPedidoDeConfirmacao(frase))) {
    return { veto: true, motivo: 'pergunta', perguntaPendente: true };
  }
  return { veto: false, motivo: null, perguntaPendente };
}

module.exports = { vetoDePergunta, fraseEhPedidoDeConfirmacao, textoTemPergunta, frasesDe };
