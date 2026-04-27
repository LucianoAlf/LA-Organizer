#!/usr/bin/env node
// src/rituals/dispatcher.js — Cron dispatcher executado pelo cron do sistema
// a cada 15 minutos. Lê user_preferences, decide quais rituais devem disparar
// agora em America/Sao_Paulo, garante idempotência via ritual_logs e dispara
// sendRitual do engine. Pode ser chamado direto via require('./dispatcher').run().
//
// Uso CLI:
//   node src/rituals/dispatcher.js                              # modo cron normal
//   node src/rituals/dispatcher.js --force=briefing_trabalho    # ignora horário
//   node src/rituals/dispatcher.js --force=briefing_trabalho --phone=5521981278047

// Resolve dependências do projeto (cwd-agnostic).
const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

// Carrega .env manualmente (sem depender de dotenv).
loadDotEnv(path.join(process.cwd(), '.env'));

const supabase = require('../supabase/client');
const { sendRitual, sendCoordinatorReport, getDndState, consolidateMemoryFor, decayExpiredMemories } = require('../engine');

const RITUAL_BY_DIRECTIVE = {
  briefing_pessoal: 'personal_briefing',
  briefing_trabalho: 'daily_briefing',
  fechamento: 'daily_closing',
  planejamento_semanal: 'weekly_planning',
  resumo_time: 'team_summary',
  retrospectiva_semanal: 'weekly_retrospective',
};

// Canonical names for observability logs (user-facing).
const CANONICAL_BY_RITUAL = {
  daily_briefing: 'briefing_trabalho',
  personal_briefing: 'briefing_pessoal',
  daily_closing: 'fechamento',
  weekly_planning: 'planejamento_semanal',
  team_summary: 'resumo_time',
  weekly_retrospective: 'retrospectiva_semanal',
};

// Coordinator report defaults — slot-aligned (15-min increments).
const TEAM_SUMMARY_DEFAULT_TIME = '19:30';      // weekdays only
const WEEKLY_RETRO_DEFAULT_TIME = '18:00';      // Sunday only
const MEMORY_CONSOLIDATION_TIME = '22:00';      // Sunday only
const COORDINATOR_ROLES = ['coordinator', 'director'];

// Default time for briefing_pessoal (until user_preferences gains a personal_briefing_time column).
const PERSONAL_BRIEFING_DEFAULT = '07:00';

// Insere um evento estruturado em ritual_logs. Falhas de log nunca derrubam o tick.
async function logRitualEvent(collaboratorId, type, status, detail = null, refDate = null) {
  try {
    const ymd = refDate || nowSaoPaulo().ymd;
    const { error } = await supabase.from('ritual_logs').insert({
      collaborator_id: collaboratorId,
      ritual_type: type,
      reference_date: ymd,
      status,
      detail: detail ? String(detail).slice(0, 500) : null,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
    });
    if (error) console.error(`[ritual_logs] insert err type=${type} status=${status}:`, error.message);
  } catch (err) {
    console.error('[ritual_logs] throw err:', err.message);
  }
}

function loadDotEnv(file) {
  try {
    const fs = require('fs');
    if (!fs.existsSync(file)) return;
    const txt = fs.readFileSync(file, 'utf-8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const k = m[1];
      let v = m[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch (err) {
    console.error('[Dispatcher] Falha ao ler .env:', err.message);
  }
}

// Retorna { hour, minute, dow, ymd } em America/Sao_Paulo.
function nowSaoPaulo() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  });
  const parts = fmt.formatToParts(new Date()).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const dow = dowMap[parts.weekday] ?? 0;
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  return { hour, minute, dow, ymd };
}

// time vem como "HH:MM" ou "HH:MM:SS"; arredonda para o slot de 15min.
function timeToSlot(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const slotMin = Math.floor(m / 15) * 15;
  return h * 60 + slotMin;
}

function currentSlot(now) {
  const slotMin = Math.floor(now.minute / 15) * 15;
  return now.hour * 60 + slotMin;
}

