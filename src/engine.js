// src/engine.js — Pipeline principal: webhook → identifica colaborador →
// constrói system prompt rico (SOUL+AGENTS+contexto Supabase) → chama Claude.
// Phase 1: Onboarding state machine via marker block + ritual entry point.
const fs = require('fs');
const path = require('path');
const collaboratorService = require('./services/collaborator');
const whatsapp = require('./services/whatsapp');
const ai = require('./ai/provider');
const { buildSystemPrompt, formatMessages } = require('./prompts/system');
const supabase = require('./supabase/client');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

const ONBOARDING_DEFAULTS = {
  briefing_time: '08:00',
  closing_time: '19:00',
  planning_day: 0,
  coaching_intensity: 'normal',
};

function loadSkillFile(name) {
  const p = path.join(SKILLS_DIR, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

function appendOnboardingSection(systemPrompt) {
  const skill = loadSkillFile('onboarding.md');
  return systemPrompt + '\n\n---\n\n### ⚠️ ONBOARDING ATIVO\n' +
    'Esta pessoa NÃO terminou o onboarding (collaborators.onboarding_completed=false).\n' +
    'Conduza o fluxo definido abaixo. Faça UMA pergunta por mensagem. Ao final, quando o colaborador confirmar a recapitulação, emita o marcador `<<ONBOARDING_DONE>>...<<END>>` no formato exato. NÃO emita o marcador antes da confirmação final.\n\n' +
    skill + '\n';
}

function appendRitualSection(systemPrompt) {
  const skill = loadSkillFile('rituais-diarios.md');
  return systemPrompt + '\n\n---\n\n### 🎯 RITUAL EM EXECUÇÃO\n' +
    'A próxima mensagem do usuário é uma diretiva `[RITUAL: ...]` disparada pelo cron. Produza a mensagem do ritual seguindo o formato abaixo. Saída vai direto pro WhatsApp.\n\n' +
    skill + '\n';
}

// Procura o marcador <<ONBOARDING_DONE>>{json}<<END>> na resposta do modelo.
// Retorna { prefs, cleanText } ou null.
function parseOnboardingMarker(text) {
  if (!text) return null;
  const re = /<<ONBOARDING_DONE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  let json = null;
  try {
    json = JSON.parse(m[1].trim());
  } catch (err) {
    return { malformed: true, cleanText: text.replace(re, '').trim() };
  }
  const prefs = {
    briefing_time: typeof json.briefing_time === 'string' ? json.briefing_time : ONBOARDING_DEFAULTS.briefing_time,
    closing_time: typeof json.closing_time === 'string' ? json.closing_time : ONBOARDING_DEFAULTS.closing_time,
    planning_day: Number.isInteger(json.planning_day) ? json.planning_day : ONBOARDING_DEFAULTS.planning_day,
    coaching_intensity: ['light', 'normal', 'hard'].includes(json.coaching_intensity)
      ? json.coaching_intensity
      : ONBOARDING_DEFAULTS.coaching_intensity,
  };
  // Normaliza HH:MM → HH:MM:SS para coluna time
  prefs.briefing_time = normalizeTime(prefs.briefing_time);
  prefs.closing_time = normalizeTime(prefs.closing_time);
  const cleanText = text.replace(re, '').trim();
  return { prefs, cleanText, malformed: false };
}

// Parse <<MEMORY_SAVE>>[...]<<END>> — array de objetos. Retorna { rows, cleanText } ou null.
function parseMemoryMarker(text) {
  if (!text) return null;
  const re = /<<MEMORY_SAVE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    return { malformed: true, cleanText: text.replace(re, '').trim() };
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const cleanText = text.replace(re, '').trim();
  return { rows, cleanText, malformed: false };
}

// Parse <<PROJECT_CREATE>>{...}<<END>> — objeto único. Retorna { project, cleanText } ou null.
function parseProjectMarker(text) {
  if (!text) return null;
  const re = /<<PROJECT_CREATE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  let project = null;
  try {
    project = JSON.parse(m[1].trim());
  } catch (err) {
    return { malformed: true, cleanText: text.replace(re, '').trim() };
  }
  const cleanText = text.replace(re, '').trim();
  return { project, cleanText, malformed: false };
}

// Parse <<TASK_UPDATE>>[...]<<END>> — array de ações. Retorna { actions, cleanText } ou null.
function parseTaskUpdateMarker(text) {
  if (!text) return null;
  const re = /<<TASK_UPDATE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    return { malformed: true, cleanText: text.replace(re, '').trim() };
  }
  const actions = Array.isArray(parsed) ? parsed : [parsed];
  const cleanText = text.replace(re, '').trim();
  return { actions, cleanText, malformed: false };
}

const VALID_PRIORITIES = ['low', 'medium', 'high'];
const SHORT_ID_RE = /^[a-f0-9]{4,12}$/i;

// Resolve o prefixo de 8 chars (ou similar) pra UUID completo, RESTRITO ao colaborador.
// Defesa-em-profundidade: marker injetado nunca consegue tocar tarefa de outro user.
async function resolveTaskByShortId(collaboratorId, shortId) {
  if (!shortId || !SHORT_ID_RE.test(String(shortId))) return null;
  // uuid não suporta LIKE — fetch todas as tarefas do colab (last 60 dias) e filtra em JS.
  // Ainda é defense-in-depth: assigned_to é restrito ao colaborador, então cross-user é impossível.
  const prefix = String(shortId).toLowerCase();
  const sinceIso = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, due_date, assigned_to')
    .eq('assigned_to', collaboratorId)
    .gte('due_date', sinceIso)
    .limit(500);
  if (error) {
    console.error('[Task] resolveTaskByShortId err:', error.message);
    return null;
  }
  if (!data || data.length === 0) return null;
  const matches = data.filter(t => String(t.id).toLowerCase().startsWith(prefix));
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    console.warn(`[Task] short_id ambíguo ${shortId} (${matches.length} matches) — rejeitando`);
    return null;
  }
  return matches[0];
}

