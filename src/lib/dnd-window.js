'use strict';

// PREFS-DND-ROUTE (26/06) — validação compartilhada da janela de "não perturbar" (DND).
// Extraída de parseDndMarker (engine) pra ser REUSADA por: (a) o próprio parseDndMarker,
// (b) applyDnd (cap no SINK — defense-in-depth, trava A do revisor), (c) o parser do
// PREFS_UPDATE que rota do_not_disturb_until pro DND em vez de dropar.
// Cap de 24h é estrutural aqui: "pausado até julho" vira impossível independente do caller.

const DND_MAX_MS = 24 * 60 * 60 * 1000;
const ISO_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// validateDndWindow(until, reason, nowMs?) →
//   { ok:true, until, reason, capped } | { ok:false, code }
// codes (espelham os logSchemaErr do parseDndMarker): bad_iso | unparseable | not_future
function validateDndWindow(until, reason, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (typeof until !== 'string' || !ISO_PREFIX_RE.test(until)) return { ok: false, code: 'bad_iso' };
  const untilMs = Date.parse(until);
  if (Number.isNaN(untilMs)) return { ok: false, code: 'unparseable' };
  if (untilMs <= now + 60_000) return { ok: false, code: 'not_future' };
  let untilFinal = until;
  let capped = false;
  if (untilMs - now > DND_MAX_MS) {
    untilFinal = new Date(now + DND_MAX_MS).toISOString();
    capped = true;
  }
  const r = typeof reason === 'string' ? reason.trim().slice(0, 80) : null;
  return { ok: true, until: untilFinal, reason: r, capped };
}

module.exports = { validateDndWindow, DND_MAX_MS };
