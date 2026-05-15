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
const { sendRitual, sendCoordinatorReport, getDndState, consolidateMemoryFor, decayExpiredMemories, generateWeeklySummaryFor, getRitualIntroDecision } = require('../engine');

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
const DAILY_DREAM_TIME = '03:00';               // Every day — "sonhar": consolidar memórias das últimas 24h
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

    // Task 6 — Routing: se template tem responsible_id, usa diretamente; senão fallback por função.
    let collabs = [];
    if (template.responsible_id) {
      let personQ = supabase
        .from('collaborators')
        .select('id, full_name, phone')
        .eq('id', template.responsible_id)
        .eq('is_active', true)
        .maybeSingle();
      if (filterPhone) personQ = personQ.eq('phone', filterPhone);
      const { data: person } = await personQ;
      if (!person || !person.phone) {
        results.push({
          template_id: template.id,
          name: template.name,
          reason: 'responsible_inactive_or_no_phone',
          would_dispatch: false,
        });
        continue;
      }
      collabs = [person];
    } else {
      // Fallback legado: matching por function_role + shift (Sprint 22.51).
      // Se ninguém tiver essa função configurada, fallback pra manager da unidade
      // (garante que alguém sempre receba enquanto a equipe não estiver cadastrada).
      let collabQuery = supabase
        .from('collaborators')
        .select('id, full_name, phone, unit, function_role, shift')
        .eq('is_active', true)
        .not('phone', 'is', null)
        .eq('function_role', template.function_role)
        .eq('shift', template.shift);
      if (template.unit !== 'all') collabQuery = collabQuery.eq('unit', template.unit);
      if (filterPhone) collabQuery = collabQuery.eq('phone', filterPhone);

      const { data: matched } = await collabQuery;
      collabs = matched ?? [];

      // Fallback: nenhum collab com function_role/shift configurado → envia pra manager da unidade.
      if (collabs.length === 0) {
        let fallbackQ = supabase
          .from('collaborators')
          .select('id, full_name, phone, unit, function_role, shift')
          .eq('is_active', true)
          .not('phone', 'is', null)
          .eq('role', 'manager');
        if (template.unit !== 'all') fallbackQ = fallbackQ.eq('unit', template.unit);
        if (filterPhone) fallbackQ = fallbackQ.eq('phone', filterPhone);
        const { data: fallback } = await fallbackQ;
        if (!fallback || fallback.length === 0) {
          results.push({ template_id: template.id, reason: 'no_collaborators_or_managers', would_dispatch: false });
          continue;
        }
        collabs = fallback;
        console.log(`[dispatchChecklists] ${template.name}: sem collabs com function_role=${template.function_role} — fallback ${collabs.length} manager(s)`);
      }
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

// Sprint 13 F3 — Audience-to-jobs helper. Mirrors PWA mutation filter logic.
// Sprint 22.X — passou a suportar role + collaborator_ids; corrigiu function_role
// que estava buscando na coluna errada (era 'role').
async function createJobsFromAudience(announcementId, audience) {
  let q = supabase.from('collaborators').select('id, phone').eq('is_active', true).not('phone', 'is', null);
  const aud = audience || {};
  if (aud.all !== true) {
    if (Array.isArray(aud.role) && aud.role.length) q = q.in('role', aud.role);
    if (Array.isArray(aud.function_role) && aud.function_role.length) q = q.in('role', aud.function_role);
    if (Array.isArray(aud.unidade) && aud.unidade.length) q = q.in('unit', aud.unidade);
    if (Array.isArray(aud.turno) && aud.turno.length) q = q.in('shift', aud.turno);
    if (Array.isArray(aud.collaborator_ids) && aud.collaborator_ids.length) q = q.in('id', aud.collaborator_ids);
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

// Sprint 22.X — Lembrete T-1 para tasks operacionais (department_id != null).
// Roda no tick. Janela: 09:00-09:10 BRT (UTC 12:00-12:10).
// Filtra tasks com due_date = amanhã BRT, status pending/in_progress,
// reminded_at IS NULL, school_event_id IS NULL (eventos têm fluxo próprio).
// Marca reminded_at após envio. Idempotente.
async function remindOperationalTasks(now = new Date()) {
  const whatsapp = require('../services/whatsapp');
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  // 09:00-09:10 BRT = UTC 12:00-12:10
  if (!(utcH === 12 && utcM >= 0 && utcM <= 10)) return;

  const brtMs = now.getTime() - 3 * 60 * 60 * 1000;
  const tomorrowBrt = new Date(brtMs + 24 * 60 * 60 * 1000);
  const tomorrowYmd = tomorrowBrt.toISOString().slice(0, 10);

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select(`
      id, title, assigned_to, due_date,
      request_type:department_request_types!tasks_request_type_id_fkey(label),
      collaborator:assigned_to(phone, full_name)
    `)
    .not('department_id', 'is', null)
    .is('school_event_id', null)
    .is('reminded_at', null)
    .in('status', ['pending', 'in_progress'])
    .eq('due_date', tomorrowYmd);

  if (error) {
    console.error('[remindOperationalTasks] query err:', error.message);
    return;
  }
  if (!tasks || tasks.length === 0) return;

  const nowIso = now.toISOString();
  for (const task of tasks) {
    const phone = task.collaborator?.phone;
    if (!phone) {
      await supabase.from('tasks').update({ reminded_at: nowIso }).eq('id', task.id);
      continue;
    }
    const firstName = (task.collaborator?.full_name || '').split(' ')[0];
    const greeting = firstName ? `${firstName}, ` : '';
    const rtype = task.request_type?.label ? ` (${task.request_type.label})` : '';
    const msg = `⏰ ${greeting}lembrete: *${task.title}*${rtype} vence amanhã. Tudo certo da sua parte?`;

    try {
      await whatsapp.sendMessage(phone, msg);
      await supabase.from('tasks').update({ reminded_at: nowIso }).eq('id', task.id);
      console.log(`[remindOperationalTasks] sent task=${task.id.slice(0, 8)} → ${phone.slice(-4)}`);
    } catch (err) {
      console.error(`[remindOperationalTasks] send err task=${task.id.slice(0, 8)}:`, err.message);
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
      id, item_id, completion_id, is_checked, checked_at,
      item:op_checklist_items!op_checklist_item_completions_item_id_fkey(
        id, description, generates_request_type_id, checklist_id
      ),
      completion:op_checklist_completions!op_checklist_item_completions_completion_id_fkey(
        id, collaborator_id, reference_date,
        op_checklists!op_checklist_completions_checklist_id_fkey(name)
      )
    `)
    .eq('is_checked', false)
    .gte('checked_at', cutoff);
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

// Sprint 22.36 Fatia 6 — Checklist cobrança + escalação ===========================
// Roda a cada tick, mas só dispara entre 8h-22h BRT (não acorda ninguém).
//
// Fase 1 — janela 6h fechada sem 100%: cobrança 1x ao colab.
//   marca op_checklist_completions.reminded_at
// Fase 2 — 20min sem resposta: escala pro gerente da unidade.
//   marca op_checklist_completions.escalated_at
//
// Resposta detectada em engine.js applyChecklistAction (set reminder_replied=true).
async function checkChecklistEscalations(now = new Date()) {
  // Filtro horário 8h-22h BRT
  const brtMs = now.getTime() - 3 * 60 * 60 * 1000;
  const brtHour = new Date(brtMs).getUTCHours();
  if (brtHour < 8 || brtHour >= 22) return;

  const whatsapp = require('../services/whatsapp');
  const internalApi = require('../internal-api');
  const findUnitManager = internalApi.findUnitManager;

  async function countItems(completionId, checklistId) {
    const [tplTotalRes, tplDoneRes, extraTotalRes, extraDoneRes] = await Promise.all([
      supabase.from('op_checklist_items')
        .select('id', { count: 'exact', head: true })
        .eq('checklist_id', checklistId || ''),
      supabase.from('op_checklist_item_completions')
        .select('id', { count: 'exact', head: true })
        .eq('completion_id', completionId).eq('is_checked', true),
      supabase.from('op_checklist_completion_extra_items')
        .select('id', { count: 'exact', head: true })
        .eq('completion_id', completionId),
      supabase.from('op_checklist_completion_extra_items')
        .select('id', { count: 'exact', head: true })
        .eq('completion_id', completionId).eq('is_checked', true),
    ]);
    const total = (tplTotalRes.count || 0) + (extraTotalRes.count || 0);
    const done = (tplDoneRes.count || 0) + (extraDoneRes.count || 0);
    return { total, done, pending: total - done };
  }

  // ── Fase 1: cobrança ──
  const sixHoursAgoIso = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const { data: needsReminder, error: reminderErr } = await supabase
    .from('op_checklist_completions')
    .select(`
      id, dispatched_at, collaborator_id, checklist_id,
      op_checklists(name, unit),
      collaborator:collaborators!op_checklist_completions_collaborator_id_fkey(
        id, full_name, phone, is_active
      )
    `)
    .is('completed_at', null)
    .is('reminded_at', null)
    .lte('dispatched_at', sixHoursAgoIso)
    .limit(50);

  if (reminderErr) {
    console.error('[checkChecklistEscalations] phase1 query err:', reminderErr.message);
  } else if (needsReminder && needsReminder.length > 0) {
    for (const c of needsReminder) {
      if (!c.collaborator || !c.collaborator.phone || !c.collaborator.is_active) {
        await supabase.from('op_checklist_completions')
          .update({ reminded_at: now.toISOString() })
          .eq('id', c.id);
        continue;
      }
      const stats = await countItems(c.id, c.checklist_id);
      if (stats.pending <= 0) {
        await supabase.from('op_checklist_completions')
          .update({ reminded_at: now.toISOString(), reminder_replied: true })
          .eq('id', c.id);
        continue;
      }

      const tplName = c.op_checklists?.name || 'checklist';
      const collabName = (c.collaborator.full_name || '').split(' ')[0] || 'amigo';
      const body =
        `Oi ${collabName}, vi que faltam ${stats.pending} ${stats.pending === 1 ? 'item' : 'itens'} ` +
        `no checklist *${tplName}* de hoje. Tudo certo? Conseguiu fazer?`;
      try {
        await whatsapp.sendMessage(c.collaborator.phone, body);
        await supabase.from('op_checklist_completions')
          .update({ reminded_at: now.toISOString() })
          .eq('id', c.id);
        console.log(`[checkChecklistEscalations] reminder sent comp=${c.id.slice(0, 8)} pending=${stats.pending}`);
      } catch (e) {
        console.error(`[checkChecklistEscalations] reminder send err comp=${c.id.slice(0,8)}:`, e.message);
      }
    }
  }

  // ── Fase 2: escalação ──
  const twentyMinAgoIso = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
  const { data: needsEscalation, error: escErr } = await supabase
    .from('op_checklist_completions')
    .select(`
      id, reminded_at, collaborator_id, checklist_id,
      op_checklists(name, unit, leader_id),
      collaborator:collaborators!op_checklist_completions_collaborator_id_fkey(
        id, full_name
      )
    `)
    .is('completed_at', null)
    .eq('reminder_replied', false)
    .is('escalated_at', null)
    .not('reminded_at', 'is', null)
    .lte('reminded_at', twentyMinAgoIso)
    .limit(50);

  if (escErr) {
    console.error('[checkChecklistEscalations] phase2 query err:', escErr.message);
    return;
  }
  if (!needsEscalation || needsEscalation.length === 0) return;

  for (const c of needsEscalation) {
    const tplUnit = c.op_checklists?.unit || 'all';

    // Task 6 — leader_id tem prioridade sobre manager da unidade.
    let escalationTarget = null;
    if (c.op_checklists?.leader_id) {
      const { data: leader } = await supabase
        .from('collaborators')
        .select('id, full_name, phone')
        .eq('id', c.op_checklists.leader_id)
        .eq('is_active', true)
        .maybeSingle();
      if (leader?.phone) escalationTarget = leader;
    }
    if (!escalationTarget) {
      // Fallback: manager da unidade (comportamento original).
      escalationTarget = findUnitManager ? await findUnitManager(tplUnit) : null;
    }

    if (!escalationTarget || !escalationTarget.phone || escalationTarget.id === c.collaborator_id) {
      await supabase.from('op_checklist_completions')
        .update({ escalated_at: now.toISOString() })
        .eq('id', c.id);
      continue;
    }

    const stats = await countItems(c.id, c.checklist_id);
    const collabName = c.collaborator?.full_name || 'Colaborador';
    const tplName = c.op_checklists?.name || 'checklist';
    const body =
      `⚠️ *${collabName}* não fechou o checklist *${tplName}* ` +
      `(faltaram ${stats.pending} ${stats.pending === 1 ? 'item' : 'itens'}) ` +
      `e não respondeu cobrança em 20min.`;
    try {
      await whatsapp.sendMessage(escalationTarget.phone, body);
      await supabase.from('op_checklist_completions')
        .update({ escalated_at: now.toISOString() })
        .eq('id', c.id);
      console.log(`[checkChecklistEscalations] escalation sent comp=${c.id.slice(0,8)} → ${escalationTarget.full_name}`);
    } catch (e) {
      console.error(`[checkChecklistEscalations] escalation send err comp=${c.id.slice(0,8)}:`, e.message);
    }
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
    .select('id, requester_id, recipient_id, message_body, response_deadline, sent_at')
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

    // Sprint 22.4 — antes de cobrar via Heads up, checar atividade do recipient.
    // Suprime o nag em DOIS casos:
    //   (a) recipient teve qualquer mensagem (inbound OU outbound) após sent_at
    //       → ele viu/respondeu mesmo sem <<COORDINATION_RESPONSE>>
    //   (b) recipient NUNCA mandou inbound nos últimos 30d → não engaja via TOM,
    //       cobrar é inútil; resposta vai vir por canal direto se vier.
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: postSent } = await supabase
      .from('conversation_history')
      .select('id')
      .eq('collaborator_id', req.recipient_id)
      .gte('created_at', req.sent_at || req.response_deadline)
      .limit(1);
    if (Array.isArray(postSent) && postSent.length > 0) {
      console.log(`[checkCoordinationTimeouts] req=${req.id.slice(0, 8)} recipient ativo após sent_at — suprimindo heads-up`);
      continue;
    }
    const { data: recentInbound } = await supabase
      .from('conversation_history')
      .select('id')
      .eq('collaborator_id', req.recipient_id)
      .eq('direction', 'inbound')
      .gte('created_at', since30d)
      .limit(1);
    const recipientEngagesTom = Array.isArray(recentInbound) && recentInbound.length > 0;
    if (!recipientEngagesTom) {
      console.log(`[checkCoordinationTimeouts] req=${req.id.slice(0, 8)} recipient sem inbound nos últimos 30d — suprimindo heads-up (não engaja via TOM)`);
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
    .select('id, body, status, audience, requires_confirmation, confirmation_question, attachment_url, attachment_type, attachment_mime, attachment_filename')
    .in('status', ['scheduled', 'sending'])
    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`);
  if (rErr) { console.error('[dispatchAnnouncements] ready query err:', rErr.message); }

  // 1b. Sprint 22.X — Lazy job creation: anúncios scheduled sem jobs (PWA não
  // pode escrever em announcement_jobs por RLS). Cria via service role.
  if (ready && ready.length > 0) {
    for (const ann of ready) {
      if (ann.status !== 'scheduled') continue;
      const { count } = await supabase
        .from('announcement_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('announcement_id', ann.id);
      if ((count ?? 0) === 0) {
        const created = await createJobsFromAudience(ann.id, ann.audience);
        console.log(`[dispatchAnnouncements] lazy jobs created for ${ann.id.slice(0,8)}: ${created}`);
      }
    }
  }

  if (ready && ready.length > 0) {
    const annIds = ready.map(a => a.id);
    const byId = new Map(ready.map(a => [a.id, a]));

    // 2. Mini-batch: até 20 jobs por tick, com delay 3–6s entre cada envio.
    // Protege contra ban da Meta sem sacrificar velocidade (40 pessoas ≈ 2–3 min).
    const BATCH_SIZE = 20;
    const DELAY_MIN_MS = 3000;
    const DELAY_MAX_MS = 6000;

    const { data: jobs, error: jErr } = await supabase
      .from('announcement_jobs')
      .select('id, announcement_id, phone, retry_count')
      .eq('status', 'pending')
      .in('announcement_id', annIds)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);
    if (jErr) console.error('[dispatchAnnouncements] job query err:', jErr.message);

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    for (const job of (jobs || [])) {
      const ann = byId.get(job.announcement_id);
      if (!ann) continue;

      const confirmTail = ann.requires_confirmation
        ? `\n\n_${ann.confirmation_question || 'Responde "ok" pra confirmar que recebeu.'}_`
        : '';
      const finalBody = ann.body + confirmTail;
      try {
        if (ann.attachment_url && ann.attachment_type) {
          await whatsapp.sendMedia(job.phone, {
            url: ann.attachment_url,
            type: ann.attachment_type,
            caption: finalBody,
            filename: ann.attachment_filename || '',
            mimetype: ann.attachment_mime || '',
          });
        } else {
          await whatsapp.sendMessage(job.phone, finalBody);
        }
        const sentAt = new Date().toISOString();
        await supabase.from('announcement_jobs')
          .update({ status: 'sent', sent_at: sentAt })
          .eq('id', job.id);

        if (ann.status === 'scheduled') {
          await supabase.from('announcements')
            .update({ status: 'sending', updated_at: sentAt })
            .eq('id', ann.id);
          ann.status = 'sending'; // atualiza local pra não re-setar
        }

        const { count } = await supabase
          .from('announcement_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('announcement_id', ann.id)
          .eq('status', 'pending');
        if (count === 0) {
          await supabase.from('announcements')
            .update({ status: 'sent', updated_at: sentAt })
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

      // Delay aleatório entre mensagens para evitar ban da Meta.
      const delay = DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));
      await sleep(delay);
    }
  }

  // 3. Tratar cancelamentos (todo tick)
  await handleCancellations(whatsapp);
}

// Sprint 22.X — Comunicados Fatia 1: lembrete pra quem recebeu e não confirmou
// após 6h. Idempotente via reminder_sent_at no announcement_jobs.
async function remindUnconfirmedAnnouncements(now = new Date()) {
  const whatsapp = require('../services/whatsapp');
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const cutoffWindow = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: jobs, error } = await supabase
    .from('announcement_jobs')
    .select(`
      id, announcement_id, phone, sent_at,
      announcements!inner(body, requires_confirmation, confirmation_question, status)
    `)
    .eq('status', 'sent')
    .is('confirmed_at', null)
    .is('reminder_sent_at', null)
    .lte('sent_at', sixHoursAgo)
    .gte('sent_at', cutoffWindow)
    .eq('announcements.requires_confirmation', true)
    .neq('announcements.status', 'cancelled')
    .limit(20);

  if (error) {
    console.error('[remindUnconfirmedAnnouncements] query err:', error.message);
    return;
  }
  if (!jobs || jobs.length === 0) return;

  const nowIso = now.toISOString();
  for (const j of jobs) {
    const annBody = j.announcements?.body || '';
    const preview = annBody.slice(0, 80) + (annBody.length > 80 ? '…' : '');
    const msg = `⏰ Lembrete: você recebeu um comunicado e ainda não confirmou.\n\n"${preview}"\n\n_Responde "ok" pra confirmar que recebeu._`;
    try {
      await whatsapp.sendMessage(j.phone, msg);
      await supabase.from('announcement_jobs')
        .update({ reminder_sent_at: nowIso })
        .eq('id', j.id);
      console.log(`[remindUnconfirmed] sent job=${j.id.slice(0,8)} → ${j.phone.slice(-4)}`);
    } catch (err) {
      console.error('[remindUnconfirmed] err job=' + j.id.slice(0,8) + ':', err.message);
    }
  }
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
  if (opts.force && opts.force !== 'aderencia' && opts.force !== 'aderencia_diaria' && opts.force !== 'consolidacao_memoria' && opts.force !== 'dream') {
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
      // Sprint 23.5+ — gera resumo semanal para cada colaborador ativo
      for (const c of all) {
        try { await generateWeeklySummaryFor(c); }
        catch (err) { console.error(`[WeeklySummary] err for ${c.full_name}:`, err.message); }
      }
    } catch (err) {
      console.error('[Dispatcher] memory-consolidation erro:', err.message);
    }
  }

  // Sprint 23.5+ — "Sonho" diário às 3h BRT: consolida memórias das últimas 24h
  // para colaboradores que tiveram conversa recente. Roda todo dia (não só domingo).
  if (opts.force === 'dream' || timeToSlot(DAILY_DREAM_TIME) === slotNow) {
    try {
      // Estratégia expandida: pega TODOS os ativos+onboarded.
      // updateCollaboratorProfile internamente usa janela adaptativa (24h→7d→30d)
      // e pula automaticamente quem não tem histórico em 30d.
      const { data: allCollabs } = await supabase
        .from('collaborators')
        .select('id, full_name, phone, role, unit, onboarding_completed')
        .eq('is_active', true)
        .eq('onboarding_completed', true);
      console.log(`[Dream] consolidando memórias para ${(allCollabs || []).length} colaborador(es) ativo(s)+onboarded`);
      for (const c of (allCollabs || [])) {
        try { await consolidateMemoryFor(c); }
        catch (err) { console.error(`[Dream] err for ${c.full_name}:`, err.message); }
      }
    } catch (err) {
      console.error('[Dispatcher] dream-consolidation erro:', err.message);
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

  // Sprint 22.50 — lembretes de events (events.remind_at). Marca remind_sent_at.
  try {
    await checkEventReminders();
  } catch (err) {
    console.error('[Dispatcher] checkEventReminders erro:', err.message);
  }

  // Sprint 22.52 — lembretes diários de hábitos (habits.reminder_time).
  try {
    await checkHabitReminders();
  } catch (err) {
    console.error('[Dispatcher] checkHabitReminders erro:', err.message);
  }

  // Sprint 23.6 — check-in de tarefas em horários configurados pelo colaborador.
  try {
    await checkTaskCheckins(now);
  } catch (err) {
    console.error('[Dispatcher] checkTaskCheckins erro:', err.message);
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

  // Sprint 22.X — lembretes T-1 de tasks operacionais (department_id != null)
  try {
    await remindOperationalTasks(new Date());
  } catch (err) {
    console.error('[Dispatcher] remindOperationalTasks erro:', err.message);
  }

  // Sprint 15 F4 — Checklist com consequência (gera tasks automáticas)
  try {
    await checkChecklistConsequences(new Date());
  } catch (err) {
    console.error('[Dispatcher] checkChecklistConsequences erro:', err.message);
  }

  // Sprint 22.36 Fatia 6 — Cobrança/escalação de checklists não fechados
  try {
    await checkChecklistEscalations(new Date());
  } catch (err) {
    console.error('[Dispatcher] checkChecklistEscalations erro:', err.message);
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
    await remindUnconfirmedAnnouncements(new Date());
  } catch (err) {
    console.error('[Dispatcher] dispatchAnnouncements erro:', err.message);
  }

  // Sprint Agenda v2 — dispatch automático do resumo mensal da agenda escolar
  // (dia 1 do mês às 09:00 BRT, pra toda equipe). Idempotente via header do body.
  try {
    await dispatchMonthlyAgenda(new Date());
  } catch (err) {
    console.error('[Dispatcher] dispatchMonthlyAgenda erro:', err.message);
  }
}

// Sprint Agenda v2 — Dispara o resumo mensal da agenda institucional pra toda equipe.
// Roda dia 1 do mês às 09:00 BRT. Idempotente: checa se já existe um announcement
// hoje com header "📅 Agenda da escola — {mês}/{ano}".
async function dispatchMonthlyAgenda(now = new Date()) {
  void now;
  const sp = nowSaoPaulo();
  // sp = { hour, minute, dow, ymd }. Derivamos day/month/year do ymd.
  const [yearStr, monthStr, dayStr] = sp.ymd.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (day !== 1) return;
  if (currentSlot(sp) !== timeToSlot('09:00')) return;

  const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                     'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const monthLabel = MONTHS_PT[month - 1];
  const headerLine = `📅 *Agenda da escola — ${monthLabel}/${year}*`;

  // Idempotência: já disparou hoje?
  const todayStart = `${sp.ymd}T00:00:00-03:00`;
  const { data: dup } = await supabase
    .from('announcements')
    .select('id')
    .gte('created_at', todayStart)
    .ilike('body', `${headerLine}%`)
    .limit(1);
  if (dup && dup.length) {
    console.log('[MonthlyAgenda] já disparado hoje, skip');
    return;
  }

  // Eventos do mês corrente.
  const firstDay = `${yearStr}-${monthStr}-01`;
  const lastDayNum = new Date(year, month, 0).getDate();
  const lastDay = `${yearStr}-${monthStr}-${String(lastDayNum).padStart(2, '0')}`;

  const [{ data: events }, { data: types }] = await Promise.all([
    supabase.from('school_events')
      .select('id, title, event_type, event_date, end_date, start_time, is_all_day, units, unit, location')
      .eq('status', 'active')
      .gte('event_date', firstDay)
      .lte('event_date', lastDay)
      .order('event_date', { ascending: true })
      .limit(60),
    supabase.from('event_types').select('id, emoji'),
  ]);

  if (!events || events.length === 0) {
    console.log('[MonthlyAgenda] sem eventos no mês, skip dispatch');
    return;
  }

  const emojiBy = new Map((types || []).map(t => [t.id, t.emoji]));
  const fmt = (ymd) => { const [, m, d] = ymd.split('-'); return `${d}/${m}`; };

  const lines = [headerLine, ''];
  for (const ev of events) {
    const emoji = emojiBy.get(ev.event_type) || '📅';
    const range = (ev.end_date && ev.end_date !== ev.event_date)
      ? `${fmt(ev.event_date)} a ${fmt(ev.end_date)}`
      : fmt(ev.event_date);
    const time = (!ev.is_all_day && ev.start_time) ? ` às ${ev.start_time.slice(0, 5)}` : '';
    const loc = ev.location ? ` · ${ev.location}` : '';
    lines.push(`${emoji} *${ev.title}* — ${range}${time}${loc}`);
  }
  lines.push('', '_Qualquer dúvida sobre a agenda, é só me perguntar._');

  // Pega um director qualquer pra usar como created_by (RLS permite director).
  const { data: director } = await supabase
    .from('collaborators')
    .select('id')
    .eq('role', 'director')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!director) {
    console.warn('[MonthlyAgenda] sem director ativo — skip');
    return;
  }

  const body = lines.join('\n');
  const { data: ann, error: annErr } = await supabase
    .from('announcements')
    .insert({
      created_by: director.id,
      body,
      audience: { all: true },
      status: 'scheduled',
      scheduled_at: null,
    })
    .select('id')
    .single();
  if (annErr) {
    console.error('[MonthlyAgenda] erro ao criar announcement:', annErr.message);
    return;
  }
  console.log(`[MonthlyAgenda] announcement criado id=${ann.id.slice(0,8)} eventos=${events.length}`);
  // Jobs serão criados na próxima volta do dispatchAnnouncements (lazy).
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

// Sprint 22.50b — Múltiplos lembretes por evento (event_reminders).
// Cada linha vira um WA. Marca sent_at=now() por linha. NÃO mexe no status do evento.
async function checkEventReminders() {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('event_reminders')
    .select('id, event_id, remind_at, label, events(id, title, collaborator_id, start_at, status, modality, location_text, meeting_url, context)')
    .is('sent_at', null)
    .lte('remind_at', nowIso)
    .limit(50);
  if (error) {
    console.error('[EventReminders] query err:', error.message);
    return;
  }
  if (!due || !due.length) return;
  console.log(`[EventReminders] ${due.length} pending event reminder(s)`);

  const collabIds = [...new Set(due.map(r => r.events?.collaborator_id).filter(Boolean))];
  const { data: collabs } = await supabase
    .from('collaborators').select('id, phone, full_name, is_active').in('id', collabIds);
  const byId = new Map((collabs || []).map(c => [c.id, c]));

  const whatsapp = require('../services/whatsapp');
  for (const r of due) {
    const ev = r.events;
    if (!ev || ev.status !== 'scheduled') {
      await supabase.from('event_reminders').update({ sent_at: nowIso }).eq('id', r.id);
      continue;
    }
    const collab = byId.get(ev.collaborator_id);
    if (!collab || !collab.is_active || !collab.phone) {
      console.warn(`[EventReminders] reminder ${String(r.id).slice(0,8)} skipped — no active collaborator/phone`);
      await supabase.from('event_reminders').update({ sent_at: nowIso }).eq('id', r.id);
      continue;
    }
    const dnd = await getDndState(collab.id);
    if (dnd.active) {
      console.log(`[EventReminders] defer ${String(r.id).slice(0,8)} — DND until ${dnd.until}`);
      continue;
    }
    const startHm = (() => {
      try {
        const d = new Date(ev.start_at);
        const fmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        return fmt.format(d);
      } catch { return ''; }
    })();
    const metaParts = [];
    if (startHm) metaParts.push(`⏰ ${startHm}`);
    if (ev.modality === 'online') metaParts.push('💻 online');
    else if (ev.modality === 'hibrido') metaParts.push('🏢 híbrido');
    else if (ev.modality === 'presencial') metaParts.push('📍 presencial');
    if (ev.location_text) metaParts.push(ev.location_text);
    if (ev.meeting_url) metaParts.push(ev.meeting_url);
    const meta = metaParts.length ? `\n${metaParts.join(' · ')}` : '';
    const labelPrefix = r.label ? `(${r.label}) ` : '';
    const text = `📅 *Lembrete:* ${labelPrefix}${ev.title}${meta}`;
    try {
      await whatsapp.sendMessage(collab.phone, text);
      const { error: upErr } = await supabase.from('event_reminders').update({ sent_at: new Date().toISOString() }).eq('id', r.id);
      if (upErr) {
        console.error(`[EventReminders] mark-sent err for ${String(r.id).slice(0,8)}:`, upErr.message);
      } else {
        console.log(`[EventReminders] fired ${String(r.id).slice(0,8)} "${ev.title.slice(0,40)}" → ${collab.phone.slice(-4)}`);
      }
      await supabase.from('conversation_history').insert({
        collaborator_id: collab.id,
        direction: 'outbound',
        message_type: 'text',
        content: text,
      });
    } catch (err) {
      console.error(`[EventReminders] send err for ${String(r.id).slice(0,8)}:`, err.message);
    }
  }
}

// Sprint 23.6 — Check-in de tarefas em múltiplos horários por colaborador.
// Configurado em user_preferences.task_checkin_times (time[]).
// Idempotência via ritual_logs (ritual_type = 'task_checkin_HH:MM' por slot).
async function checkTaskCheckins(now) {
  const slotNow = currentSlot(now);
  const ymd = now.ymd;

  const { data: collabs, error } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active, onboarding_completed, user_preferences(task_checkin_times)')
    .eq('is_active', true)
    .eq('onboarding_completed', true);

  if (error) { console.error('[TaskCheckin] query err:', error.message); return; }

  const tzFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = tzFmt.format(new Date());
  const next7 = (() => { const d = new Date(today + 'T15:00:00.000Z'); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
  const whatsapp = require('../services/whatsapp');

  for (const c of (collabs || [])) {
    const times = c.user_preferences?.task_checkin_times;
    if (!times || !times.length) continue;

    const matchingTime = times.find(t => timeToSlot(t) === slotNow);
    if (!matchingTime) continue;

    const timeKey = String(matchingTime).slice(0, 5); // "08:00"
    const ritualType = `task_checkin_${timeKey}`;

    const dnd = await getDndState(c.id);
    if (dnd.active) { console.log(`[TaskCheckin] ${c.full_name} DND, skip`); continue; }

    if (await alreadySent(c.id, ritualType, ymd)) continue;

    const { data: tasks } = await supabase
      .from('tasks')
      .select('title, context, due_date')
      .eq('assigned_to', c.id)
      .lte('due_date', next7)
      .not('status', 'in', '(done,cancelled)')
      .order('due_date', { ascending: true })
      .limit(20);

    if (!tasks || !tasks.length) {
      await logRitualEvent(c.id, ritualType, 'skipped', 'no_pending_tasks', ymd);
      continue;
    }

    const personal = tasks.filter(t => t.context === 'personal');
    const work = tasks.filter(t => !t.context || t.context === 'work');
    const hour = timeKey.slice(0, 2);
    const firstName = c.full_name.split(' ')[0];

    let msg = `⏰ *Check das ${hour}h, ${firstName}!*\n\nAinda pendente:`;
    if (personal.length) {
      msg += `\n\n📋 *Pessoal:*\n` + personal.map(t => `• ${t.title}`).join('\n');
    }
    if (work.length) {
      msg += `\n\n📋 *Trabalho:*\n` + work.map(t => `• ${t.title}`).join('\n');
    }
    msg += `\n\nMe avisa o que você concluiu! 💪`;

    try {
      await whatsapp.sendMessage(c.phone, msg);
      await logRitualEvent(c.id, ritualType, 'sent', null, ymd);
      console.log(`[TaskCheckin] ${c.full_name} ${timeKey} enviado (${tasks.length} tarefas)`);
    } catch (e) {
      console.error(`[TaskCheckin] ${c.full_name} send err:`, e.message);
    }
  }
}

// Sprint 22.55 — Múltiplos lembretes por hábito (habit_reminders).
// Cada linha em habit_reminders = 1 horário diário. Idempotência per-row via
// last_sent_at. Filtra por frequency do hábito vs dow atual.
async function checkHabitReminders() {
  const tzFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const today = tzFmt.format(new Date());
  const brStr = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
  const brNow = new Date(brStr);
  const dow = brNow.getDay() === 0 ? 7 : brNow.getDay(); // 1=seg..7=dom
  const pad = n => String(n).padStart(2, '0');
  const timeNow = `${pad(brNow.getHours())}:${pad(brNow.getMinutes())}`;
  const brMinus5 = new Date(brNow.getTime() - 5 * 60 * 1000);
  const timeMinus5 = `${pad(brMinus5.getHours())}:${pad(brMinus5.getMinutes())}`;

  const { data: rows, error } = await supabase
    .from('habit_reminders')
    .select('id, time, label, last_sent_at, habits(id, collaborator_id, name, icon, frequency, custom_days, notify_whatsapp, is_active)')
    .eq('is_active', true)
    .gte('time', timeMinus5)
    .lte('time', timeNow)
    .limit(200);
  if (error) {
    console.error('[HabitReminders] query err:', error.message);
    return;
  }
  if (!rows || !rows.length) return;

  // Frequência vs dia da semana.
  const inSchedule = (h) => {
    const f = h.frequency;
    if (f === 'daily') return true;
    if (f === 'weekdays') return dow >= 1 && dow <= 5;
    if (f === 'weekly' || f === 'custom_days') {
      const days = Array.isArray(h.custom_days) ? h.custom_days.map(Number) : [];
      return days.length === 0 ? dow === 1 : days.includes(dow);
    }
    return false;
  };

  // Idempotência por linha + filtro hábito ativo+notify.
  const due = rows.filter(r => {
    const h = r.habits;
    if (!h || !h.is_active || !h.notify_whatsapp) return false;
    if (!inSchedule(h)) return false;
    if (!r.last_sent_at) return true;
    const lastYmd = tzFmt.format(new Date(r.last_sent_at));
    return lastYmd !== today;
  });
  if (!due.length) return;
  console.log(`[HabitReminders] ${due.length} habit reminder(s) eligible`);

  const collabIds = [...new Set(due.map(r => r.habits.collaborator_id).filter(Boolean))];
  const { data: collabs } = await supabase
    .from('collaborators').select('id, phone, full_name, is_active').in('id', collabIds);
  const byId = new Map((collabs || []).map(c => [c.id, c]));

  // Logs de hoje pra skip se já completou.
  const habitIds = [...new Set(due.map(r => r.habits.id))];
  const { data: todayLogs } = await supabase
    .from('habit_logs')
    .select('habit_id, is_completed')
    .in('habit_id', habitIds)
    .eq('log_date', today);
  const completedSet = new Set((todayLogs || []).filter(l => l.is_completed).map(l => l.habit_id));

  const whatsapp = require('../services/whatsapp');
  for (const r of due) {
    const h = r.habits;
    if (completedSet.has(h.id)) {
      await supabase.from('habit_reminders').update({ last_sent_at: new Date().toISOString() }).eq('id', r.id);
      continue;
    }
    const collab = byId.get(h.collaborator_id);
    if (!collab || !collab.is_active || !collab.phone) {
      await supabase.from('habit_reminders').update({ last_sent_at: new Date().toISOString() }).eq('id', r.id);
      continue;
    }
    const dnd = await getDndState(collab.id);
    if (dnd.active) {
      console.log(`[HabitReminders] defer ${String(r.id).slice(0,8)} — DND until ${dnd.until}`);
      continue;
    }
    const icon = h.icon || '💪';
    const labelPrefix = r.label ? ` (${r.label})` : '';
    const text = `${icon} *Lembrete:* hora de "${h.name}"${labelPrefix}`;
    try {
      await whatsapp.sendMessage(collab.phone, text);
      await supabase.from('habit_reminders').update({ last_sent_at: new Date().toISOString() }).eq('id', r.id);
      console.log(`[HabitReminders] fired ${String(r.id).slice(0,8)} "${h.name.slice(0,30)}" @${r.time} → ${collab.phone.slice(-4)}`);
      await supabase.from('conversation_history').insert({
        collaborator_id: collab.id,
        direction: 'outbound',
        message_type: 'text',
        content: text,
      });
    } catch (err) {
      console.error(`[HabitReminders] send err for ${String(r.id).slice(0,8)}:`, err.message);
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

module.exports = { run, dispatchChecklists, dispatchAnnouncements, remindUnconfirmedAnnouncements, notifyCoordinators, remindEventTasks, remindOperationalTasks, checkDepartmentOperational, checkChecklistConsequences, checkCoordinationTimeouts, parseOnboardingMarker: undefined, isFirstMondayOfMonth, isLastFridayOfMonth, listLeadership, checkMonthlyPlanning, checkMonthlyClosing, dispatchMonthlyAgenda };
