'use strict';

// F5 (ALVO-FUTURO-RESPOSTA-CURTA, auditoria 09/06): concluir item DATADO NO FUTURO
// exige confirmação. Caso real (Ana): "Reunião ok tbm" → LLM completou a "Reunião ADM"
// de AMANHÃ em vez da Governança de hoje. Função PURA — o engine decide o que fazer.
//
// Regra: dia do item (em America/Sao_Paulo) > dia de hoje (BRT) → é futuro.
// due_date date-only ("2026-06-10") compara como string; timestamp converte pro dia BRT
// (cuidado clássico: 01:00Z de 11/06 ainda é 22:00 BRT de 10/06 — NÃO é futuro no dia 10).

const TZ = 'America/Sao_Paulo';

function brtDay(value, tz = TZ) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // date-only já é "dia civil"
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
}

/**
 * @param {{dueDate?: string|null, startAt?: string|null, now?: Date, tz?: string}} p
 * @returns {boolean} true se o item está datado pra DEPOIS de hoje (BRT)
 */
function isFutureCompletion({ dueDate = null, startAt = null, now = new Date(), tz = TZ } = {}) {
  const day = brtDay(dueDate, tz) || brtDay(startAt, tz);
  if (!day) return false; // sem data → nunca bloqueia
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: tz });
  return day > today;
}

module.exports = { isFutureCompletion, _brtDay: brtDay };
