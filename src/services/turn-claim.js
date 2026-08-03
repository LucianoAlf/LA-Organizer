// src/services/turn-claim.js
// Fronteira de SAÍDA do turno: nenhum outbound de um turno claimado nasce fora do dono
// vencedor da lease.
//
// POR QUE CONTEXTO IMPLÍCITO E NÃO UM HELPER EXPLÍCITO
// O engine tem 82 chamadas de whatsapp.sendMessage para o remetente do turno e mais 24
// para terceiros — respostas, early-returns de ramo, avisos. Trocar 106 call sites por um
// helper depende de não esquecer nenhum, e o esquecido não dá erro: ele só manda a
// mensagem fora do contrato, em silêncio. Isso é exatamente o modo de falha que esta
// fatia existe para eliminar.
//
// Com AsyncLocalStorage o turno é aberto UMA vez no webhook e todo envio que aconteça
// dentro dele é coberto por construção — inclusive os ramos que ninguém mapeou e os que
// forem escritos amanhã. Rituais e proativos rodam fora do turno: passam direto, sem
// consultar o banco, que é o recorte correto (não são resposta a inbound).
//
// FAIL-OPEN, igual ao claim de entrada: só UMA coisa impede o envio — o banco dizer, com
// recibo, que a posse não é mais deste worker. Banco fora, sem recibo, sem turno, sem
// lease: envia. Não enviar por engano deixa a pessoa sem resposta.
'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();

// ctx: { waMessageId, leaseToken, operationId }
function runInTurn(ctx, fn) {
  return als.run(ctx || {}, fn);
}

function currentTurn() {
  const s = als.getStore();
  return s && s.waMessageId ? s : null;
}

function decideSend({ turn = null, leaseOk = undefined, error = null } = {}) {
  if (!turn || !turn.waMessageId || !turn.leaseToken) {
    return { send: true, reason: 'sem_claim', degraded: false };
  }
  if (error) {
    const detail = (error && (error.message || error.details)) || String(error);
    return { send: true, reason: 'assert_indisponivel', degraded: true, detail: String(detail).slice(0, 120) };
  }
  if (leaseOk === true) return { send: true, reason: 'lease_ok', degraded: false };
  // false é recibo EXPLÍCITO: a linha existe e não é mais deste worker (dono trocado,
  // status concluído ou lease vencida). Só aqui o TOM cala.
  if (leaseOk === false) return { send: false, reason: 'lease_perdida', degraded: false };
  return { send: true, reason: 'sem_recibo', degraded: true };
}

// Roda ANTES de cada envio. Fora de turno não toca no banco.
async function beforeSend({ supabase } = {}) {
  const turn = currentTurn();
  if (!turn || !turn.leaseToken) return decideSend({ turn: null });
  let leaseOk;
  let error = null;
  try {
    const res = await supabase.rpc('tom_route_assert_lease', {
      p_wa_message_id: turn.waMessageId,
      p_owner: 'v1',
      p_lease_token: turn.leaseToken,
    });
    if (res && res.error) error = res.error;
    else leaseOk = res && typeof res.data === 'boolean' ? res.data : null;
  } catch (e) {
    error = e;
  }
  return decideSend({ turn, leaseOk, error });
}

// Roda DEPOIS do envio, já entregue. Amarra o outbound à operação e à lease do turno —
// quando há turno. Fora dele, registra sem operação (é proativo/ritual, dono nenhum).
// Nunca lança: a mensagem já saiu, e falha aqui é contabilidade.
async function afterSend({ supabase, sentId, phone = null, collaboratorId = null } = {}) {
  if (!sentId) return { ok: false, code: 'no_wa_id' };
  const turn = currentTurn();
  try {
    const { recordOutboundV1 } = require('./outbound-record');
    return await recordOutboundV1({
      supabase, waMessageId: sentId, phone, collaboratorId,
      operationId: turn ? turn.operationId : null,
      leaseToken: turn ? turn.leaseToken : null,
    });
  } catch (e) {
    return { ok: false, code: 'db_error', detail: String(e.message || e).slice(0, 120) };
  }
}

module.exports = { runInTurn, currentTurn, decideSend, beforeSend, afterSend };