async function applyTaskActions(collaborator, actions) {
  let okCount = 0;
  let failCount = 0;
  const last4 = String(collaborator.phone || '').slice(-4);
  for (const a of actions) {
    if (!a || typeof a.action !== 'string') {
      failCount++;
      continue;
    }
    try {
      if (a.action === 'complete') {
        const t = await resolveTaskByShortId(collaborator.id, a.id);
        if (!t) {
          console.warn(`[Task] complete REJECTED id=${a.id} (not owned by ${last4} or not found)`);
          failCount++;
          continue;
        }
        const { error } = await supabase
          .from('tasks')
          .update({
            status: 'done',
            completed_at: new Date().toISOString(),
            completed_by: collaborator.id,
          })
          .eq('id', t.id)
          .eq('assigned_to', collaborator.id);
        if (error) {
          console.error('[Task] complete err:', error.message);
          failCount++;
        } else {
          console.log(`[Task] complete ${a.id} by ${last4}`);
          okCount++;
        }
      } else if (a.action === 'reschedule') {
        const t = await resolveTaskByShortId(collaborator.id, a.id);
        if (!t) {
          console.warn(`[Task] reschedule REJECTED id=${a.id} (not owned by ${last4} or not found)`);
          failCount++;
          continue;
        }
        if (!isValidISODate(a.new_due_date)) {
          console.warn(`[Task] reschedule REJECTED — bad date ${a.new_due_date}`);
          failCount++;
          continue;
        }
        const update = { due_date: a.new_due_date };
        if (t.status === 'overdue') update.status = 'pending';
        const { error } = await supabase
          .from('tasks')
          .update(update)
          .eq('id', t.id)
          .eq('assigned_to', collaborator.id);
        if (error) {
          console.error('[Task] reschedule err:', error.message);
          failCount++;
        } else {
          console.log(`[Task] reschedule ${a.id} to ${a.new_due_date}`);
          okCount++;
        }
      } else if (a.action === 'create') {
        if (!a.title || typeof a.title !== 'string' || !a.title.trim()) {
          failCount++;
          continue;
        }
        const context = a.context === 'personal' ? 'personal' : 'work';
        const priority = VALID_PRIORITIES.includes(a.priority) ? a.priority : 'medium';
        const insertRow = {
          title: a.title.trim().slice(0, 200),
          assigned_to: collaborator.id,
          created_by: collaborator.id,
          source: 'manual',
          status: 'pending',
          context,
          priority,
        };
        if (a.remind_at && isValidRemindAt(a.remind_at)) {
          // One-shot reminder: due_date = today (SP), remind_at = exact ts.
          insertRow.remind_at = a.remind_at;
          insertRow.due_date = todaySaoPaulo();
        } else {
          insertRow.due_date = isValidISODate(a.due_date) ? a.due_date : todaySaoPaulo();
        }
        const { data, error } = await supabase
          .from('tasks')
          .insert(insertRow)
          .select('id')
          .single();
        if (error) {
          console.error('[Task] create err:', error.message);
          failCount++;
        } else {
          console.log(`[Task] create "${a.title.trim().slice(0, 60)}" ctx=${context}${a.remind_at ? ` remind_at=${a.remind_at}` : ` due=${insertRow.due_date}`} (id=${(data?.id || '').slice(0, 8)})`);
          okCount++;
        }
      } else {
        console.warn(`[Task] unknown action: ${a.action}`);
        failCount++;
      }
    } catch (err) {
      console.error('[Task] exception:', err.message);
      failCount++;
    }
  }
  return { okCount, failCount };
}

