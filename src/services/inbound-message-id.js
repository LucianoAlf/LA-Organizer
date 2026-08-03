// src/services/inbound-message-id.js
// Normalização do payload da UAZAPI e extração do id da mensagem RECEBIDA.
//
// Extraído de whatsapp.js (que carrega config + axios e, por isso, não roda em teste sem
// env) pelo mesmo motivo que sent-message-id.js foi extraído antes: função PURA precisa
// ser testável sozinha. A Fatia 3 do router depende deste id para saber "essa mensagem eu
// já processei" — se ele voltar null, o claim não acha o par e o TOM pode responder duas
// vezes depois de um restart. É contrato, não utilitário.
//
// whatsapp.js reexporta as duas: nenhum call site precisou mudar.
'use strict';

function getData(body) {
  // New format: array (enriched lean payload from curl tests)
  if (body?.EventType && body?.messages?.length > 0) return body.messages[0];
  // New format: singular message object (real UAZAPI delivery)
  if (body?.EventType && body?.message) return body.message;
  // Old format
  if (body?.data) return body.data;
  return body;
}

function extractMessageId(body) {
  const m = getData(body);
  if (!m || typeof m !== 'object') return null;
  const candidates = [
    m.id,
    m.messageid,
    m.message_id,
    m.key && m.key.id,
    body && body.id,
  ];
  for (const c of candidates) {
    // >= 4 recusa lixo: uma chave de dedupe curta demais casaria mensagens diferentes.
    if (typeof c === 'string' && c.length >= 4) return c;
  }
  return null;
}

module.exports = { getData, extractMessageId };
