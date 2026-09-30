'use strict';
// nada-a-registrar.js — a pessoa pediu pra NÃO registrar, e o TOM só disse que nada mudou. PURO.
//
// O CASO (achado 3b33aa68, Matheus 28/09 11:35 BRT). Ele respondeu "tudo pago!" à lista de
// contas, o TOM pediu confirmação (vencimento futuro), e ele recuou: "nao nao .. perdao, achei
// que fossem contas do mes 09. deixa tudo em aberto ainda". O modelo respondeu CERTO — "Fica tudo
// em aberto mesmo, nenhuma foi marcada como paga" — e a trava de honestidade (optimistic-confirm.js)
// trocou tudo por "Na real não consegui registrar isso agora — me manda de novo". Ele repetiu
// ("as contas ainda estao abertos, nao marcar como pago"), o TOM respondeu "nada marcado como
// pago", e levou a mesma nota. Só no 3º pedido saiu. Não havia NADA a registrar.
//
// A RAIZ (medida pelo gov-agent em 29/09): o ramo TOTALIZER ("tudo") + verbo de conclusão
// ("marcada") de _isCompletionClaimLine não olha negação. "nenhuma foi marcada", "nada marcado"
// são o OPOSTO de uma afirmação de escrita. optimistic-confirm.js está em parada (21+ commits em
// 60 dias) e não é tocado: o veto liga na porta `reportedState` de enforceNoMarkerHonesty, que
// só desarma a camada FORTE e continua freada por markerAttempted.
//
// Libera só quando TODAS valem:
//   1. a fala DA PESSOA pede pra não registrar / deixar como está ("deixa tudo em aberto",
//      "não marcar como pago", "ainda não paguei", "não foram feitos");
//   2. fora dos trechos negados, ela não pede escrita nenhuma ("não marca a 1, marca a 2" = pedido);
//   3. a resposta NÃO tem o TOM em 1ª pessoa de escrita ("marquei", "registrei", "dei baixa");
//   4. toda linha acusada pela trava deixa de ser afirmação FORTE quando se tiram os trechos
//      negados ("nenhuma foi marcada como paga", "nada marcado como pago", "não foi pago").
// JS: `\b` falha depois de letra acentuada — as fronteiras aqui são lookarounds de \p{L}.
const { hasCompletionClaim, hasWeakCompletionClaim } = require('./optimistic-confirm');

const A = '(?<![\\p{L}])';
const D = '(?![\\p{L}])';
const VERBO_DE_ESCRITA = 'marca|marque|marcar|registra|registre|registrar|lan[çc]a|lance|lan[çc]ar|anota|anote|anotar|d[áa]\\s+baixa|dar\\s+baixa|baixa|baixar|conclui|concluir|fecha|fechar';

// (1) a pessoa pede pra NÃO registrar / deixar como está.
const PEDE_NAO_REGISTRAR_RE = new RegExp(A + '(?:'
  + 'n[ãa]o\\s+(?:precisa\\s+|pode\\s+|[ée]\\s+pra\\s+|quero\\s+que\\s+)?(?:' + VERBO_DE_ESCRITA + ')'
  + '|deix[ae]\\s+(?:tudo\\s+|todas?\\s+|todos?\\s+|elas?\\s+|eles?\\s+|isso\\s+|as\\s+contas\\s+)?(?:em\\s+aberto|abert[oa]s?|como\\s+(?:est[áa]|t[áa])|assim|pendentes?)'
  + '|(?:est[ãa]o|t[ãa]o|est[áa]|t[áa]|continuam?|seguem?|ficam?)\\s+(?:ainda\\s+)?(?:em\\s+)?abert[oa]s?'
  + '|n[ãa]o\\s+(?:foi|foram)\\s+(?:feit|pag)[oa]s?'
  + '|n[ãa]o\\s+(?:foi|foram)\\s+(?:[\\p{L}]+\\s+){0,2}?(?:feit|pag)[oa]s?'
  + '|ainda\\s+n[ãa]o\\s+(?:paguei|pagamos|pagou|pagaram|foi|foram|fiz|venceu|chegou)'
  + ')' + D, 'iu');

// (2) pedido de escrita AFIRMATIVO — avaliado depois de tirar os trechos negados da fala dela.
const PEDIDO_RE = new RegExp(A + '(?:' + VERBO_DE_ESCRITA + '|cria|crie|criar|agenda|agende|agendar|finaliza|cancela|apaga|exclui|paguei|pagamos|t[áa]\\s+pag[oa]s?|j[áa]\\s+pag)' + D, 'iu');
const NEGACAO_NA_FALA_RE = new RegExp(A + '(?:n[ãa]o|nem|nada\\s+de)\\s+(?:precisa\\s+|pode\\s+|[ée]\\s+pra\\s+|quero\\s+que\\s+)?(?:[\\p{L}]+\\s+){0,3}?(?:' + VERBO_DE_ESCRITA + '|paguei|pagamos|pagou|pagaram|feit[oa]s?|pag[oa]s?)(?:\\s+como\\s+pag[oa]s?)?' + D, 'giu');

// (3) o TOM afirmando escrita própria — nunca liberado.
const TOM_ESCREVEU_RE = /(?<![\p{L}])(?:criei|registrei|anotei|agendei|marquei|salvei|lancei|cadastrei|atualizei|conclu[íi]|finalizei|fechei|coloquei|botei|cancelei|apaguei|dei\s+baixa)(?![\p{L}])/iu;

// (4) trecho NEGADO na fala do TOM: "nenhuma foi marcada como paga", "nada marcado como pago",
// "não foi pago", "sem marcar". A negação vem ANTES do particípio, a no máximo 3 palavras.
const TRECHO_NEGADO_RE = new RegExp(A
  + '(?:nenhum[ao]?s?|nada|n[ãa]o|nem|sem)(?:\\s+[\\p{L}]+){0,3}?\\s+'
  + '(?:(?:marcad|registrad|anotad|lan[çc]ad|baixad|conclu[íi]d|finalizad|fechad|quitad|pag|feit|criad|cancelad|alterad|mexid)[oa]s?|marcar|registrar|lan[çc]ar|mexer|alterar|mudar|dar\\s+baixa)'
  + '(?:\\s+como\\s+[\\p{L}]+)?' + D, 'giu');

const _sem = (s, re) => String(s).replace(re, ' ');

function pedidoDeNadaARegistrar(userText, reply) {
  const u = String(userText == null ? '' : userText);
  const r = String(reply == null ? '' : reply);
  if (!u.trim() || !r.trim()) return false;
  if (!PEDE_NAO_REGISTRAR_RE.test(u)) return false;                        // (1)
  if (PEDIDO_RE.test(_sem(u, NEGACAO_NA_FALA_RE))) return false;           // (2)
  if (TOM_ESCREVEU_RE.test(r)) return false;                               // (3)
  const acusadas = r.split('\n').filter((l) => l.trim() && (hasCompletionClaim(l) || hasWeakCompletionClaim(l)));
  if (!acusadas.length) return false;
  return acusadas.every((l) => !hasCompletionClaim(_sem(l, TRECHO_NEGADO_RE))); // (4)
}

module.exports = { pedidoDeNadaARegistrar };
