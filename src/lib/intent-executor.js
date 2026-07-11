'use strict';

// INTENT-CLOBBER-BATCH-COMPLETE (Fabi 30/06) — predicado PURO.
//
// Uma intent de confirmação "carrega um EXECUTOR DETERMINÍSTICO" quando o payload
// tem `anchor` (guarda temporal → complete ancorado, engine consumidor de 1 tarefa)
// OU `batch_complete` (fechamento em lote não-ancorado do A2 → executeBatchComplete).
//
// Por que importa: o registrador genérico de fim-de-turno (engine ~11894) abre uma
// intent `confirmation` genérica {last_user_text,last_tom_reply} sempre que a reply
// do TOM termina numa pergunta de confirmação. `openIntent` faz supersede same-kind,
// então essa genérica MATA a intent com executor 0,2s depois de criada. Aí o "Sim"
// seguinte não acha mais o `batch_complete`/`anchor` → cai no LLM → o LLM narra
// "✅ fechei", nada persiste, e o chokepoint reescreve pra "não consegui registrar,
// me manda de novo" — MENTIRA quando a tarefa já está feita (caso Fabi: as 2 tarefas
// estavam `done`, mas o TOM disse que falhou). Já existia guarda pra `anchor`
// (hasFreshAnchoredIntent, GUARD-CONFIRM-LOOP 10/06); faltava `batch_complete`.
function intentCarriesDeterministicExecutor(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const hasAnchor = payload.anchor != null;
  const hasBatch = Array.isArray(payload.batch_complete) && payload.batch_complete.length > 0;
  // COORD-CONFIRM-INTENT-CLOBBER (Fabi 11/07): a rede de coordenação estagia
  // {coordination:{items}} e executa no "sim" via applyCoordinationRequestAction — mesmo
  // tipo de executor determinístico. Sem cobri-lo aqui, o registrador genérico de fim-de-turno
  // superseçava o intent coord ~0,3s depois → o "sim" caía no LLM → re-estagiava → LOOP
  // (caso Fabi 11/07: "Confirma/Confirmo/Sim avisa" re-perguntava "Aviso o Luciano? Confirma?").
  const hasCoord = payload.coordination
    && Array.isArray(payload.coordination.items) && payload.coordination.items.length > 0;
  return !!(hasAnchor || hasBatch || hasCoord);
}

module.exports = { intentCarriesDeterministicExecutor };
