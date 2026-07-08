'use strict';
// snooze-fields.js — normaliza o campo de "piso" (not_before) do snooze_reminders.
//
// Audit 08/07 (Matheus B): o LLM emite o snooze com "until"/"snooze_until" em vez de
// "not_before" → o validador rejeitava (snooze_needs_not_before_or_clear_all) e o
// "não me cobra até segunda" não persistia. Log de prova (07/07 21:00): TASK_UPDATE
// REJECTED snooze_needs_not_before raw={"action":"snooze_reminders","until":"2026-07-13..."}.
// Mesma família dos aliases já tolerados no engine (recipient/to/name; message/body/content).
//
// Retorna a STRING do piso (não valida formato — quem valida é isValidRemindAt no engine),
// ou undefined se nenhum alias veio. `not_before` tem precedência.
function snoozeNotBefore(a) {
  if (!a || typeof a !== 'object') return undefined;
  if (typeof a.not_before === 'string' && a.not_before) return a.not_before;
  if (typeof a.until === 'string' && a.until) return a.until;
  if (typeof a.snooze_until === 'string' && a.snooze_until) return a.snooze_until;
  return undefined;
}

module.exports = { snoozeNotBefore };
