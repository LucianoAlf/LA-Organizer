'use strict';
// coord-request-id.js — validação + resolução TOLERANTE do request_id no
// <<COORDINATION_RESPONSE>>.
//
// Audit 08/07 (caso Jereh): o recipient respondeu um recado aberto e o TOM emitiu
//   <<COORDINATION_RESPONSE>> { "request_id": "9d08f967", "response_summary": "..." }
// O validador antigo exigia UUID de 36 chars (/^[0-9a-f-]{36}$/) → "9d08f967" (8 hex,
// o SHORT-ID que o LLM enxerga no histórico) caía em request_id:invalid_uuid →
// schema_invalid → a resposta era DESCARTADA e o requester (Gabi) nunca era avisado
// (coordination_requests.responded_at ficou null).
//
// Espelha o SHORT_ID_RE do engine (4-12 hex OU UUID completo). A resolução do
// short-id → linha real usa matchRowsByShortId, sempre escopada por recipient_id +
// status='sent'. Parecer da catraca (08/07): quando o prefixo casa N>1 recados
// abertos, NÃO chutar o mais recente — devolver 'ambiguous' pro caller rejeitar,
// senão notificaria o requester ERRADO em silêncio (a classe de confab que a
// auditoria caça). A guarda de ambiguidade cobre inclusive prefixos curtos.
const { matchRowsByShortId } = require('../services/short-id-match');

const COORD_REQUEST_ID_RE = /^([a-f0-9]{4,12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function isValidCoordRequestId(id) {
  return typeof id === 'string' && COORD_REQUEST_ID_RE.test(id.trim());
}

/**
 * Resolve o request_id (short-id OU UUID) contra as linhas candidatas já escopadas
 * (recipient_id + status='sent'). Ordem de candRows preservada (o caller passa mais
 * recente primeiro).
 * @returns {{status:'ok', req:object} | {status:'ambiguous', matches:object[]} | {status:'none'}}
 */
function resolveCoordRequest(candRows, requestId) {
  const matches = matchRowsByShortId(Array.isArray(candRows) ? candRows : [], requestId);
  if (matches.length > 1) return { status: 'ambiguous', matches };
  if (matches.length === 1) return { status: 'ok', req: matches[0] };
  return { status: 'none' };
}

module.exports = { isValidCoordRequestId, resolveCoordRequest, COORD_REQUEST_ID_RE };
