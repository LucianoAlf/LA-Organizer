// src/services/outbound-record.js
// Registra no ledger de propriedade (tom_message_ownership) a mensagem que o TOM ACABOU
// de enviar, com o id real devolvido pela UAZAPI.
//
// REGRA-MÃE DESTA CAMADA: quando este código roda, a mensagem JÁ FOI ENTREGUE ao
// WhatsApp. Falhar aqui é problema de CONTABILIDADE, não de entrega:
//   * nunca lança — o pós-entrega não pode derrubar o turno;
//   * nunca reenvia nem pede reenvio — mensagem duplicada é pior que registro faltando;
//   * devolve um RECIBO tipado para quem chamou registrar telemetria honesta.
//
// "Não deu erro" NÃO é recibo. Se a RPC não devolveu outcome, isso é ausência de prova
// (`no_outcome`), não prova de sucesso — a lição que custou cinco rodadas de auditoria
// na Fatia 1 vale aqui igual.
'use strict';

// Os únicos dois recibos que contam como registrado. `already_recorded_same` é sucesso
// porque o ledger é idempotente por wa_message_id: reprocessar não duplica.
const OUTBOUND_OK = new Set(['inserted', 'already_recorded_same']);

function classifyOutboundRecord({ waMessageId = null, outcome = null, error = null } = {}) {
  if (!waMessageId) {
    return { ok: false, code: 'no_wa_id', duplicate: false, detail: 'envio sem id da UAZAPI' };
  }
  if (error) {
    const detail = (error && (error.message || error.details)) || String(error);
    return { ok: false, code: 'db_error', duplicate: false, detail: String(detail).slice(0, 120) };
  }
  if (!outcome) {
    return { ok: false, code: 'no_outcome', duplicate: false, detail: 'RPC não devolveu recibo' };
  }
  if (OUTBOUND_OK.has(outcome)) {
    return { ok: true, code: outcome, duplicate: outcome === 'already_recorded_same', detail: null };
  }
  return { ok: false, code: outcome, duplicate: false, detail: 'recibo fora do contrato' };
}

// Extrai o outcome tolerando as duas formas em que o driver devolve `returns table`.
function _outcomeDe(data) {
  if (Array.isArray(data)) return (data[0] && data[0].outcome) || null;
  if (data && typeof data === 'object') return data.outcome || null;
  return null;
}

async function recordOutboundV1({
  supabase, waMessageId, phone = null, collaboratorId = null,
  conversationKey = null, entityType = null, entityId = null,
} = {}) {
  // Sem id não há o que registrar — e não se gasta round-trip no banco por nada.
  if (!waMessageId) return classifyOutboundRecord({ waMessageId: null });

  let outcome = null;
  let error = null;
  try {
    const res = await supabase.rpc('tom_record_outbound', {
      p_wa_message_id: waMessageId,
      p_owner: 'v1',
      p_phone: phone || null,
      p_collaborator: collaboratorId || null,
      // No v1 a conversa É o telefone; a chave explícita existe para grupo.
      p_conversation: conversationKey || phone || null,
      p_entity_type: entityType || null,
      p_entity_id: entityId || null,
    });
    if (res && res.error) error = res.error;
    else outcome = _outcomeDe(res && res.data);
  } catch (e) {
    // supabase-js normalmente devolve {error} em vez de lançar, mas cliente ausente ou
    // conexão morta lançam — e nada disso pode escapar desta função.
    error = e;
  }
  return classifyOutboundRecord({ waMessageId, outcome, error });
}

module.exports = { classifyOutboundRecord, recordOutboundV1, OUTBOUND_OK };
