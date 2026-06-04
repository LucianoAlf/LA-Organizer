// src/services/reschedule-reminders.js
// Sprint 31.12 — ao REAGENDAR um evento, os lembretes (event_reminders) não-enviados
// precisam acompanhar o novo horário. Função PURA: desloca cada remind_at pelo MESMO
// delta (new_start - old_start), preservando o offset original (T-15min continua
// T-15min do novo horário). Caso Matheus/Bia 03/06: o reschedule mudava só o start_at
// e o lembrete velho disparava no horário antigo (cobrança fantasma "hoje").

'use strict';

/**
 * @param {Array<{id:string, remind_at:string}>} reminders — lembretes não-enviados
 * @param {string} oldStartIso — start_at ANTES do reschedule
 * @param {string} newStartIso — start_at DEPOIS do reschedule
 * @returns {Array<{id:string, remind_at:string}>} novos remind_at (ISO UTC), vazio se nada a fazer
 */
function shiftRemindersByReschedule(reminders, oldStartIso, newStartIso) {
  const oldMs = Date.parse(oldStartIso);
  const newMs = Date.parse(newStartIso);
  if (!Number.isFinite(oldMs) || !Number.isFinite(newMs)) return [];
  const delta = newMs - oldMs;
  if (delta === 0) return [];
  const out = [];
  for (const r of (reminders || [])) {
    const rm = Date.parse(r && r.remind_at);
    if (!Number.isFinite(rm)) continue;
    out.push({ id: r.id, remind_at: new Date(rm + delta).toISOString() });
  }
  return out;
}

module.exports = { shiftRemindersByReschedule };
