// src/services/recurrence-time.js
// Utilitário puro para cálculo de remind_at em recorrências.
// Sem dependências externas — seguro para testes unitários isolados.

/**
 * Calcula o remind_at de uma instância preservando o delta entre o remind_at
 * do template e a meia-noite BRT do due_date do template. Brasil não tem DST,
 * então o delta reproduz o mesmo HH:MM local em qualquer dia.
 *
 * @param {string} templateDueDateYmd  — ex: '2026-06-01'
 * @param {string} templateRemindIso   — ex: '2026-06-01T13:00:00-03:00'
 * @param {string} instanceDueDateYmd  — ex: '2026-06-15'
 * @returns {string} ISO UTC do novo remind_at
 */
function shiftReminderToInstance(templateDueDateYmd, templateRemindIso, instanceDueDateYmd) {
  const tplAnchor = new Date(`${templateDueDateYmd}T00:00:00-03:00`);
  const instAnchor = new Date(`${instanceDueDateYmd}T00:00:00-03:00`);
  const delta = new Date(templateRemindIso).getTime() - tplAnchor.getTime();
  return new Date(instAnchor.getTime() + delta).toISOString();
}

module.exports = { shiftReminderToInstance };