const MEMORY_TYPES = ['fact', 'decision', 'lesson', 'preference', 'context'];
const IMPORTANCE_LEVELS = ['critical', 'high', 'normal', 'low'];

async function persistMemoryRows(collaboratorId, rows) {
  let saved = 0;
  for (const r of rows) {
    if (!r || typeof r.content !== 'string' || !r.content.trim()) continue;
    const memory_type = MEMORY_TYPES.includes(r.memory_type) ? r.memory_type : 'fact';
    const importance = IMPORTANCE_LEVELS.includes(r.importance) ? r.importance : 'normal';
    try {
      const { error } = await supabase.from('collaborator_memory').insert({
        collaborator_id: collaboratorId,
        memory_type,
        content: r.content.trim(),
        importance,
        source: 'conversation',
        is_active: true,
      });
      if (error) {
        console.error('[Memory] insert err:', error.message, '| row:', r.content);
      } else {
        saved++;
      }
    } catch (err) {
      console.error('[Memory] exception:', err.message);
    }
  }
  return saved;
}

const VALID_PROJECT_CATEGORIES = ['pedagogical', 'commercial', 'administrative', 'operational', 'event', 'infrastructure'];

function isValidISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Validates ISO 8601 timestamp with timezone (Z or ±HH:MM). Sanity-check parses.
function isValidRemindAt(s) {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t);
}

async function persistProject(collaborator, p) {
  const allowedRoles = ['coordinator', 'director'];
  if (!allowedRoles.includes(collaborator.role)) {
    console.log(`[Project] BLOCKED: ${collaborator.full_name} (role=${collaborator.role}) tried to create project. Server gate.`);
    return {
      error: true,
      userFacingReply: '_Eu te ajudo a anotar a ideia, mas só coordenador ou diretor pode criar projeto direto._ Quer que eu repasse pra alguém?'
    };
  }
  const creatorId = collaborator.id;
  const category = VALID_PROJECT_CATEGORIES.includes(p.category) ? p.category : 'operational';
  // projects.start_date / end_date são NOT NULL no schema. Fallback: hoje (SP) e +90 dias se "a definir".
  const today = todaySaoPaulo();
  const fallbackEnd = (() => {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 90);
    return d.toISOString().slice(0, 10);
  })();
  const insertRow = {
    name: p.name,
    description: p.description || null,
    justification: p.justification || null,
    location: p.location || null,
    start_date: isValidISODate(p.start_date) ? p.start_date : today,
    end_date: isValidISODate(p.end_date) ? p.end_date : fallbackEnd,
    methodology: p.methodology || null,
    estimated_hours_week: typeof p.estimated_hours_week === 'number' ? p.estimated_hours_week : null,
    category,
    created_by: creatorId,
    status: 'planning',
  };
  const { data, error } = await supabase.from('projects').insert(insertRow).select('id, name').single();
  if (error) throw error;
  const projectId = data.id;
  const { error: memErr } = await supabase.from('project_members').insert({
    project_id: projectId,
    collaborator_id: creatorId,
    role_in_project: 'owner',
  });
  if (memErr) {
    console.error('[Project] project_members insert err:', memErr.message);
    // não derruba a criação — projeto já existe
  }
  return { id: projectId, name: data.name };
}