async function alreadySent(collaboratorId, ritualType, ymd) {
  const { data, error } = await supabase
    .from('ritual_logs')
    .select('id')
    .eq('collaborator_id', collaboratorId)
    .eq('ritual_type', ritualType)
    .eq('reference_date', ymd)
    .limit(1);
  if (error) {
    console.error('[Dispatcher] Erro ao consultar ritual_logs:', error.message);
    return false;
  }
  return Boolean(data && data.length);
}

// Coordinator-report variant of fireRitual. Uses sendCoordinatorReport instead
// of sendRitual (no AI call; deterministic builder).
async function fireCoordinatorReport(collab, ritualType, ymdRef) {
  const canonical = CANONICAL_BY_RITUAL[ritualType] || ritualType;
  const dnd = await getDndState(collab.id);
  if (dnd.active) {
    console.log(`[CoordReport] ${ritualType} skipped — DND active until ${dnd.until}`);
    await logRitualEvent(collab.id, canonical, 'skipped', `dnd_active until=${dnd.until}`, ymdRef);
    return false;
  }
  if (await alreadySent(collab.id, ritualType, ymdRef)) {
    console.log(`[CoordReport] ${ritualType} already sent for ${collab.phone.slice(-4)} on ${ymdRef}, skipping`);
    await logRitualEvent(collab.id, canonical, 'skipped', 'ja_enviado_hoje', ymdRef);
    return false;
  }
  try {
    const ok = await sendCoordinatorReport(collab.id, ritualType, ymdRef);
    if (!ok) {
      await logRitualEvent(collab.id, canonical, 'skipped', 'role_denied_or_build_empty', ymdRef);
      return false;
    }
    // Persist ritual_logs row for idempotency (same shape engine writes for normal rituals).
    await supabase.from('ritual_logs').insert({
      collaborator_id: collab.id,
      ritual_type: ritualType,
      reference_date: ymdRef,
      status: 'sent',
      sent_at: new Date().toISOString(),
    });
    await logRitualEvent(collab.id, canonical, 'sent', null, ymdRef);
    return true;
  } catch (err) {
    console.error(`[CoordReport] err ${ritualType}:`, err.message);
    await logRitualEvent(collab.id, canonical, 'error', err.message, ymdRef);
    return false;
  }
}

async function listCoordinators(filterPhone) {
  let q = supabase
    .from('collaborators')
    .select('id, full_name, phone, role, is_active, onboarding_completed')
    .eq('is_active', true)
    .eq('onboarding_completed', true)
    .in('role', COORDINATOR_ROLES);
  if (filterPhone) q = q.eq('phone', filterPhone);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function fireRitual(collab, ritualType, ymd) {
  const canonical = CANONICAL_BY_RITUAL[ritualType] || ritualType;
  // DND gate: skip outbound rituals while user is paused. Briefing for the
  // current day is "missed" if window covers it — by design (pendência continua
  // no banco; user vê no dia seguinte ou ao perguntar).
  const dnd = await getDndState(collab.id);
  if (dnd.active) {
    console.log(`[Ritual] ${ritualType} skipped — DND active until ${dnd.until}${dnd.reason ? ' (' + dnd.reason + ')' : ''}`);
    await logRitualEvent(collab.id, canonical, 'skipped', `dnd_active until=${dnd.until}`, ymd);
    return false;
  }
  if (await alreadySent(collab.id, ritualType, ymd)) {
    console.log(`[Ritual] ${ritualType} already sent today for ${collab.phone.slice(-4)}, skipping`);
    await logRitualEvent(collab.id, canonical, 'skipped', 'ja_enviado_hoje', ymd);
    return false;
  }
  try {
    await sendRitual(collab.id, ritualType);
    await logRitualEvent(collab.id, canonical, 'sent', null, ymd);
    return true;
  } catch (err) {
    console.error(`[Ritual] Falha ao enviar ${ritualType} pra ${collab.full_name}:`, err.message);
    await logRitualEvent(collab.id, canonical, 'error', err.message, ymd);
    return false;
  }
}

async function listCollaborators(filterPhone) {
  let q = supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active, onboarding_completed, user_preferences(*)')
    .eq('is_active', true)
    .eq('onboarding_completed', true);
  if (filterPhone) q = q.eq('phone', filterPhone);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).filter(c => c.user_preferences);
}

