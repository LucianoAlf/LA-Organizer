// src/services/event-reminders.js
// Sprint 31.x — helper puro p/ editar o lembrete de um EVENTO via EVENT_UPDATE.
// Espelha a validação do caminho de CRIAÇÃO (engine.js applyEventActions): minutos
// antes do início, 0..30 dias, calculando remind_at = start_at − mins.
// Usado pelo handler `update` do applyEventUpdates pra substituir os lembretes
// não-enviados pelo novo conjunto. [] = remover. Caso Rose/ADM 09/06 (evento 6778d729).

const MAX_REMINDER_MIN = 60 * 24 * 30; // 30 dias — mesmo teto do CREATE

/**
 * Computa as linhas event_reminders a partir do start_at do evento e dos minutos-antes.
 * @param {string} eventId — id do evento (FK event_reminders.event_id)
 * @param {string} startIso — start_at do evento (ISO)
 * @param {Array<number>} minutesArr — minutos antes do início (ex.: [15, 60, 1440]); [] = nenhum
 * @returns {Array<{event_id:string, remind_at:string}>}
 */
function buildEventReminderRows(eventId, startIso, minutesArr) {
  const rows = [];
  if (!eventId || !Array.isArray(minutesArr)) return rows;
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return rows;
  for (const m of minutesArr) {
    const mins = Number(m);
    if (!Number.isFinite(mins) || mins < 0 || mins > MAX_REMINDER_MIN) continue;
    rows.push({ event_id: eventId, remind_at: new Date(startMs - mins * 60_000).toISOString() });
  }
  return rows;
}

module.exports = { buildEventReminderRows, MAX_REMINDER_MIN };
