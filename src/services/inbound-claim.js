// src/services/inbound-claim.js
// Claim da mensagem RECEBIDA no ledger de propriedade, antes de processá-la.
//
// PARA QUE SERVE: o webhook responde 200 na hora, então a UAZAPI não reentrega. Mas se o
// processo morre entre o envio da resposta e a limpeza do inFlightBodies, o drain salva o
// payload e o próximo boot REPROCESSA a mensagem inteira — o TOM responde de novo. O
// claim é o que faz o replay reconhecer `already_completed` e calar.
//
// ================================ FAIL-OPEN =========================================
// O risco aqui é INVERTIDO em relação ao registro de saída. Lá, falhar significava
// registro faltando — invisível pra quem usa. Aqui, decidir "não processa" por engano
// significa TOM MUDO: a pessoa escreve e não recebe nada.
//
// Por isso o default de todo caminho desconhecido é PROCESSAR. Só três recibos explícitos
// calam o TOM: already_completed, in_progress_elsewhere, owned_by_other. Banco fora do
// ar, RPC sem recibo, outcome novo, exceção — tudo processa.
//
// Isso aceita, conscientemente, que numa falha de banco possa haver resposta duplicada.
// É a troca escolhida: duplicar é raro e constrangedor; ficar mudo é imediato e destrói a
// confiança no TOM. Decisão do Alf, declarada antes de implementar.
'use strict';

// Os ÚNICOS recibos que autorizam não processar. Lista fechada de propósito: qualquer
// coisa fora dela — inclusive um outcome que só exista no futuro — processa.
const RECIBOS_QUE_CALAM = new Set(['already_completed', 'in_progress_elsewhere', 'owned_by_other']);

function _outcomeDe(data) {
  if (Array.isArray(data)) return data[0] || null;
  if (data && typeof data === 'object') return data;
  return null;
}

function decideClaim({ enabled = false, waMessageId = null, outcome = null, error = null,
                       operationId = null, leaseToken = null } = {}) {
  const base = { operationId, leaseToken };
  if (!enabled) return { ...base, proceed: true, skip: false, reason: 'flag_off', degraded: false };
  if (!waMessageId) return { ...base, proceed: true, skip: false, reason: 'no_wa_id', degraded: false };
  if (error) {
    const detail = (error && (error.message || error.details)) || String(error);
    return { ...base, proceed: true, skip: false, reason: 'db_error', degraded: true,
             detail: String(detail).slice(0, 120) };
  }
  if (!outcome) return { ...base, proceed: true, skip: false, reason: 'no_outcome', degraded: true };
  if (RECIBOS_QUE_CALAM.has(outcome)) {
    return { ...base, proceed: false, skip: true, reason: outcome, degraded: false };
  }
  // claimed / resumed são o caminho normal; invalid e desconhecidos caem aqui de
  // propósito — nunca calar por recibo que não sabemos ler.
  const normal = outcome === 'claimed' || outcome === 'resumed';
  return { ...base, proceed: true, skip: false, reason: outcome, degraded: !normal };
}

async function claimInbound({ supabase, enabled = false, waMessageId = null, phone = null,
                              collaboratorId = null, conversationKey = null, quotedId = null,
                              leaseSeconds = 300 } = {}) {
  if (!enabled) return decideClaim({ enabled: false, waMessageId });
  if (!waMessageId) return decideClaim({ enabled: true, waMessageId: null });

  let row = null;
  let error = null;
  try {
    const res = await supabase.rpc('tom_route_claim_inbound', {
      p_wa_message_id: waMessageId,
      p_owner: 'v1',
      p_phone: phone || null,
      p_collaborator: collaboratorId || null,
      p_conversation: conversationKey || phone || null,
      p_quoted: quotedId || null,
      p_lease_seconds: leaseSeconds,
    });
    if (res && res.error) error = res.error;
    else row = _outcomeDe(res && res.data);
  } catch (e) {
    error = e;
  }
  return decideClaim({
    enabled: true, waMessageId, error,
    outcome: row && row.outcome,
    operationId: row && row.operation_id,
    leaseToken: row && row.lease_token,
  });
}

// Fecha o claim. Roda em `finally`: nunca lança, e um erro aqui não altera o que já foi
// respondido — só deixa a linha vencer por lease em vez de fechar limpo.
async function finishInbound({ supabase, enabled = false, waMessageId = null, leaseToken = null,
                               status = 'completed', reason = null } = {}) {
  if (!enabled) return { ok: false, code: 'flag_off' };
  if (!waMessageId) return { ok: false, code: 'no_wa_id' };
  // Sem token este processo não é o dono: não há claim vencedor para fechar.
  if (!leaseToken) return { ok: false, code: 'no_lease' };
  try {
    const res = await supabase.rpc('tom_route_finish_inbound', {
      p_wa_message_id: waMessageId,
      p_owner: 'v1',
      p_status: status,
      // p_error, NÃO p_reason: escrevi p_reason, o teste com dublê aceitou, e só a
      // produção reclamou ("Could not find the function"). scripts/verificar-rpc-params.js
      // passou a conferir isso contra pg_proc.
      p_error: reason || null,
      p_lease_token: leaseToken,
    });
    if (res && res.error) return { ok: false, code: 'db_error', detail: String(res.error.message || '').slice(0, 120) };
    const row = _outcomeDe(res && res.data);
    if (!row) return { ok: false, code: 'no_outcome' };
    return row.ok === true ? { ok: true, code: 'ok' } : { ok: false, code: row.reason || 'recusado' };
  } catch (e) {
    return { ok: false, code: 'db_error', detail: String(e.message || e).slice(0, 120) };
  }
}

module.exports = { decideClaim, claimInbound, finishInbound, RECIBOS_QUE_CALAM };