function normalizeTime(t) {
  if (!t) return null;
  const s = String(t).trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s + ':00';
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  // tenta extrair HH e MM
  const m = s.match(/(\d{1,2})(?::(\d{2}))?/);
  if (m) {
    const hh = String(parseInt(m[1], 10)).padStart(2, '0');
    const mm = (m[2] || '00').padStart(2, '0');
    return `${hh}:${mm}:00`;
  }
  return null;
}

async function persistOnboarding(collaboratorId, prefs) {
  const { error: prefsErr } = await supabase
    .from('user_preferences')
    .upsert({
      collaborator_id: collaboratorId,
      briefing_time: prefs.briefing_time,
      closing_time: prefs.closing_time,
      planning_day: prefs.planning_day,
      coaching_intensity: prefs.coaching_intensity,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'collaborator_id' });
  if (prefsErr) {
    console.error('[Onboarding] Erro ao salvar user_preferences:', prefsErr.message);
    throw prefsErr;
  }
  const { error: collabErr } = await supabase
    .from('collaborators')
    .update({ onboarding_completed: true })
    .eq('id', collaboratorId);
  if (collabErr) {
    console.error('[Onboarding] Erro ao marcar onboarding_completed:', collabErr.message);
    throw collabErr;
  }
  console.log(`[Onboarding] Concluído pra ${collaboratorId}: ${JSON.stringify(prefs)}`);
}

