// scripts/smoke-rsvp-confirm.js
// Smoke END-TO-END do item 5 (Quintela/Luciano): "Sim, confirmo" virava EVENT_UPDATE
// action:confirm → REJEITADO (action:invalid) → confabulou "presença confirmada" sem gravar.
// Prova que agora o verbo natural roteia pro RSVP e PERSISTE event_participants.
// Cria evento de teste (dono != convidado) + convite pendente; apaga tudo no fim.
//
// Rodar no VPS:  cd /opt/LA-Organizer && set -a && . ./.env && node scripts/smoke-rsvp-confirm.js

const { applyEventUpdates, applyRsvp } = require('../src/engine');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

const LUCIANO = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';
const OWNER   = 'b41c4b5b-90e8-4f84-97cb-7d706c073454'; // Clayton — dono do evento (convidado != dono)

async function partStatus(eventId) {
  const { data } = await supabase.from('event_participants')
    .select('status, responded_at').eq('event_id', eventId).eq('collaborator_id', LUCIANO).single();
  return data || {};
}

async function main() {
  const results = [];
  let eventId = null;
  try {
    const { data: collab } = await supabase.from('collaborators').select('*').eq('id', LUCIANO).single();
    const { data: ev, error: ee } = await supabase.from('events').insert({
      collaborator_id: OWNER, title: '[SMOKE] rsvp confirm — apagar',
      start_at: '2026-06-20T12:00:00+00', end_at: '2026-06-20T13:00:00+00',
      status: 'scheduled', context: 'work', modality: 'online',
      category_id: '799f40e3-e174-45e1-b72c-93f576219cfd',
    }).select().single();
    if (ee || !ev) throw new Error('insert event falhou: ' + (ee && ee.message));
    eventId = ev.id;
    const short = eventId.slice(0, 8);
    await supabase.from('event_participants').insert({
      event_id: eventId, collaborator_id: LUCIANO, status: 'invited', invited_by: OWNER,
      invited_at: new Date().toISOString(),
    });
    console.log(`event = ${eventId}  (short ${short}), Luciano convidado=invited\n`);

    // TESTE 1 — o caminho EXATO da falha: EVENT_UPDATE action:confirm (era action:invalid)
    const r1 = await applyEventUpdates(collab, [{ action: 'confirm', event_id: short, id: short }]);
    const s1 = await partStatus(eventId);
    results.push(['EVENT_UPDATE confirm → status=confirmed', r1.okCount === 1 && s1.status === 'confirmed' && !!s1.responded_at]);

    // reset
    await supabase.from('event_participants').update({ status: 'invited', responded_at: null })
      .eq('event_id', eventId).eq('collaborator_id', LUCIANO);

    // TESTE 2 — recusar via applyRsvp direto (helper compartilhado)
    const r2 = await applyRsvp(collab, short, 'declined');
    const s2 = await partStatus(eventId);
    results.push(['applyRsvp declined → status=declined', r2.ok === true && s2.status === 'declined']);

    // reset
    await supabase.from('event_participants').update({ status: 'invited', responded_at: null })
      .eq('event_id', eventId).eq('collaborator_id', LUCIANO);

    // TESTE 3 — verbo "aceito" (alias PT) via EVENT_UPDATE
    const r3 = await applyEventUpdates(collab, [{ action: 'aceito', event_id: short }]);
    const s3 = await partStatus(eventId);
    results.push(['EVENT_UPDATE "aceito" → status=confirmed', r3.okCount === 1 && s3.status === 'confirmed']);
  } catch (e) {
    console.error('ERRO:', e.message);
    results.push(['execução sem exceção', false]);
  } finally {
    if (eventId) {
      await supabase.from('event_participants').delete().eq('event_id', eventId);
      await supabase.from('events').delete().eq('id', eventId);
      const { data: gone } = await supabase.from('events').select('id').eq('id', eventId);
      results.push(['cleanup: evento+participante apagados', !gone || gone.length === 0]);
    }
  }

  console.log('\n=== RESULTADOS ===');
  let allPass = true;
  for (const [n, ok] of results) { console.log(`${ok ? '✅' : '❌'} ${n}`); if (!ok) allPass = false; }
  console.log(allPass ? '\n🟢 SMOKE PASS' : '\n🔴 SMOKE FAIL');
  process.exit(allPass ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e); process.exit(2); });
