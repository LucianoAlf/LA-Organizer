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
const { sendRitual, sendCoordinatorReport, getDndState, consolidateMemoryFor, decayExpiredMemories, getRitualIntroDecision } = require('../engine');

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

// Sprint 11.1 Bloco D — Aderência diária. Roda 19h em dias úteis. Detecta sinais
// de "vida travando" (tasks atrasadas + projetos parados há 48h+) e cutuca UMA vez
// no fim do dia. Mensagem determinística (sem LLM). Threshold p/ disparar:
// >=2 tarefas atrasadas OU >=1 projeto parado. Senão, fica em silêncio.
const ADHERENCE_NUDGE_TIME = '19:00';
const ADHERENCE_PAUSE_HOURS = 48;
const ADHERENCE_MIN_OVERDUE = 2;
const ADHERENCE_MAX_OVERDUE_LIST = 5;
const ADHERENCE_MAX_PROJECTS_LIST = 5;

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

// Sprint 21 — calendário para rituais mensais (America/Sao_Paulo via nowSaoPaulo)
function isFirstMondayOfMonth(date) {
  if (date.getDay() !== 1) return false; // 1 = segunda
  return date.getDate() <= 7;
}
function isLastFridayOfMonth(date) {
  if (date.getDay() !== 5) return false; // 5 = sexta
  const next = new Date(date); next.setDate(date.getDate() + 7);
  return next.getMonth() !== date.getMonth();
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

// Sprint 21 — liderança = director + coordinator + manager (ativos com user_preferences)
async function listLeadership() {
  const { data, error } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, role, unit, is_active, onboarding_completed, user_preferences(*)')
    .in('role', ['director', 'coordinator', 'manager'])
    .eq('is_active', true);
  if (error) {
    console.error('[listLeadership] failed:', error.message);
    return [];
  }
  return (data || []).filter(c => c.user_preferences);
}

// Sprint 21 — Planejamento Mensal (primeira segunda do mês)
async function checkMonthlyPlanning(now) {
  const dateForCal = (now && now.date) ? now.date : new Date(`${now.ymd}T${String(now.hour).padStart(2,'0')}:${String(now.minute).padStart(2,'0')}:00-03:00`);
  if (!isFirstMondayOfMonth(dateForCal)) return;
  const collabs = await listLeadership();
  const ymdToday = now.ymd || nowSaoPaulo().ymd;
  for (const c of collabs) {
    const time = c.user_preferences?.monthly_planning_time || '07:00';
    if (currentSlot(now) !== timeToSlot(time)) continue;
    if (await alreadySent(c.id, 'monthly_planning', ymdToday)) continue;
    try {
      const decision = await getRitualIntroDecision(c.id, 'monthly_planning');
      if (decision === 'show_intro') {
        await sendRitual(c.id, 'monthly_planning_intro');
        await logRitualEvent(c.id, 'monthly_planning', 'intro_shown', null, ymdToday);
      } else if (decision === 'send_ritual') {
        await sendRitual(c.id, 'monthly_planning');
        await logRitualEvent(c.id, 'monthly_planning', 'sent', null, ymdToday);
      } else { // 'skip_saturated'
        await logRitualEvent(c.id, 'monthly_planning', 'skipped', 'saturated', ymdToday);
      }
    } catch (err) {
      console.error('[checkMonthlyPlanning]', c.full_name, err.message);
    }
  }
}

// Sprint 21 — Fechamento Mensal (última sexta do mês)
async function checkMonthlyClosing(now) {
  const dateForCal = (now && now.date) ? now.date : new Date(`${now.ymd}T${String(now.hour).padStart(2,'0')}:${String(now.minute).padStart(2,'0')}:00-03:00`);
  if (!isLastFridayOfMonth(dateForCal)) return;
  const collabs = await listLeadership();
  const ymdToday = now.ymd || nowSaoPaulo().ymd;
  for (const c of collabs) {
    const time = c.user_preferences?.monthly_closing_time || '18:00';
    if (currentSlot(now) !== timeToSlot(time)) continue;
    if (await alreadySent(c.id, 'monthly_closing', ymdToday)) continue;
    try {
      const decision = await getRitualIntroDecision(c.id, 'monthly_closing');
      if (decision === 'show_intro') {
        await sendRitual(c.id, 'monthly_closing_intro');
        await logRitualEvent(c.id, 'monthly_closing', 'intro_shown', null, ymdToday);
      } else if (decision === 'send_ritual') {
        await sendRitual(c.id, 'monthly_closing');
        await logRitualEvent(c.id, 'monthly_closing', 'sent', null, ymdToday);
      } else { // 'skip_saturated'
        await logRitualEvent(c.id, 'monthly_closing', 'skipped', 'saturated', ymdToday);
      }
    } catch (err) {
      console.error('[checkMonthlyClosing]', c.full_name, err.message);
    }
  }
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

// Sprint 11 F2+ — Checklists Operacionais.
// Roda a cada tick do dispatcher. Detecta templates cujo dispatch_time
// caiu na janela [now-5min, now]. Cria op_checklist_completions e envia WhatsApp.
// dry=true: retorna lista de would_dispatch sem persistir nem enviar.
async function dispatchChecklists(now = new Date(), { dry = false, filterPhone = null } = {}) {
  const brStr = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
  const brNow = new Date(brStr);
  const dow = brNow.getDay() === 0 ? 7 : brNow.getDay(); // 1=seg…6=sab,7=dom

  const pad = n => String(n).padStart(2, '0');
  const timeNow = `${pad(brNow.getHours())}:${pad(brNow.getMinutes())}`;
  const brMinus5 = new Date(brNow.getTime() - 5 * 60 * 1000);
  const timeMinus5 = `${pad(brMinus5.getHours())}:${pad(brMinus5.getMinutes())}`;
  const today = brNow.toISOString().slice(0, 10);

  // Templates cujo dispatch_time caiu na janela
  const { data: templates, error: tErr } = await supabase
    .from('op_checklists')
    .select('*, op_checklist_items(id, description, sort_order, is_active)')
    .contains('days_of_week', [dow])
    .gte('dispatch_time', timeMinus5)
    .lte('dispatch_time', timeNow);

  if (tErr) { console.error('[dispatchChecklists] query templates:', tErr.message); return []; }
  if (!templates || templates.length === 0) return [];

  const whatsapp = require('../services/whatsapp');
  const results = [];

  for (const template of templates) {
    // Filter out soft-deleted items (is_active=false added in Sprint 2)
    template.op_checklist_items = (template.op_checklist_items || [])
      .filter(i => i.is_active !== false);

    let collabQuery = supabase
      .from('collaborators')
      .select('id, full_name, phone, unit, shift, function_role')
      .eq('function_role', template.function_role)
      .eq('shift', template.shift);
    if (filterPhone) collabQuery = collabQuery.eq('phone', filterPhone);

    const { data: collabs } = await collabQuery;
    if (!collabs || collabs.length === 0) {
      results.push({ template_id: template.id, reason: 'no_collaborators', would_dispatch: false });
      continue;
    }

    // Unidades com template específico (prioridade unit > 'all')
    let specificUnits = [];
    if (template.unit === 'all') {
      const { data: specifics } = await supabase
        .from('op_checklists')
        .select('unit')
        .eq('function_role', template.function_role)
        .eq('shift', template.shift)
        .neq('unit', 'all')
        .contains('days_of_week', [dow])
        .gte('dispatch_time', timeMinus5)
        .lte('dispatch_time', timeNow);
      specificUnits = (specifics || []).map(s => s.unit);
    }

    for (const collab of collabs) {
      if (template.unit === 'all' && specificUnits.includes(collab.unit)) {
        results.push({ collab_id: collab.id, template_id: template.id, reason: 'has_specific_template', would_dispatch: false });
        continue;
      }

      // Idempotência: já dispatched hoje?
      // NOTE: real columns are checklist_id and reference_date
      const { data: existing } = await supabase
        .from('op_checklist_completions')
        .select('id')
        .eq('collaborator_id', collab.id)
        .eq('checklist_id', template.id)
        .eq('reference_date', today)
        .maybeSingle();

      if (existing) {
        results.push({ collab_id: collab.id, template_id: template.id, reason: 'already_dispatched', would_dispatch: false });
        continue;
      }

      if (dry) {
        results.push({ collab_id: collab.id, collab_name: collab.full_name, template_id: template.id, template_name: template.name, reason: 'ok', would_dispatch: true });
        continue;
      }

      // Criar completion record
      // NOTE: real columns are checklist_id and reference_date
      const { data: completion, error: insErr } = await supabase
        .from('op_checklist_completions')
        .insert({
          collaborator_id: collab.id,
          checklist_id: template.id,
          reference_date: today,
          dispatched_at: now.toISOString(),
        })
        .select('id')
        .single();

      if (insErr) {
        console.warn(`[dispatchChecklists] insert collab=${collab.id} template=${template.id}:`, insErr.message);
        results.push({ collab_id: collab.id, template_id: template.id, reason: 'insert_failed', would_dispatch: false });
        continue;
      }

      // Montar mensagem WhatsApp com itens numerados
      const sortedItems = (template.op_checklist_items || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item, i) => `${i + 1}. ${item.description}`)
        .join('\n');

      const msg =
        `📋 *Checklist: ${template.name}*\n` +
        `Marque os itens concluídos:\n${sortedItems}\n\n` +
        `Responda com os números (ex: *1 3 5*) ou *feito tudo*.`;

      try {
        await whatsapp.sendMessage(collab.phone, msg);
        await supabase.from('conversation_history').insert({
          collaborator_id: collab.id,
          direction: 'outbound',
          content: msg,
        });
        results.push({ collab_id: collab.id, collab_name: collab.full_name, template_id: template.id, template_name: template.name, completion_id: completion.id, reason: 'dispatched', would_dispatch: true });
      } catch (sendErr) {
        console.error(`[dispatchChecklists] sendMessage collab=${collab.id}:`, sendErr.message);
        results.push({ collab_id: collab.id, template_id: template.id, reason: 'send_failed', would_dispatch: false });
      }
    }
  }

  if (results.length) console.log('[dispatchChecklists]', JSON.stringify(results));
  return results;
}

// Sprint 13 F3 — Audience-to-jobs helper. Mirrors Fatia 1 audience query logic.
async function createJobsFromAudience(announcementId, audience) {
  let q = supabase.from('collaborators').select('id, phone').not('phone', 'is', null);
  const aud = audience || {};
  if (aud.all !== true) {
    if (Array.isArray(aud.function_role) && aud.function_role.length) q = q.in('role', aud.function_role);
    if (Array.isArray(aud.unidade) && aud.unidade.length) q = q.in('unit', aud.unidade);
    if (Array.isArray(aud.turno) && aud.turno.length) q = q.in('shift', aud.turno);
  }
  const { data: recipients, error } = await q;
  if (error) {
    console.error('[createJobsFromAudience] erro buscando recipients:', error.message);
    return 0;
  }
  if (!recipients || recipients.length === 0) return 0;
  const jobs = recipients.map(r => ({
    announcement_id: announcementId,
    recipient_id: r.id,
    phone: r.phone,
    status: 'pending',
    retry_count: 0,
  }));
  const { error: jobErr } = await supabase.from('announcement_jobs').insert(jobs);
  if (jobErr) {
    console.error('[createJobsFromAudience] erro INSERT jobs:', jobErr.message);
    return 0;
  }
  return jobs.length;
}

// Sprint 13 F3 — Notifica coordenadores sobre aprovação/rejeição pelo diretor (via PWA).
// Chamado a cada tick antes de dispatchAnnouncements para garantir que jobs existam quando
// o broadcaster os pegar.
async function notifyCoordinators() {
  const whatsapp = require('../services/whatsapp');

  const { data: rows, error } = await supabase
    .from('announcements')
    .select(`
      id, status, audience, created_by, reviewed_by, rejection_reason,
      author:collaborators!created_by(id, full_name, phone),
      reviewer:collaborators!reviewed_by(id, full_name)
    `)
    .in('status', ['scheduled', 'rejected'])
    .not('reviewed_by', 'is', null)
    .is('coordinator_notified_at', null)
    .limit(20);

  if (error) {
    console.error('[notifyCoordinators] erro buscando:', error.message);
    return;
  }
  if (!rows || rows.length === 0) return;

  for (const ann of rows) {
    const author = ann.author;
    const reviewer = ann.reviewer;

    // Para anúncios aprovados (scheduled): garantir que jobs existam antes do broadcaster
    if (ann.status === 'scheduled') {
      const { data: existingJobs, error: jobCheckErr } = await supabase
        .from('announcement_jobs')
        .select('id')
        .eq('announcement_id', ann.id)
        .limit(1);

      if (!jobCheckErr && (!existingJobs || existingJobs.length === 0)) {
        const created = await createJobsFromAudience(ann.id, ann.audience);
        if (created === 0 && (ann.audience?.all === true || Object.keys(ann.audience || {}).length > 0)) {
          console.warn(`[notifyCoordinators] nenhum recipient para announcement ${ann.id} — broadcaster vai marcar como sent`);
        }
      }
    }

    if (!author?.phone) {
      // Sem phone — só marca como notificado para não tentar de novo
      await supabase
        .from('announcements')
        .update({ coordinator_notified_at: new Date().toISOString() })
        .eq('id', ann.id);
      continue;
    }

    let msg;
    if (ann.status === 'scheduled') {
      msg = `✅ Seu comunicado foi aprovado${reviewer?.full_name ? ' por ' + reviewer.full_name : ''} e será enviado em breve.`;
    } else {
      const motivoStr = ann.rejection_reason ? `Motivo: "${ann.rejection_reason}"` : 'Sem motivo informado.';
      msg = `❌ Seu comunicado foi rejeitado${reviewer?.full_name ? ' por ' + reviewer.full_name : ''}. ${motivoStr}`;
    }

    try {
      await whatsapp.sendMessage(author.phone, msg);
      await supabase
        .from('announcements')
        .update({ coordinator_notified_at: new Date().toISOString() })
        .eq('id', ann.id);
    } catch (err) {
      console.error(`[notifyCoordinators] falha enviando para ${author.phone}:`, err.message);
      // Não marca como notificado — tenta de novo no próximo tick
    }
  }
}

// Sprint 13 F1 — Cancel + retraction handler.
// Chamado a cada tick: (a) cancela jobs pending de anúncios cancelados,
// (b) envia mensagem de retratação para quem já recebeu.
async function handleCancellations(whatsapp) {
  const { data: cancelled, error } = await supabase
    .from('announcements')
    .select('id')
    .eq('status', 'cancelled')
    .eq('cancel_retraction_sent', false);
  if (error) { console.error('[dispatchAnnouncements] cancel query err:', error.message); return; }
  if (!cancelled || cancelled.length === 0) return;

  for (const ann of cancelled) {
    // Para jobs pendentes
    await supabase.from('announcement_jobs')
      .update({ status: 'cancelled' })
      .eq('announcement_id', ann.id)
      .eq('status', 'pending');

    // Retratação para jobs já enviados
    const { data: sentJobs } = await supabase
      .from('announcement_jobs')
      .select('phone')
      .eq('announcement_id', ann.id)
      .eq('status', 'sent');

    for (const job of (sentJobs || [])) {
      try {
        await whatsapp.sendMessage(job.phone, '[LA Music] — O comunicado anterior foi cancelado. Por favor, desconsidere.');
      } catch (err) {
        console.error('[dispatchAnnouncements] retraction send err:', err.message);
      }
    }

    await supabase.from('announcements')
      .update({ cancel_retraction_sent: true })
      .eq('id', ann.id);

    console.log(`[dispatchAnnouncements] cancellation handled for announcement=${ann.id.slice(0,8)}`);
  }
}

// Sprint 14 Fatia 2 — lembretes T-1 para tasks de evento
async function remindEventTasks(now = new Date()) {
  const whatsapp = require('../services/whatsapp');
  const nowIso = now.toISOString();

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select(`
      id, title, assigned_to, school_event_id,
      collaborator:assigned_to ( phone, full_name ),
      event:school_event_id ( title )
    `)
    .not('school_event_id', 'is', null)
    .in('status', ['pending', 'in_progress'])
    .lte('remind_at', nowIso)
    .is('reminded_at', null);

  if (error) {
    console.error('[remindEventTasks] query err:', error.message);
    return;
  }
  if (!tasks || tasks.length === 0) return;

  for (const task of tasks) {
    const phone = task.collaborator?.phone;
    if (!phone) {
      // Marca como notificado mesmo sem phone — evita reprocessamento infinito
      await supabase.from('tasks').update({ reminded_at: nowIso }).eq('id', task.id);
      continue;
    }
    const firstName = (task.collaborator?.full_name || '').split(' ')[0];
    const eventTitle = task.event?.title || 'evento';
    const greeting = firstName ? `${firstName}, ` : '';
    const msg = `⏰ ${greeting}lembrete: *${task.title}* (evento *${eventTitle}*) é amanhã. Tudo certo da sua parte?`;

    try {
      await whatsapp.sendMessage(phone, msg);
      await supabase.from('tasks').update({ reminded_at: nowIso }).eq('id', task.id);
      console.log(`[remindEventTasks] sent task=${task.id.slice(0, 8)} → ${phone.slice(-4)}`);
    } catch (err) {
      console.error(`[remindEventTasks] send err task=${task.id.slice(0, 8)}:`, err.message);
      // Não marca reminded_at — tenta novamente no próximo tick
    }
  }
}

// Sprint 15 F4 — Checklist com consequência: itens flagged como não-feito que tenham
// generates_request_type_id viram tasks operacionais automáticas.
// Roda a cada tick. Idempotência via lookup em tasks.notes (contém completion_id + item_id).
async function checkChecklistConsequences(now = new Date()) {
  // Olhar completions dos últimos 30 minutos (cobrindo possíveis falhas de tick anterior)
  const cutoff = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

  const { data: itemCompletions, error } = await supabase
    .from('op_checklist_item_completions')
    .select(`
      id, item_id, completion_id, is_checked, created_at,
      item:op_checklist_items!op_checklist_item_completions_item_id_fkey(
        id, description, generates_request_type_id, checklist_id
      ),
      completion:op_checklist_completions!op_checklist_item_completions_completion_id_fkey(
        id, collaborator_id, reference_date,
        op_checklists!op_checklist_completions_checklist_id_fkey(name)
      )
    `)
    .eq('is_checked', false)
    .gte('created_at', cutoff);
  if (error) {
    console.error('[checkChecklistConsequences] query err:', error.message);
    return;
  }
  if (!itemCompletions || itemCompletions.length === 0) return;

  for (const ic of itemCompletions) {
    if (!ic.item?.generates_request_type_id) continue;

    // Idempotência: existe task com notes contendo este completion_id+item_id?
    const sentinel = `cic:${ic.id}`;
    const { data: existingTask } = await supabase
      .from('tasks')
      .select('id')
      .ilike('notes', `%${sentinel}%`)
      .limit(1)
      .maybeSingle();
    if (existingTask) {
      continue; // Já gerada
    }

    // Buscar request_type
    const { data: rtype } = await supabase
      .from('department_request_types')
      .select('id, department_id, label, default_priority, generates_task, is_active')
      .eq('id', ic.item.generates_request_type_id)
      .maybeSingle();
    if (!rtype || !rtype.is_active || !rtype.generates_task) continue;

    // Buscar default responsible do departamento
    const { data: dept } = await supabase
      .from('departments')
      .select('id, default_responsible_id, is_active')
      .eq('id', rtype.department_id)
      .maybeSingle();
    if (!dept || !dept.is_active) continue;
    const assignedTo = dept.default_responsible_id || ic.completion?.collaborator_id;
    if (!assignedTo) continue;

    // Criar task
    const checklistName = ic.completion?.op_checklists?.name || 'Checklist';
    const itemDescription = ic.item.description || 'Item flagged';
    const todayBrt = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const taskRow = {
      title: `[Auto] ${itemDescription.slice(0, 100)}`,
      description: `Gerado automaticamente por checklist "${checklistName}". Item flagged como não-concluído.`,
      assigned_to: assignedTo,
      created_by: ic.completion?.collaborator_id || assignedTo,
      due_date: todayBrt,
      status: 'pending',
      source: 'system',
      context: 'work',
      priority: rtype.default_priority || 'medium',
      department_id: rtype.department_id,
      request_type_id: rtype.id,
      notes: `cic:${ic.id} | item:${ic.item.id} | completion:${ic.completion?.id || '-'} | reference_date:${ic.completion?.reference_date || '-'}`,
    };

    const { data: created, error: insErr } = await supabase
      .from('tasks')
      .insert(taskRow)
      .select('id')
      .single();
    if (insErr) {
      console.error(`[checkChecklistConsequences] task create err item=${ic.item_id?.slice(0,8)}:`, insErr.message);
      continue;
    }
    console.log(`[checkChecklistConsequences] task created from checklist item=${ic.item_id?.slice(0,8)} → task=${created?.id?.slice(0,8)} dept=${rtype.department_id?.slice(0,8)} rt=${rtype.label}`);
  }
}

// Sprint 15 F4 — Briefing operacional semanal por departamento
// Roda toda segunda-feira 07:30 BRT, dispara WhatsApp ao default_responsible_id de cada
// departamento ativo com fila aberta (pending/in_progress/awaiting_confirmation).
// Idempotente via ritual_logs (ritual_type='dept_operational_briefing', reference_date=hoje).
async function checkDepartmentOperational(now = new Date()) {
  const whatsapp = require('../services/whatsapp');

  // Janela: segunda-feira BRT entre 07:25 e 07:35
  // BRT = UTC-3 → janela em UTC: 10:25-10:35 (segunda-feira BRT)
  // Se segunda BRT começa às 03:00 UTC e termina às 02:59 UTC do dia seguinte,
  // mas para 07:30 BRT, o UTC é 10:30, sempre na mesma data UTC. Janela em UTC:
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  // BRT day-of-week:
  const brtMs = now.getTime() - 3 * 60 * 60 * 1000;
  const brtDate = new Date(brtMs);
  const brtDow = brtDate.getUTCDay(); // 0 Sun..1 Mon..6 Sat
  const inWindow = (utcHour === 10 && utcMinute >= 25 && utcMinute <= 35);
  if (brtDow !== 1 || !inWindow) return; // Só segunda 07:25-07:35 BRT

  const todayBrt = brtDate.toISOString().slice(0, 10);

  // Listar departamentos ativos com responsável padrão
  const { data: depts, error: dErr } = await supabase
    .from('departments')
    .select('id, slug, name, default_responsible_id')
    .eq('is_active', true)
    .not('default_responsible_id', 'is', null);
  if (dErr) {
    console.error('[checkDepartmentOperational] depts query err:', dErr.message);
    return;
  }
  if (!depts || depts.length === 0) return;

  for (const dept of depts) {
    // Idempotência: já mandou hoje pra esse responsável?
    const { data: existing } = await supabase
      .from('ritual_logs')
      .select('id')
      .eq('collaborator_id', dept.default_responsible_id)
      .eq('ritual_type', 'dept_operational_briefing')
      .eq('reference_date', todayBrt)
      .limit(1)
      .maybeSingle();
    if (existing) {
      continue;
    }

    // Buscar fila aberta do departamento
    const { data: tasks, error: tErr } = await supabase
      .from('tasks')
      .select('id, title, priority, status, request_type_id')
      .eq('department_id', dept.id)
      .in('status', ['pending', 'in_progress', 'awaiting_confirmation']);
    if (tErr) {
      console.error(`[checkDepartmentOperational] tasks query err (dept=${dept.slug}):`, tErr.message);
      continue;
    }
    const queue = tasks || [];

    // Buscar dados do responsável (phone, full_name)
    const { data: resp } = await supabase
      .from('collaborators')
      .select('id, full_name, phone, is_active')
      .eq('id', dept.default_responsible_id)
      .maybeSingle();
    if (!resp || !resp.is_active || !resp.phone) {
      console.warn(`[checkDepartmentOperational] dept=${dept.slug} responsible inactive or no phone — skip`);
      continue;
    }

    // Contadores por prioridade
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const t of queue) {
      if (counts[t.priority] !== undefined) counts[t.priority]++;
    }

    const firstName = (resp.full_name || '').split(' ')[0];
    const greeting = firstName ? `Bom dia, ${firstName}!` : 'Bom dia!';

    let body;
    if (queue.length === 0) {
      body = `🔧 *${dept.name} — Briefing da semana*\n${greeting}\n\nFila vazia: nenhuma demanda aberta. Boa semana!`;
    } else {
      const lines = [
        `🔧 *${dept.name} — Briefing da semana*`,
        greeting,
        '',
        `Você tem *${queue.length}* demanda${queue.length === 1 ? '' : 's'} aberta${queue.length === 1 ? '' : 's'}:`,
      ];
      if (counts.critical > 0) lines.push(`🔴 ${counts.critical} crítica${counts.critical === 1 ? '' : 's'}`);
      if (counts.high > 0) lines.push(`🟠 ${counts.high} alta${counts.high === 1 ? '' : 's'}`);
      if (counts.medium > 0) lines.push(`🟡 ${counts.medium} média${counts.medium === 1 ? '' : 's'}`);
      if (counts.low > 0) lines.push(`🟢 ${counts.low} baixa${counts.low === 1 ? '' : 's'}`);
      lines.push('', 'Acesse o app para ver detalhes: https://la-organizer.vercel.app/mais/operacoes');
      body = lines.join('\n');
    }

    try {
      await whatsapp.sendMessage(resp.phone, body);
      const detail = JSON.stringify({
        department_slug: dept.slug,
        queue_count: queue.length,
        counts,
        task_ids: queue.map(t => t.id),
      });
      await supabase.from('ritual_logs').insert({
        collaborator_id: resp.id,
        ritual_type: 'dept_operational_briefing',
        reference_date: todayBrt,
        status: 'sent',
        detail,
      });
      console.log(`[checkDepartmentOperational] sent dept=${dept.slug} → ${resp.phone.slice(-4)} (${queue.length} tasks)`);
    } catch (err) {
      console.error(`[checkDepartmentOperational] send err dept=${dept.slug}:`, err.message);
    }
  }
}

