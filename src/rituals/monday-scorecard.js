// src/rituals/monday-scorecard.js — Sprint 29.3
//
// Roda toda segunda 8h BRT (director) e 9h BRT (cada líder).
// - Gera scorecard pra todos líderes elegíveis (managers, coords, has_coord_permissions).
// - 08h: envia consolidado pro director.
// - 09h: envia versão privada pra cada líder.
// Idempotência via UNIQUE(leader_id, week_start) na tabela + flags sent_*.

const supabase = require('../supabase/client');
const whatsapp = require('../services/whatsapp');
const builder = require('../services/scorecard-builder');
const { isQuietNow, nowBrtParts } = require('../services/quiet-hours');

const RITUAL_TYPE_DIR = 'monday_scorecard_director';
const RITUAL_TYPE_LEADER = 'monday_scorecard_leader';

function isLeaderRole(c) {
  if (!c) return false;
  return c.role === 'manager' || c.role === 'coordinator' || c.has_coord_permissions === true;
}

/**
 * Gera scorecards pra todos os líderes elegíveis. Retorna array enriquecido
 * com {scorecardId, leader, metrics, delta, insights}.
 */
async function generateAllScorecards(weekStart, weekEnd) {
  const { data: candidates } = await supabase
    .from('collaborators')
    .select('id, full_name, preferred_name, phone, role, has_coord_permissions, function_title')
    .eq('is_active', true)
    .not('phone', 'is', null)
    .neq('role', 'director');

  const eligible = (candidates || []).filter(isLeaderRole);
  const results = [];

  for (const leader of eligible) {
    try {
      const metrics = await builder.computeScorecard(leader.id, weekStart, weekEnd);
      const delta = await builder.computeDelta(leader.id, weekStart, metrics);
      const insights = await builder.generateInsight(leader, metrics, delta);
      const scorecardId = await builder.persistScorecard(leader.id, weekStart, weekEnd, metrics, delta, insights);
      if (scorecardId) {
        results.push({ scorecardId, leader, metrics, delta, insights, week_start: weekStart, week_end: weekEnd });
      }
    } catch (err) {
      console.error(`[monday-scorecard] leader=${String(leader.id).slice(0,8)} err:`, err.message);
    }
  }

  console.log(`[monday-scorecard] generated ${results.length} scorecards for week ${weekStart}..${weekEnd}`);
  return results;
}

/**
 * Envia consolidado pro director.
 */
async function sendToDirector(opts = {}) {
  const now = opts.now || new Date();
  if (!opts.force) {
    // Segunda 8h BRT = 11h UTC. Janela ampliada: qualquer tick de segunda
    // após 11h UTC (até 23h UTC) — idempotência via ritual_logs impede reenvio.
    // Janela estreita (11:00-11:14) causava miss quando deploy acontecia nessa janela.
    const utcDow = now.getUTCDay();  // monday=1
    const utcH = now.getUTCHours();
    const isMonday = utcDow === 1 && utcH >= 11 && utcH < 23;
    if (!isMonday) return { skipped: 'out_of_window' };
  }

  const { weekStart, weekEnd } = builder.lastWeekRange(now);

  // Sprint 30 — Apenas o CEO recebe scorecard consolidado (não Anne/Admin).
  const { data: directors } = await supabase
    .from('collaborators')
    .select('id, full_name, phone')
    .eq('is_ceo', true)
    .eq('is_active', true)
    .not('phone', 'is', null);
  if (!directors || directors.length === 0) return { skipped: 'no_ceo' };

  // Idempotência: 1 envio por director por semana
  let sentCount = 0;
  for (const dir of directors) {
    const { data: alreadySent } = await supabase
      .from('ritual_logs')
      .select('id')
      .eq('collaborator_id', dir.id)
      .eq('ritual_type', RITUAL_TYPE_DIR)
      .eq('reference_date', weekStart)
      .maybeSingle();
    if (alreadySent) continue;

    // Gera scorecards (compartilhado entre todos directors no mesmo run)
    const scorecards = await generateAllScorecards(weekStart, weekEnd);
    if (scorecards.length === 0) {
      console.log('[monday-scorecard] sem líderes elegíveis — skip director');
      continue;
    }

    const leadersById = new Map(scorecards.map(s => [s.leader.id, s.leader]));
    const scRows = scorecards.map(s => ({
      leader_id: s.leader.id,
      closure_rate: s.metrics.closure_rate,
      tasks_closed: s.metrics.tasks_closed,
      tasks_overdue: s.metrics.tasks_overdue,
      tasks_stuck: s.metrics.tasks_stuck,
      top_bottlenecks: s.metrics.top_bottlenecks,
      insights: s.insights,
      delta_vs_prev: s.delta,
    }));

    const msg = builder.renderForDirector(scRows, leadersById);
    if (!msg) continue;

    // Silêncio (trabalho): defere se o director está em quiet agora (não marca sent → retenta no próximo tick da janela de segunda).
    const qDir = await isQuietNow(dir.id, nowBrtParts(), 'work');
    if (qDir.quiet) { console.log(`[monday-scorecard] director=${dir.full_name} em quiet (${qDir.reason}) — defer`); continue; }

    try {
      // Fase 6a — o scorecard do director agora vai DENTRO do digest único
      // (sendGovernanceDigest, 9h). Mantém geração+persistência (digest e líderes
      // leem leader_scorecards), mas NÃO envia mais a mensagem separada pro director.
      // await whatsapp.sendMessage(dir.phone, msg);
      void msg;
      await supabase.from('leader_scorecards')
        .update({ sent_to_director: true, sent_to_director_at: new Date().toISOString() })
        .in('id', scorecards.map(s => s.scorecardId).filter(Boolean));
      await supabase.from('ritual_logs').insert({
        collaborator_id: dir.id,
        ritual_type: RITUAL_TYPE_DIR,
        status: 'sent',
        sent_at: new Date().toISOString(),
        reference_date: weekStart,
        detail: `scorecards=${scorecards.length}`,
      });
      sentCount++;
      console.log(`[monday-scorecard] director=${dir.full_name} sent consolidado (${scorecards.length} leaders)`);
    } catch (err) {
      console.error(`[monday-scorecard] director send err: ${err.message}`);
    }
  }

  return { ok: true, sent: sentCount };
}