/**
 * Executa o dispatcher.
 * @param {object} opts
 * @param {string} [opts.force] — 'briefing_trabalho' | 'fechamento' (ignora horário)
 * @param {string} [opts.phone] — filtra para um único colaborador
 */
async function run(opts = {}) {
  const now = nowSaoPaulo();
  console.log(`[Dispatcher] now=${now.ymd} ${String(now.hour).padStart(2,'0')}:${String(now.minute).padStart(2,'0')} dow=${now.dow}${opts.force ? ' force=' + opts.force : ''}${opts.phone ? ' phone=' + opts.phone.slice(-4) : ''}`);

  const collabs = await listCollaborators(opts.phone);
  if (!collabs.length) {
    console.log('[Dispatcher] Nenhum colaborador elegível.');
    return;
  }

  // Modo forçado: ignora time check e dispara o ritual pedido pra cada collab filtrado.
  if (opts.force) {
    const ritualType = RITUAL_BY_DIRECTIVE[opts.force];
    if (!ritualType) {
      console.error(`[Dispatcher] force inválido: ${opts.force}`);
      return;
    }
    // Coordinator reports go through a different path (role-gated, no AI).
    if (ritualType === 'team_summary' || ritualType === 'weekly_retrospective') {
      const coords = await listCoordinators(opts.phone);
      for (const c of coords) {
        await fireCoordinatorReport(c, ritualType, now.ymd);
      }
      return;
    }
    for (const c of collabs) {
      await fireRitual(c, ritualType, now.ymd);
    }
    return;
  }

  const slotNow = currentSlot(now);
  const isWeekend = now.dow === 0 || now.dow === 6;

  for (const c of collabs) {
    const p = c.user_preferences;
    try {
      // Briefing pessoal — todo dia (7h ou personal_briefing_time se existir)
      const personalTime = p.personal_briefing_time || PERSONAL_BRIEFING_DEFAULT;
      const pbSlot = timeToSlot(personalTime);
      if (pbSlot !== null && pbSlot === slotNow) {
        await fireRitual(c, 'personal_briefing', now.ymd);
      }
      // Briefing de trabalho — dias úteis
      if (!isWeekend) {
        const bSlot = timeToSlot(p.briefing_time);
        if (bSlot !== null && bSlot === slotNow) {
          await fireRitual(c, 'daily_briefing', now.ymd);
        }
      }
      // Fechamento — dias úteis
      if (!isWeekend) {
        const cSlot = timeToSlot(p.closing_time);
        if (cSlot !== null && cSlot === slotNow) {
          await fireRitual(c, 'daily_closing', now.ymd);
        }
      }
      // Planejamento semanal — só no dia configurado (default domingo=0) no horário configurado.
      if (Number.isInteger(p.planning_day) && p.planning_day === now.dow) {
        const wpSlot = timeToSlot(p.planning_time);
        if (wpSlot !== null && wpSlot === slotNow) {
          await fireRitual(c, 'weekly_planning', now.ymd);
        }
      }
    } catch (err) {
      console.error(`[Dispatcher] Erro processando ${c.full_name}:`, err.message);
    }
  }

  // Coordinator reports (role-gated, no AI). Slot-aligned 15-min increments.
  // - team_summary: weekdays at 19:30 (Mon-Fri).
  // - weekly_retrospective: Sundays at 18:00.
  try {
    const tsSlot = timeToSlot(TEAM_SUMMARY_DEFAULT_TIME);
    const wrSlot = timeToSlot(WEEKLY_RETRO_DEFAULT_TIME);
    if (!isWeekend && tsSlot !== null && tsSlot === slotNow) {
      const coords = await listCoordinators();
      for (const c of coords) await fireCoordinatorReport(c, 'team_summary', now.ymd);
    }
    if (now.dow === 0 && wrSlot !== null && wrSlot === slotNow) {
      const coords = await listCoordinators();
      for (const c of coords) await fireCoordinatorReport(c, 'weekly_retrospective', now.ymd);
    }
  } catch (err) {
    console.error('[Dispatcher] coordinator-reports erro:', err.message);
  }

  // Weekly memory consolidation — Sunday 22:00. Decays first (cheap), then
  // runs LLM-driven extraction per active+onboarded collaborator.
  if (opts.force === 'consolidacao_memoria' || (now.dow === 0 && timeToSlot(MEMORY_CONSOLIDATION_TIME) === slotNow)) {
    try {
      const decayed = await decayExpiredMemories();
      console.log(`[MemDecay] ${decayed} memory rows decayed`);
      const all = await listCollaborators(opts.phone);
      for (const c of all) {
        try { await consolidateMemoryFor(c); }
        catch (err) { console.error(`[MemConsolidate] err for ${c.full_name}:`, err.message); }
      }
    } catch (err) {
      console.error('[Dispatcher] memory-consolidation erro:', err.message);
    }
  }

  // Reminder dispatcher — every tick, fires pending one-shot reminders.
  try {
    await checkReminders();
  } catch (err) {
    console.error('[Dispatcher] checkReminders erro:', err.message);
  }

  // Multi-reminder dispatcher — alertas pré-evento (1h antes, 15min antes, etc).
  // Fonte: tabela task_reminders. Não mexe no status da tarefa.
  try {
    await checkTaskReminders();
  } catch (err) {
    console.error('[Dispatcher] checkTaskReminders erro:', err.message);
  }

  // Deadline + overdue alerts — fire at most once per task per day, gated by
  // hour window so we don't spam at 3am. Window: 8h-19h, América/Sao_Paulo.
  // Override with --force-alerts for tests/manual triggers.
  if (opts['force-alerts'] || (now.hour >= 8 && now.hour < 19)) {
    try {
      await checkDeadlineAlerts(now.ymd);
    } catch (err) {
      console.error('[Dispatcher] checkDeadlineAlerts erro:', err.message);
    }
    try {
      await checkOverdueAlerts(now.ymd);
    } catch (err) {
      console.error('[Dispatcher] checkOverdueAlerts erro:', err.message);
    }
  }
}

