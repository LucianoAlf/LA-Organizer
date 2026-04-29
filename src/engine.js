// src/engine.js — Pipeline principal: webhook → identifica colaborador →
// constrói system prompt rico (SOUL+AGENTS+contexto Supabase) → chama Claude.
// Phase 1: Onboarding state machine via marker block + ritual entry point.
const fs = require('fs');
const path = require('path');
const collaboratorService = require('./services/collaborator');
const whatsapp = require('./services/whatsapp');
const metricsService = require('./services/metrics');
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

// ---------- Guard 3: marker schema validation helpers ----------
// Cada parser valida o JSON contra um contrato mínimo. Em caso de falha:
// - Loga erro estruturado (`[Schema] <MARKER> REJECTED ...`)
// - Marca como malformed (cleanText preserva o texto da resposta sem o marker)
// - Engine NÃO executa side effect (persistência/notificação)

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHORT_ID_RE = /^[a-f0-9]{4,12}$/i;
const VALID_TASK_ACTIONS = new Set([
  'complete', 'reschedule', 'create', 'delegate',
  'extension_request', 'extension_decision',
]);
const VALID_COACHING = ['light', 'normal', 'hard'];
const VALID_EVENT_MODALITIES = new Set(['online', 'presencial', 'hibrido']);
const VALID_EVENT_CATEGORIES = new Set(['la_music', 'mentoria', 'aula_particular', 'outra_escola', 'estudio', 'pessoal']);
const VALID_EVENT_UPDATE_ACTIONS = new Set(['reschedule', 'cancel', 'complete']);
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function logSchemaErr(marker, errors, raw) {
  try {
    const compact = typeof raw === 'string' ? raw.slice(0, 200) : JSON.stringify(raw).slice(0, 200);
    console.warn(`[Schema] ${marker} REJECTED — errors=${JSON.stringify(errors)} raw=${compact}`);
  } catch (_) {
    console.warn(`[Schema] ${marker} REJECTED — errors=${JSON.stringify(errors)}`);
  }
}

// Insere uma linha em marker_logs (observabilidade). Falha de log NUNCA derruba o pipeline.
async function logMarker(collaboratorId, markerType, result, reason = null, raw = null) {
  try {
    let excerpt = null;
    if (raw) excerpt = typeof raw === 'string' ? raw.slice(0, 500) : JSON.stringify(raw).slice(0, 500);
    const { error } = await supabase.from('marker_logs').insert({
      collaborator_id: collaboratorId,
      marker_type: markerType,
      result,
      reason: reason ? String(reason).slice(0, 300) : null,
      raw_excerpt: excerpt,
    });
    if (error) console.error(`[marker_logs] insert err type=${markerType} result=${result}:`, error.message);
  } catch (err) {
    console.error('[marker_logs] throw err:', err.message);
  }
}

