// src/rituals/pre-1on1-watcher.js — Sprint 29.2
//
// Roda a cada 5min via dispatcher.run().
// Varre events nos próximos 30-35min com related_to_collaborator_id set,
// gera buildLeaderBriefing pro director (quem agendou) e envia WhatsApp.
//
// Janela 30-35min: garante que SEMPRE acerta o slot (dispatcher tick é 5min,
// então 30min antes pode cair em qualquer ponto da janela 30..35).
// Idempotência: ritual_logs com idempotency_key=pre_1on1_briefing_{event_id}.

const supabase = require('../supabase/client');
const whatsapp = require('../services/whatsapp');
const { buildLeaderBriefing } = require('../services/leader-briefing');

const BRIEFING_KEY_PREFIX = 'pre_1on1_briefing';
const WINDOW_START_MIN = 25;  // pega quem começa em 25min
const WINDOW_END_MIN = 35;    // até 35min (folga pra tick não escapar)

async function tick(opts = {}) {
  const now = opts.now || new Date();
  const windowStart = new Date(now.getTime() + WINDOW_START_MIN * 60000).toISOString();
  const windowEnd   = new Date(now.getTime() + WINDOW_END_MIN * 60000).toISOString();

  const { data: upcoming, error: qErr } = await supabase
    .from('events')
    .select('id, title, start_at, end_at, related_to_collaborator_id, created_by, collaborator_id, data_classification')
    .gte('start_at', windowStart)
    .lt('start_at', windowEnd)
    .not('related_to_collaborator_id', 'is', null)
    .eq('data_classification', 'real')
    .neq('status', 'cancelled')
    .limit(20);

  if (qErr) {
    console.error('[Pre1on1] query err:', qErr.message);
    return { ok: false, error: qErr.message };
  }
  if (!upcoming || upcoming.length === 0) return { ok: true, processed: 0 };

  let sent = 0, skipped = 0, errors = 0;
  for (const ev of upcoming) {
    const idempotencyKey = `${BRIEFING_KEY_PREFIX}_${ev.id}`;

    // Checa idempotência (não enviar 2x pro mesmo evento)
    const { data: existing } = await supabase
      .from('ritual_logs')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing) { skipped++; continue; }

    // Destinatário do briefing = quem criou o evento (director)
    // Fallback: dono da agenda (collaborator_id)
    const recipientId = ev.created_by || ev.collaborator_id;
    if (!recipientId) { skipped++; continue; }

    const { data: recipient } = await supabase
      .from('collaborators')
      .select('id, full_name, phone, role')
      .eq('id', recipientId)
      .maybeSingle();
    if (!recipient?.phone) { skipped++; continue; }

    try {
      const briefing = await buildLeaderBriefing(ev.related_to_collaborator_id);
      if (!briefing) { skipped++; continue; }

      await whatsapp.sendMessage(recipient.phone, briefing);
      await supabase.from('ritual_logs').insert({
        collaborator_id: recipient.id,
        ritual_type: 'pre_1on1_briefing',
        status: 'sent',
        idempotency_key: idempotencyKey,
        notes: `event=${String(ev.id).slice(0,8)} leader=${String(ev.related_to_collaborator_id).slice(0,8)}`,
      });
      sent++;
      console.log(`[Pre1on1] sent briefing event=${String(ev.id).slice(0,8)} leader=${String(ev.related_to_collaborator_id).slice(0,8)} → ${recipient.full_name}`);
    } catch (err) {
      errors++;
      console.error(`[Pre1on1] err event=${String(ev.id).slice(0,8)}:`, err.message);
    }
  }

  return { ok: true, processed: upcoming.length, sent, skipped, errors };
}

module.exports = { tick };
