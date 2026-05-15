// src/rituals/health-check.js — Auditoria diária do sistema TOM.
//
// Roda às 5h BRT (depois do Dream das 3h, antes do briefing das 7h).
// Executa 10 checks de saúde, persiste resultado em health_check_runs,
// e auto-corrige só o que é seguro (idempotente, sem efeito colateral).
//
// Uso programático:
//   const { runHealthCheck } = require('./rituals/health-check');
//   const result = await runHealthCheck();
//
// Cada check é isolado em try/catch — falha individual não derruba os outros.
// Status: 'ok' | 'warning' | 'error' | 'fixed'.

const fs = require('fs');
const path = require('path');
const supabase = require('../supabase/client');
const { generateWeeklySummaryFor } = require('../engine');

const ERROR_LOG_PATH = '/opt/LA-Organizer/logs/tom-error.log';
const WARN_THRESHOLDS = {
  rejectedMarkers: 5,
  unknownMarkers: 3,
  recurringErrors: 3,
};

function todayBrt() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

function isoHoursAgo(h) {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

// Último domingo (week_start de weekly summary)
function lastSundayYmd() {
  const now = new Date();
  const dow = now.getDay(); // 0=domingo
  const diff = dow === 0 ? 0 : dow;
  const sunday = new Date(now.getTime() - diff * 24 * 3600_000);
  const y = sunday.getUTCFullYear();
  const m = String(sunday.getUTCMonth() + 1).padStart(2, '0');
  const d = String(sunday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─────────────────────────────────────────────────────────────────
// CHECK 1 — Dream rodou nas últimas 24h
// ─────────────────────────────────────────────────────────────────
async function checkDreamRecent() {
  const { count, error } = await supabase
    .from('ritual_logs')
    .select('id', { count: 'exact', head: true })
    .eq('ritual_type', 'daily_dream')
    .eq('status', 'sent')
    .gte('created_at', isoHoursAgo(24));
  if (error) throw error;
  if (count > 0) return { status: 'ok', detail: `Dream executou (${count} colaboradores)` };
  return { status: 'error', detail: 'Dream NÃO executou nas últimas 24h' };
}

// ─────────────────────────────────────────────────────────────────
// CHECK 2 — Weekly summary do último domingo (auto-fix)
// ─────────────────────────────────────────────────────────────────
async function checkWeeklySummary() {
  const weekStart = lastSundayYmd();
  const { data: summaries, error } = await supabase
    .from('collaborator_weekly_summaries')
    .select('id, collaborator_id')
    .eq('week_start', weekStart);
  if (error) throw error;
  if (summaries && summaries.length > 0) {
    return { status: 'ok', detail: `Weekly summary OK (${summaries.length} colaboradores, semana ${weekStart})` };
  }
  // Auto-fix: gerar pra colaboradores ativos+onboarded
  const { data: collabs } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, role')
    .eq('is_active', true)
    .eq('onboarding_completed', true);
  let fixed = 0;
  let failed = 0;
  for (const c of (collabs || [])) {
    try { await generateWeeklySummaryFor(c); fixed++; }
    catch (err) { failed++; console.warn(`[health-check] weekly summary fail for ${c.full_name}:`, err.message); }
  }
  return {
    status: 'fixed',
    detail: `Weekly summary vazio — auto-corrigido (${fixed} ok, ${failed} fail)`,
    fix: { type: 'weekly_summary_backfill', week_start: weekStart, fixed, failed },
  };
}

// ─────────────────────────────────────────────────────────────────
// CHECK 3 — Memórias sem embedding (auto-fix)
// ─────────────────────────────────────────────────────────────────
async function checkMemoriesEmbedding() {
  const { data: rows, error } = await supabase
    .from('collaborator_memory')
    .select('id, content')
    .is('embedding', null)
    .eq('is_active', true)
    .limit(50);
  if (error) throw error;
  if (!rows || rows.length === 0) return { status: 'ok', detail: 'Todas memórias têm embedding' };
  // Auto-fix: backfill em lote (limit 50 pra não estourar OpenAI)
  let fixed = 0;
  let failed = 0;
  let getEmbedding;
  try { ({ getEmbedding } = require('../services/embeddings')); }
  catch (e) { return { status: 'error', detail: `${rows.length} memórias sem embedding — backfill indisponível: ${e.message}` }; }
  for (const r of rows) {
    try {
      const emb = await getEmbedding(String(r.content || ''));
      const { error: upErr } = await supabase.from('collaborator_memory').update({ embedding: emb }).eq('id', r.id);
      if (upErr) { failed++; continue; }
      fixed++;
    } catch (e) { failed++; }
  }
  return {
    status: 'fixed',
    detail: `${rows.length} memórias sem embedding — ${fixed} corrigidas, ${failed} falharam`,
    fix: { type: 'memory_embedding_backfill', total: rows.length, fixed, failed },
  };
}

// ─────────────────────────────────────────────────────────────────
// CHECK 4 — Tasks vencidas sem cobrança
// ─────────────────────────────────────────────────────────────────
async function checkOverdueTasks() {
  const today = todayBrt();
  const { count, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .lt('due_date', today)
    .eq('status', 'pending')
    .is('reminded_at', null);
  if (error) throw error;
  if (count === 0) return { status: 'ok', detail: 'Nenhuma task vencida sem cobrança' };
  return { status: 'warning', detail: `${count} tasks vencidas sem cobrança (reminded_at NULL)` };
}

// ─────────────────────────────────────────────────────────────────
// CHECK 5 — Markers rejeitados últimas 24h
// ─────────────────────────────────────────────────────────────────
async function checkRejectedMarkers() {
  const { count, error } = await supabase
    .from('marker_logs')
    .select('id', { count: 'exact', head: true })
    .eq('result', 'rejected')
    .gte('created_at', isoHoursAgo(24));
  if (error) throw error;
  if (count === 0) return { status: 'ok', detail: '0 markers rejeitados nas últimas 24h' };
  if (count <= WARN_THRESHOLDS.rejectedMarkers) return { status: 'ok', detail: `${count} markers rejeitados (abaixo do threshold)` };
  return { status: 'warning', detail: `${count} markers rejeitados nas últimas 24h (threshold ${WARN_THRESHOLDS.rejectedMarkers})` };
}

// ─────────────────────────────────────────────────────────────────
// CHECK 6 — UNKNOWN_MARKER_STRIPPED últimas 24h
// ─────────────────────────────────────────────────────────────────
async function checkUnknownMarkers() {
  const { count, error } = await supabase
    .from('marker_logs')
    .select('id', { count: 'exact', head: true })
    .eq('marker_type', 'UNKNOWN_MARKER_STRIPPED')
    .gte('created_at', isoHoursAgo(24));
  if (error) throw error;
  if (count === 0) return { status: 'ok', detail: '0 UNKNOWN_MARKER_STRIPPED' };
  if (count <= WARN_THRESHOLDS.unknownMarkers) return { status: 'ok', detail: `${count} unknown markers (abaixo do threshold)` };
  return { status: 'warning', detail: `${count} UNKNOWN_MARKER_STRIPPED — TOM inventando markers, prompt confuso` };
}

// ─────────────────────────────────────────────────────────────────
// CHECK 7 — Collaborators ativos sem conversa há 7+ dias
// ─────────────────────────────────────────────────────────────────
async function checkSilentCollaborators() {
  const { data: collabs, error } = await supabase
    .from('collaborators')
    .select('id, full_name, phone')
    .eq('is_active', true)
    .eq('onboarding_completed', true);
  if (error) throw error;
  const cutoff = isoHoursAgo(7 * 24);
  const silent = [];
  for (const c of (collabs || [])) {
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('collaborator_id', c.id)
      .gte('created_at', cutoff);
    if (!count || count === 0) silent.push(c.full_name);
  }
  if (silent.length === 0) return { status: 'ok', detail: 'Todos colaboradores ativos conversaram nos últimos 7 dias' };
  return { status: 'warning', detail: `${silent.length} colaboradores sem conversa 7+ dias: ${silent.slice(0, 5).join(', ')}${silent.length > 5 ? '...' : ''}` };
}

// ─────────────────────────────────────────────────────────────────
// CHECK 8 — Profiles sem update 7+ dias
// ─────────────────────────────────────────────────────────────────
async function checkStaleProfiles() {
  const cutoff = isoHoursAgo(7 * 24);
  const { count, error } = await supabase
    .from('collaborator_profiles')
    .select('collaborator_id', { count: 'exact', head: true })
    .lt('updated_at', cutoff);
  if (error) {
    // tenta last_updated_at se updated_at não existir
    if (/column.*updated_at.*does not exist/i.test(error.message)) {
      const r2 = await supabase.from('collaborator_profiles').select('collaborator_id', { count: 'exact', head: true }).lt('last_updated_at', cutoff);
      if (r2.error) throw r2.error;
      return { status: r2.count > 0 ? 'warning' : 'ok', detail: `${r2.count} profiles sem update 7+ dias` };
    }
    throw error;
  }
  if (count === 0) return { status: 'ok', detail: 'Profiles atualizados' };
  return { status: 'warning', detail: `${count} profiles sem update 7+ dias` };
}

// ─────────────────────────────────────────────────────────────────
// CHECK 9 — Eventos próximos 48h sem lembrete
// ─────────────────────────────────────────────────────────────────
async function checkEventsWithoutReminders() {
  const nowIso = new Date().toISOString();
  const in48h = new Date(Date.now() + 48 * 3600_000).toISOString();
  const { data: events, error } = await supabase
    .from('events')
    .select('id, title, start_at')
    .gte('start_at', nowIso)
    .lte('start_at', in48h)
    .neq('status', 'cancelled');
  if (error) throw error;
  if (!events || events.length === 0) return { status: 'ok', detail: 'Sem eventos nas próximas 48h' };
  const noReminder = [];
  for (const ev of events) {
    const { count } = await supabase
      .from('event_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev.id);
    if (!count || count === 0) noReminder.push(ev.title);
  }
  if (noReminder.length === 0) return { status: 'ok', detail: `${events.length} eventos próximos, todos com lembrete` };
  return { status: 'warning', detail: `${noReminder.length}/${events.length} eventos próximos sem lembrete: ${noReminder.slice(0, 3).join(', ')}` };
}

// ─────────────────────────────────────────────────────────────────
// CHECK 10 — Erros recorrentes nos logs (>3 do mesmo padrão/24h)
// ─────────────────────────────────────────────────────────────────
async function checkRecurringErrors() {
  if (!fs.existsSync(ERROR_LOG_PATH)) return { status: 'ok', detail: 'log de erros não encontrado (skipped)' };
  const cutoff = Date.now() - 24 * 3600_000;
  const lines = fs.readFileSync(ERROR_LOG_PATH, 'utf8').split('\n').slice(-5000); // últimos 5k linhas
  const tally = new Map();
  for (const line of lines) {
    // formato esperado: "2026-05-15T19:39:30: ..."
    const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}):/);
    if (!m) continue;
    const ts = new Date(m[1] + 'Z').getTime();
    if (isNaN(ts) || ts < cutoff) continue;
    // padrão = mensagem normalizada (remove números/uuids)
    const msg = line.slice(m[0].length).trim()
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
      .replace(/\b\d{4,}\b/g, '<n>')
      .slice(0, 200);
    if (!msg) continue;
    tally.set(msg, (tally.get(msg) || 0) + 1);
  }
  const recurring = [...tally.entries()].filter(([, c]) => c >= WARN_THRESHOLDS.recurringErrors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (recurring.length === 0) return { status: 'ok', detail: 'Sem erros recorrentes nas últimas 24h' };
  const summary = recurring.map(([m, c]) => `${c}x "${m.slice(0, 60)}"`).join('; ');
  return { status: 'warning', detail: `Erros recorrentes: ${summary}` };
}

// ─────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────
const ALL_CHECKS = [
  ['dream_recent',           checkDreamRecent],
  ['weekly_summary',         checkWeeklySummary],
  ['memories_embedding',     checkMemoriesEmbedding],
  ['overdue_tasks',          checkOverdueTasks],
  ['rejected_markers',       checkRejectedMarkers],
  ['unknown_markers',        checkUnknownMarkers],
  ['silent_collaborators',   checkSilentCollaborators],
  ['stale_profiles',         checkStaleProfiles],
  ['events_without_reminders', checkEventsWithoutReminders],
  ['recurring_errors',       checkRecurringErrors],
];

async function runHealthCheck() {
  const ranAt = new Date().toISOString();
  const checks = [];
  const fixes = [];
  for (const [name, fn] of ALL_CHECKS) {
    try {
      const result = await fn();
      checks.push({ name, status: result.status, detail: result.detail });
      if (result.fix) fixes.push(result.fix);
    } catch (err) {
      console.error(`[health-check] ${name} threw:`, err.message);
      checks.push({ name, status: 'error', detail: `Exception: ${err.message}` });
    }
  }
  const summary = {
    ok: checks.filter(c => c.status === 'ok').length,
    warning: checks.filter(c => c.status === 'warning').length,
    error: checks.filter(c => c.status === 'error').length,
    fixed: checks.filter(c => c.status === 'fixed').length,
    total: checks.length,
  };
  // Persiste
  try {
    const { error } = await supabase.from('health_check_runs').insert({
      ran_at: ranAt,
      summary,
      checks,
      auto_fixes_applied: fixes,
    });
    if (error) console.error('[health-check] persist err:', error.message);
  } catch (err) {
    console.error('[health-check] persist throw:', err.message);
  }
  return { ran_at: ranAt, summary, checks, auto_fixes_applied: fixes };
}

// CLI direto: node src/rituals/health-check.js
if (require.main === module) {
  process.chdir(path.join(__dirname, '..', '..'));
  runHealthCheck().then(r => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runHealthCheck };