// Procura o marcador <<ONBOARDING_DONE>>{json}<<END>> na resposta do modelo.
// Retorna { prefs, cleanText } se válido, { malformed:true, cleanText } se não.
function parseOnboardingMarker(text) {
  if (!text) return null;
  const re = /<<ONBOARDING_DONE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let json = null;
  try {
    json = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('ONBOARDING_DONE', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  const errors = [];
  // briefing_time / closing_time: HH:MM ou HH:MM:SS obrigatórios
  if (typeof json.briefing_time !== 'string' || !TIME_RE.test(json.briefing_time)) {
    errors.push('briefing_time:invalid');
  }
  if (typeof json.closing_time !== 'string' || !TIME_RE.test(json.closing_time)) {
    errors.push('closing_time:invalid');
  }
  // planning_day: int 0-6 — manter compat (default se faltar/ inválido), mas logar
  let planningDay = ONBOARDING_DEFAULTS.planning_day;
  if (Number.isInteger(json.planning_day) && json.planning_day >= 0 && json.planning_day <= 6) {
    planningDay = json.planning_day;
  } else if (json.planning_day !== undefined) {
    errors.push('planning_day:out_of_range');
  }
  // coaching_intensity: light|normal|hard estrito
  if (!VALID_COACHING.includes(json.coaching_intensity)) {
    errors.push('coaching_intensity:invalid');
  }
  // Erro fatal só pra fields obrigatórios (briefing/closing/coaching). planning_day cai no default.
  const fatal = errors.filter(e => !e.startsWith('planning_day'));
  if (fatal.length) {
    logSchemaErr('ONBOARDING_DONE', errors, json);
    return { malformed: true, cleanText };
  }
  const prefs = {
    briefing_time: normalizeTime(json.briefing_time),
    closing_time: normalizeTime(json.closing_time),
    planning_day: planningDay,
    coaching_intensity: json.coaching_intensity,
  };
  return { prefs, cleanText, malformed: false };
}

// Parse <<MEMORY_SAVE>>[...]<<END>> — filtra rows sem content válido.
function parseMemoryMarker(text) {
  if (!text) return null;
  const re = /<<MEMORY_SAVE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed = null;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('MEMORY_SAVE', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  const rawRows = Array.isArray(parsed) ? parsed : [parsed];
  const validRows = [];
  const dropped = [];
  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    if (!r || typeof r.content !== 'string' || !r.content.trim()) {
      dropped.push(`row[${i}]:missing_content`);
      continue;
    }
    validRows.push(r);
  }
  if (dropped.length) logSchemaErr('MEMORY_SAVE', dropped, parsed);
  if (!validRows.length) return { malformed: true, cleanText };
  return { rows: validRows, cleanText, malformed: false };
}

// Parse <<PROJECT_CREATE>>{...}<<END>> — name obrigatório não-vazio.
function parseProjectMarker(text) {
  if (!text) return null;
  const re = /<<PROJECT_CREATE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let project = null;
  try {
    project = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('PROJECT_CREATE', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    logSchemaErr('PROJECT_CREATE', ['not_object'], project);
    return { malformed: true, cleanText };
  }
  if (typeof project.name !== 'string' || !project.name.trim()) {
    logSchemaErr('PROJECT_CREATE', ['name:missing_or_empty'], project);
    return { malformed: true, cleanText };
  }
  return { project, cleanText, malformed: false };
}

// Parse <<TASK_UPDATE>>[...]<<END>> — filtra ações inválidas, mantém o resto.
function parseTaskUpdateMarker(text) {
  if (!text) return null;
  const re = /<<TASK_UPDATE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed = null;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('TASK_UPDATE', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  const rawActions = Array.isArray(parsed) ? parsed : [parsed];
  const valid = [];
  const dropped = [];
  for (let i = 0; i < rawActions.length; i++) {
    const a = rawActions[i];
    const why = validateTaskAction(a);
    if (why) {
      dropped.push(`action[${i}]:${why}`);
      continue;
    }
    valid.push(a);
  }
  if (dropped.length) logSchemaErr('TASK_UPDATE', dropped, parsed);
  if (!valid.length) return { malformed: true, cleanText };
  return { actions: valid, cleanText, malformed: false };
}

// Parse <<EVENT_CREATE>>[...]<<END>> — TOM emite evento (compromisso com horário).
// Schema mínimo por item:
//   title, start_at (ISO -03:00), end_at (ISO -03:00), modality, category
//   opcionais: context, location_text, meeting_url, description, project_id
// `category=pessoal` força `context=personal` por default (regra UX consistente com PWA).
function validateEventItem(e) {
  if (!e || typeof e !== 'object') return 'not_object';
  if (typeof e.title !== 'string' || !e.title.trim()) return 'title:missing';
  if (typeof e.start_at !== 'string' || !ISO_DATETIME_RE.test(e.start_at)) return 'start_at:invalid';
  if (typeof e.end_at !== 'string' || !ISO_DATETIME_RE.test(e.end_at)) return 'end_at:invalid';
  if (new Date(e.end_at).getTime() <= new Date(e.start_at).getTime()) return 'end_before_start';
  if (typeof e.modality !== 'string' || !VALID_EVENT_MODALITIES.has(e.modality)) return 'modality:invalid';
  if (typeof e.category !== 'string' || !VALID_EVENT_CATEGORIES.has(e.category)) return 'category:invalid';
  if (e.modality === 'presencial' && e.meeting_url) return 'presencial_with_meeting_url';
  if (e.context !== undefined && e.context !== 'work' && e.context !== 'personal') return 'context:invalid';
  return null;
}

function parseEventCreateMarker(text) {
  if (!text) return null;
  const re = /<<EVENT_CREATE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('EVENT_CREATE', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const valid = [];
  const dropped = [];
  for (let i = 0; i < items.length; i++) {
    const why = validateEventItem(items[i]);
    if (why) dropped.push(`item[${i}]:${why}`);
    else valid.push(items[i]);
  }
  if (dropped.length) logSchemaErr('EVENT_CREATE', dropped, parsed);
  if (!valid.length) return { malformed: true, cleanText };
  return { events: valid, cleanText, malformed: false };
}

async function applyEventActions(collaborator, events) {
  let okCount = 0, failCount = 0;
  const last4 = String(collaborator.phone || '').slice(-4);
  for (const e of events) {
    try {
      const ctx = e.context || (e.category === 'pessoal' ? 'personal' : 'work');
      const row = {
        title: e.title.trim().slice(0, 200),
        description: typeof e.description === 'string' ? e.description.slice(0, 1000) : null,
        collaborator_id: collaborator.id,
        created_by: collaborator.id,
        context: ctx,
        category: e.category,
        start_at: e.start_at,
        end_at: e.end_at,
        modality: e.modality,
        location_text: typeof e.location_text === 'string' ? e.location_text.slice(0, 200) : null,
        meeting_url: typeof e.meeting_url === 'string' ? e.meeting_url.slice(0, 500) : null,
        project_id: typeof e.project_id === 'string' ? e.project_id : null,
        status: 'scheduled',
        source: 'tom',
      };
      const { data, error } = await supabase
        .from('events')
        .insert(row)
        .select('id')
        .single();
      if (error) {
        console.error('[Event] create err:', error.message);
        failCount++;
        continue;
      }
      console.log(`[Event] create "${row.title.slice(0, 60)}" cat=${row.category} mod=${row.modality} ctx=${ctx} by ${last4} (id=${String(data?.id || '').slice(0, 8)})`);
      okCount++;
    } catch (err) {
      console.error('[Event] throw err:', err.message);
      failCount++;
    }
  }
  return { okCount, failCount };
}

// Parse <<EVENT_UPDATE>>[...]<<END>> — reagendar / cancelar / completar event existente.
// Schema:
//   { "action": "reschedule", "id": "<8-char>", "new_start_at": ISO, "new_end_at": ISO }
//   { "action": "cancel",     "id": "<8-char>" }
//   { "action": "complete",   "id": "<8-char>" }
function validateEventUpdateAction(a) {
  if (!a || typeof a !== 'object') return 'not_object';
  if (!VALID_EVENT_UPDATE_ACTIONS.has(a.action)) return 'action:invalid';
  if (typeof a.id !== 'string' || !SHORT_ID_RE.test(a.id)) return 'id:invalid';
  if (a.action === 'reschedule') {
    if (typeof a.new_start_at !== 'string' || !ISO_DATETIME_RE.test(a.new_start_at)) return 'new_start_at:invalid';
    if (typeof a.new_end_at !== 'string' || !ISO_DATETIME_RE.test(a.new_end_at)) return 'new_end_at:invalid';
    if (new Date(a.new_end_at).getTime() <= new Date(a.new_start_at).getTime()) return 'end_before_start';
  }
  return null;
}

function parseEventUpdateMarker(text) {
  if (!text) return null;
  const re = /<<EVENT_UPDATE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('EVENT_UPDATE', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const valid = [];
  const dropped = [];
  for (let i = 0; i < items.length; i++) {
    const why = validateEventUpdateAction(items[i]);
    if (why) dropped.push(`item[${i}]:${why}`);
    else valid.push(items[i]);
  }
  if (dropped.length) logSchemaErr('EVENT_UPDATE', dropped, parsed);
  if (!valid.length) return { malformed: true, cleanText };
  return { actions: valid, cleanText, malformed: false };
}

// ---------- Sprint 8: aprovação/rejeição de projeto pendente ----------
// Skill `aprovar-projeto` emite o token literal que o usuário digitou
// (APROVA SARAU). Engine resolve token → projeto pendente único.
const APPROVAL_STOPWORDS = new Set([
  'LA','DA','DE','DO','DOS','DAS','O','A','OS','AS','UM','UMA',
  'NO','NA','EM','COM','PARA','POR','E','OU','SEM','SOB','PELO','PELA',
]);
function extractApprovalToken(name) {
  const upper = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const words = upper.split(/\s+/).filter(Boolean);
  for (const w of words) {
    const cleaned = w.replace(/[^A-Z0-9]/g, '');
    if (cleaned.length >= 3 && !APPROVAL_STOPWORDS.has(cleaned)) return cleaned;
  }
  return (words[0] || '').replace(/[^A-Z0-9]/g, '') || 'PROJETO';
}

function parseProjectApproveMarker(text) {
  if (typeof text !== 'string') return null;
  const re = /<<PROJECT_APPROVE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try { parsed = JSON.parse(m[1].trim()); } catch (err) {
    logSchemaErr('PROJECT_APPROVE', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  const token = parsed && typeof parsed.token === 'string' ? parsed.token.trim().toUpperCase() : null;
  if (!token) {
    logSchemaErr('PROJECT_APPROVE', ['token:missing_or_invalid'], parsed);
    return { malformed: true, cleanText };
  }
  return { token, cleanText, malformed: false };
}

function parseProjectRejectMarker(text) {
  if (typeof text !== 'string') return null;
  const re = /<<PROJECT_REJECT>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try { parsed = JSON.parse(m[1].trim()); } catch (err) {
    logSchemaErr('PROJECT_REJECT', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  const token = parsed && typeof parsed.token === 'string' ? parsed.token.trim().toUpperCase() : null;
  const reason = parsed && typeof parsed.reason === 'string' ? parsed.reason.trim() : null;
  if (!token) {
    logSchemaErr('PROJECT_REJECT', ['token:missing_or_invalid'], parsed);
    return { malformed: true, cleanText };
  }
  if (!reason) {
    logSchemaErr('PROJECT_REJECT', ['reason:missing'], parsed);
    return { malformed: true, cleanText };
  }
  return { token, reason, cleanText, malformed: false };
}

// Resolve token contra projetos pending_approval.
// Retorna { match, ambiguous, none, projects } onde:
//   match: o único projeto que casa, ou null
//   ambiguous: true se 2+ projetos casam
//   none: true se nenhum projeto casa
async function resolveApprovalToken(token) {
  const { data: pendings, error } = await supabase
    .from('projects')
    .select('id, name, justification, location, start_date, end_date, category, created_by')
    .eq('status', 'pending_approval');
  if (error) {
    console.error('[Project] resolveApprovalToken err:', error.message);
    return { match: null, ambiguous: false, none: false, error: error.message };
  }
  const matches = (pendings || []).filter(p => extractApprovalToken(p.name) === token);
  if (matches.length === 0) return { match: null, ambiguous: false, none: true };
  if (matches.length > 1) return { match: null, ambiguous: true, none: false, candidates: matches };
  return { match: matches[0], ambiguous: false, none: false };
}

async function applyProjectApprove(collab, body) {
  if (collab.role !== 'coordinator' && collab.role !== 'director') {
    return { ok: false, reason: 'role_not_authorized', userMsg: '_aprovar projeto é só pra coord/diretor_' };
  }
  const r = await resolveApprovalToken(body.token);
  if (r.error) return { ok: false, reason: `db_error:${r.error}`, userMsg: '_não consegui consultar agora, tenta de novo daqui a pouco_' };
  if (r.none) return { ok: false, reason: `token_not_found:${body.token}`, userMsg: `_não tenho projeto pendente com nome \"${body.token}\". tem certeza?_` };
  if (r.ambiguous) {
    const names = (r.candidates || []).map(p => `*${p.name}*`).join(', ');
    return { ok: false, reason: `ambiguous_token:${body.token}`, userMsg: `_tenho mais de um projeto começando com ${body.token}: ${names}. pode reescrever o nome inteiro?_` };
  }
  const project = r.match;
  const { error: upErr } = await supabase
    .from('projects')
    .update({
      status: 'planning',
      requires_approval: false,
      approved_by: collab.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', project.id);
  if (upErr) return { ok: false, reason: `update_error:${upErr.message}`, userMsg: '_não consegui salvar a aprovação, tenta de novo_' };

  // Notifica criador
  const { data: creator } = await supabase
    .from('collaborators').select('phone, full_name').eq('id', project.created_by).single();
  if (creator?.phone) {
    const msg = `🎉 *${project.name}* foi aprovado por *${collab.full_name}*!\n\nO TOM já vai começar a estruturar e distribuir as tarefas.`;
    whatsapp.sendMessage(creator.phone, msg).catch(e => console.error(`[Project] APPROVE WA creator err: ${e.message}`));
  }
  return { ok: true, project };
}

async function applyProjectReject(collab, body) {
  if (collab.role !== 'coordinator' && collab.role !== 'director') {
    return { ok: false, reason: 'role_not_authorized', userMsg: '_rejeitar projeto é só pra coord/diretor_' };
  }
  const r = await resolveApprovalToken(body.token);
  if (r.error) return { ok: false, reason: `db_error:${r.error}`, userMsg: '_não consegui consultar agora, tenta de novo daqui a pouco_' };
  if (r.none) return { ok: false, reason: `token_not_found:${body.token}`, userMsg: `_não tenho projeto pendente com nome \"${body.token}\". tem certeza?_` };
  if (r.ambiguous) {
    const names = (r.candidates || []).map(p => `*${p.name}*`).join(', ');
    return { ok: false, reason: `ambiguous_token:${body.token}`, userMsg: `_tenho mais de um projeto começando com ${body.token}: ${names}. pode reescrever o nome inteiro?_` };
  }
  const project = r.match;
  const reason = String(body.reason || '').slice(0, 1000);
  const { error: upErr } = await supabase
    .from('projects')
    .update({
      status: 'cancelled',
      requires_approval: false,
      rejection_reason: reason,
    })
    .eq('id', project.id);
  if (upErr) return { ok: false, reason: `update_error:${upErr.message}`, userMsg: '_não consegui salvar a rejeição, tenta de novo_' };

  const { data: creator } = await supabase
    .from('collaborators').select('phone, full_name').eq('id', project.created_by).single();
  if (creator?.phone) {
    const msg = `❌ Seu projeto *${project.name}* foi rejeitado por *${collab.full_name}*.\n\n_Motivo:_ ${reason}\n\nSe quiser ajustar e tentar de novo, é só me chamar.`;
    whatsapp.sendMessage(creator.phone, msg).catch(e => console.error(`[Project] REJECT WA creator err: ${e.message}`));
  }
  return { ok: true, project };
}

// Defesa-em-profundidade na resolução de short_id: filtra eventos do colaborador.
async function resolveEventByShortId(collaboratorId, shortId) {
  if (!shortId || !SHORT_ID_RE.test(String(shortId))) return null;
  const prefix = String(shortId).toLowerCase();
  // Janela ampla — eventos cancelados ou já feitos podem precisar ser referenciados.
  const sinceIso = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('events')
    .select('id, title, status, start_at, end_at, collaborator_id')
    .eq('collaborator_id', collaboratorId)
    .gte('start_at', sinceIso)
    .limit(500);
  if (error) {
    console.error('[Event] resolveEventByShortId err:', error.message);
    return null;
  }
  if (!data || data.length === 0) return null;
  const matches = data.filter(e => String(e.id).toLowerCase().startsWith(prefix));
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    console.warn(`[Event] short_id ambíguo ${shortId} (${matches.length} matches) — rejeitando`);
    return null;
  }
  return matches[0];
}

async function applyEventUpdates(collaborator, actions) {
  let okCount = 0, failCount = 0;
  const last4 = String(collaborator.phone || '').slice(-4);
  for (const a of actions) {
    try {
      const ev = await resolveEventByShortId(collaborator.id, a.id);
      if (!ev) {
        console.warn(`[Event] ${a.action} REJECTED id=${a.id} (not owned by ${last4} or not found)`);
        failCount++;
        continue;
      }
      let patch = {};
      if (a.action === 'reschedule') {
        patch = { start_at: a.new_start_at, end_at: a.new_end_at };
        if (ev.status === 'cancelled') patch.status = 'scheduled';
      } else if (a.action === 'cancel') {
        patch = { status: 'cancelled' };
      } else if (a.action === 'complete') {
        patch = { status: 'done' };
      }
      const { error } = await supabase
        .from('events')
        .update(patch)
        .eq('id', ev.id)
        .eq('collaborator_id', collaborator.id);
      if (error) {
        console.error(`[Event] ${a.action} err:`, error.message);
        failCount++;
        continue;
      }
      console.log(`[Event] ${a.action} ${a.id} by ${last4}${a.action === 'reschedule' ? ` to ${a.new_start_at.slice(0, 16)}` : ''}`);
      okCount++;
    } catch (err) {
      console.error('[Event] update throw err:', err.message);
      failCount++;
    }
  }
  return { okCount, failCount };
}

// Parse <<WEEKLY_PLAN>>{...}<<END>> — weekly planning marker.
function parseWeeklyPlanMarker(text) {
  if (!text) return null;
  const re = /<<WEEKLY_PLAN>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let plan = null;
  try {
    plan = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('WEEKLY_PLAN', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    logSchemaErr('WEEKLY_PLAN', ['not_object'], plan);
    return { malformed: true, cleanText };
  }
  const errors = [];
  if (typeof plan.week_start !== 'string' || !ISO_DATE_RE.test(plan.week_start)) errors.push('week_start:invalid');
  if (!Array.isArray(plan.goals) || !plan.goals.length || plan.goals.length > 5) errors.push('goals:invalid_length');
  if (Array.isArray(plan.goals) && plan.goals.some(g => typeof g !== 'string' || !g.trim())) errors.push('goals:has_empty');
  if (!Array.isArray(plan.distribution) || !plan.distribution.length) errors.push('distribution:missing');
  if (Array.isArray(plan.distribution)) {
    for (let i = 0; i < plan.distribution.length; i++) {
      const d = plan.distribution[i];
      if (!d || typeof d !== 'object') { errors.push(`distribution[${i}]:not_object`); continue; }
      if (typeof d.day !== 'string' || !ISO_DATE_RE.test(d.day)) errors.push(`distribution[${i}]:bad_day`);
      if (!Array.isArray(d.items) || !d.items.length) errors.push(`distribution[${i}]:no_items`);
      if (Array.isArray(d.items) && d.items.some(it => typeof it !== 'string' || !it.trim())) errors.push(`distribution[${i}]:has_empty_item`);
    }
  }
  if (errors.length) {
    logSchemaErr('WEEKLY_PLAN', errors, plan);
    return { malformed: true, cleanText };
  }
  return { plan, cleanText, malformed: false };
}

// Parse <<DND_SET>>{...}<<END>> — pause notifications for a window.
// Schema: { until: ISO 8601 timestamp with timezone, reason?: string }.
// On clear / wake-up, Claude can emit { until: null } or { clear: true }.
function parseDndMarker(text) {
  if (!text) return null;
  const re = /<<DND_SET>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let payload = null;
  try { payload = JSON.parse(m[1].trim()); }
  catch (err) {
    logSchemaErr('DND_SET', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    logSchemaErr('DND_SET', ['not_object'], payload);
    return { malformed: true, cleanText };
  }
  // CLEAR variant: explicit clear or null until
  if (payload.clear === true || payload.until === null) {
    return { clear: true, cleanText, malformed: false };
  }
  // SET variant: until must be a valid future ISO timestamp
  if (typeof payload.until !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(payload.until)) {
    logSchemaErr('DND_SET', ['until:bad_iso'], payload);
    return { malformed: true, cleanText };
  }
  const untilMs = Date.parse(payload.until);
  if (Number.isNaN(untilMs)) {
    logSchemaErr('DND_SET', ['until:unparseable'], payload);
    return { malformed: true, cleanText };
  }
  if (untilMs <= Date.now() + 60_000) {
    logSchemaErr('DND_SET', ['until:not_future'], payload);
    return { malformed: true, cleanText };
  }
  // Cap at 24h to prevent accidental indefinite silence
  const MAX_MS = 24 * 60 * 60 * 1000;
  let untilFinal = payload.until;
  if (untilMs - Date.now() > MAX_MS) {
    untilFinal = new Date(Date.now() + MAX_MS).toISOString();
    logSchemaErr('DND_SET', ['until:capped_to_24h'], payload);
  }
  const reason = typeof payload.reason === 'string' ? payload.reason.trim().slice(0, 80) : null;
  return { until: untilFinal, reason, cleanText, malformed: false };
}

// Returns null if valid, else a string code describing why the action was rejected.
function validateTaskAction(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 'not_object';
  if (typeof a.action !== 'string' || !VALID_TASK_ACTIONS.has(a.action)) return 'unknown_action';
  if (a.action === 'complete') {
    if (typeof a.id !== 'string' || !SHORT_ID_RE.test(a.id)) return 'bad_id';
  } else if (a.action === 'reschedule') {
    if (typeof a.id !== 'string' || !SHORT_ID_RE.test(a.id)) return 'bad_id';
    if (typeof a.new_due_date !== 'string' || !ISO_DATE_RE.test(a.new_due_date)) return 'bad_new_due_date';
  } else if (a.action === 'create') {
    if (typeof a.title !== 'string' || !a.title.trim()) return 'title_missing';
    // remind_at e due_date são opcionais — applyTaskActions trata defaults.
    // reminders_at: array de ISO 8601 com timezone, opcional.
    if (a.reminders_at !== undefined) {
      if (!Array.isArray(a.reminders_at)) return 'reminders_at_not_array';
      if (a.reminders_at.length > 10) return 'reminders_at_too_many';
    }
    // to_name / to_phone: opcionais — quando presentes, cria task PARA outro
    // colaborador. Permissão validada em applyTaskActions (coordinator/director).
    if (a.to_name !== undefined && (typeof a.to_name !== 'string' || !a.to_name.trim())) return 'bad_to_name';
    if (a.to_phone !== undefined && (typeof a.to_phone !== 'string' || !a.to_phone.trim())) return 'bad_to_phone';
  } else if (a.action === 'delegate') {
    if (typeof a.id !== 'string' || !SHORT_ID_RE.test(a.id)) return 'bad_id';
    const hasName = typeof a.to_name === 'string' && a.to_name.trim();
    const hasPhone = typeof a.to_phone === 'string' && a.to_phone.trim();
    if (!hasName && !hasPhone) return 'recipient_missing';
  } else if (a.action === 'extension_request') {
    if (typeof a.id !== 'string' || !SHORT_ID_RE.test(a.id)) return 'bad_id';
    if (typeof a.reason !== 'string' || !a.reason.trim()) return 'reason_missing';
    if (a.new_due_date !== undefined && !ISO_DATE_RE.test(String(a.new_due_date))) return 'bad_new_due_date';
  } else if (a.action === 'extension_decision') {
    if (typeof a.id !== 'string' || !SHORT_ID_RE.test(a.id)) return 'bad_id';
    if (typeof a.approved !== 'boolean' && a.approved !== 'true' && a.approved !== 'false') return 'approved_not_bool';
    const isApproved = a.approved === true || a.approved === 'true';
    if (isApproved && (typeof a.new_due_date !== 'string' || !ISO_DATE_RE.test(a.new_due_date))) return 'approved_needs_date';
  }
  return null;
}

const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];
// SHORT_ID_RE is defined above near the schema validators.

// Friendly name (matches prompts/system.js nameFor — duplicated to avoid circular dep).
function nameForCollab(collab) {
  if (!collab) return 'amigo';
  if (collab.full_name === 'Luciano Alf') return 'Alf';
  return (collab.full_name || '').split(' ')[0] || 'amigo';
}

// Returns "DD/MM" from "YYYY-MM-DD".
function formatBRDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}`;
}

// Resolve a collaborator by best-effort name match (active only). Returns single
// match or null (rejects when ambiguous).
async function findCollaboratorByName(name) {
  const norm = String(name || '').trim().toLowerCase();
  if (!norm) return null;
  const { data } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active, role')
    .eq('is_active', true);
  if (!data || !data.length) return null;
  const first = norm.split(/\s+/)[0];
  // Try exact match on first name (case-insensitive), then prefix.
  const exact = data.filter(c => (c.full_name || '').toLowerCase().split(' ')[0] === first);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const prefix = data.filter(c => (c.full_name || '').toLowerCase().startsWith(first));
  if (prefix.length === 1) return prefix[0];
  return null;
}

async function findCollaboratorByPhone(phone) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  if (!cleaned) return null;
  const { data } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active, role')
    .eq('phone', cleaned)
    .maybeSingle();
  return data;
}

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
        // ---- create-for-other: opt-in via to_name/to_phone, gated by role ----
        const wantsForOther = (typeof a.to_name === 'string' && a.to_name.trim()) ||
                              (typeof a.to_phone === 'string' && a.to_phone.trim());
        let assignedTo = collaborator.id;
        let recipient = null;
        if (wantsForOther) {
          if (collaborator.role !== 'coordinator' && collaborator.role !== 'director') {
            console.warn(`[Task] create-for-other REJECTED — role=${collaborator.role || 'collaborator'} cannot create task for others`);
            failCount++;
            continue;
          }
          if (a.to_phone) recipient = await findCollaboratorByPhone(a.to_phone);
          else recipient = await findCollaboratorByName(a.to_name);
          if (!recipient || !recipient.is_active) {
            console.warn(`[Task] create-for-other REJECTED — recipient not found/inactive: ${a.to_phone || a.to_name}`);
            failCount++;
            continue;
          }
          // Self-assignment via to_name → silently fall back to normal create
          if (recipient.id !== collaborator.id) {
            assignedTo = recipient.id;
          } else {
            recipient = null; // treat as normal self-create
          }
        }
        const context = a.context === 'personal' ? 'personal' : 'work';
        const priority = VALID_PRIORITIES.includes(a.priority) ? a.priority : 'medium';
        const insertRow = {
          title: a.title.trim().slice(0, 200),
          assigned_to: assignedTo,
          created_by: collaborator.id,
          source: 'manual',
          status: 'pending',
          context,
          priority,
        };
        // remind_at = ONE-SHOT (e.g. "me lembra de tomar remédio em 30 min").
        //             Dispatcher fires WA AND marks task done. Use só quando a tarefa
        //             é o lembrete em si (sem reunião associada).
        // reminders_at = MULTIPLE alertas pra uma tarefa real (reunião). Cada um
        //                vira uma linha em task_reminders, dispara WA mas NÃO mexe
        //                no status da tarefa. Tarefa permanece pendente.
        const reminders = Array.isArray(a.reminders_at)
          ? a.reminders_at.filter(r => typeof r === 'string' && isValidRemindAt(r))
          : [];
        if (reminders.length === 0 && a.remind_at && isValidRemindAt(a.remind_at)) {
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
          continue;
        }
        const taskId = data?.id;
        let attachedReminders = 0;
        if (reminders.length && taskId) {
          const labels = Array.isArray(a.reminders_labels) ? a.reminders_labels : [];
          const rows = reminders.map((iso, i) => ({
            task_id: taskId,
            remind_at: iso,
            label: typeof labels[i] === 'string' ? labels[i].slice(0, 40) : null,
          }));
          const { error: rErr } = await supabase.from('task_reminders').insert(rows);
          if (rErr) console.error('[Task] reminders insert err:', rErr.message);
          else attachedReminders = rows.length;
        }
        const sufx = insertRow.remind_at ? ` remind_at=${insertRow.remind_at}`
          : reminders.length ? ` due=${insertRow.due_date} reminders=${attachedReminders}`
          : ` due=${insertRow.due_date}`;
        const forSuf = recipient ? ` for=${String(recipient.phone).slice(-4)}(${recipient.full_name})` : '';
        console.log(`[Task] create "${a.title.trim().slice(0, 60)}" ctx=${context}${sufx}${forSuf} (id=${String(taskId || '').slice(0, 8)})`);
        // Notify recipient when created-for-other (best-effort).
        if (recipient && taskId) {
          const creatorName = nameForCollab(collaborator);
          const dueLabel = insertRow.due_date ? ` (prazo ${formatBRDate(insertRow.due_date)})` : '';
          const notifText = `📋 ${creatorName} abriu uma tarefa pra você: *${a.title.trim()}*${dueLabel}.`;
          try {
            await whatsapp.sendMessage(recipient.phone, notifText);
            await supabase.from('conversation_history').insert({
              collaborator_id: recipient.id,
              direction: 'outbound',
              message_type: 'text',
              content: notifText,
            });
            await supabase.from('notifications').insert({
              collaborator_id: recipient.id,
              notification_type: 'task_assigned_by_other',
              title: `Tarefa atribuída por ${creatorName}`,
              body: notifText,
              reference_type: 'task',
              reference_id: taskId,
              channel: 'whatsapp',
              status: 'sent',
              sent_at: new Date().toISOString(),
            });
          } catch (err) {
            console.error('[Task] create-for-other notification err:', err.message);
            // task created in DB; notification failure does not flip okCount
          }
        }
        okCount++;
      } else if (a.action === 'extension_request') {
        const t = await resolveTaskByShortId(collaborator.id, a.id);
        if (!t) {
          console.warn(`[Task] extension_request REJECTED id=${a.id} (not owned by ${last4})`);
          failCount++;
          continue;
        }
        const reason = (typeof a.reason === 'string' && a.reason.trim()) ? a.reason.trim().slice(0, 500) : null;
        // Resolve supervisor via collaborators.supervisor_id, fallback to any active coordinator/director.
        let supervisor = null;
        if (collaborator.supervisor_id) {
          const { data } = await supabase
            .from('collaborators')
            .select('id, full_name, phone, is_active')
            .eq('id', collaborator.supervisor_id).maybeSingle();
          if (data && data.is_active) supervisor = data;
        }
        if (!supervisor) {
          const { data } = await supabase
            .from('collaborators')
            .select('id, full_name, phone, is_active, role')
            .in('role', ['coordinator', 'director'])
            .eq('is_active', true).neq('id', collaborator.id).limit(1);
          if (data && data.length) supervisor = data[0];
        }
        if (!supervisor) {
          console.warn('[Task] extension_request REJECTED — no supervisor available');
          failCount++;
          continue;
        }
        // Insert task_comment with the reason (audit trail).
        if (reason) {
          await supabase.from('task_comments').insert({
            task_id: t.id,
            content: `[extensão pedida] ${reason}`,
            comment_type: 'manual',
            created_by: collaborator.id,
          });
        }
        // Insert notification for supervisor (status=sent — we send right away).
        const requesterName = nameForCollab(collaborator);
        const dueLabel = t.due_date ? formatBRDate(t.due_date) : 'sem prazo';
        const askText = a.new_due_date && isValidISODate(a.new_due_date)
          ? ` Pediu até ${formatBRDate(a.new_due_date)}.`
          : '';
        const notifBody = `⚠️ ${requesterName} pediu mais prazo na tarefa *${t.title}* (prazo atual: ${dueLabel}).${askText}${reason ? ` Motivo: ${reason}.` : ''}\n\nResponde *aprovar até DD/MM* ou *negar*.`;
        await supabase.from('notifications').insert({
          collaborator_id: supervisor.id,
          notification_type: 'deadline_extension_request',
          title: `${requesterName} pediu mais prazo`,
          body: notifBody,
          reference_type: 'task',
          reference_id: t.id,
          channel: 'whatsapp',
          status: 'sent',
          sent_at: new Date().toISOString(),
        });
        try {
          await whatsapp.sendMessage(supervisor.phone, notifBody);
          await supabase.from('conversation_history').insert({
            collaborator_id: supervisor.id,
            direction: 'outbound',
            message_type: 'text',
            content: notifBody,
          });
          console.log(`[Task] extension_request ${a.id} ${last4} → supervisor ${String(supervisor.phone).slice(-4)}`);
          okCount++;
        } catch (err) {
          console.error('[Task] extension_request notify err:', err.message);
          okCount++;
        }
      } else if (a.action === 'extension_decision') {
        // Coordinator deciding on a pending extension request. Approve→update task.due_date.
        const approved = a.approved === true || a.approved === 'true';
        // Recipient is the requester — find the task via id (any task, not necessarily owned by deciding user).
        const shortId = a.id;
        if (!shortId || !SHORT_ID_RE.test(String(shortId))) {
          failCount++;
          continue;
        }
        const sinceIso = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        // Find the task by prefix — but ANY assigned_to (since we're deciding, not editing our own).
        // Restrict by matching a recent extension_request notification to this collaborator.
        const { data: tasksMatching } = await supabase
          .from('tasks')
          .select('id, title, due_date, assigned_to, projects(name)')
          .gte('due_date', sinceIso)
          .limit(500);
        const prefix = String(shortId).toLowerCase();
        const candidate = (tasksMatching || []).find(t => String(t.id).toLowerCase().startsWith(prefix));
        if (!candidate) {
          console.warn(`[Task] extension_decision REJECTED — task ${shortId} not found`);
          failCount++;
          continue;
        }
        // Verify the deciding user actually has a pending extension_request notification for this task.
        const { data: notifs } = await supabase
          .from('notifications')
          .select('id, created_at')
          .eq('collaborator_id', collaborator.id)
          .eq('notification_type', 'deadline_extension_request')
          .eq('reference_id', candidate.id)
          .order('created_at', { ascending: false }).limit(1);
        if (!notifs || !notifs.length) {
          console.warn(`[Task] extension_decision REJECTED — no pending request for ${last4} on task ${shortId}`);
          failCount++;
          continue;
        }
        // If approved, must include new_due_date.
        if (approved && (!a.new_due_date || !isValidISODate(a.new_due_date))) {
          console.warn('[Task] extension_decision approved but bad new_due_date');
          failCount++;
          continue;
        }
        if (approved) {
          const update = { due_date: a.new_due_date };
          // If task was overdue, reset status to pending.
          await supabase.from('tasks').update(update).eq('id', candidate.id);
        }
        // Mark notification as read so it doesn't re-trigger.
        await supabase.from('notifications').update({ status: 'read', read_at: new Date().toISOString() }).eq('id', notifs[0].id);
        // Notify requester.
        const { data: reqColl } = await supabase
          .from('collaborators')
          .select('id, phone, full_name').eq('id', candidate.assigned_to).maybeSingle();
        if (reqColl && reqColl.phone) {
          const decidedBy = nameForCollab(collaborator);
          const replyToReq = approved
            ? `✅ ${decidedBy} aprovou seu prazo: *${candidate.title}* fica pra ${formatBRDate(a.new_due_date)}.`
            : `🚫 ${decidedBy} não aprovou o prazo extra na tarefa *${candidate.title}*.${a.reason ? ` Motivo: ${a.reason}.` : ''} Bora resolver hoje?`;
          try {
            await whatsapp.sendMessage(reqColl.phone, replyToReq);
            await supabase.from('conversation_history').insert({
              collaborator_id: reqColl.id,
              direction: 'outbound',
              message_type: 'text',
              content: replyToReq,
            });
          } catch (err) {
            console.error('[Task] extension_decision notify-requester err:', err.message);
          }
        }
        console.log(`[Task] extension_decision ${shortId} ${approved ? 'APPROVED→' + a.new_due_date : 'DENIED'} by ${last4}`);
        okCount++;
      } else if (a.action === 'delegate') {
        // Role gate: only coordinator/director can delegate to others.
        if (collaborator.role !== 'coordinator' && collaborator.role !== 'director') {
          console.warn(`[Task] delegate REJECTED — role=${collaborator.role || 'collaborator'} cannot delegate to others`);
          failCount++;
          continue;
        }
        const t = await resolveTaskByShortId(collaborator.id, a.id);
        if (!t) {
          console.warn(`[Task] delegate REJECTED id=${a.id} (not owned by ${last4} or not found)`);
          failCount++;
          continue;
        }
        let recipient = null;
        if (a.to_phone) recipient = await findCollaboratorByPhone(a.to_phone);
        else if (a.to_name) recipient = await findCollaboratorByName(a.to_name);
        if (!recipient || !recipient.is_active) {
          console.warn(`[Task] delegate REJECTED — recipient not found: ${a.to_phone || a.to_name}`);
          failCount++;
          continue;
        }
        if (recipient.id === collaborator.id) {
          console.warn('[Task] delegate REJECTED — self-delegation');
          failCount++;
          continue;
        }
        const { error } = await supabase
          .from('tasks')
          .update({
            assigned_to: recipient.id,
            delegated_to: recipient.id,
            delegated_at: new Date().toISOString(),
            status: 'delegated',
          })
          .eq('id', t.id)
          .eq('assigned_to', collaborator.id);
        if (error) {
          console.error('[Task] delegate err:', error.message);
          failCount++;
          continue;
        }
        // Notify recipient via WhatsApp (best-effort — DB transition already committed).
        const delegatorName = nameForCollab(collaborator);
        const dueLabel = t.due_date ? ` (prazo ${formatBRDate(t.due_date)})` : '';
        const notifText = `📋 ${delegatorName} delegou pra você: *${t.title}*${dueLabel}. Prazo mantém?`;
        try {
          await whatsapp.sendMessage(recipient.phone, notifText);
          await supabase.from('conversation_history').insert({
            collaborator_id: recipient.id,
            direction: 'outbound',
            message_type: 'text',
            content: notifText,
          });
          await supabase.from('notifications').insert({
            collaborator_id: recipient.id,
            notification_type: 'delegation_notice',
            title: `Tarefa delegada por ${delegatorName}`,
            body: notifText,
            reference_type: 'task',
            reference_id: t.id,
            channel: 'whatsapp',
            status: 'sent',
            sent_at: new Date().toISOString(),
          });
          console.log(`[Task] delegate ${a.id} ${last4} → ${String(recipient.phone).slice(-4)} (${recipient.full_name})`);
          okCount++;
        } catch (err) {
          console.error('[Task] delegate notification err:', err.message);
          // task already updated in DB; still count ok so user sees confirmation
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

// ---------- HABIT marker + handler ----------

const VALID_HABIT_FREQUENCIES = new Set(['daily', 'weekdays', 'weekly', 'custom']);
const HABIT_TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// Parse <<HABIT_ACTION>>[...]<<END>> — array (ou objeto) de ações.
function parseHabitMarker(text) {
  if (!text) return null;
  const re = /<<HABIT_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed = null;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('HABIT_ACTION', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  const rawActions = Array.isArray(parsed) ? parsed : [parsed];
  const valid = [];
  const dropped = [];
  for (let i = 0; i < rawActions.length; i++) {
    const a = rawActions[i];
    const why = validateHabitAction(a);
    if (why) { dropped.push(`action[${i}]:${why}`); continue; }
    valid.push(a);
  }
  if (dropped.length) logSchemaErr('HABIT_ACTION', dropped, parsed);
  if (!valid.length) return { malformed: true, cleanText };
  return { actions: valid, cleanText, malformed: false };
}

function validateHabitAction(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 'not_object';
  if (a.action === 'create') {
    if (typeof a.name !== 'string' || !a.name.trim()) return 'name_missing';
    if (a.frequency !== undefined && !VALID_HABIT_FREQUENCIES.has(a.frequency)) return 'bad_frequency';
    if (a.reminder_time !== undefined && a.reminder_time !== null
        && (typeof a.reminder_time !== 'string' || !HABIT_TIME_RE.test(a.reminder_time))) return 'bad_reminder_time';
    if (a.custom_days !== undefined && !Array.isArray(a.custom_days)) return 'bad_custom_days';
  } else if (a.action === 'log') {
    if (typeof a.habit_id !== 'string' || !SHORT_ID_RE.test(a.habit_id)) return 'bad_habit_id';
    if (a.completed !== undefined && typeof a.completed !== 'boolean') return 'completed_not_bool';
  } else {
    return 'unknown_action';
  }
  return null;
}

// Resolve habit by 8-char prefix, restricted to collaborator (defense in depth).
async function resolveHabitByShortId(collaboratorId, shortId) {
  if (!shortId || !SHORT_ID_RE.test(String(shortId))) return null;
  const prefix = String(shortId).toLowerCase();
  const { data } = await supabase
    .from('habits').select('id, name, icon, current_streak, best_streak, is_active')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).limit(200);
  if (!data || !data.length) return null;
  const matches = data.filter(h => String(h.id).toLowerCase().startsWith(prefix));
  if (matches.length !== 1) return null;
  return matches[0];
}

// Compute current streak for a habit (consecutive days with is_completed=true,
// counted backwards from todayYmd in America/Sao_Paulo).
async function calcHabitStreak(habitId, todayYmd) {
  const since = todayOffsetSP(todayYmd, -370);
  const { data } = await supabase
    .from('habit_logs')
    .select('log_date, is_completed')
    .eq('habit_id', habitId)
    .gte('log_date', since)
    .lte('log_date', todayYmd)
    .order('log_date', { ascending: false });
  if (!data || !data.length) return 0;
  const done = new Set(data.filter(l => l.is_completed).map(l => l.log_date));
  let streak = 0;
  let cursor = todayYmd;
  while (done.has(cursor)) {
    streak++;
    cursor = todayOffsetSP(cursor, -1);
  }
  return streak;
}

function todayOffsetSP(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

async function applyHabitActions(collaborator, actions) {
  const today = todaySaoPaulo();
  let okCount = 0, failCount = 0;
  const last4 = String(collaborator.phone || '').slice(-4);
  // We collect created/logged habits so caller can append a friendly footer if needed.
  const created = [], logged = [];
  for (const a of actions) {
    try {
      if (a.action === 'create') {
        // Try to enrich from a matching template (icon/color) if name corresponds.
        let icon = a.icon;
        let color = a.color;
        let templateId = null;
        if (!icon || !color) {
          const { data: tmpl } = await supabase
            .from('habit_templates').select('id, icon, color')
            .ilike('name', a.name.trim()).limit(1);
          if (tmpl && tmpl.length) {
            templateId = tmpl[0].id;
            if (!icon) icon = tmpl[0].icon;
            if (!color) color = tmpl[0].color;
          }
        }
        const insertRow = {
          collaborator_id: collaborator.id,
          template_id: templateId,
          name: a.name.trim().slice(0, 200),
          icon: icon || '💪',
          color: color || '#3B82F6',
          frequency: VALID_HABIT_FREQUENCIES.has(a.frequency) ? a.frequency : 'daily',
          custom_days: Array.isArray(a.custom_days) ? a.custom_days : null,
          reminder_time: (a.reminder_time && HABIT_TIME_RE.test(a.reminder_time))
            ? (a.reminder_time.length === 5 ? a.reminder_time + ':00' : a.reminder_time)
            : null,
          notify_whatsapp: a.notify_whatsapp !== false,
          is_active: true,
          current_streak: 0,
          best_streak: 0,
        };
        const { data, error } = await supabase
          .from('habits').insert(insertRow).select('id, name, icon').single();
        if (error) {
          console.error('[Habit] create err:', error.message);
          failCount++;
          continue;
        }
        console.log(`[Habit] create "${insertRow.name}" freq=${insertRow.frequency} id=${String(data.id).slice(0,8)} by ${last4}`);
        created.push(data);
        okCount++;
      } else if (a.action === 'log') {
        const completed = a.completed !== false; // default true
        const h = await resolveHabitByShortId(collaborator.id, a.habit_id);
        if (!h) {
          console.warn(`[Habit] log REJECTED — habit ${a.habit_id} not owned by ${last4}`);
          failCount++;
          continue;
        }
        // Upsert habit_logs (habit_id, log_date) — manual SELECT/UPDATE/INSERT.
        const { data: existing } = await supabase
          .from('habit_logs').select('id')
          .eq('habit_id', h.id).eq('log_date', today).maybeSingle();
        if (existing) {
          await supabase.from('habit_logs').update({
            is_completed: completed,
            completed_at: completed ? new Date().toISOString() : null,
            notes: a.notes || null,
          }).eq('id', existing.id);
        } else {
          await supabase.from('habit_logs').insert({
            habit_id: h.id,
            collaborator_id: collaborator.id,
            log_date: today,
            is_completed: completed,
            completed_at: completed ? new Date().toISOString() : null,
            notes: a.notes || null,
          });
        }
        // Recompute streak.
        const newStreak = await calcHabitStreak(h.id, today);
        const newBest = Math.max(newStreak, h.best_streak || 0);
        await supabase.from('habits').update({
          current_streak: newStreak,
          best_streak: newBest,
        }).eq('id', h.id);
        console.log(`[Habit] log "${h.name}" completed=${completed} streak=${newStreak} (best=${newBest})`);
        logged.push({ habit: h, streak: newStreak, completed });
        okCount++;
      }
    } catch (err) {
      console.error('[Habit] exception:', err.message);
      failCount++;
    }
  }
  return { okCount, failCount, created, logged };
}

// Apply DND marker — persists do_not_disturb_until + reason on user_preferences.
// `parsed` shape: either { until, reason } (set) or { clear: true } (clear).
async function applyDnd(collaborator, parsed) {
  const update = parsed.clear
    ? { do_not_disturb_until: null, do_not_disturb_reason: null }
    : { do_not_disturb_until: parsed.until, do_not_disturb_reason: parsed.reason };
  const { error } = await supabase
    .from('user_preferences')
    .update(update)
    .eq('collaborator_id', collaborator.id);
  if (error) {
    console.error('[DND] persist err:', error.message);
    return false;
  }
  if (parsed.clear) console.log(`[DND] cleared for ${String(collaborator.phone).slice(-4)}`);
  else console.log(`[DND] set ${parsed.until} for ${String(collaborator.phone).slice(-4)}${parsed.reason ? ' (' + parsed.reason + ')' : ''}`);
  return true;
}

// Returns { active, until, reason } — used by dispatcher to gate outbound.
async function getDndState(collaboratorId) {
  const { data } = await supabase
    .from('user_preferences')
    .select('do_not_disturb_until, do_not_disturb_reason')
    .eq('collaborator_id', collaboratorId)
    .maybeSingle();
  if (!data || !data.do_not_disturb_until) return { active: false };
  const untilMs = Date.parse(data.do_not_disturb_until);
  if (Number.isNaN(untilMs) || untilMs <= Date.now()) return { active: false };
  return { active: true, until: data.do_not_disturb_until, reason: data.do_not_disturb_reason };
}

// Persist a weekly plan: weekly_plans + daily_plans + daily_plan_items + tasks.
// Idempotent on (collaborator_id, week_start) — re-running for the same week
// updates the row. daily_plans uses (collaborator_id, plan_date) as upsert key.
async function applyWeeklyPlan(collaborator, plan) {
  const collId = collaborator.id;
  // Upsert weekly_plans by manual SELECT/UPDATE/INSERT (no unique constraint guarantee).
  const { data: existingWp } = await supabase
    .from('weekly_plans')
    .select('id')
    .eq('collaborator_id', collId).eq('week_start', plan.week_start)
    .maybeSingle();
  let weeklyPlanId;
  if (existingWp) {
    weeklyPlanId = existingWp.id;
    await supabase.from('weekly_plans').update({
      goals: plan.goals,
      tasks_planned: plan.distribution.reduce((a, d) => a + (d.items?.length || 0), 0),
      status: 'active',
    }).eq('id', weeklyPlanId);
  } else {
    const { data: newWp, error } = await supabase
      .from('weekly_plans')
      .insert({
        collaborator_id: collId,
        week_start: plan.week_start,
        goals: plan.goals,
        status: 'active',
        tasks_planned: plan.distribution.reduce((a, d) => a + (d.items?.length || 0), 0),
      })
      .select('id').single();
    if (error) throw error;
    weeklyPlanId = newWp.id;
  }

  let createdItems = 0, createdTasks = 0;
  for (const d of plan.distribution) {
    // daily_plan upsert
    const { data: existingDp } = await supabase
      .from('daily_plans')
      .select('id').eq('collaborator_id', collId).eq('plan_date', d.day).maybeSingle();
    let dailyPlanId;
    if (existingDp) {
      dailyPlanId = existingDp.id;
      await supabase.from('daily_plans').update({
        weekly_plan_id: weeklyPlanId,
        items_planned: d.items.length,
      }).eq('id', dailyPlanId);
    } else {
      const { data: newDp, error: dpErr } = await supabase
        .from('daily_plans').insert({
          collaborator_id: collId,
          plan_date: d.day,
          weekly_plan_id: weeklyPlanId,
          status: 'active',
          items_planned: d.items.length,
        }).select('id').single();
      if (dpErr) {
        console.error('[WeeklyPlan] daily_plan err:', dpErr.message);
        continue;
      }
      dailyPlanId = newDp.id;
    }

    // For each item: create a task + a daily_plan_item linked to it.
    for (let i = 0; i < d.items.length; i++) {
      const title = d.items[i].slice(0, 200);
      const { data: newTask, error: taskErr } = await supabase
        .from('tasks').insert({
          title,
          assigned_to: collId,
          created_by: collId,
          status: 'pending',
          due_date: d.day,
          scheduled_date: d.day,
          context: 'work',
          priority: 'medium',
          source: 'manual',
        }).select('id').single();
      if (taskErr) {
        console.error('[WeeklyPlan] task err:', taskErr.message);
        continue;
      }
      createdTasks++;
      const { error: itemErr } = await supabase.from('daily_plan_items').insert({
        daily_plan_id: dailyPlanId,
        task_id: newTask.id,
        description: title,
        sort_order: i,
        is_completed: false,
      });
      if (itemErr) {
        console.error('[WeeklyPlan] item err:', itemErr.message);
        continue;
      }
      createdItems++;
    }
  }
  console.log(`[WeeklyPlan] saved week=${plan.week_start} for ${String(collaborator.phone).slice(-4)} — goals=${plan.goals.length} items=${createdItems} tasks=${createdTasks}`);
  return { weeklyPlanId, createdItems, createdTasks };
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
  const _t0 = Date.now();
  const _phoneTail = String(phone).slice(-4);
  console.log(`[Engine] processMessage START phone=${_phoneTail} text="${String(text).slice(0, 60).replace(/\n/g, ' ')}"`);
  // Sprint 10: telemetria operacional. Acumulada durante o pipeline e gravada
  // em tom_metrics no fim. Falha silenciosa via metricsService.
  const _metrics = {
    message_kind: /^\[áudio transcrito\]/i.test(String(text || '')) ? 'audio' : 'text',
  };
  const collab = await collaboratorService.findByPhone(phone);
  if (!collab) {
    await whatsapp.sendMessage(phone, 'Nao te encontrei no sistema. Fala com seu coordenador pra te cadastrar.');
    console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (unknown_collab)`);
    return;
  }
  _metrics.collaborator_id = collab.id;
  console.log('[Engine] Mensagem de', collab.full_name);
  await logConversation(collab.id, 'inbound', text);

  // Constrói o system prompt 4-block (regras → identidade → contexto → skill ativa).
  let { systemPrompt, ctx } = await buildSystemPrompt(collab, { lastUserMessage: text });
  const _tt = ctx.todayTasks || {};
  const _tCount = (_tt.personal?.length || 0) + (_tt.work?.length || 0);
  console.log(`[Engine] system prompt size: ${systemPrompt.length} chars (memories=${ctx.memories.length}, tasks=${_tCount}, notifs=${ctx.notifications.length})`);

  const onboardingActive = collab.onboarding_completed === false;
  // Onboarding skill is now loaded conditionally inside buildSystemPrompt via pickSkill.

  const msgs = formatMessages(ctx.recentMessages, text);
  let response;
  try {
    response = await ai.chat(systemPrompt, msgs);
  } catch (err) {
    const kind = err.kind || 'unknown';
    const errs = err.errors ? JSON.stringify(err.errors).slice(0, 280) : err.message?.slice(0, 280);
    console.error(`[AI] FATAL all-providers-failed for ${_phoneTail}: ${errs}`);
    await logMarker(collab.id, 'PROVIDER', 'rejected', `all_failed: ${errs}`, null);
    _metrics.error_kind = `all_providers_failed:${kind}`;
    _metrics.latency_ms = Date.now() - _t0;
    metricsService.recordMessage(_metrics).catch(() => {});
    console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (provider_failed)`);
    throw err;
  }
  // Sprint 10: capturar métricas do provider call.
  _metrics.provider_used = response.provider || null;
  _metrics.fallback_from = response.fallbackFrom || null;
  _metrics.input_tokens = response.meta?.input_tokens ?? null;
  _metrics.output_tokens = response.meta?.output_tokens ?? null;
  _metrics.sanitized_chars = response.meta?.sanitized_chars || 0;
  if (response.fallbackFrom) {
    const reason = `fallback_from=${response.fallbackFrom} kind=${response.primaryError?.kind || 'unknown'}`;
    await logMarker(collab.id, 'PROVIDER', 'fallback', reason, null);
  }
  let reply = response.text;

  // Ordem de strip: ONBOARDING → PROJECT → MEMORY (memória por último — não deve aparecer pro user em hipótese alguma).

  // 1) Onboarding (apenas quando ativo)
  if (onboardingActive) {
    const parsed = parseOnboardingMarker(reply);
    if (parsed && parsed.malformed) {
      console.warn('[Onboarding] WARN: malformed marker, asking again');
      await logMarker(collab.id, 'ONBOARDING_DONE', 'rejected', 'schema_invalid', reply);
      reply = parsed.cleanText || reply;
    } else if (parsed) {
      try {
        await persistOnboarding(collab.id, parsed.prefs);
        await logMarker(collab.id, 'ONBOARDING_DONE', 'executed', null, null);
        reply = parsed.cleanText || '👽 Fechou! Bora trabalhar.';
      } catch (err) {
        console.error('[Onboarding] Falha ao persistir:', err.message);
        await logMarker(collab.id, 'ONBOARDING_DONE', 'rejected', `persist_error:${err.message}`, null);
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
      await logMarker(collab.id, 'PROJECT_CREATE', 'rejected', 'schema_invalid', reply);
      reply = parsedProj.cleanText || reply;
    } else if (parsedProj) {
      try {
        const created = await persistProject(collab, parsedProj.project);
        if (created && created.error) {
          await logMarker(collab.id, 'PROJECT_CREATE', 'rejected', `persist_error:${created.error}`, parsedProj.project);
          reply = created.userFacingReply;
        } else {
          console.log(`[Project] criado por ${String(collab.phone).slice(-4)}: ${created.name} (id=${created.id})`);
          await logMarker(collab.id, 'PROJECT_CREATE', 'executed', `name:${created.name}`, null);
          const base = parsedProj.cleanText || '';
          // Sem ID, sem UUID — Claude já confirmou em texto natural antes do marcador.
          // Se Claude não emitiu confirmação, usa fallback semântico padrão (✅ + nome).
          reply = base ? base : `✅ ${created.name} criado! Bora distribuir tarefas?`;
        }
      } catch (err) {
        console.error('[Project] Falha ao criar:', err.message);
        await logMarker(collab.id, 'PROJECT_CREATE', 'rejected', `persist_error:${err.message}`, null);
        const base = parsedProj.cleanText || '';
        reply = (base ? base + '\n\n' : '') + `⚠️ Não rolou criar agora. Tenta de novo daqui a pouco?`;
      }
    }
  }

  // 2.1) Project approve (Sprint 8). Skill aprovar-projeto emite token literal.
  {
    const parsedAp = parseProjectApproveMarker(reply);
    if (parsedAp && parsedAp.malformed) {
      console.warn('[Project] WARN: malformed PROJECT_APPROVE marker');
      await logMarker(collab.id, 'PROJECT_APPROVE', 'rejected', 'schema_invalid', reply);
      reply = parsedAp.cleanText || reply;
    } else if (parsedAp) {
      const r = await applyProjectApprove(collab, parsedAp);
      if (!r.ok) {
        await logMarker(collab.id, 'PROJECT_APPROVE', 'rejected', r.reason, null);
        const base = parsedAp.cleanText || '';
        reply = (base ? base + '\n\n' : '') + (r.userMsg || '_não consegui aprovar agora_');
      } else {
        await logMarker(collab.id, 'PROJECT_APPROVE', 'executed', `name:${r.project.name}`, null);
        const base = parsedAp.cleanText || '';
        reply = base || `✅ *${r.project.name}* aprovado. Avisei quem criou.`;
      }
    }
  }

  // 2.2) Project reject (Sprint 8).
  {
    const parsedRj = parseProjectRejectMarker(reply);
    if (parsedRj && parsedRj.malformed) {
      console.warn('[Project] WARN: malformed PROJECT_REJECT marker');
      await logMarker(collab.id, 'PROJECT_REJECT', 'rejected', 'schema_invalid', reply);
      reply = parsedRj.cleanText || reply;
    } else if (parsedRj) {
      const r = await applyProjectReject(collab, parsedRj);
      if (!r.ok) {
        await logMarker(collab.id, 'PROJECT_REJECT', 'rejected', r.reason, null);
        const base = parsedRj.cleanText || '';
        reply = (base ? base + '\n\n' : '') + (r.userMsg || '_não consegui rejeitar agora_');
      } else {
        await logMarker(collab.id, 'PROJECT_REJECT', 'executed', `name:${r.project.name}`, null);
        const base = parsedRj.cleanText || '';
        reply = base || `❌ *${r.project.name}* rejeitado. Avisei quem criou.`;
      }
    }
  }

  // 2.5) Task update (complete / reschedule / create) — defense-in-depth na resolução de IDs.
  {
    const parsedTask = parseTaskUpdateMarker(reply);
    if (parsedTask && parsedTask.malformed) {
      console.warn('[Task] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'TASK_UPDATE', 'rejected', 'schema_invalid', reply);
      reply = parsedTask.cleanText || reply;
    } else if (parsedTask) {
      const { okCount, failCount } = await applyTaskActions(collab, parsedTask.actions);
      console.log(`[Task] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      const result = okCount > 0 ? 'executed' : 'rejected';
      const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
      await logMarker(collab.id, 'TASK_UPDATE', result, reason, null);
      let base = parsedTask.cleanText || '';
      if (failCount > 0) {
        base = (base ? base + '\n\n' : '') + '_não consegui atualizar uma das tarefas, te aviso depois_';
      }
      reply = base || reply;
    }
  }

  // 2.6) Habit action (create / log)
  {
    const parsedHab = parseHabitMarker(reply);
    if (parsedHab && parsedHab.malformed) {
      console.warn('[Habit] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'HABIT_ACTION', 'rejected', 'schema_invalid', reply);
      reply = parsedHab.cleanText || reply;
    } else if (parsedHab) {
      const { okCount, failCount } = await applyHabitActions(collab, parsedHab.actions);
      console.log(`[Habit] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      const result = okCount > 0 ? 'executed' : 'rejected';
      const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
      await logMarker(collab.id, 'HABIT_ACTION', result, reason, null);
      let base = parsedHab.cleanText || '';
      if (failCount > 0 && okCount === 0) {
        base = (base ? base + '\n\n' : '') + '_não consegui registrar agora, te aviso depois_';
      }
      reply = base || reply;
    }
  }

  // 2.65) Event create — compromissos com horário (Sprint 4+).
  {
    const parsedEv = parseEventCreateMarker(reply);
    if (parsedEv && parsedEv.malformed) {
      console.warn('[Event] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'EVENT_CREATE', 'rejected', 'schema_invalid', reply);
      reply = parsedEv.cleanText || reply;
    } else if (parsedEv) {
      const { okCount, failCount } = await applyEventActions(collab, parsedEv.events);
      console.log(`[Event] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      const result = okCount > 0 ? 'executed' : 'rejected';
      const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
      await logMarker(collab.id, 'EVENT_CREATE', result, reason, null);
      let base = parsedEv.cleanText || '';
      if (failCount > 0 && okCount === 0) {
        base = (base ? base + '\n\n' : '') + '_não consegui salvar o compromisso, te aviso depois_';
      }
      reply = base || reply;
    }
  }

  // 2.66) Event update (Sprint 5) — reschedule / cancel / complete.
  {
    const parsedEU = parseEventUpdateMarker(reply);
    if (parsedEU && parsedEU.malformed) {
      console.warn('[Event] WARN: malformed EVENT_UPDATE marker, dropping block');
      await logMarker(collab.id, 'EVENT_UPDATE', 'rejected', 'schema_invalid', reply);
      reply = parsedEU.cleanText || reply;
    } else if (parsedEU) {
      const { okCount, failCount } = await applyEventUpdates(collab, parsedEU.actions);
      console.log(`[Event] update batch: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      const result = okCount > 0 ? 'executed' : 'rejected';
      const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
      await logMarker(collab.id, 'EVENT_UPDATE', result, reason, null);
      let base = parsedEU.cleanText || '';
      if (failCount > 0 && okCount === 0) {
        base = (base ? base + '\n\n' : '') + '_não consegui atualizar o compromisso, te aviso depois_';
      }
      reply = base || reply;
    }
  }

  // 2.7) Weekly plan
  {
    const parsedPlan = parseWeeklyPlanMarker(reply);
    if (parsedPlan && parsedPlan.malformed) {
      console.warn('[WeeklyPlan] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'WEEKLY_PLAN', 'rejected', 'schema_invalid', reply);
      reply = parsedPlan.cleanText || reply;
    } else if (parsedPlan) {
      try {
        await applyWeeklyPlan(collab, parsedPlan.plan);
        await logMarker(collab.id, 'WEEKLY_PLAN', 'executed', `week_start:${parsedPlan.plan?.week_start || ''}`, null);
        reply = parsedPlan.cleanText || reply;
      } catch (err) {
        console.error('[WeeklyPlan] persist err:', err.message);
        await logMarker(collab.id, 'WEEKLY_PLAN', 'rejected', `persist_error:${err.message}`, null);
        const base = parsedPlan.cleanText || '';
        reply = (base ? base + '\n\n' : '') + '_não rolou salvar agora, mas seu plano tá registrado em conversa. Tenta de novo daqui a pouco?_';
      }
    }

    // 2.8) DND set/clear (do_not_disturb)
    const parsedDnd = parseDndMarker(reply);
    if (parsedDnd && parsedDnd.malformed) {
      console.warn('[DND] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'DND_SET', 'rejected', 'schema_invalid', reply);
      reply = parsedDnd.cleanText || reply;
    } else if (parsedDnd) {
      const ok = await applyDnd(collab, parsedDnd);
      const detail = parsedDnd.clear ? 'clear' : `until=${parsedDnd.until}${parsedDnd.reason ? ' reason=' + parsedDnd.reason : ''}`;
      await logMarker(collab.id, 'DND_SET', ok ? 'executed' : 'rejected', ok ? detail : 'persist_error', null);
      reply = parsedDnd.cleanText || reply;
    }
  }

  // 3) Memory save (sempre por último — o conteúdo do bloco NUNCA deve vazar)
  {
    const parsedMem = parseMemoryMarker(reply);
    if (parsedMem && parsedMem.malformed) {
      console.warn('[Memory] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'MEMORY_SAVE', 'rejected', 'schema_invalid', reply);
      reply = parsedMem.cleanText || reply;
    } else if (parsedMem) {
      const saved = await persistMemoryRows(collab.id, parsedMem.rows);
      console.log(`[Memory] saved ${saved} facts for ${String(collab.phone).slice(-4)}`);
      await logMarker(collab.id, 'MEMORY_SAVE', 'executed', `saved=${saved}`, null);
      reply = parsedMem.cleanText || reply;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SPRINT 10 HOTFIX-CRÍTICO (29/04/2026): catch-all marker strip.
  // ════════════════════════════════════════════════════════════════════════
  // Caso real capturado: TOM disse "Boa, Alf!" e mais texto humano OK, mas
  // emitiu <<TASK_CREATE>>...<<END>> dentro da resposta. <<TASK_CREATE>> NÃO
  // é um marker válido (real é <<TASK_UPDATE>> com action="create"). Como
  // os parsers (parseTaskUpdateMarker, parseEventCreateMarker, etc) só
  // reconhecem nomes específicos, o marker hallucinated sobrou no reply e
  // foi enviado cru pro usuário.
  //
  // Estratégia: depois de TODOS os parsers conhecidos rodarem (cada um
  // extraiu seu marker legítimo via cleanText), qualquer <<UPPER>>...<<END>>
  // sobrando É leak por definição. Stripa + loga UNKNOWN_MARKER_STRIPPED.
  // Não envia ao usuário. Sinal explícito de regressão pra investigar:
  //   - skill com nome de marker errado
  //   - parser não plumbed
  //   - modelo inventando marker que não existe
  try {
    if (typeof reply === 'string') {
      const ALL_MARKER_RE = /<<[A-Z_][A-Z0-9_]*>>[\s\S]*?<<END>>/g;
      const STANDALONE_MARKER_RE = /<<[A-Z_][A-Z0-9_]{2,}>>|<<END>>/g;
      const fullMatches = reply.match(ALL_MARKER_RE) || [];
      const standaloneMatches = reply.match(STANDALONE_MARKER_RE) || [];
      if (fullMatches.length > 0 || standaloneMatches.length > 0) {
        const before = reply;
        reply = reply
          .replace(ALL_MARKER_RE, '')
          .replace(STANDALONE_MARKER_RE, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        const sample = (fullMatches[0] || standaloneMatches[0] || '').slice(0, 120);
        const matchNames = [...fullMatches, ...standaloneMatches]
          .map(m => (m.match(/^<<([A-Z_][A-Z0-9_]*)>>/) || [])[1])
          .filter(Boolean);
        console.warn(`[Engine] UNKNOWN_MARKER_STRIPPED — names=[${matchNames.join(',')}] sample="${sample}"`);
        await logMarker(collab.id, 'UNKNOWN_MARKER_STRIPPED', 'rejected',
          `names:${matchNames.slice(0, 5).join(',')} delta:${before.length - reply.length}`, before);
        // Se reply ficou vazio, fallback genérico (modelo só emitiu marker errado).
        if (!reply) reply = '_recebi sua mensagem mas tive um problema pra responder. Tenta de novo?_';
      }
    }
  } catch (e) {
    // ignore — guard nunca pode quebrar fluxo principal
  }

  // Safety nets: detect leaks before sending.
  //
  // Sprint 7 anti-leak guard (1.3): se o reply mencionar stack interno
  // (supabase, postgres, banco de dados, mcp, "permissão pra acessar X",
  // "tabela <nome>", sql), substitui por mensagem genérica e loga em
  // marker_logs como LEAK_BLOCKED. Defesa em profundidade — mesmo com
  // MCP desabilitado (1.4), o modelo ainda pode improvisar texto que
  // viola o contrato ZERO leaks do system prompt.
  //
  // Os warnings de marker fragment / UUID leak continuam não bloqueantes
  // (são guardrails históricos para detectar marker mal-fechado e raros).
  // ⚠️ SEGUNDA LINHA DE DEFESA (Sprint 10).
  // A primeira linha agora é o sanitizer no provider (src/ai/claude.js):
  // HOME isolado + --output-format json + strip de tags XML + strip de
  // narração inglesa + diretiva "no tools" no system prompt.
  // Após Sprint 10, o sanitizer no provider deveria capturar 100% dos casos
  // documentados em smoke (10/10 limpo). Esta regex permanece como
  // CONTENÇÃO DE REGRESSÃO — se um leak passar daqui, é sinal de regressão
  // arquitetural na primeira linha, não desculpa pra estender esta regex.
  //
  // Histórico do guard (mantido pra documentação):
  //   1. Strip de blocos <tool_call> e narração ANTES da regex.
  //   2. Regex pega tool_call avulso + paths internos + memória + diretórios.
  //   3. Se casar, substitui por mensagem genérica + log LEAK_BLOCKED.
  // NÃO crescer esta regex. Leak novo = investigar primeira linha.
  const STACK_LEAK_RE = new RegExp(
    [
      String.raw`\b(supabase|postgres|banco\s+de\s+dados|mcp|sql)\b`,
      String.raw`\bpermiss[ãa]o.+(acess|aprovar|liberar)`,
      String.raw`\btabela\s+[a-z_]`,
      String.raw`<\/?tool_call`,                  // <tool_call>, </tool_call>
      String.raw`\/root\/\.claude`,               // /root/.claude paths
      String.raw`\.claude\/projects`,             // .claude/projects/...
      String.raw`memory\/[\w-]+\.md`,             // memory/<file>.md
      String.raw`MEMORY\.md`,                     // MEMORY.md index
      String.raw`-opt-LA-Organizer`,              // claude project dir
    ].join('|'),
    'i',
  );
  const GENERIC_LEAK_REPLY = '_tive um problema interno aqui, tenta de novo daqui a pouco_';
  try {
    if (typeof reply === 'string') {
      // 1) Strip de blocos tool_call + narração de fluxo (camada 1).
      const before = reply;
      reply = reply
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
        .replace(/^(Now let me .*|Let me (?:update|read|write|check) .*|I'll .*|I need to .*)$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (before !== reply) {
        console.warn(`[Engine] tool_call/narration stripped (${before.length}→${reply.length} chars)`);
        await logMarker(collab.id, 'TOOL_CALL_STRIPPED', 'cleaned', `delta:${before.length - reply.length}`, before.slice(0, 500));
      }

      if (reply.includes('<<') || reply.includes('>>')) {
        console.warn('[Engine] WARN: marker fragment leaked into reply');
      }
      if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}/i.test(reply)) {
        console.warn('[Engine] WARN: possible UUID leak in reply');
      }
      // 2) Regex check (camada 2).
      const leakMatch = reply.match(STACK_LEAK_RE);
      if (leakMatch) {
        console.warn(`[Engine] LEAK_BLOCKED — match="${leakMatch[0]}" reply="${reply.slice(0, 200)}"`);
        await logMarker(collab.id, 'LEAK_BLOCKED', 'rejected', `match:${leakMatch[0]}`, reply);
        reply = GENERIC_LEAK_REPLY;
        _metrics.leak_blocked = true;
        _metrics.leak_match = String(leakMatch[0]).slice(0, 100);
      }
      // 3) Se reply ficou vazio depois da limpeza, fallback genérico.
      if (!reply.trim()) {
        console.warn('[Engine] reply ficou vazio após strip — usando fallback');
        reply = '_recebi sua mensagem, mas tive um problema pra responder. Tenta de novo?_';
      }
    }
  } catch (e) {
    // ignore guard errors — never crash pipeline on a guard
  }

  await whatsapp.sendMessage(phone, reply);
  await logConversation(collab.id, 'outbound', reply);
  // Sprint 10: grava telemetria. Fire-and-forget — falha de metric não quebra fluxo.
  _metrics.latency_ms = Date.now() - _t0;
  metricsService.recordMessage(_metrics).catch(() => {});
  console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${_metrics.latency_ms}ms`);
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
  // Insert (was upsert) — idempotency enforced at dispatcher.alreadySent(); UNIQUE
  // constraint dropped to allow per-event observability rows (alerts, reminders).
  await supabase.from('ritual_logs').insert({
    collaborator_id: collaboratorId,
    ritual_type: ritualType,
    reference_date: today,
    status: 'sent',
    sent_at: new Date().toISOString(),
  });
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

// ==================== WEEKLY MEMORY CONSOLIDATION ====================
// Sunday 22h: read last 7 days of inbound history for each active collaborator,
// extract durable facts/decisions/preferences/lessons/contexts via Claude,
// dedupe against existing memories, insert. Also decays expired memories.

const MEM_VALID_TYPES = ['fact', 'decision', 'lesson', 'preference', 'context'];

// Simple word-set overlap dedupe. Returns true if `a` looks like `b`.
function looksLikeMemory(a, b, threshold = 0.6) {
  const norm = s => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(w => w.length >= 4);
  const wa = new Set(norm(a));
  const wb = new Set(norm(b));
  if (!wa.size || !wb.size) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union > 0 && inter / union >= threshold;
}

async function _consolidateExtract(collab, historyText, existingTexts) {
  const sysPrompt = `Você é um extrator de memória durável.
Receberá o histórico inbound dos últimos 7 dias de um colaborador no WhatsApp + lista de memórias já salvas.
Sua tarefa: identificar até 5 NOVOS itens dignos de memória futura (que ainda NÃO estão na lista existente).

Tipos válidos (use exatamente um): fact | decision | lesson | preference | context
- fact: dado concreto duradouro (mora em X, toca instrumento Y)
- decision: decisão consciente (vai pausar projeto Z até agosto)
- lesson: padrão aprendido (evitar reunião sexta após 17h)
- preference: gosto/forma de trabalhar (prefere reuniões curtas)
- context: situação temporária (filha nasceu em mar/2026 — sempre defina decay_at)

Importance: critical | high | normal | low

Saída OBRIGATÓRIA: array JSON puro, sem texto antes/depois. Vazio se nada digno:
[
  {"memory_type":"fact","content":"...","importance":"normal"},
  {"memory_type":"context","content":"...","importance":"normal","decay_at":"2026-08-01"}
]

REGRAS:
- 1 memória boa > 4 banais. Se nada novo, retorne [].
- Conteúdo: 1 frase curta, terceira pessoa, neutra
- NÃO duplique algo que já está nas memórias existentes
- NÃO salve fofoca/julgamento de terceiros
- NÃO salve estado momentâneo (cansaço de hoje) — só padrão
- decay_at obrigatório se memory_type='context'`;

  const userPrompt = `Memórias existentes (NÃO duplicar):
${(existingTexts || []).map(t => '- ' + t).join('\n') || '(nenhuma)'}

Histórico dos últimos 7 dias (inbound):
${historyText}

Extraia até 5 itens novos. Apenas JSON.`;

  const r = await ai.chat(sysPrompt, [{ role: 'user', content: userPrompt }]);
  const raw = String(r.text || '').trim();
  // Be lenient: strip any leading/trailing prose around the JSON array.
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) {
    console.warn(`[MemConsolidate] no JSON array in extractor output for ${collab.full_name}`);
    return [];
  }
  let parsed;
  try { parsed = JSON.parse(m[0]); }
  catch (err) {
    console.warn(`[MemConsolidate] JSON parse err for ${collab.full_name}:`, err.message);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(x => x && typeof x === 'object' && typeof x.content === 'string' && x.content.trim())
    .filter(x => MEM_VALID_TYPES.includes(x.memory_type))
    .map(x => ({
      memory_type: x.memory_type,
      content: x.content.trim().slice(0, 600),
      importance: ['critical', 'high', 'normal', 'low'].includes(x.importance) ? x.importance : 'normal',
      decay_at: typeof x.decay_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x.decay_at) ? x.decay_at : null,
    }))
    .slice(0, 5);
}

async function consolidateMemoryFor(collab) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: msgs } = await supabase
    .from('conversation_history')
    .select('content, created_at')
    .eq('collaborator_id', collab.id)
    .eq('direction', 'inbound')
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: true })
    .limit(200);
  const historyText = (msgs || [])
    .map(m => String(m.content || '').slice(0, 500))
    .join('\n')
    .slice(0, 12000);
  if (historyText.length < 50) {
    return { collab: collab.full_name, saved: 0, skipped: 'too_thin' };
  }

  const { data: existing } = await supabase
    .from('collaborator_memory')
    .select('content')
    .eq('collaborator_id', collab.id)
    .eq('is_active', true)
    .limit(100);
  const existingTexts = (existing || []).map(e => e.content);

  let candidates;
  try {
    candidates = await _consolidateExtract(collab, historyText, existingTexts);
  } catch (err) {
    console.error(`[MemConsolidate] extract err for ${collab.full_name}:`, err.message);
    return { collab: collab.full_name, saved: 0, skipped: 'extract_error', error: err.message };
  }

  let saved = 0, dedup = 0;
  for (const c of candidates) {
    const dup = existingTexts.some(t => looksLikeMemory(c.content, t));
    if (dup) { dedup++; continue; }
    const { error } = await supabase.from('collaborator_memory').insert({
      collaborator_id: collab.id,
      memory_type: c.memory_type,
      content: c.content,
      importance: c.importance,
      decay_at: c.decay_at,
      source: 'observation', // weekly consolidation = observação periódica
      is_active: true,
    });
    if (error) console.error('[MemConsolidate] insert err:', error.message);
    else { saved++; existingTexts.push(c.content); /* prevent intra-batch dup */ }
  }
  console.log(`[MemConsolidate] ${collab.full_name}: candidates=${candidates.length} saved=${saved} dedup=${dedup}`);
  return { collab: collab.full_name, candidates: candidates.length, saved, dedup };
}

// Decays expired memories: is_active flips to false. Returns count.
async function decayExpiredMemories() {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('collaborator_memory')
    .update({ is_active: false })
    .lt('decay_at', nowIso)
    .eq('is_active', true)
    .select('id');
  if (error) {
    console.error('[MemDecay] err:', error.message);
    return 0;
  }
  const n = (data || []).length;
  if (n) console.log(`[MemDecay] ${n} memory rows decayed`);
  return n;
}

// ==================== COORDINATOR REPORTS ====================
// Deterministic, template-based summaries that DO NOT call the AI provider.
// Privacy contract: only WORK-context data is queried. Habits, personal tasks,
// collaborator_memory, and conversation_history.content are NEVER read here.

const COORDINATOR_ROLES = ['coordinator', 'director'];

function ymdAddDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function brShort(ymd) {
  if (!ymd) return '';
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : ymd;
}
function dowShort(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12)); // noon UTC ≈ same day in BR
  return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][dt.getUTCDay()];
}
function firstName(full) { return String(full || '').split(' ')[0]; }

// Build the team summary text for the END OF DAY (~19:30, Mon-Fri).
// Returns string. Never throws — on partial data, sections gracefully omit.
async function buildTeamSummary(coord, ymdToday) {
  const dayBR = brShort(ymdToday);
  const dow = dowShort(ymdToday);

  // 1) Active team (excluding the coordinator viewing it).
  const { data: team } = await supabase
    .from('collaborators')
    .select('id, full_name, role')
    .eq('is_active', true)
    .eq('onboarding_completed', true);
  const peers = (team || []).filter(c => c.id !== coord.id);

  // 2) Daily briefing response status (presence of any inbound message
  //    AFTER briefing.sent_at counts as "responded").
  const { data: briefings } = await supabase
    .from('ritual_logs')
    .select('collaborator_id, sent_at')
    .eq('reference_date', ymdToday)
    .eq('ritual_type', 'daily_briefing')
    .eq('status', 'sent');
  const responded = [];
  const noResponse = [];
  for (const c of peers) {
    const b = (briefings || []).find(x => x.collaborator_id === c.id);
    if (!b) continue; // briefing not sent → don't classify
    const { count } = await supabase
      .from('conversation_history')
      .select('id', { head: true, count: 'exact' })
      .eq('collaborator_id', c.id)
      .eq('direction', 'inbound')
      .gte('created_at', b.sent_at);
    if ((count || 0) > 0) responded.push(c); else noResponse.push(c);
  }

  // 3) Work tasks today (PRIVACY: context='work' only).
  const todayStart = ymdToday + 'T00:00:00-03:00';
  const todayEnd = ymdToday + 'T23:59:59-03:00';
  const { count: completedCount } = await supabase
    .from('tasks').select('id', { head: true, count: 'exact' })
    .eq('context', 'work').eq('status', 'done')
    .gte('completed_at', todayStart).lte('completed_at', todayEnd);
  const { count: dueTodayCount } = await supabase
    .from('tasks').select('id', { head: true, count: 'exact' })
    .eq('context', 'work').eq('due_date', ymdToday);
  const { count: pendingTodayCount } = await supabase
    .from('tasks').select('id', { head: true, count: 'exact' })
    .eq('context', 'work').eq('due_date', ymdToday)
    .in('status', ['pending', 'in_progress']);
  const { data: overdue } = await supabase
    .from('tasks').select('id, title, due_date, assigned_to')
    .eq('context', 'work').lt('due_date', ymdToday)
    .not('status', 'in', '(done,cancelled)').limit(50);

  // Aggregate overdue by assignee (top 3) — names from team list.
  const overdueByPerson = new Map();
  for (const t of (overdue || [])) {
    const c = peers.find(p => p.id === t.assigned_to);
    if (!c) continue;
    overdueByPerson.set(c.full_name, (overdueByPerson.get(c.full_name) || 0) + 1);
  }
  const overdueSummary = [...overdueByPerson.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, n]) => `${firstName(name)}:${n}`).join(', ');

  // ----- Build text -----
  const lines = [`🧭 *Resumo do time* — ${dayBR} (${dow})`];

  if (responded.length || noResponse.length) {
    lines.push('');
    if (responded.length) lines.push(`✅ Respondeu briefing: ${responded.map(c => firstName(c.full_name)).join(', ')}`);
    if (noResponse.length) lines.push(`🤐 Sem resposta: ${noResponse.map(c => firstName(c.full_name)).join(', ')}`);
  }

  lines.push('');
  lines.push('📋 *Tarefas (work)*');
  lines.push(`• Concluídas hoje: ${completedCount || 0}${dueTodayCount ? ` de ${dueTodayCount} pra hoje` : ''}`);
  if (pendingTodayCount) lines.push(`• Pendentes pra hoje: ${pendingTodayCount}`);
  if ((overdue || []).length) {
    lines.push(`• Atrasadas: ${overdue.length}${overdueSummary ? ` (${overdueSummary})` : ''}`);
  }

  // Atenção (only when there's signal).
  const atencao = [];
  if (peers.length && noResponse.length >= Math.ceil(peers.length / 2)) {
    atencao.push(`Mais da metade do time sem responder hoje`);
  }
  if ((overdue || []).length >= 5) atencao.push(`${overdue.length} tarefas atrasadas no time`);
  if (atencao.length) {
    lines.push('');
    lines.push('⚠️ *Atenção*');
    for (const a of atencao) lines.push(`• ${a}`);
  }

  return lines.join('\n');
}

// Build the weekly retrospective text. ymdEnd = Sunday (or any reference).
async function buildWeeklyRetrospective(coord, ymdEnd) {
  const ymdStart = ymdAddDays(ymdEnd, -6);
  const tsStart = ymdStart + 'T00:00:00-03:00';
  const tsEnd = ymdEnd + 'T23:59:59-03:00';

  const { data: team } = await supabase
    .from('collaborators').select('id, full_name, role')
    .eq('is_active', true).eq('onboarding_completed', true);
  const peers = (team || []).filter(c => c.id !== coord.id);

  // Ritual response rates (briefing_trabalho + fechamento; sent rows in window).
  async function rateFor(ritualType) {
    const { data: rows } = await supabase
      .from('ritual_logs').select('collaborator_id, sent_at')
      .eq('ritual_type', ritualType).eq('status', 'sent')
      .gte('reference_date', ymdStart).lte('reference_date', ymdEnd);
    let responded = 0;
    for (const r of (rows || [])) {
      const { count } = await supabase
        .from('conversation_history').select('id', { head: true, count: 'exact' })
        .eq('collaborator_id', r.collaborator_id)
        .eq('direction', 'inbound')
        .gte('created_at', r.sent_at);
      if ((count || 0) > 0) responded++;
    }
    return { sent: (rows || []).length, responded };
  }
  const briefingRate = await rateFor('daily_briefing');
  const closingRate = await rateFor('daily_closing');

  // Tasks (work only) created/completed in window.
  const { count: createdCount } = await supabase
    .from('tasks').select('id', { head: true, count: 'exact' })
    .eq('context', 'work')
    .gte('created_at', tsStart).lte('created_at', tsEnd);
  const { count: completedCount } = await supabase
    .from('tasks').select('id', { head: true, count: 'exact' })
    .eq('context', 'work').eq('status', 'done')
    .gte('completed_at', tsStart).lte('completed_at', tsEnd);
  const { data: openOverdue } = await supabase
    .from('tasks').select('id, assigned_to')
    .eq('context', 'work').lt('due_date', ymdAddDays(ymdEnd, 1))
    .not('status', 'in', '(done,cancelled)').limit(200);
  const overdueByPerson = new Map();
  for (const t of (openOverdue || [])) {
    const c = peers.find(p => p.id === t.assigned_to);
    if (c) overdueByPerson.set(c.full_name, (overdueByPerson.get(c.full_name) || 0) + 1);
  }

  // Per-collaborator: created vs completed (work only).
  const perCollab = [];
  for (const c of peers) {
    const { count: cCreated } = await supabase
      .from('tasks').select('id', { head: true, count: 'exact' })
      .eq('context', 'work').eq('assigned_to', c.id)
      .gte('created_at', tsStart).lte('created_at', tsEnd);
    const { count: cDone } = await supabase
      .from('tasks').select('id', { head: true, count: 'exact' })
      .eq('context', 'work').eq('assigned_to', c.id).eq('status', 'done')
      .gte('completed_at', tsStart).lte('completed_at', tsEnd);
    const ovd = overdueByPerson.get(c.full_name) || 0;
    perCollab.push({ name: c.full_name, created: cCreated || 0, done: cDone || 0, overdue: ovd });
  }

  // ----- Build text -----
  const lines = [`📊 *Retrospectiva semanal* — ${brShort(ymdStart)} a ${brShort(ymdEnd)}`];

  lines.push('');
  lines.push('🎯 *Rituais*');
  if (briefingRate.sent) {
    const pct = Math.round(100 * briefingRate.responded / briefingRate.sent);
    lines.push(`• Briefing: ${briefingRate.responded}/${briefingRate.sent} (${pct}%)`);
  } else lines.push(`• Briefing: nenhum disparado`);
  if (closingRate.sent) {
    const pct = Math.round(100 * closingRate.responded / closingRate.sent);
    lines.push(`• Fechamento: ${closingRate.responded}/${closingRate.sent} (${pct}%)`);
  } else lines.push(`• Fechamento: nenhum disparado`);

  lines.push('');
  lines.push('📋 *Tarefas (work)*');
  lines.push(`• Criadas: ${createdCount || 0}`);
  const compRate = createdCount ? Math.round(100 * (completedCount || 0) / createdCount) : 0;
  lines.push(`• Concluídas: ${completedCount || 0}${createdCount ? ` (${compRate}% das criadas)` : ''}`);
  lines.push(`• Atrasadas (em aberto): ${(openOverdue || []).length}`);

  if (perCollab.some(x => x.created || x.done || x.overdue)) {
    lines.push('');
    lines.push('🏆 *Por colaborador*');
    perCollab
      .sort((a, b) => b.done - a.done)
      .forEach(p => {
        const ov = p.overdue ? ` / ${p.overdue} atraso${p.overdue > 1 ? 's' : ''}` : '';
        lines.push(`• ${firstName(p.name)} — ${p.created} criadas, ${p.done} done${ov}`);
      });
  }

  // Sinais — minimal heuristics (only flag obvious patterns).
  const sinais = [];
  if (briefingRate.sent && briefingRate.responded / briefingRate.sent < 0.5) {
    sinais.push(`Resposta de briefing abaixo de 50%`);
  }
  if (closingRate.sent && closingRate.responded / closingRate.sent < 0.5) {
    sinais.push(`Resposta de fechamento abaixo de 50%`);
  }
  if ((openOverdue || []).length >= 10) sinais.push(`Acúmulo de atrasos: ${openOverdue.length}`);
  if (sinais.length) {
    lines.push('');
    lines.push('⚠️ *Sinais*');
    for (const s of sinais) lines.push(`• ${s}`);
  }

  return lines.join('\n');
}

// Send a coordinator report. Role-gated: only coordinator/director receive it.
// Returns true on success, false on skip/error. Caller logs ritual_logs separately.
async function sendCoordinatorReport(collaboratorId, type, ymdRef) {
  const { data: collab } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, role, is_active')
    .eq('id', collaboratorId).single();
  if (!collab || !collab.is_active) {
    console.warn(`[CoordReport] skipped ${type} — collaborator inactive/missing`);
    return false;
  }
  if (!COORDINATOR_ROLES.includes(collab.role)) {
    console.warn(`[CoordReport] DENIED ${type} for ${collab.full_name} — role=${collab.role || 'collaborator'}`);
    return false;
  }
  let text;
  try {
    if (type === 'team_summary') text = await buildTeamSummary(collab, ymdRef);
    else if (type === 'weekly_retrospective') text = await buildWeeklyRetrospective(collab, ymdRef);
    else { console.warn(`[CoordReport] unknown type ${type}`); return false; }
  } catch (err) {
    console.error(`[CoordReport] build err ${type}:`, err.message);
    return false;
  }
  try {
    await whatsapp.sendMessage(collab.phone, text);
    await logConversation(collab.id, 'outbound', text);
  } catch (err) {
    console.error(`[CoordReport] send err ${type} to ${String(collab.phone).slice(-4)}:`, err.message);
    return false;
  }
  console.log(`[CoordReport] ${type} sent to ${String(collab.phone).slice(-4)} (${collab.full_name}) — ${text.length} chars`);
  return true;
}

module.exports = { processMessage, sendRitual, sendCoordinatorReport, buildTeamSummary, buildWeeklyRetrospective, parseOnboardingMarker, persistOnboarding, parseMemoryMarker, parseProjectMarker, parseTaskUpdateMarker, parseWeeklyPlanMarker, parseHabitMarker, parseDndMarker, persistMemoryRows, persistProject, applyTaskActions, applyWeeklyPlan, applyHabitActions, applyDnd, getDndState, consolidateMemoryFor, decayExpiredMemories, looksLikeMemory, resolveTaskByShortId };
