'use strict';
// confirm-coord-gate.js — Fatia 8. Decide se uma pergunta de confirmação SEM payload executável é
// uma proposta de RECADO — então o "sim" pode instruir o LLM a compor+emitir COORDINATION_REQUEST
// (despacho direto, pré-confirmado) em vez de cair no ramo "desiste e pede pra repetir". Espelha o
// confirm-create-gate: FAIL-CLOSED, e veta se a pergunta mexe em item existente. PURO.
//
// A Fatia 3 cobre recado com TEXTO explícito (parse-on-open). O implícito ("Mando um agradecimento
// pro X?") não tem texto extraível — quem compõe é o LLM, sob a intenção que o próprio TOM propôs
// e o usuário aprovou. O bypass do estágio é seguro porque a confirmação JÁ aconteceu (turno anterior).

// Reusa o veto de "ação sobre item existente" do create-gate (deleg/fecha/cancel/apaga/reagenda…).
const { ACAO_SOBRE_EXISTENTE } = require('../utils/confirm-create-gate');

// Sinal de que o TOM está PROPONDO mandar um recado/aviso a alguém.
const PROPOE_RECADO = new RegExp([
  '\\bavis(?:o|ar)\\s+(?:o|a|os|as|\\d|pra|pro|para)\\b',
  '\\baviso\\s+\\d+\\s+pessoa',
  // "mande" (subjuntivo) entrou em 19/08: o gate determinístico propõe "Quer que eu MANDE um
  // recado…" e a forma não casava — o "sim" não pré-confirmava e o recado era re-estagiado.
  '\\bmand(?:o|ar|e)\\s+(?:um[a]?\\s+)?(?:recado|mensagem|aviso|agradecimento)',
  '\\bmand(?:o|ar|e)\\s+(?:pra|pro|para)\\b',
  '\\bpasso?\\s+o\\s+recado', '\\brepass(?:o|ar)\\s+(?:o\\s+)?(?:recado|agradecimento|mensagem)',
  '\\bfal(?:o|ar)\\s+com\\b', '\\bagrade[çc](?:o|er)\\b',
].join('|'), 'iu');

// COORD-GATE-VETADO-PELO-PREAMBULO (Alf 19/08 13:10). O veto rodava no TEXTO INTEIRO da
// pergunta. Quando o TOM passou a EXPLICAR a regra antes de propor ("…quem pode *remarcar* é o
// dono, Yuri — convidado não altera a agenda dos outros. Quer que eu mande um recado?"), o
// "remarcar" do preâmbulo vetava a proposta que vinha depois: o "Sim" não pré-confirmava e o
// recado era re-estagiado ("Aviso o Yuri? Confirma?"), pedindo o MESMO consentimento duas vezes.
//
// O "sim" responde a PERGUNTA, não o preâmbulo — então é na pergunta que se decide. Veto e
// proposta são avaliados na MESMA frase (a última interrogativa): proposta limpa numa frase com
// ação destrutiva em OUTRA continua vetada, e o fail-closed segue fechado.
// Sem "?" no texto, avalia tudo (comportamento antigo).
// COORD-GATE-APAGADO-PELA-TAG (Clayton 29/08 08:53). A casa fecha proposta com uma tag de
// confirmação SEM conteúdo ("Mando um agradecimento pro Rafinha? *Confirma?*"), e era ela a
// última interrogativa — então o alvo do gate virava "Confirma?", que não casa proposta
// nenhuma. Nas perguntas gravadas em CONFIRM_NOEXEC o gate liberava 1 e ficava apagado por
// isto em 5. A tag é pulada; o veto segue rodando na frase da proposta, então o fail-closed
// não afrouxa. Tag sozinha (sem proposta antes) continua sem liberar.
const TAG_CONFIRMACAO = /^(?:confirma\w*|certo|t[áa]\s+certo|correto|pode\s+ser)\b[^?]*\?$/iu;

function ultimaPergunta(texto) {
  // Corta em fim de FRASE (. ! ?), não só em "?": o preâmbulo do gate termina em ponto, e sem
  // isso o texto inteiro contaria como "a pergunta" — que era justamente o bug.
  const frases = String(texto).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const limpa = (s) => s.replace(/[*_"“”]/g, '').replace(/\s+/g, ' ').trim();
  for (let i = frases.length - 1; i >= 0; i--) {
    if (frases[i].endsWith('?') && !TAG_CONFIRMACAO.test(limpa(frases[i]))) return frases[i];
  }
  for (let i = frases.length - 1; i >= 0; i--) {
    if (frases[i].endsWith('?')) return frases[i];
  }
  return String(texto);
}

/**
 * A pergunta de confirmação pode liberar despacho de RECADO (COORDINATION_REQUEST)?
 * @param {string} perguntaDoTom  question_text da intent
 * @returns {boolean} true só quando é proposta de recado sem menção a ação sobre item existente
 */
function podeLiberarRecado(perguntaDoTom) {
  if (typeof perguntaDoTom !== 'string') return false;
  const t = perguntaDoTom.trim();
  if (!t) return false;
  const alvo = ultimaPergunta(t);
  if (ACAO_SOBRE_EXISTENTE.test(alvo)) return false;  // veta primeiro (fail-closed)
  return PROPOE_RECADO.test(alvo);
}

module.exports = { podeLiberarRecado, PROPOE_RECADO, ultimaPergunta };
