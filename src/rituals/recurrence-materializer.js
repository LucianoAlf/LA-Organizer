// src/rituals/recurrence-materializer.js — Sprint 29.4
//
// Roda 1x/dia 00:30 BRT. Idempotente: pode rodar várias vezes no mesmo dia
// sem efeito colateral (materializeSeries dedupe por dia).
//
// Disparado pelo dispatcher.run() — não precisa cron próprio.

const { materializeAll } = require('../services/recurrence-engine');

async function tick(opts = {}) {
  // opts.force=true pula gate de horário (útil pra teste manual)
  const now = opts.now || new Date();
  if (!opts.force) {
    // Roda só 1x/dia entre 00:30-00:44 BRT (UTC-3 → 03:30-03:44 UTC)
    const utcHour = now.getUTCHours();
    const utcMin = now.getUTCMinutes();
    const isWindow = utcHour === 3 && utcMin >= 30 && utcMin < 45;
    if (!isWindow) return { skipped: 'out_of_window', utc: `${utcHour}:${utcMin}` };
  }
  try {
    const totals = await materializeAll();
    return { ok: true, ...totals };
  } catch (err) {
    console.error('[recurrence-materializer] err:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { tick };
