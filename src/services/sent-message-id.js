// src/services/sent-message-id.js
// Lê o id da mensagem ENVIADA a partir do retorno do whatsapp.sendMessage (response.data
// da UAZAPI). Espelha extractMessageId (que lê o id da msg RECEBIDA) — a UAZAPI varia o
// formato. Função PURA → testável sem axios/env. Usado pelo Lote D para vincular o
// proativo de saída ao objeto que o originou (REPLY-QUOTE-PROATIVO).
'use strict';

function extractSentMessageId(responseData) {
  const m = responseData;
  if (!m || typeof m !== 'object') return null;
  const candidates = [
    m.id, m.messageid, m.message_id,
    m.key && m.key.id,
    m.message && m.message.id,
    m.data && m.data.id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length >= 4) return c;
  }
  return null;
}

module.exports = { extractSentMessageId };