/**
 * Envia versão individual pra cada líder.
 */
async function sendToEachLeader(opts = {}) {
  const now = opts.now || new Date();
  if (!opts.force) {
    // Segunda 9h BRT = 12h UTC. Janela ampliada: qualquer tick de segunda
    // após 12h UTC — idempotência via ritual_logs impede reenvio.
    const utcDow = now.getUTCDay();
    const utcH = now.getUTCHours();
    const isMonday = utcDow === 1 && utcH >= 12 && utcH < 23;
    if (!isMonday) return { skipped: 'out_of_window' };
  }

  const { weekStart } = builder.lastWeekRange(now);

  // Pega scorecards não enviados ainda pros líderes
  const { data: scs } = await supabase
    .from('leader_scorecards')
    .select('*, collaborators:leader_id(id, full_name, preferred_name, phone)')
    .eq('week_start', weekStart)
    .eq('sent_to_leader', false);

  if (!scs || scs.length === 0) return { skipped: 'all_already_sent_or_none' };

  let sent = 0;
  for (const sc of scs) {
    const leader = sc.collaborators;
    if (!leader?.phone) continue;

    try {
      // Silêncio (trabalho): defere se o líder está em quiet (não marca sent_to_leader → retenta).
      const qL = await isQuietNow(leader.id, nowBrtParts(), 'work');
      if (qL.quiet) { console.log(`[monday-scorecard] leader=${leader.full_name} em quiet (${qL.reason}) — defer`); continue; }
      // Fase 6a — o scorecard do líder agora vai DENTRO do digest do líder
      // (sendLeaderGovernanceDigest, 14h/9h-sáb) como "🏆 Seu scorecard".
      // Mantém persistência+idempotência, mas NÃO envia mais a mensagem separada.
      const msg = builder.renderForLeader(sc, leader);
      void msg;
      // await whatsapp.sendMessage(leader.phone, msg);
      await supabase.from('leader_scorecards')
        .update({ sent_to_leader: true, sent_to_leader_at: new Date().toISOString() })
        .eq('id', sc.id);
      await supabase.from('ritual_logs').insert({
        collaborator_id: leader.id,
        ritual_type: RITUAL_TYPE_LEADER,
        status: 'sent',
        sent_at: new Date().toISOString(),
        reference_date: weekStart,
        detail: `scorecard=${sc.id}`,
      });
      sent++;
      console.log(`[monday-scorecard] leader=${leader.full_name} sent individual`);
    } catch (err) {
      console.error(`[monday-scorecard] leader=${leader.full_name} err:`, err.message);
    }
  }

  return { ok: true, sent };
}

/**
 * Tick chamado pelo dispatcher.run(). Decide qual ritual disparar baseado no horário.
 */
async function tick(opts = {}) {
  const r1 = await sendToDirector(opts);
  const r2 = await sendToEachLeader(opts);
  return { director: r1, leaders: r2 };
}

module.exports = { tick, sendToDirector, sendToEachLeader, generateAllScorecards };
