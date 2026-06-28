'use strict';
// AUDIT-CHECK9-PENDING (28/06) — CHECK 9 do health-check (checkEventsWithoutReminders) sinalizava
// "evento sem lembrete" contando event_reminders TOTAL (incluía sent_at != null) → CEGO a evento
// futuro cuja única row já DISPAROU (reschedule-orphan da família EVENT-RESCHED-REMINDER-*). Regra
// PURA: sinaliza só quando 0 PENDENTE (o caller conta sent_at IS NULL) E o start está > minLeadHours
// à frente — assim um lembrete legítimo já enviado no MESMO dia (morning-of/T-15) não vira FP.
// O caller (health-check) deve excluir templates de recorrência e data_classification != real da
// query (espelha a visibilidade do PWA) — aqui é só a regra de decisão, sem I/O.

/**
 * @param {Array<{title:string, start_at:string, pendingCount:number}>} events
 * @param {number} nowMs — Date.now() do caller (injetado p/ pureza/teste)
 * @param {{minLeadHours?:number}} [opts] — lead mínimo (default 24h) p/ evitar FP de lembrete do dia
 * @returns {string[]} títulos dos eventos sem lembrete pendente E com start futuro o bastante
 */
function selectEventsWithoutReminder(events, nowMs, { minLeadHours = 24 } = {}) {
  const cutoff = nowMs + minLeadHours * 3600_000;
  const out = [];
  for (const ev of (events || [])) {
    if (!ev) continue;
    const startMs = Date.parse(ev.start_at);
    if (!Number.isFinite(startMs)) continue; // defensivo — start inválido não flagueia
    if ((ev.pendingCount || 0) === 0 && startMs > cutoff) out.push(ev.title);
  }
  return out;
}

module.exports = { selectEventsWithoutReminder };
