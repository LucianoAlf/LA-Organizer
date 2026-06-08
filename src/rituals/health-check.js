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
const { isQuietNow } = require('../services/quiet-hours');

const ERROR_LOG_PATH = '/opt/LA-Organizer/logs/tom-error.log';
const WARN_THRESHOLDS = {
  rejectedMarkers: 5,
  unknownMarkers: 3,
  recurringErrors: 3,
  actionableNoMarker: 3,
  // Provider health (Sprint 31.9): warning se latência/fallback passar destes limites.
  providerMedianMs: 30000,
  providerP95Ms: 90000,
  providerFallbackPct: 10,
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

// {hour, minute, dow} em America/Sao_Paulo — formato que isQuietNow espera (dow: 0=domingo).
function nowBrtParts() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const hour = parseInt(p.find(x => x.type === 'hour').value, 10) % 24;
  const minute = parseInt(p.find(x => x.type === 'minute').value, 10);
  const wd = p.find(x => x.type === 'weekday').value;
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? 0;
  return { hour, minute, dow };
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
// CHECK 2 — Weekly summary recente (sem auto-fix)
// ─────────────────────────────────────────────────────────────────
// O engine.generateWeeklySummaryFor usa week_start = (today − 7 dias),
// uma janela rolante. lastSundayYmd() nunca bate com isso, então o auto-fix
// anterior regenerava 15 summaries TODO DIA (~105 calls LLM/semana de waste).
// Agora: só verifica se houve summary nos últimos 8 dias (o ritual roda domingo
// 22h). Se parou, alerta — não auto-corrige (mascararia o problema do cron).
async function checkWeeklySummary() {
  const cutoff = isoHoursAgo(8 * 24);
  const { count, error } = await supabase
    .from('collaborator_weekly_summaries')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', cutoff);
  if (error) throw error;
  if (count > 0) return { status: 'ok', detail: `${count} weekly summaries nos últimos 8 dias` };
  return { status: 'warning', detail: 'Nenhum weekly summary nos últimos 8 dias — ritual de domingo 22h provavelmente parou' };
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
  // Mede cobrança real via notifications.overdue_alert/deadline_alert.
  // `reminded_at` não serve aqui — ela é tocada pelos rituais T-1 (event/operational/personal),
  // não pelo checkOverdueAlerts que grava em `notifications`.
  //
  // Sprint 31.6 (D1) — alinhado à POLÍTICA REAL de cobrança:
  //   • checkOverdueAlerts só cobra individualmente tasks de 1-5 dias de atraso.
  //     Tasks 6+ dias são escaladas via CEO report (não cobrança individual), então
  //     NÃO devem contar como "sem cobrança" aqui (gerava falso positivo crônico).
  //   • Janela de notificação = 48h (não 24h): o health-check roda 07:00 e o job de
  //     cobrança roda ~08:13; com 24h o check via sempre o buraco da madrugada.
  const today = todayBrt();
  const oldest = ymdMinus(today, 5);       // limite inferior = 5 dias atrás (cap do chaser)
  const yesterday = ymdMinus(today, 1);    // Sprint 31.12 — fronteira "venceu ontem"
  const since48h = isoHoursAgo(48);
  const { data: overdue, error } = await supabase
    .from('tasks')
    .select('id, assigned_to, due_date')
    .gte('due_date', oldest)
    .lt('due_date', today)
    .not('status', 'in', '(done,cancelled)');
  if (error) throw error;
  if (!overdue || overdue.length === 0) return { status: 'ok', detail: 'Nenhuma task vencida na janela de cobrança (1-5d)' };
  const ids = overdue.map(t => t.id);
  const { data: notified, error: nErr } = await supabase
    .from('notifications')
    .select('reference_id')
    .in('reference_id', ids)
    .in('notification_type', ['overdue_alert', 'deadline_alert'])
    .gte('sent_at', since48h);
  if (nErr) throw nErr;
  const notifiedIds = new Set((notified || []).map(n => n.reference_id));
  const sem_cobranca = overdue.filter(t => !notifiedIds.has(t.id));
  if (sem_cobranca.length === 0) return { status: 'ok', detail: `${overdue.length} tasks vencidas (1-5d), todas cobradas nas últimas 48h` };

  // Quiet-aware (31/05): NÃO conta como "sem cobrança" a task cujo DONO está em
  // silêncio AGORA (janela horária ou dia de silêncio) — a cobrança foi adiada
  // corretamente, não perdida. Mata o falso positivo crônico (domingo, manhãs
  // com quiet 00:00–11h). O health-check roda 07:00, quando muita gente tá em quiet.
  const now = nowBrtParts();
  const quietByOwner = new Map();
  for (const ownerId of new Set(sem_cobranca.map(t => t.assigned_to).filter(Boolean))) {
    try {
      const q = await isQuietNow(ownerId, now, 'work');
      quietByOwner.set(ownerId, !!q.quiet);
    } catch { quietByOwner.set(ownerId, false); }
  }
  const notQuiet = sem_cobranca.filter(t => !quietByOwner.get(t.assigned_to));
  const adiadas = sem_cobranca.length - notQuiet.length;
  // Sprint 31.12 — não conta como "negligenciada" a task que venceu ONTEM: o chaser
  // diário roda ~08:13, DEPOIS desta auditoria (~05-07h), então ela ainda terá a 1ª
  // cobrança do dia. Só é "sem cobrança" de verdade quem venceu há 2+ dias E mesmo
  // assim passou 48h sem chase (aí o chaser realmente falhou). Mata o FP recorrente
  // das 5h (caso 03/06: 8 "sem cobrança" = 8 venceram ontem, 0 negligência real).
  const real = notQuiet.filter(t => t.due_date < yesterday);
  const aguardando = notQuiet.length - real.length;
  if (real.length === 0) {
    const extras = [];
    if (aguardando > 0) extras.push(`${aguardando} venceram ontem (chase ~08:13)`);
    if (adiadas > 0) extras.push(`${adiadas} em silêncio (adiadas)`);
    const suf = extras.length ? ` — ${extras.join(', ')}` : '';
    return { status: 'ok', detail: `${overdue.length} tasks vencidas (1-5d), 0 realmente sem cobrança${suf}` };
  }
  const extras = [];
  if (aguardando > 0) extras.push(`${aguardando} venceram ontem`);
  if (adiadas > 0) extras.push(`${adiadas} em silêncio`);
  const suffix = extras.length ? ` (+${extras.join(', ')})` : '';
  return { status: 'warning', detail: `${real.length}/${overdue.length} tasks vencidas (2+ dias) sem cobrança nas últimas 48h${suffix}` };
}

// Sprint 31.6 (D1) — subtrai N dias de um ymd 'YYYY-MM-DD' (timezone-safe via UTC).
function ymdMinus(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────
// CHECK 5 — Markers rejeitados últimas 24h
// ─────────────────────────────────────────────────────────────────
async function checkRejectedMarkers() {
  // Sprint 31.10 — conta só rejeições que indicam FALHA REAL. Exclui:
  //  (a) ACTIONABLE_NO_MARKER → tem check dedicado (checkActionableNoMarker). Contar
  //      aqui também era dupla-contagem (o "14 rejeitados" = 10 actionable + 4 outros).
  //  (b) reason 'integrity_*' → é a confirmação de duplicata "1/2/3" (by-design, TOM
  //      perguntando qual tarefa), não falha. Volume baixo → filtra em JS (robusto a null).
  const { data, error } = await supabase
    .from('marker_logs')
    .select('marker_type, reason')
    .eq('result', 'rejected')
    .gte('created_at', isoHoursAgo(24));
  if (error) throw error;
  const real = (data || []).filter(r =>
    r.marker_type !== 'ACTIONABLE_NO_MARKER' &&
    !/^integrity_/i.test(String(r.reason || '')));
  const count = real.length;
  if (count === 0) return { status: 'ok', detail: '0 markers rejeitados (falha real) nas últimas 24h' };
  if (count <= WARN_THRESHOLDS.rejectedMarkers) return { status: 'ok', detail: `${count} markers rejeitados (falha real, abaixo do threshold)` };
  return { status: 'warning', detail: `${count} markers rejeitados (falha real) nas últimas 24h (threshold ${WARN_THRESHOLDS.rejectedMarkers})` };
}

// ─────────────────────────────────────────────────────────────────
// CHECK 5.5 — ACTIONABLE_NO_MARKER (TOM "alucinou" sucesso sem persistir)
// Sprint 30.1: detecta casos onde TOM falou "registrei/criei/anotei" mas o
// engine não viu marker correspondente. Retorna amostras pro relatório 7h.
// ─────────────────────────────────────────────────────────────────
async function checkActionableNoMarker() {
  const { count, error } = await supabase
    .from('marker_logs')
    .select('id', { count: 'exact', head: true })
    .eq('marker_type', 'ACTIONABLE_NO_MARKER')
    .eq('result', 'rejected')
    .gte('created_at', isoHoursAgo(24));
  if (error) throw error;

  // Sempre carrega amostras pra incluir no relatório (mesmo quando count<=threshold)
  let samples = [];
  if (count > 0) {
    const { data } = await supabase
      .from('marker_logs')
      .select('created_at, reason, raw_excerpt, collaborator_id, collaborators:collaborator_id(full_name)')
      .eq('marker_type', 'ACTIONABLE_NO_MARKER')
      .eq('result', 'rejected')
      .gte('created_at', isoHoursAgo(24))
      .order('created_at', { ascending: false })
      .limit(5);
    samples = data || [];
  }

  if (count === 0) return { status: 'ok', detail: '0 ACTIONABLE_NO_MARKER (TOM fiel ao banco)', samples };
  if (count <= WARN_THRESHOLDS.actionableNoMarker) {
    return { status: 'ok', detail: `${count} ACTIONABLE_NO_MARKER nas últimas 24h (abaixo do threshold)`, samples };
  }
  return {
    status: 'warning',
    detail: `${count} ACTIONABLE_NO_MARKER nas últimas 24h — TOM verbalizou ação SEM persistir (verificar amostras)`,
    samples,
  };
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
    .select('id, full_name, phone, created_at')
    .eq('is_active', true)
    .eq('onboarding_completed', true);
  if (error) throw error;
  const cutoff = isoHoursAgo(7 * 24);
  const cutoffMs = Date.parse(cutoff);
  const silent = [];
  // Sprint 31.6 (D3) — ignora contas de sistema (não conversam no WhatsApp).
  // Ex.: Admin tem phone placeholder "00000000000" — cobrar "conversa" dela é ruído.
  const SYSTEM_NAMES = new Set(['admin', 'sistema', 'system', 'tom']);
  // Tabela correta é `conversation_history` (a antiga `messages` nunca existiu).
  for (const c of (collabs || [])) {
    if (SYSTEM_NAMES.has(String(c.full_name || '').trim().toLowerCase())) continue;
    if (/^0+$/.test(String(c.phone || '').replace(/\D/g, ''))) continue;
    // Sprint 31.20 — recém-criado (< janela de 7d) não pode ter "7+ dias sem conversa";
    // flagar quem entrou ontem é falso positivo. Caso Ana Paula/Jéssica 07/06.
    if (c.created_at && Date.parse(c.created_at) > cutoffMs) continue;
    const { count } = await supabase
      .from('conversation_history')
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
  // `updated_at` é tocado por qualquer write na linha (incluindo bump de
  // total_interactions), então não mede atualização semântica do perfil.
  // `last_profile_update` é o timestamp do refresh do perfil pelo LLM.
  const cutoff = isoHoursAgo(7 * 24);
  const { count, error } = await supabase
    .from('collaborator_profiles')
    .select('collaborator_id', { count: 'exact', head: true })
    .lt('last_profile_update', cutoff);
  if (error) throw error;
  if (count === 0) return { status: 'ok', detail: 'Profiles atualizados' };
  return { status: 'warning', detail: `${count} profiles sem refresh 7+ dias` };
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
// Sprint 27 — Cutoff = max(24h_ago, last_process_start). Crash de boot
// (ex: MODULE_NOT_FOUND quando node_modules sumiu) ficava poluindo a
// auditoria por 24h mesmo depois do TOM voltar estável. Agora descarta
// tudo que aconteceu antes do último PROCESS START — só erros do processo
// atual contam.
// ─────────────────────────────────────────────────────────────────
function lastProcessStartMs() {
  try {
    const OUT_LOG_PATH = ERROR_LOG_PATH.replace('-error.log', '-out.log');
    if (!fs.existsSync(OUT_LOG_PATH)) return 0;
    const lines = fs.readFileSync(OUT_LOG_PATH, 'utf8').split('\n').slice(-2000);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('PROCESS START')) {
        const m = lines[i].match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
        if (m) return new Date(m[1] + 'Z').getTime();
      }
    }
  } catch (_) { /* silencioso */ }
  return 0;
}

async function checkRecurringErrors() {
  if (!fs.existsSync(ERROR_LOG_PATH)) return { status: 'ok', detail: 'log de erros não encontrado (skipped)' };
  const win24h = Date.now() - 24 * 3600_000;
  const procStart = lastProcessStartMs();
  const cutoff = Math.max(win24h, procStart);
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
// CHECK 12 — Regressão de incidentes conhecidos (tom_known_issues) — Sprint 31.7
// Chama a RPC evaluate_known_issues(), que (a) bumpa contadores dos incidentes com
// sinal em marker_logs e (b) retorna os que regrediram (corrigido mas voltou a
// disparar). Como é um check normal, a regressão entra no relatório das 07:00 pelo
// mesmo caminho dos outros alertas.
// ─────────────────────────────────────────────────────────────────
async function checkKnownIssuesRegression() {
  const { data: regs, error } = await supabase.rpc('evaluate_known_issues');
  if (error) return { status: 'error', detail: `evaluate_known_issues: ${error.message}` };
  if (!regs || regs.length === 0) return { status: 'ok', detail: 'Nenhuma regressão de incidente conhecido' };
  const fmt = (d) => d
    ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
    : '?';
  const linhas = regs.map((r) => {
    const quem = (r.afetados && r.afetados.length) ? ` · ${r.afetados.join(', ')}` : '';
    return `${r.codigo} ${r.titulo} (corrigido ${fmt(r.corrigido_em)}, voltou ${r.ocorrencias_novas}×${quem})`;
  });
  return { status: 'warning', detail: `🔁 ${regs.length} regressão(ões): ${linhas.join('; ')}` };
}

// ─────────────────────────────────────────────────────────────────
// CHECK — Saúde do provider de IA (latência + fallback), Sprint 31.9
// Lê tom_metrics (24h). Volume ~125/dia → calcula percentil em JS (sem RPC).
// ─────────────────────────────────────────────────────────────────
function _percentileMs(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(idx, sortedAsc.length - 1))];
}

async function checkProviderHealth() {
  const since = isoHoursAgo(24);
  const { data, error } = await supabase
    .from('tom_metrics')
    .select('latency_ms, provider_used, fallback_from, error_kind')
    .gte('ts', since);
  if (error) return { status: 'error', detail: `provider-health indisponível: ${error.message}` };
  if (!data || data.length === 0) return { status: 'ok', detail: 'Sem mensagens nas últimas 24h' };

  const n = data.length;
  const lat = data.map(r => r.latency_ms).filter(v => typeof v === 'number').sort((a, b) => a - b);
  const med = _percentileMs(lat, 50);
  const p95 = _percentileMs(lat, 95);
  const max = lat.length ? lat[lat.length - 1] : 0;
  const fb = data.filter(r => r.fallback_from).length;
  const fails = data.filter(r => r.error_kind).length;
  const over60 = lat.filter(v => v > 60000).length;
  const fbPct = n ? (fb / n) * 100 : 0;
  const s = (ms) => (ms / 1000).toFixed(1);

  const detail = `${n} msgs · mediana ${s(med)}s · P95 ${s(p95)}s · máx ${s(max)}s · fallback ${fbPct.toFixed(1)}% · falhas ${fails} · >60s ${over60}`;
  const warn = med > WARN_THRESHOLDS.providerMedianMs
    || p95 > WARN_THRESHOLDS.providerP95Ms
    || fbPct > WARN_THRESHOLDS.providerFallbackPct
    || fails > 0;
  return { status: warn ? 'warning' : 'ok', detail };
}

// ─────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// CHECK 14 — Qualidade das conversas (findings abertos do analisador do Dream)
// ─────────────────────────────────────────────────────────────────
const CONV_CAT_LABEL = {
  confabulation: 'confabulação/contradição',
  wrong_refusal: 'recusa indevida',
  media_fail: 'mídia falha',
  dropped_request: 'pedido largado',
  frustration: 'frustração',
  proactive_overreach: 'cobrança indevida',
};
async function checkConversationQuality() {
  const { data, error } = await supabase
    .from('tom_audit_findings')
    .select('category, severity, summary, occurrences, collaborator_id, collaborators:collaborator_id(full_name)')
    .in('status', ['novo', 'confirmado'])
    .order('occurrences', { ascending: false })
    .limit(50);
  if (error) throw error;
  const findings = data || [];
  if (findings.length === 0) {
    return { status: 'ok', detail: '🗣️ 0 falhas nas conversas (24h)' };
  }
  // Amostragem honesta: prioriza ALTO + diversifica por pessoa (não enterra os
  // graves sob 5 do mesmo chat — caso 08/06). rankFindings é puro/testado.
  const { rankFindings } = require('../services/conversation-audit');
  const { sample, byPerson, bySeverity } = rankFindings(findings, { perPerson: 2, max: 7 });
  const SEV_EMOJI = { alto: '🔴', medio: '🟠', baixo: '🟡' };
  const nameById = {};
  for (const f of findings) nameById[f.collaborator_id] = f.collaborators?.full_name?.split(' ')[0] || '—';
  const top = sample.map(f => {
    const who = nameById[f.collaborator_id] || '—';
    const rec = (f.occurrences || 1) >= 2 ? `🔁${f.occurrences}× ` : '';
    const sev = SEV_EMOJI[f.severity] || '';
    return `  • ${sev} ${rec}[${CONV_CAT_LABEL[f.category] || f.category}] ${String(f.summary).slice(0, 60)} (${who})`;
  });
  const sevLine = ['alto', 'medio', 'baixo'].filter(s => bySeverity[s]).map(s => `${bySeverity[s]} ${s}`).join(' · ');
  const personLine = Object.entries(byPerson)
    .sort((a, b) => b[1] - a[1])
    .map(([pid, n]) => `${nameById[pid] || '—'} ${n}`)
    .slice(0, 8).join(', ');
  const hiddenN = findings.length - sample.length;
  const samples = sample.map(f => ({
    category: f.category, severity: f.severity, summary: f.summary, occurrences: f.occurrences,
  }));
  return {
    status: 'warning',
    detail: `🗣️ ${findings.length} falha(s) de conversa pra revisar (${sevLine}):\n${top.join('\n')}` +
      (hiddenN > 0 ? `\n  …+${hiddenN} (por pessoa: ${personLine})` : ''),
    samples,
  };
}

const ALL_CHECKS = [
  ['dream_recent',           checkDreamRecent],
  ['weekly_summary',         checkWeeklySummary],
  ['memories_embedding',     checkMemoriesEmbedding],
  ['overdue_tasks',          checkOverdueTasks],
  ['rejected_markers',       checkRejectedMarkers],
  ['actionable_no_marker',   checkActionableNoMarker],
  ['unknown_markers',        checkUnknownMarkers],
  ['silent_collaborators',   checkSilentCollaborators],
  ['stale_profiles',         checkStaleProfiles],
  ['events_without_reminders', checkEventsWithoutReminders],
  ['recurring_errors',       checkRecurringErrors],
  ['known_issues_regression', checkKnownIssuesRegression],
  ['provider_health',        checkProviderHealth],
  ['conversation_quality',   checkConversationQuality],
];

async function runHealthCheck() {
  const ranAt = new Date().toISOString();
  const checks = [];
  const fixes = [];
  for (const [name, fn] of ALL_CHECKS) {
    try {
      const result = await fn();
      const entry = { name, status: result.status, detail: result.detail };
      if (result.samples && result.samples.length > 0) entry.samples = result.samples;
      checks.push(entry);
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

module.exports = { runHealthCheck, checkProviderHealth };
