// src/utils/dates.js — Helpers de data resilientes a input ruim.
//
// Por que existe: `new Date(x).toISOString()` joga RangeError("Invalid time
// value") quando x não parseia. Em runtime, isso virava "[Queue] task err
// for XXXX: Invalid time value" sem stack — bug silencioso por mensagem.
// Esses helpers retornam null em vez de jogar.

function safeIsoDate(input) {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function safeDate(input) {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Sprint 28 — Anotação de data relativa pra TOM nunca recalcular dias.
 * Recebe due_date (YYYY-MM-DD em BRT) e today (mesmo formato).
 * Retorna string tipo:
 *   "26/05 ter (HOJE)" | "27/05 qua (amanhã)" | "28/05 qui (em 2d)"
 *   "24/05 sáb (ATRASADA -2d)"
 *   "" se input inválido
 *
 * Filosofia: TOM lê o rótulo pronto. Zero aritmética mental.
 */
const _WEEKDAY_ABBR = ['dom','seg','ter','qua','qui','sex','sáb'];

function formatRelativeDate(dueDate, todayISO) {
  if (!dueDate || typeof dueDate !== 'string') return '';
  const dueYMD = dueDate.slice(0, 10);
  const todayYMD = (todayISO || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueYMD) || !/^\d{4}-\d{2}-\d{2}$/.test(todayYMD)) return '';
  const dueD = new Date(dueYMD + 'T12:00:00.000Z');
  const todayD = new Date(todayYMD + 'T12:00:00.000Z');
  if (isNaN(dueD.getTime()) || isNaN(todayD.getTime())) return '';
  const diffDays = Math.round((dueD.getTime() - todayD.getTime()) / 86400000);
  const dd = String(dueD.getUTCDate()).padStart(2, '0');
  const mm = String(dueD.getUTCMonth() + 1).padStart(2, '0');
  const wd = _WEEKDAY_ABBR[dueD.getUTCDay()];
  let rel;
  if (diffDays === 0) rel = 'HOJE';
  else if (diffDays === 1) rel = 'amanhã';
  else if (diffDays === -1) rel = 'ATRASADA -1d';
  else if (diffDays < 0) rel = `ATRASADA ${diffDays}d`;
  else rel = `em ${diffDays}d`;
  return `${dd}/${mm} ${wd} (${rel})`;
}

module.exports = { safeIsoDate, safeDate, formatRelativeDate };