async function processMessage(phone, text, raw = {}) {
  const collab = await collaboratorService.findByPhone(phone);
  if (!collab) {
    await whatsapp.sendMessage(phone, 'Nao te encontrei no sistema. Fala com seu coordenador pra te cadastrar.');
    return;
  }
  console.log('[Engine] Mensagem de', collab.full_name);
  await logConversation(collab.id, 'inbound', text);

  // Constrói o system prompt 4-block (regras → identidade → contexto → skill ativa).
  let { systemPrompt, ctx } = await buildSystemPrompt(collab, { lastUserMessage: text });
  console.log(`[Engine] system prompt size: ${systemPrompt.length} chars (memories=${ctx.memories.length}, tasks=${ctx.todayTasks.length}, notifs=${ctx.notifications.length})`);

  const onboardingActive = collab.onboarding_completed === false;
  // Onboarding skill is now loaded conditionally inside buildSystemPrompt via pickSkill.

  const msgs = formatMessages(ctx.recentMessages, text);
  const response = await ai.chat(systemPrompt, msgs);
  let reply = response.text;

  // Ordem de strip: ONBOARDING → PROJECT → MEMORY (memória por último — não deve aparecer pro user em hipótese alguma).

  // 1) Onboarding (apenas quando ativo)
  if (onboardingActive) {
    const parsed = parseOnboardingMarker(reply);
    if (parsed && parsed.malformed) {
      console.warn('[Onboarding] WARN: malformed marker, asking again');
      reply = parsed.cleanText || reply;
    } else if (parsed) {
      try {
        await persistOnboarding(collab.id, parsed.prefs);
        reply = parsed.cleanText || '👽 Fechou! Bora trabalhar.';
      } catch (err) {
        console.error('[Onboarding] Falha ao persistir:', err.message);
        // segue enviando o texto limpo, conversa continua
        reply = parsed.cleanText || reply;
      }
    }
  }

  // 2) Project create
  {
    const parsedProj = parseProjectMarker(reply);
    if (parsedProj && parsedProj.malformed) {
      console.warn('[Project] WARN: malformed marker');
      reply = parsedProj.cleanText || reply;
    } else if (parsedProj) {
      try {
        const created = await persistProject(collab, parsedProj.project);
        if (created && created.error) {
          reply = created.userFacingReply;
        } else {
          console.log(`[Project] criado por ${String(collab.phone).slice(-4)}: ${created.name} (id=${created.id})`);
          const base = parsedProj.cleanText || '';
          // Sem ID, sem UUID — Claude já confirmou em texto natural antes do marcador.
          // Se Claude não emitiu confirmação, usa fallback semântico padrão (✅ + nome).
          reply = base ? base : `✅ ${created.name} criado! Bora distribuir tarefas?`;
        }
      } catch (err) {
        console.error('[Project] Falha ao criar:', err.message);
        const base = parsedProj.cleanText || '';
        reply = (base ? base + '\n\n' : '') + `⚠️ Não rolou criar agora. Tenta de novo daqui a pouco?`;
      }
    }
  }

  // 2.5) Task update (complete / reschedule / create) — defense-in-depth na resolução de IDs.
  {
    const parsedTask = parseTaskUpdateMarker(reply);
    if (parsedTask && parsedTask.malformed) {
      console.warn('[Task] WARN: malformed marker, dropping block');
      reply = parsedTask.cleanText || reply;
    } else if (parsedTask) {
      const { okCount, failCount } = await applyTaskActions(collab, parsedTask.actions);
      console.log(`[Task] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      let base = parsedTask.cleanText || '';
      if (failCount > 0) {
        base = (base ? base + '\n\n' : '') + '_não consegui atualizar uma das tarefas, te aviso depois_';
      }
      reply = base || reply;
    }
  }

  // 3) Memory save (sempre por último — o conteúdo do bloco NUNCA deve vazar)
  {
    const parsedMem = parseMemoryMarker(reply);
    if (parsedMem && parsedMem.malformed) {
      console.warn('[Memory] WARN: malformed marker, dropping block');
      reply = parsedMem.cleanText || reply;
    } else if (parsedMem) {
      const saved = await persistMemoryRows(collab.id, parsedMem.rows);
      console.log(`[Memory] saved ${saved} facts for ${String(collab.phone).slice(-4)}`);
      reply = parsedMem.cleanText || reply;
    }
  }

  // Safety nets: detect leaks before sending (don't crash, just warn).
  try {
    if (typeof reply === 'string') {
      if (reply.includes('<<') || reply.includes('>>')) {
        console.warn('[Engine] WARN: marker fragment leaked into reply');
      }
      if (/[a-f0-9]{8}-[a-f0-9]/i.test(reply)) {
        console.warn('[Engine] WARN: possible UUID leak in reply');
      }
    }
  } catch (e) {
    // ignore guard errors
  }

  await whatsapp.sendMessage(phone, reply);
  await logConversation(collab.id, 'outbound', reply);
}

async function sendRitual(collaboratorId, ritualType) {
  const { data: collab } = await supabase
    .from('collaborators')
    .select('*, user_preferences(*), collaborator_profiles(*)')
    .eq('id', collaboratorId).single();
  if (!collab?.is_active) return;

  // Tag collaborator with _ritualType so pickSkill loads rituais-diarios + system.js filters tasks.
  const ritualKey = ritualType === 'daily_briefing' ? 'briefing_trabalho'
    : ritualType === 'daily_closing' ? 'fechamento'
    : ritualType === 'personal_briefing' ? 'briefing_pessoal'
    : ritualType;
  collab._ritualType = ritualKey;
  let { systemPrompt } = await buildSystemPrompt(collab);
  console.log(`[Engine] ritual=${ritualType} system prompt size: ${systemPrompt.length} chars`);

  const directive = ritualToDirective(ritualType);
  const response = await ai.chat(systemPrompt, [{ role: 'user', content: directive }]);
  await whatsapp.sendMessage(collab.phone, response.text);
  await logConversation(collab.id, 'outbound', response.text);

  const today = todaySaoPaulo();
  await supabase.from('ritual_logs').upsert({
    collaborator_id: collaboratorId,
    ritual_type: ritualType,
    reference_date: today,
    status: 'sent',
    sent_at: new Date().toISOString(),
  }, { onConflict: 'collaborator_id,ritual_type,reference_date' });
  console.log(`[Ritual] ${ritualType} enviado pra ${collab.phone.slice(-4)}`);
  return response.text;
}

function ritualToDirective(type) {
  if (type === 'daily_briefing') return '[RITUAL: briefing_trabalho]';
  if (type === 'daily_closing') return '[RITUAL: fechamento]';
  if (type === 'personal_briefing') return '[RITUAL: briefing_pessoal]';
  if (type === 'weekly_planning') return '[RITUAL: planejamento_semanal]';
  return `[RITUAL: ${type}]`;
}

function todaySaoPaulo() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

async function logConversation(collaboratorId, direction, content) {
  await supabase.from('conversation_history').insert({
    collaborator_id: collaboratorId,
    direction,
    message_type: 'text',
    content,
  });
}

module.exports = { processMessage, sendRitual, parseOnboardingMarker, persistOnboarding, parseMemoryMarker, parseProjectMarker, parseTaskUpdateMarker, persistMemoryRows, persistProject, applyTaskActions, resolveTaskByShortId };
