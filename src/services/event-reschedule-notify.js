'use strict';
// EVENT-APP-RESCHEDULE-NO-RENOTIFY — fonte única do fan-out de "reunião remarcada".
//
// Extraído de engine.js (handler EVENT_UPDATE reschedule, ~3522-3549) pra ser reusado por:
//   (a) o próprio handler do engine (caminho TOM), e
//   (b) o endpoint /internal/event-rescheduled (caminho APP/PWA — audit John 17/08: reagendar no
//       app não avisava os participantes, só o TOM avisava).
// Regra: avisa invited/confirmed/tentative, EXCLUI quem remarcou (actorId) e inativo/sem telefone;
// SÓ informa (não mexe em RSVP). Mensagem/queue idênticas às do engine → app e TOM não divergem.

const ELEGIVEIS = new Set(['invited', 'confirmed', 'tentative']);

// PURA: monta as linhas de outbound. Testável sem I/O.
// { eventId, title, senderName, whenStr, actorId, participants:[{collaborator_id,status}],
//   collaborators:[{id,phone,is_active}] } -> [{ phone, body, meta }]
function buildRescheduleNotices({ eventId, title, senderName, whenStr, actorId, participants, collaborators }) {
  const parts = (Array.isArray(participants) ? participants : []).filter(
    (p) => p && ELEGIVEIS.has(p.status) && p.collaborator_id && p.collaborator_id !== actorId,
  );
  if (!parts.length) return [];
  const byId = new Map((Array.isArray(collaborators) ? collaborators : []).map((c) => [c && c.id, c]));
  const rows = [];
  for (const p of parts) {
    const c = byId.get(p.collaborator_id);
    if (!c || !c.phone || c.is_active === false) continue;
    const body = `📅 A reunião *${title}* foi remarcada por *${senderName}*: agora *${whenStr}*.`;
    rows.push({ phone: c.phone, body, meta: { collaborator_id: c.id, kind: 'event_reschedule', event_id: eventId, sender_name: senderName } });
  }
  return rows;
}

// I/O: busca participantes + colaboradores + nome do ator, formata o horário, enfileira (fila
// durável anti-ban). newStartIso opcional — se ausente, usa event.start_at (o app já persistiu).
// Retorna { enqueued }. Nunca lança (best-effort, igual ao engine).
async function notifyEventReschedule(supabase, { event, actorId, newStartIso }) {
  try {
    if (!event || !event.id) return { enqueued: 0 };
    const { enqueueOutbound } = require('../lib/outbound-queue');
    const { data: parts } = await supabase
      .from('event_participants')
      .select('collaborator_id, status')
      .eq('event_id', event.id)
      .in('status', ['invited', 'confirmed', 'tentative']);
    const ids = (parts || []).map((p) => p.collaborator_id).filter((id) => id && id !== actorId);
    if (!ids.length) return { enqueued: 0 };
    const { data: cols } = await supabase
      .from('collaborators').select('id, phone, is_active').in('id', ids);
    let senderName = 'Alguém';
    if (actorId) {
      const { data: actor } = await supabase
        .from('collaborators').select('full_name, preferred_name').eq('id', actorId).maybeSingle();
      if (actor) senderName = String(actor.preferred_name || actor.full_name || 'Alguém').split(' ')[0];
    }
    const iso = newStartIso || event.start_at;
    const whenStr = (() => {
      try {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? String(iso)
          : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
      } catch { return String(iso); }
    })();
    const rows = buildRescheduleNotices({
      eventId: event.id, title: event.title, senderName, whenStr, actorId,
      participants: parts || [], collaborators: cols || [],
    });
    if (rows.length) {
      await enqueueOutbound(supabase, rows, {});
      console.log(`[Event] reschedule fan-out (svc): ${rows.length} avisos enfileirados p/ ${String(event.id).slice(0, 8)}`);
    }
    return { enqueued: rows.length };
  } catch (e) {
    console.warn('[Event] notifyEventReschedule falhou (não-fatal):', e.message);
    return { enqueued: 0 };
  }
}

module.exports = { buildRescheduleNotices, notifyEventReschedule };
