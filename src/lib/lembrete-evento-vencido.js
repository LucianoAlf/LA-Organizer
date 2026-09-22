// src/lib/lembrete-evento-vencido.js
// Caso Ana Paula 21/09 00:00 BRT: dois "📅 Lembrete: (15min antes) Marcar presenças
// do horário" chegaram à meia-noite de segunda, sobre eventos de SÁBADO 19/09 13:00 e
// DOMINGO 20/09 13:00. Ela tem folga no fim de semana — o ramo quiet_day do
// checkEventReminders faz `continue` SEM consumir sent_at, e a query não tem piso
// inferior de remind_at. A fila inteira do fim de semana era liberada no instante em
// que o dia virava, 11h e 35h atrasada, com a etiqueta "(15min antes)" já mentirosa.
//
// buildEventReminderRows (services/event-reminders.js) garante remind_at = start_at −
// minutos, ou seja remind_at <= start_at SEMPRE: lembrete de evento é alerta PRÉ-evento
// por construção. Logo, se o evento já começou, não há mais alerta a dar — a linha é
// consumida em silêncio. A folga absorve o tick do cron e o lembrete "na hora" (mins=0).

const TOLERANCIA_MIN = 5;

/**
 * O lembrete ainda vale a pena ser enviado agora?
 * @param {string} startIso — start_at do evento
 * @param {number|Date} now — instante do disparo
 * @returns {{vencido: boolean, atrasoMin: number|null}}
 */
function lembreteDeEventoVencido(startIso, now) {
  const startMs = Date.parse(startIso);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return { vencido: false, atrasoMin: null };
  const atrasoMin = Math.round((nowMs - startMs) / 60_000);
  return { vencido: atrasoMin > TOLERANCIA_MIN, atrasoMin };
}

module.exports = { lembreteDeEventoVencido, TOLERANCIA_MIN };
