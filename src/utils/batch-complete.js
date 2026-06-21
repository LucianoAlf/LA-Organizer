// src/utils/batch-complete.js
// ──────────────────────────────────────────────────────────────────────
// BATCH-COMPLETE-CONFIRM-NOOP (Fabi 20/06) — executor determinístico do
// fechamento em LOTE confirmado.
//
// A intent {batch_complete:[short_ids]} (aberta em applyTaskActions A2 do
// engine, caminho CLOSING-INTERCEPTOR-OVERCAPTURE) era resolvida 'confirmed'
// mas NUNCA executava: o payload não tem `anchor` (pula o executor de 1
// tarefa, engine.js consumidor da confirmação) e `batch_complete` não está
// na lista do `hasConcrete` (o branch do LLM, por desenho do RECUR-TEMPLATE-DUP,
// proíbe emitir marker quando o payload não tem item concreto). Resultado: o
// TOM dizia "fechamento de lote confirmado" e as tarefas ficavam `pending`
// (família AUDIT-OPTIMISTIC-CONFIRM invertida — fala ≠ persistência).
//
// Este helper espelha o executor ancorado (complete direto na tabela, sem LLM):
// robusto sob fallback de provider. resolveTaskByShortId escopa por colaborador
// (assigned_to + pool dos grupos do remetente) → concluir tarefa de outro é
// impossível. Por concluir DIRETO e o caller retornar cedo, NÃO passa pelo
// branch do LLM → o gate `hasConcrete` fica intacto → RECUR-TEMPLATE-DUP não
// regride.

/**
 * Conclui em lote as tarefas referenciadas por short-id, restrito ao colaborador.
 * @param {object}   args
 * @param {object}   args.supabase                client supabase (service_role no engine)
 * @param {function} args.resolveTaskByShortId    (collaboratorId, shortId) => task|null  (escopo por dono)
 * @param {string}   args.collaboratorId          dono da confirmação (nunca vem do marker)
 * @param {string[]} args.ids                     short-ids do payload.batch_complete
 * @param {string}   [args.now]                   ISO timestamp (injetável p/ teste)
 * @returns {Promise<{okCount:number, okTitles:string[], total:number}>}
 */
async function executeBatchComplete({ supabase, resolveTaskByShortId, collaboratorId, ids, now }) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  const ts = now || new Date().toISOString();
  let okCount = 0;
  const okTitles = [];
  for (const sid of list) {
    let t = null;
    try {
      t = await resolveTaskByShortId(collaboratorId, sid);
    } catch (e) {
      t = null; // resolução falhou → trata como não-encontrado (não derruba o lote)
    }
    if (!t || !t.id) continue; // short-id stale / não pertence ao colaborador
    const { error } = await supabase
      .from('tasks')
      .update({ status: 'done', completed_at: ts, completed_by: collaboratorId })
      .eq('id', t.id);
    if (!error) {
      okCount++;
      if (t.title) okTitles.push(t.title);
    }
  }
  return { okCount, okTitles, total: list.length };
}

module.exports = { executeBatchComplete };
