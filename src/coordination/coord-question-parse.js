'use strict';
// coord-question-parse.js — Fatia 3 (confirmação parse-on-open, coordenação).
//
// Extrai {recipient_name, message_body} da PERGUNTA DE CONFIRMAÇÃO do TOM ("Aviso o Yuri? Segue
// o texto: '…'. Confirma?"), pra o hook genérico de fim-de-turno abrir o intent com
// coordination.items ESTRUTURADO — aí o "sim" despacha determinístico (applyCoordinationRequest
// Action) em vez de o LLM ter que re-emitir o marker (que confabula "perdi o fio, me manda de novo").
//
// FAIL-CLOSED: só retorna objeto quando destinatário E texto EXPLÍCITO (entre aspas) estão
// presentes. Mensagem implícita ("Aviso o Alf sobre os calendários?") → null → cai no caminho de
// hoje. Mandar recado ERRADO pra uma pessoa real é pior que o drop atual. Puro (sem I/O).
// A resolução do destinatário fica no executor, que já fail-closa em ambíguo/não-achado.

// "Aviso o/a/os/as {Nome}" — nome CAPITALIZADO (1–2 tokens). [Aa]viso cobre início e meio de
// frase sem ligar /i (que faria o nome aceitar minúscula e quebrar o requisito de capitalização).
// VERBOS REAIS DO TOM (caso Rafinha 29/08 14:07, finding bd84ca6b). A Fatia 3 existia e nao
// disparava: o parser so conhecia 'Aviso o/a X', e a forma que o TOM mais usa e 'Mando pro X
// assim? _"..."_'. Sem extracao, o payload ficava so-texto, a execucao voltava a depender do
// LLM -- e ele respondeu 'Nao consegui processar aqui, me manda de novo' UM SEGUNDO depois de
// a intent ser resolvida como confirmed. O fail-closed do texto entre aspas NAO muda: recado
// errado pra pessoa real segue sendo pior que o drop.
const AVISO_RE = /(?:^|[^\p{L}])(?:[Aa]viso\s+(?:os?|as?)|(?:[Mm]ando|[Ee]ncaminho|[Ee]nvio)\s+(?:pro|pra|para)(?:\s+(?:o|a))?)\s+([A-ZÀ-Ú][\p{L}._'-]*(?:\s+[A-ZÀ-Ú][\p{L}._'-]*)?)/u;
// Negação: "não aviso" / "nem aviso" desqualifica a fala inteira.
const NEG_RE = /\bn[\u00e3a]o\s+(?:aviso|mando|encaminho|envio)\b|\bnem\s+(?:aviso|mando)\b/i;
// Bloco de mensagem: entre aspas retas ou tipográficas, ao menos 1 caractere.
const QUOTE_RE = /["“”]([^"“”]+)["“”]/;

function _limpaMsg(s) {
  return String(s)
    .replace(/^\s*>\s*/gm, '')  // marca de citação markdown
    .replace(/\*/g, '')         // negrito/itálico
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCoordinationConfirmQuestion(replyText) {
  if (typeof replyText !== 'string' || !replyText.trim()) return null;
  if (NEG_RE.test(replyText)) return null;

  const mR = AVISO_RE.exec(replyText);
  if (!mR) return null;
  const recipient_name = mR[1].trim();
  if (!recipient_name) return null;

  const mM = QUOTE_RE.exec(replyText);
  if (!mM) return null;
  const message_body = _limpaMsg(mM[1]);
  if (!message_body) return null;

  return { recipient_name, message_body };
}

module.exports = { parseCoordinationConfirmQuestion };
