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
  const t = String(inboundText || '').trim();
  if (!t) return null;
  if (AUDIO_PREFIX.test(t)) {
    const body = t.replace(AUDIO_PREFIX, '').trim();
    return body || null;
  }
  if (t.startsWith('[')) return null;
  return t;
}

/**
 * Monta a notificação ao requester ancorada na fala verbatim do recipient.
 * - Com verbatim: cita literalmente entre aspas; o resumo do LLM entra SEPARADO
 *   e rotulado ("como entendi: ..."), nunca fundido na fala. Resumo idêntico ao
 *   verbatim é omitido (sem redundância).
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

  let msg = `Boa! O ${name} respondeu:\n\n"${verbatim}"`;
  const s = String(summary || '').trim();
  if (s && s !== verbatim) {
    msg += `\n\n_(como entendi: ${s})_`;
  }
  return msg;
}

module.exports = { buildCoordinationResponseNotification, extractVerbatim };