// Compute YMD for "today + N days" in America/Sao_Paulo.
function ymdOffset(ymdToday, days) {
  const [y, m, d] = ymdToday.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// Returns true if a notification of `type` was already created today for this task+user.
async function alreadyNotifiedToday(collaboratorId, taskId, type, ymdToday) {
  const since = ymdToday + 'T00:00:00-03:00';
  const { data } = await supabase
    .from('notifications')
    .select('id')
    .eq('collaborator_id', collaboratorId)
    .eq('reference_id', taskId)
    .eq('notification_type', type)
    .gte('created_at', since)
    .limit(1);
  return Boolean(data && data.length);
}

// Deadline alert: tasks due tomorrow (status != done/cancelled).
async function checkDeadlineAlerts(ymdToday) {
  const tomorrow = ymdOffset(ymdToday, 1);
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, due_date, status')
    .eq('due_date', tomorrow)
    .not('status', 'in', '(done,cancelled)')
    .limit(200);
  if (error) {
    console.error('[DeadlineAlert] query err:', error.message);
    return;
  }
  if (!tasks || !tasks.length) return;

  // Resolve collaborators in batch + their preferences.
  const ids = [...new Set(tasks.map(t => t.assigned_to).filter(Boolean))];
  if (!ids.length) return;
  const { data: collabs } = await supabase
    .from('collaborators')
    .select('id, phone, full_name, is_active, user_preferences(notify_deadline_alerts)')
    .in('id', ids).eq('is_active', true);
  const byId = new Map((collabs || []).map(c => [c.id, c]));

  const whatsapp = require('../services/whatsapp');
  let sent = 0;
  for (const t of tasks) {
    const collab = byId.get(t.assigned_to);
    if (!collab || !collab.phone) continue;
    const pref = collab.user_preferences && collab.user_preferences.notify_deadline_alerts;
    if (pref === false) continue; // user opted out
    const dnd = await getDndState(collab.id);
    if (dnd.active) {
      await logRitualEvent(collab.id, 'alerta_prazo', 'skipped', `dnd_active until=${dnd.until}`, ymdToday);
      continue;
    }
    if (await alreadyNotifiedToday(collab.id, t.id, 'deadline_alert', ymdToday)) {
      await logRitualEvent(collab.id, 'alerta_prazo', 'skipped', `ja_notificado:${String(t.id).slice(0,8)}`, ymdToday);
      continue;
    }
    const nick = collab.full_name === 'Luciano Alf' ? 'Alf' : (collab.full_name || '').split(' ')[0] || 'amigo';
    const text = `⏳ ${nick}, lembrete: *${t.title}* vence amanhã. Tá encaminhado?`;
    try {
      await whatsapp.sendMessage(collab.phone, text);
      await supabase.from('notifications').insert({
        collaborator_id: collab.id,
        notification_type: 'deadline_alert',
        title: `${t.title} vence amanhã`,
        body: text,
        reference_type: 'task',
        reference_id: t.id,
        channel: 'whatsapp',
        status: 'sent',
        sent_at: new Date().toISOString(),
      });
      await supabase.from('conversation_history').insert({
        collaborator_id: collab.id,
        direction: 'outbound',
        message_type: 'text',
        content: text,
      });
      await logRitualEvent(collab.id, 'alerta_prazo', 'sent', `task:${String(t.id).slice(0,8)}`, ymdToday);
      sent++;
    } catch (err) {
      console.error(`[DeadlineAlert] send err for ${String(t.id).slice(0,8)}:`, err.message);
      await logRitualEvent(collab.id, 'alerta_prazo', 'error', `${String(t.id).slice(0,8)}:${err.message}`, ymdToday);
    }
  }
  if (sent) console.log(`[DeadlineAlert] fired ${sent} deadline alert(s) for ${tomorrow}`);
}

// Overdue alert: tasks due before today (status != done/cancelled).
async function checkOverdueAlerts(ymdToday) {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, due_date, status')
    .lt('due_date', ymdToday)
    .not('status', 'in', '(done,cancelled)')
    .limit(200);
  if (error) {
    console.error('[OverdueAlert] query err:', error.message);
    return;
  }
  if (!tasks || !tasks.length) return;

  const ids = [...new Set(tasks.map(t => t.assigned_to).filter(Boolean))];
  if (!ids.length) return;
  const { data: collabs } = await supabase
    .from('collaborators')
    .select('id, phone, full_name, is_active, user_preferences(notify_overdue_alerts)')
    .in('id', ids).eq('is_active', true);
  const byId = new Map((collabs || []).map(c => [c.id, c]));

  // Compute days late in JS using ymdToday as anchor.
  function daysLate(dueYmd) {
    const [y1, m1, d1] = ymdToday.split('-').map(Number);
    const [y2, m2, d2] = dueYmd.split('-').map(Number);
    const a = Date.UTC(y1, m1 - 1, d1);
    const b = Date.UTC(y2, m2 - 1, d2);
    return Math.max(1, Math.round((a - b) / 86400000));
  }

  const whatsapp = require('../services/whatsapp');
  let sent = 0;
  for (const t of tasks) {
    const collab = byId.get(t.assigned_to);
    if (!collab || !collab.phone) continue;
    const pref = collab.user_preferences && collab.user_preferences.notify_overdue_alerts;
    if (pref === false) continue;
    const dnd = await getDndState(collab.id);
    if (dnd.active) {
      await logRitualEvent(collab.id, 'alerta_atraso', 'skipped', `dnd_active until=${dnd.until}`, ymdToday);
      continue;
    }
    if (await alreadyNotifiedToday(collab.id, t.id, 'overdue_alert', ymdToday)) {
      await logRitualEvent(collab.id, 'alerta_atraso', 'skipped', `ja_notificado:${String(t.id).slice(0,8)}`, ymdToday);
      continue;
    }
    const n = daysLate(t.due_date);
    const text = `🔴 *${t.title}* tá atrasada ${n} dia${n > 1 ? 's' : ''}. Resolve hoje ou reagenda?`;
    try {
      await whatsapp.sendMessage(collab.phone, text);
      await supabase.from('notifications').insert({
        collaborator_id: collab.id,
        notification_type: 'overdue_alert',
        title: `${t.title} atrasada ${n}d`,
        body: text,
        reference_type: 'task',
        reference_id: t.id,
        channel: 'whatsapp',
        status: 'sent',
        sent_at: new Date().toISOString(),
      });
      await supabase.from('conversation_history').insert({
        collaborator_id: collab.id,
        direction: 'outbound',
        message_type: 'text',
        content: text,
      });
      await logRitualEvent(collab.id, 'alerta_atraso', 'sent', `task:${String(t.id).slice(0,8)} late=${n}d`, ymdToday);
      sent++;
    } catch (err) {
      console.error(`[OverdueAlert] send err for ${String(t.id).slice(0,8)}:`, err.message);
      await logRitualEvent(collab.id, 'alerta_atraso', 'error', `${String(t.id).slice(0,8)}:${err.message}`, ymdToday);
    }
  }
  if (sent) console.log(`[OverdueAlert] fired ${sent} overdue alert(s) (today=${ymdToday})`);
}

// Multi-reminder: dispara linhas de task_reminders pendentes (sent_at IS NULL,
// remind_at <= now). Cada linha vira um WA "⏰ <label>: *<task title>*". A tarefa
// fica intacta (status, due_date) — esses são alertas pré-evento, não one-shots.
async function checkTaskReminders() {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('task_reminders')
    .select('id, task_id, remind_at, label, tasks(id, title, assigned_to, status)')
    .is('sent_at', null)
    .lte('remind_at', nowIso)
    .limit(50);
  if (error) {
    console.error('[TaskReminders] query err:', error.message);
    return;
  }
  if (!due || !due.length) return;
  const ids = [...new Set(due.map(r => r.tasks?.assigned_to).filter(Boolean))];
  if (!ids.length) return;
  const { data: collabs } = await supabase
    .from('collaborators').select('id, phone, full_name, is_active').in('id', ids);
  const byId = new Map((collabs || []).map(c => [c.id, c]));
  const whatsapp = require('../services/whatsapp');
  let fired = 0;
  for (const r of due) {
    const t = r.tasks;
    const collab = t && byId.get(t.assigned_to);
    if (!collab || !collab.is_active || !collab.phone) {
      console.warn(`[TaskReminders] skip ${String(r.id).slice(0,8)} — no active collaborator`);
      // Mark as sent anyway so it doesn't loop forever.
      await supabase.from('task_reminders').update({ sent_at: new Date().toISOString() }).eq('id', r.id);
      continue;
    }
    if (t.status === 'done' || t.status === 'cancelled') {
      // Tarefa já concluída — não envia mais alerta. Marca como sent.
      await supabase.from('task_reminders').update({ sent_at: new Date().toISOString() }).eq('id', r.id);
      continue;
    }
    const dnd = await getDndState(collab.id);
    if (dnd.active) {
      // Não consome o reminder — sent_at fica null, vai retry no próximo tick após DND.
      console.log(`[TaskReminders] defer ${String(r.id).slice(0,8)} — DND until ${dnd.until}`);
      continue;
    }
    const labelStr = r.label ? `${r.label}: ` : 'Lembrete: ';
    const text = `⏰ ${labelStr}*${t.title}*`;
    try {
      await whatsapp.sendMessage(collab.phone, text);
      await supabase.from('task_reminders').update({ sent_at: new Date().toISOString() }).eq('id', r.id);
      await supabase.from('conversation_history').insert({
        collaborator_id: collab.id,
        direction: 'outbound',
        message_type: 'text',
        content: text,
      });
      await logRitualEvent(collab.id, 'lembrete', 'sent', `reminder:${String(r.id).slice(0,8)} task:${String(t.id).slice(0,8)}`);
      fired++;
    } catch (err) {
      console.error(`[TaskReminders] send err for ${String(r.id).slice(0,8)}:`, err.message);
      await logRitualEvent(collab.id, 'lembrete', 'error', `${String(r.id).slice(0,8)}:${err.message}`);
    }
  }
  if (fired) console.log(`[TaskReminders] fired ${fired} pre-event alert(s)`);
}

// Pending reminders: tasks where remind_at <= now AND status not done/cancelled.
// Sends "⏰ Lembrete: <title>" to the assignee, then marks task as done (one-shot).
async function checkReminders() {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, remind_at, status')
    .not('remind_at', 'is', null)
    .lte('remind_at', nowIso)
    .not('status', 'in', '(done,cancelled)')
    .limit(50);
  if (error) {
    console.error('[Reminders] query err:', error.message);
    return;
  }
  if (!due || !due.length) return;
  console.log(`[Reminders] ${due.length} pending reminder(s) to fire`);

  // Resolve phones in batch.
  const ids = [...new Set(due.map(t => t.assigned_to).filter(Boolean))];
  const { data: collabs } = await supabase
    .from('collaborators').select('id, phone, full_name, is_active').in('id', ids);
  const byId = new Map((collabs || []).map(c => [c.id, c]));

  const whatsapp = require('../services/whatsapp');
  for (const t of due) {
    const collab = byId.get(t.assigned_to);
    if (!collab || !collab.is_active || !collab.phone) {
      console.warn(`[Reminders] task ${String(t.id).slice(0,8)} skipped — no active collaborator/phone`);
      continue;
    }
    const dnd = await getDndState(collab.id);
    if (dnd.active) {
      console.log(`[Reminders] defer ${String(t.id).slice(0,8)} — DND until ${dnd.until}`);
      continue; // don't mark task done; will fire on next tick after DND
    }
    const text = `⏰ Lembrete: ${t.title}`;
    try {
      await whatsapp.sendMessage(collab.phone, text);
      const { error: upErr } = await supabase.from('tasks').update({
        status: 'done',
        completed_at: new Date().toISOString(),
        completed_by: collab.id,
      }).eq('id', t.id);
      if (upErr) {
        console.error(`[Reminders] mark-done err for ${String(t.id).slice(0,8)}:`, upErr.message);
      } else {
        console.log(`[Reminders] fired ${String(t.id).slice(0,8)} "${t.title.slice(0,40)}" → ${collab.phone.slice(-4)}`);
      }
      // Log to conversation_history (outbound).
      await supabase.from('conversation_history').insert({
        collaborator_id: collab.id,
        direction: 'outbound',
        message_type: 'text',
        content: text,
      });
    } catch (err) {
      console.error(`[Reminders] send err for ${String(t.id).slice(0,8)}:`, err.message);
    }
  }
}

function parseArgs(argv) {
  const opts = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) opts[m[1]] = m[2];
    else if (a.startsWith('--')) opts[a.slice(2)] = true;
  }
  return opts;
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  run(opts)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[Dispatcher] Erro fatal:', err);
      process.exit(1);
    });
}

module.exports = { run, parseOnboardingMarker: undefined };
