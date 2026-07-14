'use strict';
// coord-alias.js — normalização de aliases de campo do <<COORDINATION_REQUEST>>.
//
// Extraído do engine (parseCoordinationRequestMarker, ~1563-1575) no audit 14/07.
// COORD-REQUEST-TONAME-ALIAS: o LLM emite `to_name` como destinatário (espelhando o
// `from_name` que ele mesmo usa pro remetente). A cadeia cobria recipient/to/name mas
// NÃO to_name → recipient_name:missing → schema_invalid → o recado nunca era enviado.
// Dominou 81% das rejeições históricas de coordenação e 100% das de julho (John, Anne…).
// Todos os fixes anteriores (COORD-SEND-CONFAB-STRIP, FATIA-B-COORD-CONFAB) trataram o
// SINTOMA (prosa honesta "não consegui enviar"); este fecha a RAIZ (o recado passa a sair).
//
// Aditivo e idempotente: o campo canônico, quando presente, NUNCA é sobrescrito.
// @param {object} parsed — o objeto JSON do marker (mutado in-place, espelha o engine)
// @returns {object} o mesmo objeto, com recipient_name/message_body/mode normalizados
const MODE_ALIASES = {
  relay: 'relay_literal', literal: 'relay_literal',
  assisted: 'relay_assisted',
  'follow-up': 'followup', follow_up: 'followup', follow: 'followup',
};

function normalizeCoordinationFields(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  parsed.recipient_name = parsed.recipient_name || parsed.recipient || parsed.to || parsed.to_name || parsed.name;
  parsed.message_body   = parsed.message_body   || parsed.message  || parsed.body || parsed.content || parsed.text;
  if (parsed.mode) {
    const _modeKey = String(parsed.mode).toLowerCase();
    if (MODE_ALIASES[_modeKey]) parsed.mode = MODE_ALIASES[_modeKey];
  }
  return parsed;
}

module.exports = { normalizeCoordinationFields };