// Sprint 16 — Verifica coordination_requests com response_deadline expirado.
// Transita 'sent' → 'timeout' e notifica o requester.
// Gating por horário: 8h–20h BRT (evita mensagem de madrugada).
async function checkCoordinationTimeouts(now = new Date()) {
  const whatsapp = require('../services/whatsapp');
  const hourBRT = Number(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false,
  }).format(now));
  if (hourBRT < 8 || hourBRT >= 20) return;

  const { data: expired, error } = await supabase
    .from('coordination_requests')
    .select('id, requester_id, recipient_id, message_body, response_deadline')
    .eq('expects_response', true)
    .eq('status', 'sent')
    .lt('response_deadline', now.toISOString())
    .limit(10);

  if (error) {
    console.error('[checkCoordinationTimeouts] query err:', error.message);
    return;
  }

  for (const req of (expired || [])) {
    const { error: updErr } = await supabase
      .from('coordination_requests')
      .update({ status: 'timeout', updated_at: now.toISOString() })
      .eq('id', req.id);

    if (updErr) {
      console.error(`[checkCoordinationTimeouts] update err req=${req.id.slice(0, 8)}:`, updErr.message);
      continue;
    }

    const { data: people } = await supabase
      .from('collaborators')
      .select('id, full_name, phone')
      .in('id', [req.requester_id, req.recipient_id]);

    const requester = (people || []).find(p => p.id === req.requester_id);
    const recipient = (people || []).find(p => p.id === req.recipient_id);

    if (requester?.phone) {
      const recipientName = recipient
        ? ((recipient.full_name || '').split(' ')[0] || 'o destinatário')
        : 'o destinatário';
      const preview = req.message_body.slice(0, 80) + (req.message_body.length > 80 ? '...' : '');
      const msg = `⏳ Heads up: pedi pro ${recipientName} responder ao seu recado, mas até agora não respondeu.\nMensagem: "${preview}"\nQuer que eu insista ou prefere falar direto?`;
      try {
        await whatsapp.sendMessage(requester.phone, msg);
        console.log(`[checkCoordinationTimeouts] timeout notified req=${req.id.slice(0, 8)} → requester=${requester.phone.slice(-4)}`);
      } catch (sendErr) {
        console.error(`[checkCoordinationTimeouts] notify err req=${req.id.slice(0, 8)}:`, sendErr.message);
      }
    }
  }
}

