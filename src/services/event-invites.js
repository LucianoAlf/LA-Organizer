'use strict';

// CONVITE-SO-NA-PRIMEIRA-VEZ (achado 07/10, corrigido com aval do Alf). /internal/event-invites
// deduplicava por EVENTO (marker_logs `event-invites:<id>`): a primeira chamada do app convidava e
// gravava o marcador; quem fosse ADICIONADO depois no EditEventSheet caía em "already_notified" e
// nunca recebia convite. A unidade certa de "já convidei" é o PAR (evento, participante) — e ela
// já existe: event_participants.notified_at.
//
// Regras:
//  • O app diz QUEM acabou de entrar (collaborator_ids). Só esses são candidatos — participante
//    que entrou por outro caminho (TOM com attendees, chat de grupo com suppressNotify) e tem
//    notified_at nulo NÃO é convidado de carona numa edição do app.
//  • Reivindicação atômica: UPDATE notified_at ... WHERE notified_at IS NULL RETURNING. Duas
//    chamadas simultâneas (duplo toque, retry) não mandam o convite duas vezes.
//  • Cliente antigo (sem collaborator_ids, PWA em cache): mantém o comportamento de antes — o
//    marcador por evento continua valendo pra ele, pra não convidar de carona quem o engine já
//    convidou sem marcar notified_at.

const LEGADO_KEY = (eventId) => `event-invites:${eventId}`;

async function reivindicarConvidados({ supabase, eventId, collaboratorIds, agoraIso = new Date().toISOString() }) {
  const key = LEGADO_KEY(eventId);
  const ids = Array.isArray(collaboratorIds) ? collaboratorIds.map(String).filter(Boolean) : null;
  if (!ids) {
    const { data: prior } = await supabase.from('marker_logs')
      .select('id').eq('marker_type', 'EVENT_INVITES').eq('raw_excerpt', key).limit(1);
    if (prior && prior.length > 0) return { status: 'already_notified', key, recipients: [] };
  } else if (!ids.length) {
    return { status: 'no_recipients', key, recipients: [] };
  }

  let cand = supabase.from('event_participants')
    .select('id, collaborator_id, status')
    .eq('event_id', eventId)
    .is('notified_at', null);
  if (ids) cand = cand.in('collaborator_id', ids);
  const { data: candidatos, error: cErr } = await cand;
  if (cErr) throw new Error(`participants_query_failed: ${cErr.message}`);
  const alvo = (candidatos || []).filter((p) => p.status !== 'declined').map((p) => p.id);
  if (!alvo.length) return { status: 'no_recipients', key, recipients: [] };

  // Reivindica: só quem ESTA chamada marcou recebe.
  const { data: meus, error: uErr } = await supabase.from('event_participants')
    .update({ notified_at: agoraIso })
    .in('id', alvo)
    .is('notified_at', null)
    .select('id, collaborator_id');
  if (uErr) throw new Error(`participants_claim_failed: ${uErr.message}`);
  if (!meus || !meus.length) return { status: 'no_recipients', key, recipients: [] };

  const { data: pessoas } = await supabase.from('collaborators')
    .select('id, full_name, phone, is_active')
    .in('id', meus.map((m) => m.collaborator_id));
  const porId = new Map((pessoas || []).map((c) => [c.id, c]));
  const recipients = meus.map((m) => {
    const c = porId.get(m.collaborator_id);
    return c && c.phone && c.is_active ? { participantId: m.id, id: c.id, name: c.full_name, phone: c.phone } : null;
  }).filter(Boolean);
  return { status: recipients.length ? 'ok' : 'no_recipients', key, recipients };
}

module.exports = { reivindicarConvidados, LEGADO_KEY };
