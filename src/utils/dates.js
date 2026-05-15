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

module.exports = { safeIsoDate, safeDate };
