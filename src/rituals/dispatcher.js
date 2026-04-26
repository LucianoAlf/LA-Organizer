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
const { sendRitual } = require('../engine');

const RITUAL_BY_DIRECTIVE = {
  briefing_pessoal: 'personal_briefing',
  briefing_trabalho: 'daily_briefing',
  fechamento: 'daily_closing',
};

// Default time for briefing_pessoal (until user_preferences gains a personal_briefing_time column).
const PERSONAL_BRIEFING_DEFAULT = '07:00';

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

async function fireRitual(collab, ritualType, ymd) {
  if (await alreadySent(collab.id, ritualType, ymd)) {
    console.log(`[Ritual] ${ritualType} already sent today for ${collab.phone.slice(-4)}, skipping`);
    return false;
  }
  try {
    await sendRitual(collab.id, ritualType);
    return true;
  } catch (err) {
    console.error(`[Ritual] Falha ao enviar ${ritualType} pra ${collab.full_name}:`, err.message);
    try {
      await supabase.from('ritual_logs').insert({
        collaborator_id: collab.id,
        ritual_type: ritualType,
        reference_date: ymd,
        status: 'ignored',
      });
    } catch (_) {}
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
    } catch (err) {
      console.error(`[Dispatcher] Erro processando ${c.full_name}:`, err.message);
    }
  }

  // Reminder dispatcher — every tick, fires pending one-shot reminders.
  try {
    await checkReminders();
  } catch (err) {
    console.error('[Dispatcher] checkReminders erro:', err.message);
  }
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
