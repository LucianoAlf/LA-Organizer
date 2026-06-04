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

/**
 * Sprint 31.13 (Yuri/Kinho 30/05) — versão TAREFA do shift acima.
 * Uma task tem UM `remind_at` (timestamp) e um `due_date` (date-only). Ao REAGENDAR
 * sem informar um lembrete novo, o `remind_at` antigo ficava congelado no passado —
 * o cron de lembrete (`checkReminders`) disparava no horário velho e, pior, marcava a
 * task como done (one-shot). Aqui deslocamos o `remind_at` pelo MESMO número de DIAS
 * que o due_date andou, preservando o horário do dia escolhido pelo usuário.
 *
 * @param {string} oldDueDate — due_date ANTES (YYYY-MM-DD) ou null
 * @param {string} newDueDate — due_date DEPOIS (YYYY-MM-DD)
 * @param {string} remindAtIso — remind_at atual (ISO) ou null
 * @returns {string|null} novo remind_at (ISO UTC), ou null se não há o que deslocar
 */
function shiftTaskRemindAt(oldDueDate, newDueDate, remindAtIso) {
  if (!oldDueDate || !newDueDate || !remindAtIso) return null;
  // Datas date-only viram meia-noite UTC — delta em dias inteiros é exato.
  const oldMs = Date.parse(`${oldDueDate}T00:00:00Z`);
  const newMs = Date.parse(`${newDueDate}T00:00:00Z`);
  const remMs = Date.parse(remindAtIso);
  if (!Number.isFinite(oldMs) || !Number.isFinite(newMs) || !Number.isFinite(remMs)) return null;
  const deltaDays = Math.round((newMs - oldMs) / 86400000);
  if (deltaDays === 0) return null;
  return new Date(remMs + deltaDays * 86400000).toISOString();
}

module.exports = { shiftRemindersByReschedule, shiftTaskRemindAt };
