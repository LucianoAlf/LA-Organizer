'use strict';
// Balde A (audit 19/06) — dedup de tarefas recorrentes para listas que o usuário vê
// (check-in, briefing, fechamento). Causa-raiz: o materializador pré-cria ~22 instâncias
// (horizonte 30d) e os rituais listavam cada instância como um bullet → "a mesma tarefa 8x".
// Prova read-only na Gabi ("Renovação"): 6 linhas → 1 com este dedup por série.
//
// Regra (função PURA, sem I/O):
//  - molde (recurrence_rule != null && recurrence_parent_id == null) NUNCA é ocorrência
//    exibível → removido;
//  - instâncias com o mesmo recurrence_parent_id colapsam em UMA — a PRIMEIRA na ordem
//    recebida (as queries já vêm ordenadas por due_date asc → a mais próxima);
//  - não-recorrentes (recurrence_parent_id == null e sem recurrence_rule) passam intactas,
//    ordem preservada.

/** É o molde da série (não uma ocorrência)? */
function isRecurrenceTemplate(t) {
  return !!(t && t.recurrence_rule != null && t.recurrence_parent_id == null);
}

/**
 * @param {Array<object>} tasks linhas de tarefa (com recurrence_parent_id, recurrence_rule)
 * @returns {Array<object>} lista deduplicada, ordem preservada
 */
function dedupRecurringSeries(tasks) {
  if (!Array.isArray(tasks)) return [];
  const seenSeries = new Set();
  const out = [];
  for (const t of tasks) {
    if (!t) continue;
    if (isRecurrenceTemplate(t)) continue; // molde fora
    const key = t.recurrence_parent_id;
    if (key == null) {
      out.push(t); // não-recorrente: passa
      continue;
    }
    if (seenSeries.has(key)) continue; // 2ª+ instância da série: descarta
    seenSeries.add(key);
    out.push(t); // 1ª instância da série (a mais próxima): mantém
  }
  return out;
}

module.exports = { dedupRecurringSeries, isRecurrenceTemplate };
