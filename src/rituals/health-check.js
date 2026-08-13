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
const { selectEventsWithoutReminder } = require('./event-reminder-audit');
const { classificarActionable } = require('../lib/actionable-triage');

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
    .not('assigned_to', 'is', null)        // só tarefas com dono individual: é o universo que o
    .gte('due_date', oldest)               // chaser checkOverdueAlerts realmente cobre. Tarefa de
    .lt('due_date', today)                 // grupo tem trilha própria (ver checkUncoveredGroups).
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
  //  (c) UNKNOWN_MARKER_STRIPPED → tem check dedicado (checkUnknownMarkers) → dupla-contagem.
  //  (d) LEAK_BLOCKED → é o sanitizador BLOQUEANDO um vazamento (resultado DESEJADO, proteção
  //      ativa), não uma falha. Auditoria 14/06: inflavam o "12 markers rejeitados".
  const { data, error } = await supabase
    .from('marker_logs')
    .select('marker_type, reason')
    .eq('result', 'rejected')
    .gte('created_at', isoHoursAgo(24));
  if (error) throw error;
  const BENIGN_TYPES = new Set(['ACTIONABLE_NO_MARKER', 'UNKNOWN_MARKER_STRIPPED', 'LEAK_BLOCKED']);
  const real = (data || []).filter(r =>
    !BENIGN_TYPES.has(r.marker_type) &&
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
// Benigno = NÃO é "ação verbalizada sem persistir". Auditoria 14/06: dos 15 ACTIONABLE,
// a maioria eram confirmações curtas ("Ok"/"Sim"/"Confirma"/"👍") e o scaffold de intent
// interno ("[CONTEXTO INTERNO — não verbalize"), que o user disparou ao confirmar algo.
function _isBenignActionable(reasonOrText) {
  let t = String(reasonOrText || '').replace(/^text:/i, '').trim();
  if (/\[CONTEXTO INTERNO|não verbalize ao usu/i.test(t)) return true; // scaffold de intent
  const firstLine = (t.split('\n')[0] || '').trim();
  if (!firstLine) return true;
  // só emoji/pontuação (👍🏼, 👍, …)
  if (firstLine.replace(/[\s\p{P}\p{S}\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '') === '') return true;
  // confirmação/ack de uma palavra ("Ok", "Sim", "Confirma", "Beleza")
  if (firstLine.split(/\s+/).filter(Boolean).length <= 1) return true;
  return false;
}

// Janela do "mesmo turno". Assimétrica de propósito: o alerta nasce logo que a resposta sai,
// e a persistência (ou a recusa dela) vem depois — no caso Matheus a 3ª tentativa de
// MEMORY_SAVE caiu 26s adiante.
const ANM_JANELA_ANTES_MS = 20_000;
const ANM_JANELA_DEPOIS_MS = 90_000;

async function checkActionableNoMarker() {
  // Medido em 08/08 sobre 14 dias: 18 alertas, ~4 reais. O resto é conversa, listagem,
  // pergunta e recuperação pelo auto-retry. Como este check vai TODO DIA pro WhatsApp do Alf
  // e do Hugo, ruído nessa proporção faz o alerta parar de ser lido — e o dia em que for
  // real ninguém vê. Classificar exige saber o que mais aconteceu NO TURNO, então carrega os
  // dois conjuntos e cruza em memória.
  const desdeIso = isoHoursAgo(24);
  const [alertasRes, turnoRes] = await Promise.all([
    supabase.from('marker_logs')
      .select('created_at, reason, raw_excerpt, collaborator_id, collaborators:collaborator_id(full_name)')
      .eq('marker_type', 'ACTIONABLE_NO_MARKER').eq('result', 'rejected')
      .gte('created_at', desdeIso).order('created_at', { ascending: false }),
    supabase.from('marker_logs')
      .select('created_at, marker_type, result, reason, collaborator_id')
      .neq('marker_type', 'ACTIONABLE_NO_MARKER')
      .gte('created_at', new Date(Date.parse(desdeIso) - ANM_JANELA_ANTES_MS).toISOString())
      .limit(3000),
  ]);
  if (alertasRes.error) throw alertasRes.error;

  const porColab = new Map();
  for (const m of (turnoRes.data || [])) {
    const k = String(m.collaborator_id);
    if (!porColab.has(k)) porColab.set(k, []);
    porColab.get(k).push(m);
  }

  const real = [];
  for (const r of (alertasRes.data || [])) {
    const t = Date.parse(r.created_at);
    const doTurno = (porColab.get(String(r.collaborator_id)) || []).filter((m) => {
      const dt = Date.parse(m.created_at) - t;
      return dt >= -ANM_JANELA_ANTES_MS && dt <= ANM_JANELA_DEPOIS_MS;
    });
    const v = classificarActionable(r.raw_excerpt, doTurno);
    if (v.real) real.push({ ...r, motivo: v.motivo, detalhe: v.detalhe });
  }

  const count = real.length;
  const samples = real.slice(0, 5);
  const brutos = (alertasRes.data || []).length;
  const sufixo = brutos > count ? ` (${brutos - count} ruído filtrado)` : '';

  if (count === 0) return { status: 'ok', detail: `0 ACTIONABLE_NO_MARKER${sufixo}`, samples };

  // A causa no título é o que torna o alerta acionável: "MEMORY_SAVE (schema_invalid)" leva
  // direto ao parser; "4 ACTIONABLE_NO_MARKER" não leva a lugar nenhum.
  const causas = [...new Set(real.map((r) => r.detalhe).filter(Boolean))].slice(0, 3).join(', ');
  const comCausa = causas ? ` — causa: ${causas}` : '';
  if (count <= WARN_THRESHOLDS.actionableNoMarker) {
    return { status: 'ok', detail: `${count} ACTIONABLE_NO_MARKER em 24h${sufixo}${comCausa}`, samples };
  }
  return {
    status: 'warning',
    detail: `${count} ACTIONABLE_NO_MARKER em 24h${sufixo} — TOM verbalizou ação SEM persistir${comCausa}`,
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
  // AUDIT-QA-PROFILE-NOISE (13/08): os perfis do Replay Lab ("[QA] Replay 01..04", criados
  // 05/08) são fixtures de teste — não têm dono e por desenho não conversam. Eles entravam
  // aqui todo dia como "colaboradores sem conversa 7+ dias", ocupando a primeira linha da
  // auditoria das 07h com um alarme que ninguém pode resolver. A spec do Replay Lab já previa
  // "QA fora das métricas" (trava 3); este check tinha ficado de fora. Gate pelo prefixo do
  // nome, que é o mesmo contrato que o sweep do lab usa pra achar os perfis.
  const ehPerfilQA = (nome) => /^\s*\[QA\]/i.test(String(nome || ''));
  // Tabela correta é `conversation_history` (a antiga `messages` nunca existiu).
  for (const c of (collabs || [])) {
    if (SYSTEM_NAMES.has(String(c.full_name || '').trim().toLowerCase())) continue;
    if (ehPerfilQA(c.full_name)) continue;
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
// CHECK 9 — Eventos próximos (7d) sem lembrete PENDENTE
// AUDIT-CHECK9-PENDING (28/06): antes contava event_reminders TOTAL (incluía sent) → cego a
// evento futuro cuja única row já disparou (reschedule-orphan, EVENT-RESCHED-REMINDER-*). Agora
// conta PENDENTE (sent_at IS NULL) + janela 7d + regra de lead >24h (selectEventsWithoutReminder,
// evita FP do lembrete do dia já enviado). Exclui templates de recorrência e data_classification
// != real (espelha a visibilidade do PWA — não flagueia o que o usuário nem vê).
// ─────────────────────────────────────────────────────────────────
async function checkEventsWithoutReminders() {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const in7d = new Date(nowMs + 7 * 24 * 3600_000).toISOString();
  const { data: events, error } = await supabase
    .from('events')
    .select('id, title, start_at')
    .eq('data_classification', 'real')
    .or('recurrence_rule.is.null,recurrence_parent_id.not.is.null') // exclui TEMPLATES (hidden)
    .gte('start_at', nowIso)
    .lte('start_at', in7d)
    .neq('status', 'cancelled');
  if (error) throw error;
  if (!events || events.length === 0) return { status: 'ok', detail: 'Sem eventos nos próximos 7 dias' };
  const withCounts = [];
  for (const ev of events) {
    const { count } = await supabase
      .from('event_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev.id)
      .is('sent_at', null); // PENDENTE, não total
    withCounts.push({ title: ev.title, start_at: ev.start_at, pendingCount: count || 0 });
  }
  const noReminder = selectEventsWithoutReminder(withCounts, nowMs);
  if (noReminder.length === 0) return { status: 'ok', detail: `${events.length} eventos próximos, todos com lembrete pendente` };
  return { status: 'warning', detail: `${noReminder.length}/${events.length} eventos sem lembrete pendente: ${noReminder.slice(0, 3).join(', ')}` };
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
  // Padrões BENIGNOS que não são erro: scaffold de contexto interno injetado no prompt
  // ("[CONTEXTO INTERNO — não verbalize"), não uma falha. Auditoria 14/06: contava 3x como erro.
  const BENIGN_LOG_RE = /\[CONTEXTO INTERNO|não verbalize ao usu/i;
  const tally = new Map();
  for (const line of lines) {
    // formato esperado: "2026-05-15T19:39:30: ..."
    const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}):/);
    if (!m) continue;
    if (BENIGN_LOG_RE.test(line)) continue; // scaffold interno, não erro
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
// CONV_CAT_LABEL + formatConvQuality (puros) → ./conv-quality-format (testável isolado).

// Janela do RELATÓRIO DO DIA: só os achados vistos na última rodada (~24h). A detecção
// do Dream já varre 24h de conversa; 20h isola a rodada de hoje sem reimprimir a de ontem
// (a borda de 24h colheria a rodada anterior). ANTES era WINDOW_DAYS*24 = 7 dias → a mesma
// falha reaparecia por 7 manhãs seguidas (regressão AUDIT-REPORT-7D-WINDOW, 19→20/06).
async function checkConversationQuality() {
  const REPORT_WINDOW_HOURS = 20;
  const { formatConvQuality } = require('./conv-quality-format');
  const windowIso = isoHoursAgo(REPORT_WINDOW_HOURS);
  // findings abertos da JANELA (atividade recente) + veredito de auto-triagem
  const { data, error } = await supabase
    .from('tom_audit_findings')
    .select('id, category, severity, summary, occurrences, collaborator_id, auto_triage, collaborators:collaborator_id(full_name)')
    .in('status', ['novo', 'confirmado'])
    .gte('last_seen', windowIso)
    .order('occurrences', { ascending: false })
    .limit(200);
  if (error) throw error;
  // contagem de inativos (abertos, fora da janela) — só número, não polui o corpo
  const { count: inactiveCount } = await supabase
    .from('tom_audit_findings')
    .select('id', { count: 'exact', head: true })
    .in('status', ['novo', 'confirmado'])
    .lt('last_seen', windowIso);
  return formatConvQuality(data || [], { inactiveCount: inactiveCount || 0 });
}

// CHECK — Auto-triagem dos findings de conversa (grava auto_triage; roda ANTES do conversation_quality).
async function checkFindingTriage() {
  const { triageOpenFindings } = require('../services/finding-triage');
  const { chat } = require('../ai/provider');
  const r = await triageOpenFindings(supabase, chat);
  return { status: 'ok', detail: `🧭 triagem: ${r.suppressed} já-corrigidos · ${r.regressions} regressão(ões) · ${r.kept} mantidos` };
}

// ─────────────────────────────────────────────────────────────────
// CHECK — Churn de pacote de grupo (B, 20/06): containers (is_group) DUPLICADOS
// visíveis no mês pro mesmo (grupo, título). Rede de segurança do RECUR-PACKAGE-CHURN —
// o motor parou de duplicar em 13/06; se voltar, isto flagra no MESMO dia (antes da Rose).
// ─────────────────────────────────────────────────────────────────
async function checkGroupPackageChurn() {
  const { findDuplicatePackages } = require('./package-churn');
  const ym = todayBrt().slice(0, 7);
  const { data, error } = await supabase
    .from('tasks')
    .select('assigned_group_id, title, status, due_date')
    .eq('is_group', true)
    .is('recurrence_rule', null)            // só instâncias (template não renderiza)
    .neq('status', 'cancelled')
    .eq('data_classification', 'real')
    .not('assigned_group_id', 'is', null);
  if (error) throw error;
  const rows = (data || []).map((r) => ({
    group_id: r.assigned_group_id, title: r.title, status: r.status, due_date: r.due_date,
  }));
  const dups = findDuplicatePackages(rows, ym);
  if (!dups.length) return { status: 'ok', detail: 'Nenhum pacote de grupo duplicado no mês' };
  // Nomes dos grupos flagrados (query leve só pros ids afetados).
  let nameById = new Map();
  try {
    const ids = [...new Set(dups.map((d) => d.group_id))];
    const { data: gs } = await supabase.from('work_groups').select('id, name').in('id', ids);
    nameById = new Map((gs || []).map((g) => [g.id, g.name]));
  } catch (_) { /* nome é nice-to-have */ }
  const list = dups.slice(0, 6)
    .map((d) => `${nameById.get(d.group_id) || String(d.group_id).slice(0, 8)}: "${d.title}" ×${d.count}`)
    .join('; ');
  return { status: 'warning', detail: `🧩 ${dups.length} pacote(s) de grupo duplicado(s) no mês (churn de recorrência): ${list}` };
}

// ─────────────────────────────────────────────────────────────────
// CHECK — Grupos com atrasada e cobrança (preset 'overdue') desligada
// ─────────────────────────────────────────────────────────────────
// Espelha checkOverdueTasks no eixo de GRUPO. Tarefa de grupo é cobrada por
// dispatchGroupReports (preset 'overdue'), não pelo chaser individual — então o
// check individual NÃO deve contá-la (ver filtro em checkOverdueTasks) e este
// check vigia grupos descobertos. Reusa queryGroupTasks (fonte única: retroativa,
// done-twin, molde e dedup já tratados) p/ não reintroduzir GROUPREPORT-DONE-TWIN-OVERDUE.
async function checkUncoveredGroups() {
  const { queryGroupTasks } = require('../services/group-report-builder');
  const { summarizeUncoveredGroups } = require('../services/uncovered-groups');
  const today = todayBrt();
  const { data: groups, error: gErr } = await supabase.from('work_groups').select('id, name');
  if (gErr) throw gErr;
  if (!groups || !groups.length) return { status: 'ok', detail: 'Nenhum grupo cadastrado' };
  const { data: settings, error: sErr } = await supabase
    .from('group_notification_settings')
    .select('group_id').eq('preset', 'overdue').eq('enabled', true);
  if (sErr) throw sErr;
  const coveredGroupIds = new Set((settings || []).map((s) => s.group_id));
  // Só consulta tarefas dos grupos NÃO cobertos (candidatos a descoberto).
  const tasksByGroup = new Map();
  for (const g of groups) {
    if (coveredGroupIds.has(g.id)) continue;
    try {
      const tasks = await queryGroupTasks(supabase, g.id);
      tasksByGroup.set(g.id, tasks || []);
    } catch (e) {
      console.error(`[uncovered_groups] queryGroupTasks ${String(g.id).slice(0, 8)}:`, e.message);
    }
  }
  const { count, groups: flagged } = summarizeUncoveredGroups({ groups, coveredGroupIds, tasksByGroup, today });
  if (count === 0) return { status: 'ok', detail: 'Nenhum grupo com atrasada descoberta' };
  const list = flagged.slice(0, 6).map((g) => `${g.name} (${g.overdue})`).join(', ');
  return { status: 'warning', detail: `🔴 ${count} grupo(s) com atrasada e cobrança desligada: ${list}` };
}

// ─────────────────────────────────────────────────────────────────
// CHECK — Paridade git↔produção (09/08). Dois incidentes no MESMO dia motivaram:
// (a) o agente de governança commitou um fix e o commit ficou só na VPS — o próximo
//     `reset --hard origin/main` teria apagado; (b) um deploy rodou `reset --hard` no meio da
// varredura dele e apagou do disco a correção ainda não commitada.
// As duas são silenciosas: nada quebra, nada loga, o trabalho some. Ver src/lib/git-paridade.js.
// ─────────────────────────────────────────────────────────────────
async function checkGitParidade() {
  const { avaliarParidade, lerEstadoGit } = require('../lib/git-paridade');
  return avaliarParidade(lerEstadoGit());
}

const ALL_CHECKS = [
  ['git_paridade',           checkGitParidade],
  ['dream_recent',           checkDreamRecent],
  ['weekly_summary',         checkWeeklySummary],
  ['memories_embedding',     checkMemoriesEmbedding],
  ['overdue_tasks',          checkOverdueTasks],
  ['uncovered_groups',       checkUncoveredGroups],
  ['rejected_markers',       checkRejectedMarkers],
  ['actionable_no_marker',   checkActionableNoMarker],
  ['unknown_markers',        checkUnknownMarkers],
  ['silent_collaborators',   checkSilentCollaborators],
  ['stale_profiles',         checkStaleProfiles],
  ['events_without_reminders', checkEventsWithoutReminders],
  ['recurring_errors',       checkRecurringErrors],
  ['known_issues_regression', checkKnownIssuesRegression],
  ['group_package_churn',    checkGroupPackageChurn],
  ['provider_health',        checkProviderHealth],
  ['finding_triage',         checkFindingTriage],
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

module.exports = { runHealthCheck, checkProviderHealth, checkGroupPackageChurn, checkUncoveredGroups, checkOverdueTasks };
