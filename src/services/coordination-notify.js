// src/services/coordination-notify.js
//
// Por que existe: ao devolver a resposta de um recipient ao requester, o TOM
// deve CITAR A FALA VERBATIM da pessoa (registro real em conversation_history),
// nunca apenas a paráfrase livre do LLM. Fecha o vetor de "pôr palavras/
// compromissos na boca de uma pessoa real".
//
// Caso real Rafinha (29/05): ele digitou SÓ "Consigo verificar sim", mas o
// response_summary do LLM acrescentou "...e vai dar um retorno" — compromisso
// que ele nunca assumiu. Inócuo naquele turno, mas é exatamente o drift que num
// sistema de coordenação real vira mal-entendido (o requester espera um retorno
// que nunca foi prometido). Convenção de projeto: citar verbatim, nunca paráfrase.

const AUDIO_PREFIX = /^\[áudio transcrito\]\s*/i;

// Scaffolding de reply/quoted que o webhook PREPENDE (webhook.js ~289/292). A
// fala REAL da pessoa vem logo depois do ']\n'. Bug 30/05 (Alf respondeu "Sim"
// CITANDO a msg do Tom): extractVerbatim derrubava a fala por causa do '[' e
// caía em "não consegui transcrever". Anchorado no formato gerado:
//   texto:  [O usuário está RESPONDENDO a esta mensagem anterior...: "<snip>"]\n<fala>
//   mídia:  [O usuário está RESPONDENDO a uma mídia anterior do tipo <t>]\n<fala>
const REPLY_TEXT_SCAFFOLD = /^\[O usuário está RESPONDENDO a esta mensagem anterior[\s\S]*?"\]\n/;
const REPLY_MEDIA_SCAFFOLD = /^\[O usuário está RESPONDENDO a uma mídia anterior do tipo [^\]\n]*\]\n/;

/**
 * Extrai a fala literal do recipient a partir do texto inbound que o engine
 * processou (o `text` de processMessage). Retorna null quando NÃO há fala
 * verbatim citável — mídia, áudio não transcrito, scaffolding de reply/multi-
 * mensagem. Nesse caso o chamador NÃO deve parafrasear/inventar.
 *
 * Decisão conservadora: qualquer placeholder de sistema começa com '[' (ver
 * webhook.js: "[O usuário ACABOU DE ENVIAR...]", "[O usuário está RESPONDENDO...]",
 * "[O usuário enviou N mensagens...]"). A única exceção é "[áudio transcrito] X",
 * onde X é a transcrição real da fala — essa sim é citável (sem o prefixo).
 *
 * @param {string} inboundText
 * @returns {string|null}
 */
function extractVerbatim(inboundText) {
  let t = String(inboundText || '').trim();
  if (!t) return null;
  // 1) Tira scaffolding de reply/quoted — a fala real da pessoa vem depois do ']'.
  //    (só um dos dois casa; replace é inócuo quando não casa.)
  t = t.replace(REPLY_TEXT_SCAFFOLD, '').replace(REPLY_MEDIA_SCAFFOLD, '').trim();
  // 2) Tira o prefixo de transcrição de áudio — a transcrição É a fala citável
  //    (inclusive quando o áudio veio dentro de um reply citado).
  if (AUDIO_PREFIX.test(t)) {
    t = t.replace(AUDIO_PREFIX, '').trim();
  }
  if (!t) return null;
  // 3) O que ainda começa com '[' é scaffolding de MÁQUINA (análise de imagem/
  //    vídeo/PDF, header de multi-mensagem) — não há fala humana citável.
  if (t.startsWith('[')) return null;
  return t;
}

/**
 * Monta a notificação ao requester ancorada na fala verbatim do recipient.
 * - Com verbatim: cita SÓ a fala literal entre aspas. O resumo do LLM NÃO entra
 *   (VERBATIM-RELAY-HARDENING 22/06) — era o vetor que punha tópico/compromisso na
 *   boca da pessoa (Alf "sobre os aniversariantes"; Rafinha "vai dar um retorno").
 * - Sem verbatim: avisa que não conseguiu capturar o conteúdo. NUNCA cai no
 *   resumo livre — não pode atribuir fala a uma pessoa real sem registro
 *   verificável.
 *
 * @param {{recipientFirstName:string, inboundText:string, summary?:string}} args
 * @returns {string}
 */
function buildCoordinationResponseNotification({ recipientFirstName, inboundText, summary }) {
  const name = (recipientFirstName || '').trim() || 'Alguém';
  const verbatim = extractVerbatim(inboundText);

  if (!verbatim) {
    return `Boa! O ${name} respondeu (não consegui transcrever o conteúdo — dá uma olhada direto com ele/ela).`;
  }

  // VERBATIM-RELAY-HARDENING (COORD-RESPONSE-WRONG-BIND, 22/06): relay SÓ a fala literal.
  // O resumo do LLM (`summary`) NÃO entra mais na notificação — era o vetor que injetava
  // tópico/compromisso que a pessoa não disse (caso Alf: "...sobre os aniversariantes";
  // caso Rafinha: "...vai dar um retorno"). O requester recebe exatamente o que o recipient
  // escreveu. `summary` fica no param só por compat de callers; é ignorado de propósito.
  void summary;
  return `Boa! O ${name} respondeu:\n\n"${verbatim}"`;
}

/**
 * response_summary a PERSISTIR no coordination_requests: só confia na paráfrase do LLM
 * quando houve fala REAL capturada (extractVerbatim != null). Áudio/imagem não transcrita
 * → null, pra NÃO envenenar o _accQ3 (que reinjeta o summary e faz o LLM confabular
 * "Fulano autorizou" o que ninguém disse). Caso Dudu/Rafinha 12/06 (VERBATIM-SUMMARY-POISON).
 * Espelha a mesma regra que protege a NOTIFICAÇÃO (buildCoordinationResponseNotification).
 * @param {string} inboundText  o texto inbound que o engine processou (o `text`)
 * @param {string} llmSummary   parsed.response_summary do marker
 * @returns {string|null}
 */
function safeResponseSummary(inboundText, llmSummary) {
  if (extractVerbatim(inboundText) == null) return null;
  return llmSummary == null ? null : String(llmSummary);
}

module.exports = { buildCoordinationResponseNotification, extractVerbatim, safeResponseSummary };
