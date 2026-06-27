'use strict';

// CONFAB-INVERSO-AUTORETRY-DUP (27/06) — classifica o resultado de applyTaskActions no
// AUTO-RETRY pós-resposta (engine ~11441). Caso Ana 26/06: "Pode ser" (ack de algo já
// feito) → LLM sem marker → ACTIONABLE_NO_MARKER → o auto-retry emite um `create` da tarefa
// que JÁ EXISTE → applyTaskActions rejeita como dup semântica → all_failed:1 →
// auto_retry_succeeded=false → nothingPersisted=true → o chokepoint rebaixa "tá fechado"
// pra "não consegui registrar" (MENTIRA — tava registrada). Mesma família do
// FIN-CONFAB-INVERSO-MARKER-EMITTED (24/06): estado real existe, a métrica não reflete.
//
// dup_task = a tarefa que o retry tentou criar JÁ EXISTE (o detector só marca `probable`
// com score>=0.85 + keyword overlap — Sprint 23.5/22.3) → estado desejado PRESENTE → conta
// como PERSISTIDO. SÓ dup prova existência: qualquer outra falha (sem payload / temporal /
// permissão / sem match) segue rejeitando → o chokepoint continua pegando confab de verdade.
function classifyAutoRetry(retryResult) {
  const r = retryResult || {};
  const ok = r.okCount || 0;
  const fail = r.failCount || 0;
  if (ok > 0) {
    return { persisted: true, status: fail > 0 ? 'partial' : 'executed', reason: `ok=${ok} fail=${fail}` };
  }
  if (r.integrityPayload && r.integrityPayload.type === 'dup_task') {
    const c = r.integrityPayload.conflicts && r.integrityPayload.conflicts[0];
    const score = Number((c && c._score) || 0).toFixed(2);
    return { persisted: true, status: 'skipped', reason: `already_exists:dup(${score})` };
  }
  return { persisted: false, status: 'rejected', reason: `all_failed:${fail}` };
}

module.exports = { classifyAutoRetry };
