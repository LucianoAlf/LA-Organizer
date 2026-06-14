// src/rituals/group-reports.js
// B2 — Rituais proativos do grupo. dispatchGroupReports roda no tick do dispatcher,
// casa cada preset habilitado com a hora atual (fuso SP), claim atômico em
// group_ritual_logs (idempotência), e insere card kind='report' em group_chat_messages
// (bridge-out espelha pro WhatsApp; app renderiza). Conteúdo = buildGroupReport (B1).
'use strict';

const { isTransientRitualError } = require('./ritual-claim');

const PRESETS = ['daily_morning', 'weekly', 'monthly', 'overdue'];

const PRESET_CONFIG = {
  daily_morning: { scope: 'agenda', window: 'hoje', onlyOverdue: false, headingTemplate: '☀️ Bom dia, {grupo}! Hoje vocês têm:' },
  weekly:        { scope: 'tudo',   window: 'semana', onlyOverdue: false, headingTemplate: '📅 Semana do {grupo}' },
  monthly:       { scope: 'tudo',   window: 'mes',  onlyOverdue: false, headingTemplate: '🗓️ Mês do {grupo}' },
  overdue:       { scope: 'tarefas', window: 'mes', onlyOverdue: true,  headingTemplate: '⏰ {grupo}: tarefas atrasadas' },
};

function presetConfig(preset) { return PRESET_CONFIG[preset]; }

// 'HH:MM' → minutos do dia, arredondado ao slot de 15min (espelha dispatcher.timeToSlot).
function timeToSlot(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + Math.floor(m / 15) * 15;
}
function currentSlot(now) { return now.hour * 60 + Math.floor(now.minute / 15) * 15; }

// dow do nowSaoPaulo é 0=dom..6=sab; weekdays usa ISO 1=seg..7=dom.
function isoDow(now) { return now.dow === 0 ? 7 : now.dow; }

// Casa um setting com o instante atual (now = nowSaoPaulo()).
function matchSchedule(now, setting) {
  if (currentSlot(now) !== timeToSlot(setting.time_local)) return false;
  if (setting.preset === 'monthly') {
    return Number(now.ymd.slice(8, 10)) === Number(setting.day_of_month);
  }
  return Array.isArray(setting.weekdays) && setting.weekdays.includes(isoDow(now));
}

// Claim atômico: insert em group_ritual_logs. 23505 = já disparou hoje → skip.
async function claimGroupRitual(supabase, groupId, preset, ymd) {
  const { data, error } = await supabase
    .from('group_ritual_logs')
    .insert({ group_id: groupId, preset, reference_date: ymd })
    .select('id')
    .single();
  if (error) return { won: false, duplicate: error.code === '23505', code: error.code || null };
  return { won: true, id: data.id };
}

// Rollback do claim (RITUAL-NO-RETRY) — libera o re-envio no próximo tick quando o
// envio falhou com erro transitório (pré-entrega). Falha de rollback nunca derruba o tick.
async function rollbackGroupRitual(supabase, claimId) {
  if (!claimId) return;
  const { error } = await supabase.from('group_ritual_logs').delete().eq('id', claimId);
  if (error) console.error('[GroupReports] rollback err:', error.message);
}

// Insere o card kind='report' (mesma forma do card da B1/closing). channel='app'
// faz o bridge-out espelhar pro WhatsApp; o app renderiza via realtime.
async function insertReportCard(supabase, groupId, html) {
  const { error } = await supabase.from('group_chat_messages').insert({
    group_id: groupId, sender_id: null, role: 'tom', kind: 'report', content: html, channel: 'app',
  });
  if (error) throw new Error('insert card: ' + error.message);
}