// Sprint 13 F1 — Broadcast dispatcher. Chamado a cada tick do cron.
// Processa 1 job por tick (rate = 1 msg/min, anti-ban Meta).
// Ordem FIFO por created_at.
async function dispatchAnnouncements(now = new Date()) {
  const whatsapp = require('../services/whatsapp');
  const nowIso = now instanceof Date ? now.toISOString() : new Date().toISOString();

  // 1. Anúncios prontos para enviar
  const { data: ready, error: rErr } = await supabase
    .from('announcements')
    .select('id, body, status')
    .in('status', ['scheduled', 'sending'])
    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`);
  if (rErr) { console.error('[dispatchAnnouncements] ready query err:', rErr.message); }

  if (ready && ready.length > 0) {
    const annIds = ready.map(a => a.id);
    const byId = new Map(ready.map(a => [a.id, a]));

    // 2. Pegar 1 job pending (FIFO)
    const { data: job, error: jErr } = await supabase
      .from('announcement_jobs')
      .select('id, announcement_id, phone, retry_count')
      .eq('status', 'pending')
      .in('announcement_id', annIds)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (jErr) console.error('[dispatchAnnouncements] job query err:', jErr.message);

    if (job) {
      const ann = byId.get(job.announcement_id);
      try {
        await whatsapp.sendMessage(job.phone, ann.body);
        await supabase.from('announcement_jobs')
          .update({ status: 'sent', sent_at: nowIso })
          .eq('id', job.id);

        // Primeiro job do anúncio: scheduled → sending
        if (ann.status === 'scheduled') {
          await supabase.from('announcements')
            .update({ status: 'sending', updated_at: nowIso })
            .eq('id', ann.id);
        }

        // Verificar se é o último job pendente
        const { count } = await supabase
          .from('announcement_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('announcement_id', ann.id)
          .eq('status', 'pending');
        if (count === 0) {
          await supabase.from('announcements')
            .update({ status: 'sent', updated_at: nowIso })
            .eq('id', ann.id);
          console.log(`[dispatchAnnouncements] announcement=${ann.id.slice(0,8)} fully sent`);
        }

        console.log(`[dispatchAnnouncements] sent job=${job.id.slice(0,8)} → ${job.phone.slice(-4)}`);
      } catch (err) {
        const newRetry = (job.retry_count || 0) + 1;
        const updates = newRetry >= 3
          ? { status: 'failed', error: err.message.slice(0, 200), retry_count: newRetry }
          : { retry_count: newRetry, error: err.message.slice(0, 200) };
        await supabase.from('announcement_jobs').update(updates).eq('id', job.id);
        console.error(`[dispatchAnnouncements] send err job=${job.id.slice(0,8)}:`, err.message);
      }
    }
  }

  // 3. Tratar cancelamentos (todo tick)
  await handleCancellations(whatsapp);
}

// Sprint 18 — Higiene de execução: tasks zumbi (stale)
// Dispara segunda-feira às 09:00 BRT. Max 5 tasks. Idempotência via ritual_logs.
async function detectStaleTasks(now = new Date()) {
  const sp = nowSaoPaulo();
  if (sp.dow !== 1 || currentSlot(sp) !== timeToSlot('09:00')) return; // segunda 09:00

  const whatsapp = require('../services/whatsapp');
  const STALE_DAYS = 14;
  const MAX_ALERTS = 5;
  const staleCutoff = new Date(now.getTime() - STALE_DAYS * 24 * 3600_000).toISOString();
  const ymdRef = sp.ymd;

  const collabs = await listCollaborators();
  for (const collab of collabs) {
    if (await alreadySent(collab.id, 'hygiene_stale_tasks', ymdRef)) continue;

    const { data: staleTasks, error } = await supabase
      .from('tasks')
      .select('id, title, due_date, updated_at, status')
      .eq('assigned_to', collab.id)
      .not('status', 'in', '("done","cancelled")')
      .lt('updated_at', staleCutoff)
      .order('updated_at', { ascending: true })
      .limit(MAX_ALERTS);

    if (error) {
      console.error('[detectStaleTasks] query err:', error.message);
      await logRitualEvent(collab.id, 'hygiene_stale_tasks', 'error', error.message, ymdRef);
      continue;
    }
    if (!staleTasks || staleTasks.length === 0) {
      await logRitualEvent(collab.id, 'hygiene_stale_tasks', 'skipped', 'no_stale_tasks', ymdRef);
      continue;
    }

    const count = staleTasks.length;
    const listText = staleTasks
      .slice(0, 3)
      .map(t => `• _${String(t.title).slice(0, 60)}_`)
      .join('\n');
    const msg = `👻 *Higiene de tarefas*\n\nEncontrei *${count}* tarefa${count > 1 ? 's' : ''} aberta${count > 1 ? 's' : ''} há mais de ${STALE_DAYS} dias sem atualização:\n${listText}${count > 3 ? `\n_...e mais ${count - 3}_` : ''}\n\nQuer revisar agora? Só dizer "abre minhas tarefas paradas".`;

    try {
      await whatsapp.sendMessage(collab.phone, msg);
      await logRitualEvent(collab.id, 'hygiene_stale_tasks', 'sent', `count=${count}`, ymdRef);
    } catch (err) {
      console.error(`[detectStaleTasks] send err ${String(collab.phone).slice(-4)}:`, err.message);
      await logRitualEvent(collab.id, 'hygiene_stale_tasks', 'error', err.message, ymdRef);
    }
  }
}

// Sprint 18 — Higiene de execução: eventos passados sem fechamento
// Dispara todos os dias às 09:30 BRT. Max 3 eventos. Idempotência via ritual_logs.
async function detectUnclosedPastEvents(now = new Date()) {
  const sp = nowSaoPaulo();
  if (currentSlot(sp) !== timeToSlot('09:30')) return; // 09:30 (qualquer dia)

  const whatsapp = require('../services/whatsapp');
  const MAX_ALERTS = 3;
  const cutoff24h = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const ymdRef = sp.ymd;

  const collabs = await listCollaborators();
  for (const collab of collabs) {
    if (await alreadySent(collab.id, 'hygiene_unclosed_events', ymdRef)) continue;

    const { data: unclosed, error } = await supabase
      .from('events')
      .select('id, title, start_at, end_at, category')
      .eq('collaborator_id', collab.id)
      .not('status', 'in', '("done","cancelled")')
      .lt('end_at', cutoff24h)
      .order('end_at', { ascending: false })
      .limit(MAX_ALERTS);

    if (error) {
      console.error('[detectUnclosedPastEvents] query err:', error.message);
      await logRitualEvent(collab.id, 'hygiene_unclosed_events', 'error', error.message, ymdRef);
      continue;
    }
    if (!unclosed || unclosed.length === 0) {
      await logRitualEvent(collab.id, 'hygiene_unclosed_events', 'skipped', 'none_found', ymdRef);
      continue;
    }

    const count = unclosed.length;
    const listText = unclosed
      .map(e => {
        const dateStr = new Date(e.end_at).toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
        });
        return `• _${String(e.title).slice(0, 60)}_ (${dateStr})`;
      })
      .join('\n');
    const msg = `📌 *Compromissos sem fechamento*\n\nTinha *${count}* compromisso${count > 1 ? 's' : ''} que já aconteceu${count > 1 ? 'ram' : ''} e ainda está${count > 1 ? 'o' : ''} em aberto:\n${listText}\n\nQuer fechar agora? Só responder "fecha" ou me dizer o que aconteceu.`;

    try {
      await whatsapp.sendMessage(collab.phone, msg);
      await logRitualEvent(collab.id, 'hygiene_unclosed_events', 'sent', `count=${count}`, ymdRef);
    } catch (err) {
      console.error(`[detectUnclosedPastEvents] send err ${String(collab.phone).slice(-4)}:`, err.message);
      await logRitualEvent(collab.id, 'hygiene_unclosed_events', 'error', err.message, ymdRef);
    }
  }
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
  // Exceções: 'aderencia'/'aderencia_diaria' são determinísticos (sem LLM/sendRitual);
  // caem no gancho condicional adiante e são tratados por checkAdherenceNudge.
  if (opts.force && opts.force !== 'aderencia' && opts.force !== 'aderencia_diaria') {
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
      // Sprint 11.1: briefing_diario UNIFICADO substitui personal_briefing + daily_briefing
      // separados. Dispara UMA mensagem com seções *PESSOAL* e *TRABALHO* no horário do
      // briefing_time (default: PERSONAL_BRIEFING_DEFAULT=07:00). Roda TODO DIA — fim de
      // semana mostra "📭 Nada marcado" na seção trabalho, mas mantém pessoal.
      // - personal_briefing automático: DESATIVADO. Use --force=briefing_pessoal pra fallback manual.
      const briefingTime = p.briefing_time || p.personal_briefing_time || PERSONAL_BRIEFING_DEFAULT;
      const bSlot = timeToSlot(briefingTime);
      if (bSlot !== null && bSlot === slotNow) {
        await fireRitual(c, 'daily_briefing', now.ymd);
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

  // Sprint 11.1 Bloco D — Adherence nudge. Weekdays at 19:00. Mensagem determinística
  // (sem LLM) que cutuca UMA vez quando há sinais de "vida travando" (atrasadas + projetos
  // parados). Threshold conservador pra não virar alarme ambulante.
  const adhSlot = timeToSlot(ADHERENCE_NUDGE_TIME);
  const forceAdh = opts.force === 'aderencia' || opts.force === 'aderencia_diaria';
  if (forceAdh || (!isWeekend && adhSlot !== null && adhSlot === slotNow)) {
    try {
      await checkAdherenceNudge(now.ymd, opts.phone, { dry: Boolean(opts.dry) });
    } catch (err) {
      console.error('[Dispatcher] checkAdherenceNudge erro:', err.message);
    }
  }

  // Sprint 11 F2+ — checklists operacionais diários
  try {
    await dispatchChecklists(new Date(), { filterPhone: opts.phone || null });
  } catch (err) {
    console.error('[Dispatcher] dispatchChecklists erro:', err.message);
  }

  // Sprint 13 F3 — notifica coordenadores sobre aprovação/rejeição (via PWA) e cria jobs
  try {
    await notifyCoordinators();
  } catch (err) {
    console.error('[Dispatcher] notifyCoordinators erro:', err.message);
  }

  // Sprint 14 F2 — lembretes T-1 de tasks de evento
  try {
    await remindEventTasks(new Date());
  } catch (err) {
    console.error('[Dispatcher] remindEventTasks erro:', err.message);
  }

  // Sprint 15 F4 — Checklist com consequência (gera tasks automáticas)
  try {
    await checkChecklistConsequences(new Date());
  } catch (err) {
    console.error('[Dispatcher] checkChecklistConsequences erro:', err.message);
  }

  // Sprint 21 — Planejamento e Fechamento Mensal (liderança)
  try { await checkMonthlyPlanning(now); } catch (e) { console.error('[run] monthlyPlanning', e); }
  try { await checkMonthlyClosing(now);  } catch (e) { console.error('[run] monthlyClosing', e); }

  // Sprint 15 F4 — Briefing operacional semanal por departamento (segunda 07:30 BRT)
  try {
    await checkDepartmentOperational(new Date());
  } catch (err) {
    console.error('[Dispatcher] checkDepartmentOperational erro:', err.message);
  }

  // Sprint 16 — Alertas de timeout para coordination_requests sem resposta
  try {
    await checkCoordinationTimeouts(new Date());
  } catch (err) {
    console.error('[Dispatcher] checkCoordinationTimeouts erro:', err.message);
  }

  // Sprint 18 — Higiene de execução (stale tasks + unclosed events)
  try {
    await detectStaleTasks(new Date());
  } catch (err) {
    console.error('[Dispatcher] detectStaleTasks erro:', err.message);
  }

  try {
    await detectUnclosedPastEvents(new Date());
  } catch (err) {
    console.error('[Dispatcher] detectUnclosedPastEvents erro:', err.message);
  }

  // Sprint 13 F1 — comunicados internos (broadcast queue)
  try {
    await dispatchAnnouncements(new Date());
  } catch (err) {
    console.error('[Dispatcher] dispatchAnnouncements erro:', err.message);
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
// Hotfix pós-Sprint20: cooldown de 6h — não disparar lembrete se a task foi
// criada/reagendada recentemente. Bug observado: Jereh reagendou pra amanhã
// às 16:32, dispatcher rodou às 16:35 e mandou lembrete "vence amanhã" em loop.
// Cooldown garante que TOM não cobre o que ele acabou de avisar.
async function checkDeadlineAlerts(ymdToday) {
  const tomorrow = ymdOffset(ymdToday, 1);
  const cooldownCutoff = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, due_date, status, updated_at')
    .eq('due_date', tomorrow)
    .not('status', 'in', '(done,cancelled)')
    .lt('updated_at', cooldownCutoff)
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

// Overdue alert: tasks que viraram atrasadas EXATAMENTE 1 dia (vencimento ontem,
// status != done/cancelled). Sprint 11.2: limitado a 1 dia pra evitar spam — tasks
// com 2+ dias de atraso ficam só no nudge agregado das 19h (checkAdherenceNudge).
// Resultado: máx 1 alerta individual por task + 1 agregado/dia se ainda parado.
async function checkOverdueAlerts(ymdToday) {
  const yesterday = ymdOffset(ymdToday, -1);
  // Hotfix pós-Sprint20: mesmo cooldown que checkDeadlineAlerts (6h).
  // Evita loop quando user pede pra reagendar e dispatcher dispara overdue logo após.
  const cooldownCutoff = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, due_date, status, updated_at')
    .eq('due_date', yesterday)
    .not('status', 'in', '(done,cancelled)')
    .lt('updated_at', cooldownCutoff)
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
// Sprint 11.1: emoji semântico por context (👉 personal / 🔔 work) + título em *negrito*.
// Sem ⏰: o cron já dispara na hora certa, repetir o horário no texto é redundante.
// Format: "👉 *Lembrete:* {title}" (personal) | "🔔 *Lembrete:* {title}" (work)
async function checkReminders() {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, remind_at, status, context')
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
    // Emoji por contexto: personal=👉 (pessoal/cuidado), work=🔔 (trabalho/sino).
    // Fallback work se context for null/desconhecido (mais comum em tasks legadas).
    const reminderEmoji = t.context === 'personal' ? '👉' : '🔔';
    const text = `${reminderEmoji} *Lembrete:* ${t.title}`;
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

// ===== Sprint 11.1 Bloco D — Adherence nudge =====
// Days between two YMD strings (YYYY-MM-DD), absolute, ignores timezone.
function ymdDaysBetween(ymd1, ymd2) {
  const [y1, m1, d1] = ymd1.split('-').map(Number);
  const [y2, m2, d2] = ymd2.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.abs(Math.round((a - b) / 86400000));
}

// Coleta sinais de aderência fraca pra um collab. Retorna { overdueTasks, pausedProjects }.
// pausedProjects: projetos active onde a última task atualizada do collab é > ADHERENCE_PAUSE_HOURS atrás.
async function gatherAdherenceSignals(collabId, ymdToday) {
  const cutoffIso = new Date(Date.now() - ADHERENCE_PAUSE_HOURS * 3600 * 1000).toISOString();

  // Atrasadas: due_date < hoje AND não concluídas/canceladas. Ordem cronológica reversa
  // (mais antigas primeiro — sinaliza acúmulo).
  const { data: overdueTasks, error: oErr } = await supabase
    .from('tasks')
    .select('id, title, due_date, context')
    .eq('assigned_to', collabId)
    .lt('due_date', ymdToday)
    .not('status', 'in', '(done,cancelled)')
    .order('due_date', { ascending: true })
    .limit(20);
  if (oErr) console.error('[AdherenceNudge] overdue query err:', oErr.message);

  // Projetos active no banco. RLS: assumindo todos visíveis ao service_role.
  const { data: activeProjects, error: pErr } = await supabase
    .from('projects')
    .select('id, name, status')
    .eq('status', 'active')
    .limit(50);
  if (pErr) console.error('[AdherenceNudge] projects query err:', pErr.message);

  let pausedProjects = [];
  if (activeProjects && activeProjects.length) {
    const projIds = activeProjects.map(p => p.id);
    // Pega última atualização de task do collab por projeto.
    const { data: collabTasks } = await supabase
      .from('tasks')
      .select('project_id, updated_at')
      .eq('assigned_to', collabId)
      .in('project_id', projIds);
    const lastByProj = new Map();
    for (const t of (collabTasks || [])) {
      const cur = lastByProj.get(t.project_id);
      if (!cur || cur < t.updated_at) lastByProj.set(t.project_id, t.updated_at);
    }
    for (const p of activeProjects) {
      const last = lastByProj.get(p.id);
      if (!last) continue; // collab não tem task nesse projeto — ignora
      if (last < cutoffIso) {
        const lastYmd = String(last).slice(0, 10);
        const daysSince = ymdDaysBetween(ymdToday, lastYmd);
        pausedProjects.push({ id: p.id, name: p.name, last_update: last, days_since: daysSince });
      }
    }
    // Mais parado primeiro.
    pausedProjects.sort((a, b) => b.days_since - a.days_since);
  }

  return { overdueTasks: overdueTasks || [], pausedProjects };
}

// Build deterministic adherence text. Returns null if no signal worth sending.
function buildAdherenceText(collab, signals, ymdToday) {
  const { overdueTasks, pausedProjects } = signals;
  const hasSignal = overdueTasks.length >= ADHERENCE_MIN_OVERDUE || pausedProjects.length >= 1;
  if (!hasSignal) return null;

  const nick = collab.full_name === 'Luciano Alf' ? 'Alf' : (collab.full_name || '').split(' ')[0] || 'amigo';
  const lines = [`${nick}, balanço de aderência... 🌒`, ''];

  if (overdueTasks.length) {
    lines.push('⏰ *Atrasadas:*');
    for (const t of overdueTasks.slice(0, ADHERENCE_MAX_OVERDUE_LIST)) {
      const days = ymdDaysBetween(ymdToday, t.due_date);
      const lateLabel = days === 0 ? 'vencia hoje'
        : days === 1 ? 'vencia ontem'
        : `vencia há ${days}d`;
      lines.push(`• *${t.title}* (${lateLabel})`);
    }
    if (overdueTasks.length > ADHERENCE_MAX_OVERDUE_LIST) {
      lines.push(`_...e mais ${overdueTasks.length - ADHERENCE_MAX_OVERDUE_LIST}_`);
    }
    lines.push('');
  }

  if (pausedProjects.length) {
    lines.push('📁 *Projetos parados:*');
    for (const p of pausedProjects.slice(0, ADHERENCE_MAX_PROJECTS_LIST)) {
      lines.push(`• *${p.name}* — sem mexer há ${p.days_since}d`);
    }
    lines.push('');
  }

  lines.push('Reagenda? Cancela? Me diz o que rolou.');
  return lines.join('\n');
}

// Adherence nudge — runs at 19:00 weekdays. Determinístico, idempotente, opt-out via
// notify_overdue_alerts=false. Threshold conservador pra não virar alarme ambulante.
async function checkAdherenceNudge(ymdToday, filterPhone, { dry = false } = {}) {
  let q = supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active, onboarding_completed, user_preferences(notify_overdue_alerts)')
    .eq('is_active', true)
    .eq('onboarding_completed', true);
  if (filterPhone) q = q.eq('phone', filterPhone);
  const { data: collabs, error } = await q;
  if (error) {
    console.error('[AdherenceNudge] collabs query err:', error.message);
    return;
  }
  if (!collabs || !collabs.length) return;

  const whatsapp = require('../services/whatsapp');
  let sent = 0, skipped = 0, errs = 0;

  for (const c of collabs) {
    try {
      // Opt-out
      if (c.user_preferences && c.user_preferences.notify_overdue_alerts === false) {
        skipped++;
        await logRitualEvent(c.id, 'aderencia_diaria', 'skipped', 'opt_out', ymdToday);
        continue;
      }
      if (!c.phone) {
        skipped++;
        continue;
      }
      // DND
      const dnd = await getDndState(c.id);
      if (dnd.active) {
        await logRitualEvent(c.id, 'aderencia_diaria', 'skipped', `dnd_active until=${dnd.until}`, ymdToday);
        skipped++;
        continue;
      }
      // Idempotency
      if (await alreadySent(c.id, 'aderencia_diaria', ymdToday)) {
        skipped++;
        continue;
      }
      // Gather signals
      const signals = await gatherAdherenceSignals(c.id, ymdToday);
      const text = buildAdherenceText(c, signals, ymdToday);
      if (!text) {
        // No signal worth sending — log silently, don't spam
        await logRitualEvent(c.id, 'aderencia_diaria', 'skipped', `no_signal overdue=${signals.overdueTasks.length} paused=${signals.pausedProjects.length}`, ymdToday);
        skipped++;
        continue;
      }
      // Dry-run: só loga, não envia, não persiste. Útil pra dev/debug.
      if (dry) {
        console.log(`[AdherenceNudge] DRY → ${c.phone.slice(-4)} overdue=${signals.overdueTasks.length} paused=${signals.pausedProjects.length}`);
        console.log('--- BEGIN MESSAGE ---');
        console.log(text);
        console.log('--- END MESSAGE ---');
        sent++;
        continue;
      }
      // Send
      await whatsapp.sendMessage(c.phone, text);
      await supabase.from('conversation_history').insert({
        collaborator_id: c.id,
        direction: 'outbound',
        message_type: 'text',
        content: text,
      });
      await logRitualEvent(
        c.id, 'aderencia_diaria', 'sent',
        `overdue=${signals.overdueTasks.length} paused=${signals.pausedProjects.length}`,
        ymdToday,
      );
      sent++;
      console.log(`[AdherenceNudge] sent → ${c.phone.slice(-4)} (overdue=${signals.overdueTasks.length} paused=${signals.pausedProjects.length})`);
    } catch (err) {
      errs++;
      console.error(`[AdherenceNudge] err for ${c.full_name || c.id.slice(0,8)}:`, err.message);
      try {
        await logRitualEvent(c.id, 'aderencia_diaria', 'error', err.message, ymdToday);
      } catch { /* ignore */ }
    }
  }
  if (sent || errs) {
    console.log(`[AdherenceNudge] done sent=${sent} skipped=${skipped} errs=${errs}`);
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

module.exports = { run, dispatchChecklists, dispatchAnnouncements, notifyCoordinators, remindEventTasks, checkDepartmentOperational, checkChecklistConsequences, checkCoordinationTimeouts, parseOnboardingMarker: undefined, isFirstMondayOfMonth, isLastFridayOfMonth, listLeadership, checkMonthlyPlanning, checkMonthlyClosing };
