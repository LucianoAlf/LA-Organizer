'use strict';
// Fila de envio DURÁVEL — anti-ban WhatsApp (02/07). Fan-out em rajada (N sendMessage
// quase simultâneos) é gatilho de restrição/ban do número. Esta fila espaça os envios
// com jitter e persiste no banco (sobrevive a restart do pm2). Espelha o padrão já provado
// no broadcaster de announcements (dispatcher.js), mas genérico (convites, avisos de reschedule).
//
// planSchedule é PURO (rng injetável) → testável de forma determinística.

// Offsets (ms) escalonados a partir de agora. jitter mapeia rng∈[0,1) → [-jitterMs, +jitterMs].
// Clamp ≥0 e MONOTÔNICO: nunca deixa a msg i+1 sair antes da i, mesmo com jitter negativo.
function planSchedule(count, { baseGapMs = 30000, jitterMs = 8000, rng = Math.random } = {}) {
  const out = [];
  let prev = 0;
  for (let i = 0; i < count; i++) {
    const jitter = Math.round((rng() * 2 - 1) * jitterMs);
    let t = i * baseGapMs + jitter;
    if (t < 0) t = 0;
    if (t < prev) t = prev;
    out.push(t);
    prev = t;
  }
  return out;
}

// Insere N linhas em outbound_queue com scheduled_at escalonado. rows = [{phone, body, meta}].
// I/O fino (o dreno no dispatcher envia depois). Nunca lança — loga e devolve inserted:0 em erro.
async function enqueueOutbound(supabase, rows, opts = {}) {
  const list = (rows || []).filter((r) => r && r.phone && r.body);
  if (!list.length) return { inserted: 0 };
  const offsets = planSchedule(list.length, opts);
  const start = opts.startAt || Date.now();
  const payload = list.map((r, i) => ({
    phone: r.phone,
    body: r.body,
    meta: r.meta || {},
    scheduled_at: new Date(start + offsets[i]).toISOString(),
  }));
  const { error } = await supabase.from('outbound_queue').insert(payload);
  if (error) {
    console.error('[OutboundQueue] enqueue err:', error.message);
    return { inserted: 0, error };
  }
  return { inserted: payload.length };
}

module.exports = { planSchedule, enqueueOutbound };
