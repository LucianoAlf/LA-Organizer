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
// COORD-MODE-DIRECT-E-AUSENTE (08/08) — depois que o to_name foi resolvido em 14/07, o
// `mode` virou o ÚNICO motivo vivo de rejeição da coordenação: 3 casos em agosto (Krissya
// 03/08, Jhonatan 03/08, Quintela 04/08), todos com recipient_name e message_body corretos.
// Um deles emitiu "direct"; nos outros o log trunca antes do campo, então o mode ou é outro
// valor de fora da whitelist ou está ausente — e ausente também caía em mode:invalid, porque
// a validação é um includes() sobre undefined.
// Os dois casos caem em relay_literal DE PROPÓSITO: o message_body já vem redigido pelo LLM,
// e literal manda exatamente esse texto. relay_assisted abriria espaço pra parafrasear, o que
// contraria o verbatim-relay (o TOM não reescreve fala de terceiro).
const MODE_ALIASES = {
  relay: 'relay_literal', literal: 'relay_literal', direct: 'relay_literal',
  direto: 'relay_literal', send: 'relay_literal', message: 'relay_literal',
  assisted: 'relay_assisted',
  'follow-up': 'followup', follow_up: 'followup', follow: 'followup',
};
const MODE_DEFAULT = 'relay_literal';

function normalizeCoordinationFields(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  parsed.recipient_name = parsed.recipient_name || parsed.recipient || parsed.to || parsed.to_name || parsed.name;
  parsed.message_body   = parsed.message_body   || parsed.message  || parsed.body || parsed.content || parsed.text;
  const _modeKey = String(parsed.mode || '').trim().toLowerCase();
  if (!_modeKey) {
    // Só assume o default quando há recado de verdade pra mandar — sem destinatário ou sem
    // texto o marker segue inválido, e a validação do engine rejeita como antes.
    if (parsed.recipient_name && parsed.message_body) parsed.mode = MODE_DEFAULT;
  } else if (MODE_ALIASES[_modeKey]) {
    parsed.mode = MODE_ALIASES[_modeKey];
  }
  return parsed;
}

module.exports = { normalizeCoordinationFields };