// Orquestradora chamada no tick do dispatcher.
// deps: { buildGroupReport } (injetável p/ teste). now = nowSaoPaulo().
async function dispatchGroupReports({ now, supabase, deps }) {
  const buildGroupReport = deps && deps.buildGroupReport
    ? deps.buildGroupReport
    : require('../services/group-report-builder').buildGroupReport;
  const ymd = now.ymd;

  const { data: settings, error } = await supabase
    .from('group_notification_settings')
    .select('group_id, preset, enabled, weekdays, day_of_month, time_local, group:work_groups!group_notification_settings_group_id_fkey(name)')
    .eq('enabled', true);
  if (error) { console.error('[GroupReports] query settings:', error.message); return; }
  if (!settings || !settings.length) return;

  for (const s of settings) {
    if (!matchSchedule(now, s)) continue;
    const cfg = presetConfig(s.preset);
    if (!cfg) continue;
    const groupName = s.group ? s.group.name : 'grupo';
    const heading = cfg.headingTemplate.replace('{grupo}', groupName);
    let claimId = null;
    try {
      if (cfg.onlyOverdue) {
        // overdue: checa atrasadas ANTES; só claima/envia se houver.
        const { html, isEmpty } = await buildGroupReport({
          supabase, groupId: s.group_id, scope: cfg.scope, window: cfg.window,
          onlyOverdue: true, heading, now: new Date(),
        });
        if (isEmpty) { console.log(`[GroupReports] ${groupName}/overdue: sem atrasadas, skip`); continue; }
        const claim = await claimGroupRitual(supabase, s.group_id, s.preset, ymd);
        if (!claim.won) { if (!claim.duplicate) console.error(`[GroupReports] claim_err ${groupName}/overdue ${claim.code}`); continue; }
        claimId = claim.id;
        await insertReportCard(supabase, s.group_id, html);
        console.log(`[GroupReports] sent ${groupName}/overdue`);
      } else {
        // demais: claim ANTES (sempre enviam), evita corrida entre ticks.
        const claim = await claimGroupRitual(supabase, s.group_id, s.preset, ymd);
        if (!claim.won) { if (!claim.duplicate) console.error(`[GroupReports] claim_err ${groupName}/${s.preset} ${claim.code}`); continue; }
        claimId = claim.id;
        const { html } = await buildGroupReport({
          supabase, groupId: s.group_id, scope: cfg.scope, window: cfg.window, heading, now: new Date(),
        });
        await insertReportCard(supabase, s.group_id, html);
        console.log(`[GroupReports] sent ${groupName}/${s.preset}`);
      }
    } catch (err) {
      // RITUAL-NO-RETRY: claim já vencido + erro transitório (pré-entrega) → reverte o
      // claim pra re-tentar no próximo tick; senão o relatório do dia some em silêncio.
      if (claimId && isTransientRitualError(err)) {
        await rollbackGroupRitual(supabase, claimId);
        console.error(`[GroupReports] transient ${groupName}/${s.preset} — claim revertido p/ retry:`, err.message);
      } else {
        console.error(`[GroupReports] err ${groupName}/${s.preset}:`, err.message);
      }
    }
  }
}

// Monta o relatório de UM preset SEM enviar — usado pelo "Pré-visualizar" (#3 das
// notificações). Reutiliza presetConfig + heading do ritual; READ-ONLY: não claima em
// group_ritual_logs nem insere card. Retorna { ok:true, html, isEmpty, heading } ou { ok:false, error }.
async function buildPresetPreview({ supabase, groupId, preset, now = new Date(), deps }) {
  const cfg = presetConfig(preset);
  if (!cfg) return { ok: false, error: 'invalid_preset' };
  const buildGroupReport = deps && deps.buildGroupReport
    ? deps.buildGroupReport
    : require('../services/group-report-builder').buildGroupReport;
  const { data: g } = await supabase.from('work_groups').select('name').eq('id', groupId).maybeSingle();
  if (!g) return { ok: false, error: 'group_not_found' };
  const heading = cfg.headingTemplate.replace('{grupo}', g.name || 'grupo');
  const { html, isEmpty } = await buildGroupReport({
    supabase, groupId, scope: cfg.scope, window: cfg.window, onlyOverdue: cfg.onlyOverdue, heading, now,
  });
  return { ok: true, html, isEmpty, heading };
}

// Dispara AGORA, sob demanda manual (botão "Enviar pro grupo agora") — monta via
// buildPresetPreview e insere o card (app renderiza + espelho WhatsApp via bridge-out).
// NÃO usa o claim diário (é ação explícita do usuário, pode coexistir com o agendado).
// overdue vazio não envia (mesma regra do ritual). Retorna { ok, sent, isEmpty }.
async function sendPresetNow({ supabase, groupId, preset, now = new Date(), deps }) {
  const r = await buildPresetPreview({ supabase, groupId, preset, now, deps });
  if (!r.ok) return r;
  const cfg = presetConfig(preset);
  if (cfg.onlyOverdue && r.isEmpty) return { ok: true, sent: false, isEmpty: true };
  const insert = deps && deps.insertReportCard ? deps.insertReportCard : insertReportCard;
  await insert(supabase, groupId, r.html);
  return { ok: true, sent: true, isEmpty: r.isEmpty };
}

module.exports = { PRESETS, presetConfig, matchSchedule, timeToSlot, currentSlot, isoDow, claimGroupRitual, rollbackGroupRitual, insertReportCard, dispatchGroupReports, buildPresetPreview, sendPresetNow };
