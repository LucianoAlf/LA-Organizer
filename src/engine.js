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

// Sprint 13 F3 T3 — Helper: converte objeto audience em string legível para humanos.
function describeAudience(audience) {
  if (!audience) return 'sem público';
  if (audience.all === true) return 'Escola toda';
  const parts = [];
  if (Array.isArray(audience.function_role) && audience.function_role.length) {
    parts.push(`função: ${audience.function_role.join(', ')}`);
  }
  if (Array.isArray(audience.unidade) && audience.unidade.length) {
    parts.push(`unidade: ${audience.unidade.join(', ')}`);
  }
  if (Array.isArray(audience.turno) && audience.turno.length) {
    parts.push(`turno: ${audience.turno.join(', ')}`);
  }
  return parts.length ? parts.join(' | ') : 'público customizado';
}

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
// Sprint 22.26 — VALID_EVENT_CATEGORIES era set fixo; agora a validacao acontece
// em runtime via lookupEventCategoryBySlug (tabela event_categories). Removido.
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

// Sprint 11 Bloco A.2: parser YAML-ish para recuperar markers que Claude emite
// em formato "key: value" em vez de JSON (caso real 28/04 22:59 onde
// "action: create / title: ... / remind_at: ..." virou regression silenciosa).
// Retorna objeto único (caller faz wrap em array se preciso) ou null.
function parseYamlIshObject(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const obj = {};
  for (const line of lines) {
    // Aceita "key: value", "key:value", "  key: value  ". Não aceita multiline.
    const km = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!km) return null; // linha não é "key: value" — aborta (provavelmente JSON corrompido, não YAML)
    let [, key, val] = km;
    val = val.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val === 'true') obj[key] = true;
    else if (val === 'false') obj[key] = false;
    else if (val === 'null' || val === '') obj[key] = null;
    else if (/^-?\d+(?:\.\d+)?$/.test(val)) obj[key] = Number(val);
    else obj[key] = val;
  }
  return Object.keys(obj).length > 0 ? obj : null;
}

// Parse <<TASK_UPDATE>>[...]<<END>> — filtra ações inválidas, mantém o resto.
function parseTaskUpdateMarker(text) {
  if (!text) return null;
  const re = /<<TASK_UPDATE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed = null;
  let recoveredVia = null;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    // Sprint 11 Bloco A.2: YAML-ish fallback. Se Claude improvisou
    // "action: create\ntitle: ..." em vez de JSON, recuperamos.
    const yamlObj = parseYamlIshObject(m[1].trim());
    if (yamlObj) {
      parsed = yamlObj;
      recoveredVia = 'yaml';
      console.warn(`[TASK_UPDATE] recovered via YAML-ish parser (json_err=${err.message.slice(0, 80)})`);
    } else {
      logSchemaErr('TASK_UPDATE', ['invalid_json: ' + err.message], m[1]);
      return { malformed: true, cleanText };
    }
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

// Sprint 11.4 — Marker novo <<CHECKPOINT_BATCH>>. TOM emite quando produz checklist
// estruturado (4+ itens) ligado a um projeto existente. Persiste como project_checkpoints
// pra deixar o checklist como dado de primeira classe (não fumaça em conversation_history).
//
// Schema esperado:
// {
//   "project_id": "uuid",      // ou "project_name": "Workshop de Improvisação" (resolução fuzzy)
//   "items": [
//     { "name": "Definir tema com Moreira", "due_date": "2026-04-30" },
//     { "name": "Fechar local e data" },
//     ...
//   ]
// }
function validateCheckpointItem(item) {
  if (!item || typeof item !== 'object') return 'not_object';
  if (typeof item.name !== 'string' || !item.name.trim()) return 'name:missing';
  if (item.name.length > 200) return 'name:too_long';
  if (item.due_date !== undefined && item.due_date !== null) {
    if (typeof item.due_date !== 'string' || !ISO_DATE_RE.test(item.due_date)) return 'due_date:invalid';
  }
  if (item.description !== undefined && item.description !== null && typeof item.description !== 'string') {
    return 'description:invalid';
  }
  return null;
}

function parseCheckpointBatchMarker(text) {
  if (!text) return null;
  const re = /<<CHECKPOINT_BATCH>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('CHECKPOINT_BATCH', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { malformed: true, cleanText };
  }
  const project_id = typeof parsed.project_id === 'string' ? parsed.project_id : null;
  const project_name = typeof parsed.project_name === 'string' ? parsed.project_name : null;
  if (!project_id && !project_name) {
    logSchemaErr('CHECKPOINT_BATCH', ['project_id_or_name:missing'], parsed);
    return { malformed: true, cleanText };
  }
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    logSchemaErr('CHECKPOINT_BATCH', ['items:empty_or_not_array'], parsed);
    return { malformed: true, cleanText };
  }
  // Threshold mínimo: 2 items (regra de "não vira batch pra listinha trivial").
  // Skill orienta 4+ mas engine aceita 2+ pra flexibilidade.
  if (parsed.items.length < 2) {
    logSchemaErr('CHECKPOINT_BATCH', ['items:below_threshold_2'], parsed);
    return { malformed: true, cleanText };
  }
  const valid = [];
  const dropped = [];
  for (let i = 0; i < parsed.items.length; i++) {
    const why = validateCheckpointItem(parsed.items[i]);
    if (why) dropped.push(`item[${i}]:${why}`);
    else valid.push(parsed.items[i]);
  }
  if (dropped.length) logSchemaErr('CHECKPOINT_BATCH', dropped, parsed);
  if (!valid.length) return { malformed: true, cleanText };
  return { project_id, project_name, items: valid, cleanText, malformed: false };
}

// Sprint 11 F2+ — Marker <<CHECKLIST_ACTION>>. TOM emite quando colaborador
// responde a checklist operacional enviado pelo cron. Persiste em
// op_checklist_item_completions com canal 'whatsapp'. Valida completion_id
// (uuid) e array items com { item_id, done }.
function parseChecklistActionMarker(text) {
  if (!text) return null;
  const re = /<<CHECKLIST_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('CHECKLIST_ACTION', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || typeof parsed !== 'object') return { malformed: true, cleanText };

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!parsed.completion_id || !UUID_RE.test(parsed.completion_id)) {
    logSchemaErr('CHECKLIST_ACTION', ['completion_id:missing_or_invalid'], parsed);
    return { malformed: true, cleanText };
  }
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    logSchemaErr('CHECKLIST_ACTION', ['items:empty_or_not_array'], parsed);
    return { malformed: true, cleanText };
  }
  const valid = [];
  const dropped = [];
  for (let i = 0; i < parsed.items.length; i++) {
    const item = parsed.items[i];
    if (!item.item_id || !UUID_RE.test(item.item_id)) {
      dropped.push(`item[${i}]:item_id_invalid`);
    } else if (typeof item.done !== 'boolean') {
      dropped.push(`item[${i}]:done_not_boolean`);
    } else {
      valid.push(item);
    }
  }
  if (dropped.length) logSchemaErr('CHECKLIST_ACTION', dropped, parsed);
  if (!valid.length) return { malformed: true, cleanText };

  return {
    completion_id: parsed.completion_id,
    items: valid,
    channel: ['pwa', 'whatsapp'].includes(parsed.channel) ? parsed.channel : 'whatsapp',
    cleanText,
    malformed: false,
  };
}

async function applyChecklistAction(collaborator, parsed) {
  const { completion_id, items, channel } = parsed;

  // 1. Busca completion + checklist (threshold + cobranca state Sprint 22.36)
  // NOTE: real column is 'checklist_id', not 'template_id'
  const { data: completion, error: fetchErr } = await supabase
    .from('op_checklist_completions')
    .select('id, dispatched_at, completed_at, checklist_id, reminded_at, reminder_replied, op_checklists(completion_threshold)')
    .eq('id', completion_id)
    .eq('collaborator_id', collaborator.id)
    .single();

  if (fetchErr || !completion) {
    console.warn(`[ChecklistAction] completion ${completion_id} not found for collab ${collaborator.id}`);
    return { ok: false, reason: 'completion_not_found' };
  }

  // 2. Janela 6h
  const now = new Date();
  if (!completion.dispatched_at) {
    console.warn(`[ChecklistAction] completion ${completion_id} has no dispatched_at — treating window as open`);
  }
  const dispatchedAt = completion.dispatched_at ? new Date(completion.dispatched_at) : now;
  const windowEnd = new Date(dispatchedAt.getTime() + 6 * 60 * 60 * 1000);
  const isLate = now > windowEnd;

  // 3. UPSERT cada item
  for (const item of items) {
    const { error } = await supabase
      .from('op_checklist_item_completions')
      .upsert(
        {
          completion_id,
          item_id: item.item_id,
          is_checked: item.done,
          channel: channel || 'whatsapp',
          late: isLate,
        },
        { onConflict: 'completion_id,item_id' }
      );
    if (error) console.warn(`[ChecklistAction] upsert item ${item.item_id}:`, error.message);
  }

  // 4. Recalcular progresso (template + ad-hoc Sprint 22.36)
  // NOTE: real column is 'checklist_id', not 'template_id'
  const { count: templateTotal } = await supabase
    .from('op_checklist_items')
    .select('id', { count: 'exact', head: true })
    .eq('checklist_id', completion.checklist_id);

  const { count: extraTotal } = await supabase
    .from('op_checklist_completion_extra_items')
    .select('id', { count: 'exact', head: true })
    .eq('completion_id', completion_id);

  const { count: templateDone } = await supabase
    .from('op_checklist_item_completions')
    .select('id', { count: 'exact', head: true })
    .eq('completion_id', completion_id)
    .eq('is_checked', true);

  const { count: extraDone } = await supabase
    .from('op_checklist_completion_extra_items')
    .select('id', { count: 'exact', head: true })
    .eq('completion_id', completion_id)
    .eq('is_checked', true);

  const totalCount = (templateTotal ?? 0) + (extraTotal ?? 0);
  const doneCount = (templateDone ?? 0) + (extraDone ?? 0);

  const threshold = completion.op_checklists?.completion_threshold ?? 100;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // 5. Sprint 22.36 Fatia 6 — atualizar estado de cobrança/celebração
  const updates = {};
  // 5a. Marcar completed_at se threshold atingido (e ainda não completed)
  let justCompleted = false;
  if (pct >= threshold && !completion.completed_at) {
    updates.completed_at = now.toISOString();
    justCompleted = true;
  }
  // 5b. Sprint 22.36 — colab respondeu cobrança? Cancela escalação.
  if (completion.reminded_at && !completion.reminder_replied) {
    updates.reminder_replied = true;
  }
  if (Object.keys(updates).length > 0) {
    await supabase
      .from('op_checklist_completions')
      .update(updates)
      .eq('id', completion_id);
  }

  // 5c. Sprint 22.36 — Disparar celebração (pro user + gerente da unidade)
  if (justCompleted) {
    try {
      const { runChecklistCompletedFlow } = require('./internal-api');
      // Fire-and-forget — não bloqueia resposta do TOM
      runChecklistCompletedFlow(completion_id).catch(err =>
        console.error(`[ChecklistAction] celebration flow err:`, err.message)
      );
    } catch (err) {
      console.warn(`[ChecklistAction] could not trigger celebration:`, err.message);
    }
  }

  return { ok: true, pct, doneCount, totalCount, isLate, threshold };
}

// Sprint 13 F1 — Marker <<ANNOUNCEMENT_ACTION>>. TOM emite quando director/coordinator
// confirma criação ou cancelamento de comunicado interno. Persiste em announcements
// e announcement_jobs (create) ou seta status=cancelled (cancel).
function parseAnnouncementActionMarker(text) {
  if (!text) return null;
  const re = /<<ANNOUNCEMENT_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('ANNOUNCEMENT_ACTION', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || typeof parsed !== 'object') return { malformed: true, cleanText };
  if (!['create', 'cancel'].includes(parsed.action)) {
    logSchemaErr('ANNOUNCEMENT_ACTION', ['action:invalid'], parsed);
    return { malformed: true, cleanText };
  }
  if (parsed.action === 'create') {
    if (!parsed.body || typeof parsed.body !== 'string' || !parsed.body.trim()) {
      logSchemaErr('ANNOUNCEMENT_ACTION', ['body:missing_or_empty'], parsed);
      return { malformed: true, cleanText };
    }
  }
  return { ...parsed, cleanText, malformed: false };
}

// Sprint 13 F3 T4 — Marker <<ANNOUNCEMENT_APPROVAL>>. TOM emite quando director aprova/rejeita comunicado pendente.
function parseAnnouncementApprovalMarker(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/<<ANNOUNCEMENT_APPROVAL>>\s*([\s\S]*?)\s*<<END>>/i);
  if (!m) return null;
  let parsed;
  try {
    parsed = JSON.parse(m[1]);
  } catch (err) {
    console.warn('[parseAnnouncementApprovalMarker] JSON inválido:', err.message);
    return null;
  }
  if (!['approve', 'reject'].includes(parsed.action)) return null;
  if (typeof parsed.announcement_id !== 'string' || !parsed.announcement_id.trim()) return null;
  if (parsed.reason !== undefined && parsed.reason !== null && typeof parsed.reason !== 'string') {
    parsed.reason = null;
  }
  return {
    action: parsed.action,
    announcement_id: parsed.announcement_id.trim(),
    reason: parsed.reason ?? null,
  };
}

async function createAnnouncementJobs(ann) {
  let q = supabase.from('collaborators').select('id, phone').not('phone', 'is', null);
  const aud = ann.audience || {};
  if (aud.all !== true) {
    if (Array.isArray(aud.function_role) && aud.function_role.length) q = q.in('role', aud.function_role);
    if (Array.isArray(aud.unidade) && aud.unidade.length) q = q.in('unit', aud.unidade);
    if (Array.isArray(aud.turno) && aud.turno.length) q = q.in('shift', aud.turno);
  }
  const { data: recipients, error: recErr } = await q;
  if (recErr) return { count: 0, error: recErr.message };
  if (!recipients || recipients.length === 0) return { count: 0, error: null };
  const jobs = recipients.map(r => ({
    announcement_id: ann.id,
    recipient_id: r.id,
    phone: r.phone,
    status: 'pending',
    retry_count: 0,
  }));
  const { error: jobErr } = await supabase.from('announcement_jobs').insert(jobs);
  if (jobErr) return { count: 0, error: jobErr.message };
  return { count: jobs.length, error: null };
}

async function notifyCoordinatorOfDecision(ann, director, action, reason) {
  const { data: coord, error } = await supabase
    .from('collaborators')
    .select('phone, full_name')
    .eq('id', ann.created_by)
    .single();
  if (error || !coord || !coord.phone) {
    console.warn('[notifyCoordinatorOfDecision] coordinator sem phone, pulando notificação');
    return;
  }
  let msg;
  if (action === 'approve') {
    msg = `✅ Seu comunicado foi aprovado por ${director.full_name} e será enviado em breve.`;
  } else {
    const motivoStr = reason ? `Motivo: "${reason}"` : 'Sem motivo informado.';
    msg = `❌ Seu comunicado foi rejeitado por ${director.full_name}. ${motivoStr}`;
  }
  try {
    await whatsapp.sendMessage(coord.phone, msg);
    await supabase
      .from('announcements')
      .update({ coordinator_notified_at: new Date().toISOString() })
      .eq('id', ann.id);
  } catch (err) {
    console.error('[notifyCoordinatorOfDecision] erro enviando WhatsApp:', err.message);
  }
}

async function applyAnnouncementApproval(collaborator, parsed) {
  if (collaborator.role !== 'director') {
    return { ok: false, reason: 'Apenas diretores podem aprovar ou rejeitar comunicados.' };
  }

  const idValue = parsed.announcement_id;
  let query = supabase.from('announcements').select('*');
  if (idValue.length === 4) {
    query = query.filter('id::text', 'ilike', `${idValue}%`);
  } else {
    query = query.eq('id', idValue);
  }

  const { data: rows, error: queryErr } = await query
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: false })
    .limit(1);

  if (queryErr) {
    console.error('[applyAnnouncementApproval] erro buscando announcement:', queryErr.message);
    return { ok: false, reason: 'Erro ao buscar o comunicado. Tenta de novo.' };
  }
  if (!rows || rows.length === 0) {
    return { ok: false, reason: `Comunicado \`${idValue}\` não encontrado ou já foi aprovado/rejeitado.` };
  }

  const ann = rows[0];

  if (ann.created_by === collaborator.id) {
    return { ok: false, reason: 'Você não pode aprovar seu próprio comunicado.' };
  }

  if (parsed.action === 'approve') {
    const { error: updErr } = await supabase
      .from('announcements')
      .update({
        status: 'scheduled',
        reviewed_by: collaborator.id,
      })
      .eq('id', ann.id);
    if (updErr) {
      console.error('[applyAnnouncementApproval] erro UPDATE approve:', updErr.message);
      return { ok: false, reason: 'Erro ao aprovar o comunicado.' };
    }

    const jobsResult = await createAnnouncementJobs(ann);
    if (jobsResult.error) {
      console.error('[applyAnnouncementApproval] erro criando jobs após aprovação:', jobsResult.error);
    }

    await notifyCoordinatorOfDecision(ann, collaborator, 'approve', null);

    return { ok: true, action: 'approved', announcement_id: ann.id, recipient_count: jobsResult.count, jobs_error: jobsResult.error ?? null };
  }

  if (parsed.action === 'reject') {
    const reason = parsed.reason || null;
    const { error: updErr } = await supabase
      .from('announcements')
      .update({
        status: 'rejected',
        reviewed_by: collaborator.id,
        rejection_reason: reason,
      })
      .eq('id', ann.id);
    if (updErr) {
      console.error('[applyAnnouncementApproval] erro UPDATE reject:', updErr.message);
      return { ok: false, reason: 'Erro ao rejeitar o comunicado.' };
    }

    await notifyCoordinatorOfDecision(ann, collaborator, 'reject', reason);

    return { ok: true, action: 'rejected', announcement_id: ann.id };
  }

  return { ok: false, reason: 'Ação inválida.' };
}

async function applyAnnouncementAction(collaborator, parsed) {
  const { action, body, audience, scheduled_at, announcement_id } = parsed;

  if (action === 'cancel') {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let annId = (announcement_id && announcement_id !== 'latest' && UUID_RE.test(announcement_id))
      ? announcement_id
      : null;
    if (!annId) {
      const { data } = await supabase
        .from('announcements')
        .select('id')
        .eq('created_by', collaborator.id)
        .in('status', ['scheduled', 'sending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return { ok: false, reason: 'no_active_announcement' };
      annId = data.id;
    }
    const { error } = await supabase
      .from('announcements')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', annId);
    if (error) return { ok: false, reason: error.message };
    return { ok: true, action: 'cancelled', announcement_id: annId };
  }

  if (action === 'create') {
    // Sprint 13 F3 T3 — Coordinators go to pending_approval; directors go straight to scheduled.
    const isCoordinator = collaborator.role === 'coordinator';

    const { data: ann, error: annErr } = await supabase
      .from('announcements')
      .insert({
        created_by: collaborator.id,
        body: body.trim(),
        audience: audience || { all: true },
        status: isCoordinator ? 'pending_approval' : 'scheduled',
        scheduled_at: scheduled_at || null,
      })
      .select('id')
      .single();
    if (annErr) return { ok: false, reason: annErr.message };

    if (isCoordinator) {
      // Buscar directors com phone
      const { data: directors, error: dirErr } = await supabase
        .from('collaborators')
        .select('id, full_name, phone')
        .eq('role', 'director')
        .not('phone', 'is', null);

      if (dirErr) {
        console.error('[applyAnnouncementAction] Falha ao buscar directors:', dirErr.message);
        // Don't compensating-delete the announcement — it's still valid in pending_approval and director can approve via PWA later.
        return { ok: false, reason: dirErr.message, announcement_id: ann.id };
      }

      const shortId = ann.id.slice(0, 4);
      const audienceStr = describeAudience(parsed.audience);
      const bodyPreview = parsed.body.length > 80
        ? parsed.body.slice(0, 80) + '...'
        : parsed.body;

      if (!directors || directors.length === 0) {
        console.warn('[applyAnnouncementAction] Nenhum director com phone — comunicado fica em pending_approval para aprovação manual via PWA');
        return { ok: true, action: 'pending_approval', announcement_id: ann.id, recipient_count: 0 };
      }

      for (const director of directors) {
        try {
          await whatsapp.sendMessage(director.phone, [
            '📋 *Comunicado pendente de aprovação*',
            `De: ${collaborator.full_name} (coordinator)`,
            `Para: ${audienceStr}`,
            `Mensagem: "${bodyPreview}"`,
            `ID: \`${shortId}\``,
            `Responda: APROVAR ${shortId} ou REJEITAR ${shortId} [motivo opcional]`,
          ].join('\n'));
        } catch (err) {
          console.error(`[applyAnnouncementAction] Falha ao notificar director ${director.id}:`, err.message);
        }
      }

      return { ok: true, action: 'pending_approval', announcement_id: ann.id, recipient_count: directors.length };
    }

    // Caso director (fluxo já existente) — buscar recipients e inserir jobs
    let q = supabase
      .from('collaborators')
      .select('id, phone')
      .eq('is_active', true)
      .not('phone', 'is', null);

    if (audience && !audience.all) {
      if (audience.function_role?.length) q = q.in('function_role', audience.function_role);
      if (audience.unidade?.length) q = q.in('unit', audience.unidade);
      if (audience.turno?.length) q = q.in('shift', audience.turno);
    }

    const { data: recipients, error: rErr } = await q;
    if (rErr) return { ok: false, reason: rErr.message };
    if (!recipients || recipients.length === 0) return { ok: false, reason: 'no_recipients' };

    const jobs = recipients.map(r => ({
      announcement_id: ann.id,
      recipient_id: r.id,
      phone: r.phone,
    }));
    const { error: jobErr } = await supabase.from('announcement_jobs').insert(jobs);
    if (jobErr) {
      // compensate: remove the orphaned announcement row
      await supabase.from('announcements').delete().eq('id', ann.id);
      return { ok: false, reason: jobErr.message };
    }

    return { ok: true, action: 'created', announcement_id: ann.id, recipient_count: recipients.length };
  }

  return { ok: false, reason: 'unknown_action' };
}

// Sprint 13 F2 — Helper: gera specs de anúncio para cada etapa ativa do evento.
// Recebe o registro school_events e a data/hora atual.
// Retorna array de { body, audience, scheduled_at } para cada etapa habilitada.
// scheduled_at null = envio imediato (broadcaster processa no próximo tick).
// Timezone: BRT = UTC-3. T-3 às 09:00 BRT = UTC 12:00 do dia (event_date - 3d).
function buildEventAnnouncementsNode(ev, now) {
  const [y, m, d] = ev.event_date.split('-').map(Number);
  const timeStr = ev.start_time ? ` às ${ev.start_time.slice(0, 5)}` : '';
  const locStr = ev.location ? `, ${ev.location}` : '';
  const dateBR = `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
  // 09:00 BRT = 12:00 UTC (UTC-3)
  const t3 = new Date(Date.UTC(y, m - 1, d - 3, 12, 0, 0));
  const t1 = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
  const specs = [];
  if (ev.notify_leadership) {
    specs.push({
      body: `📅 Novo evento: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: { function_role: ['director', 'coordinator'] },
      scheduled_at: null,
    });
  }
  if (ev.notify_school) {
    specs.push({
      body: `📅 Em 3 dias: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: { all: true },
      scheduled_at: t3 > now ? t3.toISOString() : null,
    });
  }
  if (ev.notify_unit) {
    specs.push({
      body: `📅 Amanhã: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: ev.unit ? { unidade: [ev.unit] } : { all: true },
      scheduled_at: t1 > now ? t1.toISOString() : null,
    });
  }
  if (ev.notify_day_of) {
    const t0 = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // 09h BRT = 12h UTC
    specs.push({
      body: `📅 Hoje: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: ev.unit ? { unidade: [ev.unit] } : { all: true },
      scheduled_at: t0 > now ? t0.toISOString() : null,
    });
  }
  return specs;
}

// ─── Sprint 14 Fatia 2 — Kits de tasks de evento ─────────────────────────────

const TYPE_TO_FAMILY = {
  show: 'performance', recital: 'performance',
  workshop: 'aprendizagem', treinamento: 'aprendizagem', oficinas: 'aprendizagem',
  reuniao: 'reuniao',
  formatura: 'formatura',
  evento: 'evento',
};

const EVENT_TASK_KITS = {
  performance: [
    { title: 'Confirmar local e montagem do espaço',          sector: 'logistica'   },
    { title: 'Organizar lista de presença e convites',        sector: 'logistica'   },
    { title: 'Testar equipamentos de som e iluminação',       sector: 'tecnica'     },
    { title: 'Preparar roteiro técnico do evento',            sector: 'tecnica'     },
    { title: 'Realizar ensaio geral com alunos',              sector: 'pedagogico'  },
    { title: 'Confirmar repertório e ordem de apresentação',  sector: 'pedagogico'  },
    { title: 'Divulgar evento (redes sociais e WhatsApp)',    sector: 'comunicacao' },
    { title: 'Enviar convites para responsáveis',             sector: 'comunicacao' },
    { title: 'Decoração e ambientação do espaço',             sector: 'producao'    },
  ],
  aprendizagem: [
    { title: 'Confirmar sala e número de vagas',              sector: 'logistica'   },
    { title: 'Preparar materiais e impressões',               sector: 'logistica'   },
    { title: 'Verificar equipamentos audiovisuais',           sector: 'tecnica'     },
    { title: 'Finalizar conteúdo e apostilas',                sector: 'pedagogico'  },
    { title: 'Preparar dinâmica e exercícios práticos',       sector: 'pedagogico'  },
    { title: 'Confirmar inscrições e presenças',              sector: 'comunicacao' },
  ],
  reuniao: [
    { title: 'Confirmar sala e presença dos participantes',   sector: 'logistica'   },
    { title: 'Preparar pauta da reunião',                     sector: 'pedagogico'  },
    { title: 'Registrar ata durante a reunião',               sector: 'pedagogico'  },
    { title: 'Convocar participantes com antecedência',       sector: 'comunicacao' },
  ],
  formatura: [
    { title: 'Confirmar local e estrutura do espaço',         sector: 'logistica'   },
    { title: 'Organizar lista de convidados e ingressos',     sector: 'logistica'   },
    { title: 'Testar som, filmagem e fotografia',             sector: 'tecnica'     },
    { title: 'Realizar ensaio da cerimônia com formandos',    sector: 'pedagogico'  },
    { title: 'Preparar diplomas e certificados',              sector: 'pedagogico'  },
    { title: 'Enviar convites e confirmar presenças',         sector: 'comunicacao' },
    { title: 'Decoração e montagem do espaço',                sector: 'producao'    },
    { title: 'Organizar homenagens e momentos especiais',     sector: 'producao'    },
  ],
  evento: [
    { title: 'Confirmar local e estrutura',                   sector: 'logistica'   },
    { title: 'Verificar equipamentos necessários',            sector: 'tecnica'     },
    { title: 'Preparar conteúdo e programação',               sector: 'pedagogico'  },
    { title: 'Divulgar e confirmar participantes',            sector: 'comunicacao' },
    { title: 'Preparar ambientação do espaço',                sector: 'producao'    },
  ],
};

const VALID_EVENT_TYPES = Object.keys(TYPE_TO_FAMILY);

async function buildEventTaskKit(eventId, eventDate, eventType, unit, createdBy) {
  const family = TYPE_TO_FAMILY[eventType];
  if (!family) return { ok: true, count: 0 };

  const kit = EVENT_TASK_KITS[family];
  if (!kit || !kit.length) return { ok: true, count: 0 };

  // Buscar mapa de equipe da unidade (vazio se evento for "escola toda" sem unit)
  const teamMap = {};
  if (unit) {
    const { data: mapRows } = await supabase
      .from('event_team_map')
      .select('sector, collaborator_id')
      .eq('unit', unit);
    for (const row of mapRows || []) {
      teamMap[row.sector] = row.collaborator_id;
    }
  }

  // remind_at = event_date às 09h BRT do dia ANTERIOR (T-1)
  // event_date é YYYY-MM-DD; 09h BRT = 12h UTC; subtrair 24h = dia anterior 12h UTC
  const eventDayUtc = new Date(eventDate + 'T12:00:00Z').getTime();
  const remindAtIso = new Date(eventDayUtc - 24 * 60 * 60 * 1000).toISOString();

  const tasks = kit.map(item => ({
    title: item.title,
    assigned_to: teamMap[item.sector] || createdBy,
    created_by: createdBy,
    due_date: eventDate,
    remind_at: remindAtIso,
    status: 'pending',
    source: 'system',
    context: 'work',
    priority: 'medium',
    school_event_id: eventId,
    event_sector: item.sector,
  }));

  const { error } = await supabase.from('tasks').insert(tasks);
  if (error) return { ok: false, error: error.message, count: 0 };
  return { ok: true, count: tasks.length };
}

// Sprint 13 F2 — Marker <<SCHOOL_EVENT_ACTION>>.
function parseSchoolEventActionMarker(text) {
  if (!text) return null;
  const re = /<<SCHOOL_EVENT_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('SCHOOL_EVENT_ACTION', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || typeof parsed !== 'object') return { malformed: true, cleanText };
  if (!['create', 'cancel'].includes(parsed.action)) {
    logSchemaErr('SCHOOL_EVENT_ACTION', ['action:invalid'], parsed);
    return { malformed: true, cleanText };
  }
  if (parsed.action === 'create') {
    if (!parsed.title || typeof parsed.title !== 'string' || !parsed.title.trim()) {
      logSchemaErr('SCHOOL_EVENT_ACTION', ['title:missing'], parsed);
      return { malformed: true, cleanText };
    }
    if (!parsed.event_date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.event_date)) {
      logSchemaErr('SCHOOL_EVENT_ACTION', ['event_date:invalid'], parsed);
      return { malformed: true, cleanText };
    }
    if (parsed.event_type !== undefined && parsed.event_type !== null) {
      if (!VALID_EVENT_TYPES.includes(parsed.event_type)) {
        logSchemaErr('SCHOOL_EVENT_ACTION', ['event_type:invalid'], parsed);
        return { malformed: true, cleanText };
      }
    }
  }
  return { ...parsed, cleanText, malformed: false };
}

async function applySchoolEventAction(collaborator, parsed) {
  const { action, event_id } = parsed;

  if (action === 'cancel') {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let evId = (event_id && event_id !== 'latest' && UUID_RE.test(event_id)) ? event_id : null;
    if (!evId) {
      const { data } = await supabase
        .from('school_events')
        .select('id')
        .eq('created_by', collaborator.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return { ok: false, reason: 'no_active_event' };
      evId = data.id;
    }
    const { error: evErr } = await supabase
      .from('school_events')
      .update({ status: 'cancelled' })
      .eq('id', evId);
    if (evErr) return { ok: false, reason: evErr.message };
    // Cancel linked announcements — broadcaster will send retractions
    await supabase
      .from('announcements')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('source_event_id', evId)
      .in('status', ['scheduled', 'sending']);
    return { ok: true, action: 'cancelled', event_id: evId };
  }

  if (action === 'create') {
    const { title, event_date, start_time, unit, location,
            notify_leadership, notify_school, notify_unit } = parsed;
    const { data: ev, error: evErr } = await supabase
      .from('school_events')
      .insert({
        title: title.trim(),
        event_date,
        start_time: start_time || null,
        unit: unit || null,
        location: location ? location.trim() : null,
        created_by: collaborator.id,
        notify_leadership: notify_leadership !== false,
        notify_school: notify_school !== false,
        notify_unit: notify_unit !== false,
        notify_day_of: parsed.notify_day_of ?? true,
        event_type: parsed.event_type || null,
      })
      .select('id, title, event_date, start_time, unit, location, notify_leadership, notify_school, notify_unit, event_type')
      .single();
    if (evErr) return { ok: false, reason: evErr.message };

    // Sprint 14 Fatia 2 — auto-gerar kit de tasks
    let kitCount = 0;
    if (parsed.event_type) {
      const kitResult = await buildEventTaskKit(
        ev.id,
        ev.event_date,
        parsed.event_type,
        ev.unit,
        collaborator.id
      );
      if (!kitResult.ok) {
        console.error('[applySchoolEventAction] kit error:', kitResult.error);
        // best-effort — continua para criar announcements
      } else {
        kitCount = kitResult.count;
      }
    }

    const specs = buildEventAnnouncementsNode(ev, new Date());
    let annCount = 0;
    for (const spec of specs) {
      const { data: ann, error: annErr } = await supabase
        .from('announcements')
        .insert({
          created_by: collaborator.id,
          body: spec.body,
          audience: spec.audience,
          status: 'scheduled',
          scheduled_at: spec.scheduled_at,
          source_event_id: ev.id,
        })
        .select('id')
        .single();
      if (annErr) {
        console.error('[SchoolEventAction] ann insert err:', annErr.message);
        continue;
      }
      let q = supabase.from('collaborators').select('id, phone').eq('is_active', true).not('phone', 'is', null);
      if (!spec.audience.all) {
        if (spec.audience.function_role?.length) q = q.in('function_role', spec.audience.function_role);
        if (spec.audience.unidade?.length) q = q.in('unit', spec.audience.unidade);
        if (spec.audience.turno?.length) q = q.in('shift', spec.audience.turno);
      }
      const { data: recipients } = await q;
      if (recipients?.length) {
        const jobs = recipients.map(r => ({ announcement_id: ann.id, recipient_id: r.id, phone: r.phone }));
        const { error: jobErr } = await supabase.from('announcement_jobs').insert(jobs);
        if (jobErr) {
          // compensating delete: remove orphan announcement so broadcaster doesn't pick it up
          await supabase.from('announcements').delete().eq('id', ann.id);
          console.error('[SchoolEventAction] job insert err — compensated:', jobErr.message);
          continue;
        }
      }
      annCount++;
    }
    return { ok: true, action: 'created', event_id: ev.id, announcement_count: annCount, task_count: kitCount };
  }

  return { ok: false, reason: 'unknown_action' };
}

// Sprint 16 — Marker <<COORDINATION_REQUEST>>.
function parseCoordinationRequestMarker(text) {
  if (!text) return null;
  const re = /<<COORDINATION_REQUEST>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('COORDINATION_REQUEST', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || typeof parsed !== 'object') return { malformed: true, cleanText };
  if (!parsed.recipient_name || typeof parsed.recipient_name !== 'string') {
    logSchemaErr('COORDINATION_REQUEST', ['recipient_name:missing'], parsed);
    return { malformed: true, cleanText };
  }
  if (!['relay_literal', 'relay_assisted', 'followup'].includes(parsed.mode)) {
    logSchemaErr('COORDINATION_REQUEST', ['mode:invalid'], parsed);
    return { malformed: true, cleanText };
  }
  if (!parsed.message_body || typeof parsed.message_body !== 'string') {
    logSchemaErr('COORDINATION_REQUEST', ['message_body:missing'], parsed);
    return { malformed: true, cleanText };
  }
  return {
    recipient_name:           String(parsed.recipient_name).trim(),
    mode:                     parsed.mode,
    message_body:             String(parsed.message_body).trim(),
    message_original:         parsed.message_original ? String(parsed.message_original).trim() : null,
    expects_response:         Boolean(parsed.expects_response),
    response_deadline_hours:  parsed.response_deadline_hours ? Number(parsed.response_deadline_hours) : null,
    cleanText,
  };
}

// Sprint 16 — Marker <<COORDINATION_RESPONSE>>.
function parseCoordinationResponseMarker(text) {
  if (!text) return null;
  const re = /<<COORDINATION_RESPONSE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('COORDINATION_RESPONSE', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || typeof parsed !== 'object') return { malformed: true, cleanText };
  if (!parsed.request_id || typeof parsed.request_id !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(parsed.request_id.trim())) {
    logSchemaErr('COORDINATION_RESPONSE', ['request_id:invalid_uuid'], parsed);
    return { malformed: true, cleanText };
  }
  if (!parsed.response_summary || typeof parsed.response_summary !== 'string') {
    logSchemaErr('COORDINATION_RESPONSE', ['response_summary:missing'], parsed);
    return { malformed: true, cleanText };
  }
  return {
    request_id:       parsed.request_id.trim(),
    response_summary: String(parsed.response_summary).trim(),
    cleanText,
  };
}

// Sprint 16 — Processa resposta: UPDATE status='responded', notifica requester.
async function applyCoordinationResponseAction(collab, parsed) {
  const { data: req, error: fetchErr } = await supabase
    .from('coordination_requests')
    .select('id, requester_id, recipient_id, mode, message_body, status')
    .eq('id', parsed.request_id)
    .eq('recipient_id', collab.id)
    .eq('status', 'sent')
    .maybeSingle();

  if (fetchErr || !req) {
    console.warn('[CoordinationResponse] request not found or not sent:', parsed.request_id.slice(0, 8));
    return { ok: false, reason: 'request_not_found' };
  }

  const { error: updErr } = await supabase
    .from('coordination_requests')
    .update({
      status:           'responded',
      responded_at:     new Date().toISOString(),
      response_summary: parsed.response_summary,
    })
    .eq('id', req.id);

  if (updErr) {
    console.error('[CoordinationResponse] update err:', updErr.message);
    return { ok: false, reason: 'db_update_error' };
  }

  const { data: requester } = await supabase
    .from('collaborators')
    .select('id, full_name, phone')
    .eq('id', req.requester_id)
    .maybeSingle();

  const recipientFirstName = (collab.full_name || '').split(' ')[0] || 'alguém';

  if (requester?.phone) {
    const msg = `Boa! O ${recipientFirstName} respondeu o que você pediu:\n\n"${parsed.response_summary}"`;
    try {
      await whatsapp.sendMessage(requester.phone, msg);
      await logConversation(requester.id, 'outbound', msg);
    } catch (sendErr) {
      console.error('[CoordinationResponse] notify requester err:', sendErr.message);
    }
  }

  console.log(`[CoordinationResponse] req=${req.id.slice(0, 8)} responded by ${String(collab.phone).slice(-4)}`);
  return { ok: true, reason: `req=${req.id.slice(0, 8)}` };
}

// Sprint 16 UX §6 — templates obrigatórios para mensagem ao recipient.
// NUNCA enviar mensagem sem cabeçalho de origem + indicação de modo.
function _buildRecipientMessage(requesterDisplayName, mode, messageBody) {
  switch (mode) {
    case 'relay_literal':
      return `O ${requesterDisplayName} pediu pra eu te repassar (literalmente):\n\n"${messageBody}"`;
    case 'relay_assisted':
      return `O ${requesterDisplayName} me pediu pra te avisar:\n\n${messageBody}`;
    case 'followup':
      return `O ${requesterDisplayName} me pediu pra te perguntar (e estou acompanhando tua resposta pra devolver pra ele/ela):\n\n${messageBody}`;
    default:
      return `O ${requesterDisplayName} me pediu pra te avisar:\n\n${messageBody}`;
  }
}

// Sprint 16 UX §6 — display name do requester com fallback de homônimo via function_title.
// Radar pós-Sprint19: usar APENAS o primeiro nome — sem '(CEO / Fundador)' etc.
// Tom mais leve no relay. Se houver homônimos no futuro, resolver via contexto/ACC,
// não via title em parêntese.
function _requesterDisplayName(requester) {
  const firstName = (requester.full_name || '').split(' ')[0];
  return firstName || 'Alguém';
}

// Bug B2 fix (Radar pós-Sprint19): quando IntegrityCheck bloqueia criação,
// substitui qualquer texto otimista que o LLM possa ter gerado ("✅ Registrado!")
// por uma microconfirmação clara. Determinístico no engine, não confia no Claude.
function _buildIntegrityConfirmText(payload) {
  if (!payload) return '_não consegui registrar agora, te aviso depois_';
  const cand = String(payload.candidateTitle || '').slice(0, 80);
  const conflicts = Array.isArray(payload.conflicts) ? payload.conflicts : [];
  const first = conflicts[0] || {};
  const existing = String(first.title || '').slice(0, 80);
  switch (payload.type) {
    case 'dup_task': {
      const existId = String(first.id || '').slice(0, 8);
      const idRef = existId ? ` [ref:${existId}]` : '';
      return `Item bloqueado: _"${cand}"_\n\nJá existe parecido:${idRef}\n_"${existing}"_\n\nQual o caso? Responde com o **número**:\n\n1️⃣ *Mesma situação* — a existente já cobre, não preciso criar. Se quiser atualizar, use o id \`${existId}\`.\n2️⃣ *Outro caso* — crio nova com nome **explicitamente diferente** do existente (me diz o nome novo).\n3️⃣ Cancela, vou reformular.`;
    }
    case 'dup_event':
      return `Achei um compromisso parecido já criado:\n_"${existing}"_\n\nQual o caso? Responde com o **número**:\n\n1️⃣ É o *mesmo compromisso* — atualizo o existente\n2️⃣ É *outro compromisso* — crio novo\n3️⃣ Cancela, vou reformular`;
    case 'temporal_hard': {
      const overlap = first.overlapMin ? ` (sobrepõe ${first.overlapMin}min)` : '';
      return `Tem um conflito de horário/local com _"${existing}"_${overlap}. Não dá pra criar como está.\n\nQuer ajustar horário ou local de "${cand}"? Ou cancelar o existente?`;
    }
    case 'temporal_soft': {
      const overlap = first.overlapMin ? ` (~${first.overlapMin}min)` : '';
      return `Tem um cruzamento leve com _"${existing}"_${overlap}. Crio assim mesmo, ou prefere ajustar?`;
    }
    default:
      return `Encontrei algo que pode conflitar com _"${cand}"_. Quer que eu siga ou prefere revisar?`;
  }
}

// Sprint 16 — Executa coordination request: gating de autorização, INSERT, WhatsApp.
//
// REGRA DE INSERÇÃO (Alf 2026-05-03):
//   NÃO inserir row em coordination_requests quando:
//     - recipient não encontrado
//     - recipient inativo
//     - self-relay
//   Auditoria fica em marker_logs.
//
//   INSERIR row com status='rejected_by_tom' quando:
//     - recipient existe E é ativo E é diferente do requester
//     - alçada bloqueou (role_insufficient, cannot_followup_director)
async function applyCoordinationRequestAction(collab, parsed) {
  // 1. Lookup recipient — sem row se falhar
  const recipient = await findCollaboratorByName(parsed.recipient_name);
  if (!recipient || !recipient.is_active) {
    return {
      ok: false,
      reason: 'recipient_not_found',
      replyText: `Não encontrei ninguém com o nome "${parsed.recipient_name}" ativo no sistema.`,
    };
  }

  // 2. Self-relay — sem row
  if (recipient.id === collab.id) {
    return {
      ok: false,
      reason: 'self_relay',
      replyText: 'Você quer mandar uma mensagem pra si mesmo? Isso não faz sentido — fala diretamente 😄',
    };
  }

  const recipientFirstName = (recipient.full_name || '').split(' ')[0];

  // Sprint 19 — Gate pedagógico tem PRECEDÊNCIA sobre o gate genérico Sprint 16.
  // DENY pedagógico = DENY final. Gate genérico não pode reautorizar acima dele.
  // Reusa `recipient` resolvido em (1) acima.
  if (parsed.mode === 'followup') {
    const isPedContext = !!getPedagogicalRole(collab) || !!getPedagogicalRole(recipient);
    if (isPedContext) {
      const ok = await canDelegatePedagogical(collab, recipient);
      if (!ok) {
        await supabase.from('coordination_requests').insert({
          requester_id: collab.id,
          recipient_id: recipient.id,
          mode: parsed.mode,
          message_body: parsed.message_body,
          message_original: parsed.message_original,
          status: 'rejected_by_tom',
          expects_response: parsed.expects_response,
          cancelled_reason: 'pedagogical_authority_denied',
        });
        // Sprint 20 — mensagem custom para manager (gerente) sugerindo relay como alternativa.
        // PRD §13: critério de fracasso é gerente bloqueado SEM ORIENTAÇÃO. Damos a saída clara.
        let replyText = 'Esse tipo de cobrança precisa vir de quem tem alçada pedagógica para isso. Posso te ajudar a formular para mandar pra Juliana ou Quintela?';
        if (collab.role === 'manager') {
          const assistente = await findAssistantByUnit(collab.unit);
          const assistName = assistente ? (assistente.full_name || '').split(' ')[0] : 'o assistente da unidade';
          replyText = `Como gerente, você não cobra (followup) o pedagógico — você encaminha (relay).\n\nQuer que eu mande como recado para *${assistName}* (assistente pedagógico da sua unidade) ou direto para *Juliana* (LA Music School) ou *Quintela* (LA Music Kids)?`;
        }
        return {
          ok: false,
          reason: 'pedagogical_authority_denied',
          replyText,
        };
      }
    }
  }

  // 3. Followup bloqueado para collaborator (PRD §8.3)
  if (parsed.mode === 'followup' && collab.role === 'collaborator') {
    await supabase.from('coordination_requests').insert({
      requester_id: collab.id,
      recipient_id: recipient.id,
      mode: parsed.mode,
      message_body: parsed.message_body,
      message_original: parsed.message_original,
      status: 'rejected_by_tom',
      expects_response: parsed.expects_response,
      cancelled_reason: 'role_insufficient',
    });
    return {
      ok: false,
      reason: 'role_insufficient',
      replyText: `Não vou cobrar o ${recipientFirstName} por você. Esse tipo de cobrança precisa vir do coordenador ou diretor. Quer que eu te ajude a formular para mandar pro teu coordenador?`,
    };
  }

  // 4. Followup bloqueado coord/manager → director
  if (
    parsed.mode === 'followup' &&
    ['coordinator', 'manager'].includes(collab.role) &&
    recipient.role === 'director'
  ) {
    await supabase.from('coordination_requests').insert({
      requester_id: collab.id,
      recipient_id: recipient.id,
      mode: parsed.mode,
      message_body: parsed.message_body,
      message_original: parsed.message_original,
      status: 'rejected_by_tom',
      expects_response: parsed.expects_response,
      cancelled_reason: 'cannot_followup_director',
    });
    return {
      ok: false,
      reason: 'cannot_followup_director',
      replyText: `Não é minha função cobrar o ${recipientFirstName} por você — ele/ela é diretor/a. Você pode falar diretamente ou me pedir pra repassar um recado (relay).`,
    };
  }

  // Sprint 17 F4 — Defense-in-depth: strip de cabeçalho de origem duplicado.
  // A skill já é instruída a não incluir prefixo (Sprint 16 484d708), mas
  // se TOM falhar, este strip remove para evitar duplicação ao recipient.
  // ATENÇÃO: regex pode morder texto legítimo — logar toda execução que remova chars.
  {
    const STRIP_PATTERNS = [
      /^\s*(O\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÜ][\w\s\(\)\/\.]{0,40}(pediu|me pediu|disse|mandou)[^\n]{0,40}:\s*/i,
      /^\s*Alf\s+pediu[^\n]{0,30}:\s*/i,
    ];
    const bodyOriginal = parsed.message_body;
    let bodyClean = bodyOriginal;
    for (const p of STRIP_PATTERNS) {
      bodyClean = bodyClean.replace(p, '');
    }
    bodyClean = bodyClean.trim();
    if (bodyClean !== bodyOriginal) {
      console.warn(`[CoordinationRequest] HEADER_STRIP applied: "${bodyOriginal.slice(0, 60)}..." → "${bodyClean.slice(0, 60)}..."`);
      parsed.message_body = bodyClean;
    }
  }

  // 5. Calcular response_deadline
  let response_deadline = null;
  if (parsed.expects_response && parsed.response_deadline_hours) {
    response_deadline = new Date(
      Date.now() + parsed.response_deadline_hours * 60 * 60 * 1000
    ).toISOString();
  }

  // 5.5. Dedup defensivo (hotfix pós-Sprint20).
  // Bug observado: Rafinha mandou "Tom pergunta ao Alf...", TOM emitiu relay.
  // Rafinha respondeu "Ok" (confirmando) e TOM emitiu SEGUNDO relay com o
  // mesmo conteúdo — Alf recebeu duplicado. Skill ensina não re-emitir mas
  // engine reforça: se há coord_request similar nos últimos 90s
  // (mesmo requester+recipient+mode, body similar via jaroWinkler), rejeita.
  try {
    const dedupCutoff = new Date(Date.now() - 90 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('coordination_requests')
      .select('id, message_body, status, created_at')
      .eq('requester_id', collab.id)
      .eq('recipient_id', recipient.id)
      .eq('mode', parsed.mode)
      .gte('created_at', dedupCutoff)
      .in('status', ['pending', 'sent', 'responded'])
      .order('created_at', { ascending: false })
      .limit(3);
    if (recent && recent.length) {
      // Threshold conservador: 0.75 jaroWinkler em normalizeForSim já indica
      // mesma demanda parafraseada. Title strip do suffix não se aplica aqui
      // (não há separador de unidade típico em message_body de relay).
      const candNorm = normalizeForSim(parsed.message_body || '');
      for (const prev of recent) {
        const score = jaroWinkler(candNorm, normalizeForSim(prev.message_body || ''));
        if (score >= 0.75) {
          console.warn(`[CoordinationRequest] DEDUP_BLOCK score=${score.toFixed(2)} prev=${prev.id.slice(0,8)} (${prev.status}) — skipping duplicate from ${String(collab.phone).slice(-4)}→${String(recipient.phone).slice(-4)}`);
          return {
            ok: true, // não é falha do user — é proteção silenciosa
            reason: 'dedup_recent_relay',
            replyText: 'Combinado! Já mandei pro destinatário há pouco — vou esperar a resposta antes de mandar de novo.',
          };
        }
      }
    }
  } catch (dedupErr) {
    console.warn('[CoordinationRequest] dedup check err (non-fatal):', dedupErr.message);
  }

  // 6. INSERT pending
  const { data: inserted, error: insErr } = await supabase
    .from('coordination_requests')
    .insert({
      requester_id:           collab.id,
      recipient_id:           recipient.id,
      mode:                   parsed.mode,
      message_body:           parsed.message_body,
      message_original:       parsed.message_original,
      status:                 'pending',
      expects_response:       parsed.expects_response,
      response_deadline,
    })
    .select('id')
    .single();

  if (insErr) {
    console.error('[CoordinationRequest] insert err:', insErr.message);
    return { ok: false, reason: 'db_insert_error', replyText: 'Tive um erro ao registrar o recado. Tenta de novo?' };
  }

  // 7. Enviar WhatsApp ao recipient (UX §6)

  // Sprint 17 — defense-in-depth: strip de prefixo de origem no message_body.
  // Garante que o engine não dobre o cabeçalho mesmo que a skill falhe na REGRA CRÍTICA.
  const STRIP_HEADER_PATTERNS = [
    /^\s*o\s+[\wÀ-ú]+(?:\s+[\wÀ-ú]+)?\s*(?:\([^)]{0,40}\))?\s*(?:pediu|me pediu|disse|mandou|pediu pra mim).{0,40}:\s*/i,
    /^\s*alf(?:redo)?\s+pediu.{0,40}:\s*/i,
    /^\s*(?:o\s+)?requester\s+pediu.{0,40}:\s*/i,
  ];
  let _sanitizedBody = parsed.message_body;
  let _stripped = false;
  for (const pattern of STRIP_HEADER_PATTERNS) {
    const _before = _sanitizedBody;
    _sanitizedBody = _sanitizedBody.replace(pattern, '').trim();
    if (_sanitizedBody !== _before) {
      _stripped = true;
      console.warn(`[CoordinationRequest] strip cabeçalho duplicado detectado em req ${inserted?.id?.slice(0, 8) ?? 'unknown'}`);
    }
  }
  // Se strip ocorreu mas body ficou vazio (edge case: body era só o cabeçalho), preservar original
  if (_stripped && _sanitizedBody.length === 0) {
    console.error(`[CoordinationRequest] strip resultou em body vazio — mantendo original`);
    _stripped = false;
  }
  const finalBody = _stripped ? _sanitizedBody : parsed.message_body;

  const requesterDisplayName = _requesterDisplayName(collab);
  let recipientMsg = _buildRecipientMessage(requesterDisplayName, parsed.mode, finalBody);

  // Hotfix pós-Sprint20 — Self-introduction unificada via helper.
  // Antes: duplicado aqui e ausente em applyTaskActions delegate (Krissya recebeu spam).
  // Agora: helper único com cadência (full/half/short) — Q2.
  const introPrefix = await buildSelfIntroPrefix(recipient);
  if (introPrefix) recipientMsg = introPrefix + recipientMsg;

  try {
    await whatsapp.sendMessage(recipient.phone, recipientMsg);
    await logConversation(recipient.id, 'outbound', recipientMsg);
  } catch (sendErr) {
    console.error('[CoordinationRequest] sendMessage err:', sendErr.message);
    await supabase.from('coordination_requests')
      .update({ status: 'cancelled', cancelled_reason: 'send_failed', cancelled_at: new Date().toISOString() })
      .eq('id', inserted.id);
    return { ok: false, reason: 'send_failed', replyText: 'Não consegui enviar a mensagem pro WhatsApp do destinatário. Tenta de novo?' };
  }

  // 8. UPDATE → sent
  await supabase.from('coordination_requests')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', inserted.id);

  // 9. Reply ao requester
  const shortId = inserted.id.slice(0, 4);
  const expectsNote = parsed.expects_response ? ' Te aviso quando ele/ela responder.' : '';
  return {
    ok: true,
    reason: `sent=${shortId} recipient=${recipientFirstName}`,
    replyText: `✓ Avisei o ${recipientFirstName}. [ID: ${shortId}]${expectsNote}`,
  };
}

// Resolve project_id por nome quando o TOM só passou project_name. Match fuzzy
// (case-insensitive, ignora acentos) na lista de projetos do collab.
async function resolveProjectByName(collaboratorId, projectName) {
  if (!projectName || typeof projectName !== 'string') return null;
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const target = norm(projectName);
  // Pega projetos do user (membro OU criador) status active/planning.
  const { data: created } = await supabase
    .from('projects')
    .select('id, name, status, created_by')
    .eq('created_by', collaboratorId)
    .in('status', ['active', 'planning', 'pending_approval']);
  const { data: memberRows } = await supabase
    .from('project_members')
    .select('project_id, projects(id, name, status)')
    .eq('collaborator_id', collaboratorId);
  const fromMembership = (memberRows || [])
    .map(r => r.projects)
    .filter(p => p && ['active', 'planning', 'pending_approval'].includes(p.status));
  const all = [...(created || []), ...fromMembership];
  // Dedupe by id
  const seen = new Set();
  const projects = [];
  for (const p of all) {
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    projects.push(p);
  }
  // Match: substring exata primeiro, depois starts-with, depois contém
  const exact = projects.find(p => norm(p.name) === target);
  if (exact) return exact;
  const startsWith = projects.find(p => norm(p.name).startsWith(target));
  if (startsWith) return startsWith;
  const contains = projects.find(p => norm(p.name).includes(target));
  return contains || null;
}

async function applyCheckpointBatch(collaborator, parsed) {
  const last4 = String(collaborator.phone || '').slice(-4);
  // 1) Resolve project_id (preferir id direto; fallback fuzzy por nome)
  let projectId = parsed.project_id;
  let projectName = parsed.project_name;
  if (!projectId && projectName) {
    const proj = await resolveProjectByName(collaborator.id, projectName);
    if (proj) {
      projectId = proj.id;
      projectName = proj.name;
    }
  }
  if (!projectId) {
    console.warn(`[CheckpointBatch] project not resolved (name="${projectName}") collab=${last4}`);
    return { okCount: 0, failCount: parsed.items.length, projectId: null, projectName, reason: 'project_not_found' };
  }

  // 2) Confirma membership / authorship pra evitar inserir em projeto alheio.
  const { data: proj } = await supabase
    .from('projects')
    .select('id, name, created_by')
    .eq('id', projectId).maybeSingle();
  if (!proj) {
    return { okCount: 0, failCount: parsed.items.length, projectId, projectName, reason: 'project_not_exists' };
  }
  projectName = proj.name;
  let isMember = proj.created_by === collaborator.id;
  if (!isMember) {
    const { data: mb } = await supabase
      .from('project_members')
      .select('id').eq('project_id', projectId).eq('collaborator_id', collaborator.id).maybeSingle();
    isMember = Boolean(mb);
  }
  if (!isMember && !['coordinator', 'director'].includes(collaborator.role)) {
    console.warn(`[CheckpointBatch] blocked — collab ${last4} not member/owner of ${projectId.slice(0,8)} and not coord/dir`);
    return { okCount: 0, failCount: parsed.items.length, projectId, projectName, reason: 'permission_denied' };
  }

  // 3) Calcula sort_order base (após o maior atual).
  const { data: existing } = await supabase
    .from('project_checkpoints')
    .select('sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: false })
    .limit(1);
  let nextSort = (existing && existing[0]?.sort_order != null ? existing[0].sort_order : -1) + 1;

  // 4) Insere todos. Falha individual não derruba o batch.
  let okCount = 0, failCount = 0;
  const insertedIds = [];
  for (const it of parsed.items) {
    const row = {
      project_id: projectId,
      name: it.name.trim().slice(0, 200),
      description: typeof it.description === 'string' ? it.description.slice(0, 1000) : null,
      due_date: typeof it.due_date === 'string' ? it.due_date : null,
      status: 'pending',
      sort_order: nextSort++,
    };
    const { data, error } = await supabase
      .from('project_checkpoints')
      .insert(row)
      .select('id')
      .single();
    if (error) {
      console.error('[CheckpointBatch] insert err:', error.message);
      failCount++;
    } else {
      okCount++;
      if (data?.id) insertedIds.push(data.id);
    }
  }
  console.log(`[CheckpointBatch] project=${projectName?.slice(0,40)} ${okCount} ok, ${failCount} fail (collab ${last4})`);
  return { okCount, failCount, projectId, projectName, insertedIds, reason: null };
}

// Sprint 22.26 — Lookup de categoria de evento por slug. Procura em ordem:
// 1) categoria pessoal do collaborador (se tiver)
// 2) categoria global system (collaborator_id IS NULL, is_system=true)
// Retorna { id, slug, label, context } ou null.
async function lookupEventCategoryBySlug(slug, collaboratorId) {
  if (!slug || !collaboratorId) return null;
  // Tenta pessoal primeiro (user pode ter "academia", "medico", etc).
  const { data: personal } = await supabase
    .from('event_categories')
    .select('id, slug, label, context')
    .eq('collaborator_id', collaboratorId)
    .eq('slug', slug)
    .maybeSingle();
  if (personal) return personal;
  // Fallback: categoria global system.
  const { data: global } = await supabase
    .from('event_categories')
    .select('id, slug, label, context')
    .is('collaborator_id', null)
    .eq('slug', slug)
    .eq('is_system', true)
    .maybeSingle();
  return global ?? null;
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
  // Sprint 22.26 — categorias agora vivem em event_categories (DB). TOM aceita
  // qualquer slug; validacao de existencia (system OU pessoal do user) acontece
  // no lookupCategoryId logo antes do INSERT.
  if (typeof e.category !== 'string' || !e.category.trim()) return 'category:invalid';
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
  const droppedItems = []; // Sprint 22.34b — preserva items invalidos pra fallback (habit redirect)
  for (let i = 0; i < items.length; i++) {
    const why = validateEventItem(items[i]);
    if (why) {
      dropped.push(`item[${i}]:${why}`);
      droppedItems.push(items[i]);
    } else {
      valid.push(items[i]);
    }
  }
  if (dropped.length) logSchemaErr('EVENT_CREATE', dropped, parsed);
  if (!valid.length) return { malformed: true, cleanText, droppedItems };
  return { events: valid, cleanText, malformed: false, droppedItems };
}

async function applyEventActions(collaborator, events) {
  let okCount = 0, failCount = 0;
  let integrityPayload = null;
  const last4 = String(collaborator.phone || '').slice(-4);
  // Sprint 22.34b — Habit redirect (titles que batem habito ativo do user)
  // acontece no caller, ANTES de chegar aqui. Aqui só processa events reais.
  for (const e of events) {
    try {
      // Sprint 18 — pre-check de integridade (fail-open: erros nos detectores não bloqueiam)
      let temporalResult = { hardConflicts: [], softConflicts: [] };
      let dupResult      = { probable: [], possible: [] };
      try {
        [temporalResult, dupResult] = await Promise.all([
          detectTemporalConflict(collaborator, e),
          detectDuplicateSemanticEvent(collaborator, e),
        ]);
      } catch (detErr) {
        console.warn('[IntegrityCheck] event detectors err (non-fatal):', detErr.message);
      }

      // HARD conflict (A2: bloqueia até confirmação explícita, 1 rodada)
      if (temporalResult.hardConflicts.length > 0) {
        const c = temporalResult.hardConflicts[0];
        const startStr = new Date(c.start_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
        const endStr   = new Date(c.end_at).toLocaleTimeString('pt-BR',   { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
        console.warn(`[IntegrityCheck] HARD temporal conflict for "${String(e.title).slice(0,40)}" — overlaps "${String(c.title).slice(0,40)}" ${startStr}–${endStr} (${c.reason})`);
        integrityPayload = {
          severity: 'hard',
          type: 'temporal_hard',
          conflicts: temporalResult.hardConflicts.slice(0, 2).map(x => ({ id: x.id, title: x.title, start_at: x.start_at, end_at: x.end_at, overlapMin: x.overlapMin, reason: x.reason })),
          candidateTitle: e.title,
        };
        failCount++;
        continue;
      }

      // A1: DUP semântico provável — NUNCA bloqueia auto; retorna suspect-payload para skill decidir
      if (dupResult.probable.length > 0) {
        const d = dupResult.probable[0];
        console.warn(`[IntegrityCheck] DUP_EVENT score=${d._score.toFixed(2)} "${String(e.title).slice(0,40)}" ~ "${String(d.title).slice(0,40)}"`);
        integrityPayload = {
          severity: 'soft',
          type: 'dup_event',
          conflicts: dupResult.probable.slice(0, 3).map(x => ({ id: x.id, title: x.title, start_at: x.start_at, end_at: x.end_at, _score: x._score })),
          candidateTitle: e.title,
        };
        failCount++;
        continue;
      }

      // A2: SOFT temporal — NÃO cria silenciosamente; microconfirm via skill
      if (temporalResult.softConflicts.length > 0) {
        const c = temporalResult.softConflicts[0];
        console.log(`[IntegrityCheck] SOFT temporal conflict "${String(e.title).slice(0,40)}" ~ "${String(c.title).slice(0,40)}" overlap=${c.overlapMin}min (${c.reason})`);
        integrityPayload = {
          severity: 'soft',
          type: 'temporal_soft',
          conflicts: temporalResult.softConflicts.slice(0, 2).map(x => ({ id: x.id, title: x.title, start_at: x.start_at, end_at: x.end_at, overlapMin: x.overlapMin, reason: x.reason })),
          candidateTitle: e.title,
        };
        failCount++;
        continue;
      }

      // Sprint 22.26 — lookup category_id do slug. Procura em system (global)
      // primeiro, depois nas pessoais do user. Falha se nao achar.
      const catRow = await lookupEventCategoryBySlug(e.category, collaborator.id);
      if (!catRow) {
        console.error(`[Event] category slug not found: "${e.category}" (collab ${collaborator.id})`);
        failCount++;
        continue;
      }
      // Context derivado da categoria (work/personal). e.context override permitido.
      const ctx = e.context || catRow.context;
      const row = {
        title: e.title.trim().slice(0, 200),
        description: typeof e.description === 'string' ? e.description.slice(0, 1000) : null,
        collaborator_id: collaborator.id,
        created_by: collaborator.id,
        context: ctx,
        category: e.category,         // mantido temporariamente p/ conflict detection legado
        category_id: catRow.id,        // FK pra event_categories — fonte de verdade
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
      // Sprint 22.50b — TOM pode passar reminders_minutes_before:[15, 60, 1440]
      // ou reminders:[ISO,...] pra criar lembretes vinculados.
      try {
        const eventId = data && data.id;
        if (eventId) {
          const reminderRows = [];
          if (Array.isArray(e.reminders_minutes_before)) {
            for (const m of e.reminders_minutes_before) {
              const mins = Number(m);
              if (!Number.isFinite(mins) || mins < 0 || mins > 60 * 24 * 30) continue;
              const t = new Date(new Date(e.start_at).getTime() - mins * 60_000).toISOString();
              reminderRows.push({ event_id: eventId, remind_at: t });
            }
          }
          if (Array.isArray(e.reminders)) {
            for (const iso of e.reminders) {
              if (typeof iso !== 'string' || !ISO_DATETIME_RE.test(iso)) continue;
              reminderRows.push({ event_id: eventId, remind_at: iso });
            }
          }
          if (reminderRows.length > 0) {
            const { error: rErr } = await supabase.from('event_reminders').insert(reminderRows);
            if (rErr) console.error('[Event] reminders err:', rErr.message);
            else console.log(`[Event] +${reminderRows.length} reminder(s) for event ${String(eventId).slice(0,8)}`);
          }
        }
      } catch (rErr) {
        console.warn('[Event] reminders attach failed:', rErr.message);
      }
      okCount++;
    } catch (err) {
      console.error('[Event] throw err:', err.message);
      failCount++;
    }
  }
  return { okCount, failCount, integrityPayload };
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
  // Sprint 11.2 hotfix — Tolerância a aliases comuns que o Claude tende a inventar.
  // Bug observado (29/04 14:43): TOM emitiu reschedule com `task_id`+`due_date`+`remind_at`
  // em vez de `id`+`new_due_date`+`new_remind_at`. Engine rejeitou por bad_id e a task
  // ficou em data/hora antiga (criação inicial chutada). Normalização defensiva aqui
  // sem precisar refinar prompt — se o Claude variar o naming, a gente acolhe.
  if (a && typeof a === 'object') {
    if (typeof a.task_id === 'string' && !a.id) a.id = a.task_id;
    if (typeof a.due_date === 'string' && !a.new_due_date && a.action === 'reschedule') {
      a.new_due_date = a.due_date;
    }
    if (typeof a.remind_at === 'string' && !a.new_remind_at && a.action === 'reschedule') {
      a.new_remind_at = a.remind_at;
    }
  }
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
    // Sprint 12 Bloco D — action_type opcional, mas se presente DEVE estar no enum.
    if (a.action_type !== undefined && a.action_type !== null) {
      if (typeof a.action_type !== 'string' || !VALID_ACTION_TYPES.includes(a.action_type)) {
        return 'bad_action_type';
      }
    }
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
// Sprint 12 Bloco D — categoria de execução decidida pela skill priorizacao-inteligente.
// NULL é permitido (legacy / manual / sem classificação). Schema DB tem CHECK matching.
const VALID_ACTION_TYPES = ['now', 'task', 'call', 'meeting', 'delegate', 'project'];
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
    // Hotfix pós-Sprint20: incluir onboarding_completed + unit + pedagogical_role
    // para que helpers downstream (buildSelfIntroPrefix, gates, findAssistantByUnit)
    // possam ler esses campos sem precisar fazer query adicional.
    .select('id, full_name, phone, is_active, role, unit, onboarding_completed, pedagogical_role')
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
    // Hotfix pós-Sprint20: idem findCollaboratorByName — campos completos.
    .select('id, full_name, phone, is_active, role, unit, onboarding_completed, pedagogical_role')
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

// ============================================================
// Sprint 19 — Camada Pedagógica: helpers de papel e alçada
// ============================================================

function getPedagogicalRole(collab) {
  return collab && collab.pedagogical_role ? collab.pedagogical_role : null;
}

// Helper de APOIO/LOOKUP — não automação opaca.
// A skill resolve assigned_to por nome quando possível; este helper só entra
// quando a skill marca apenas {subdomain|unit|specialty} sem assignee, ou
// para validação interna de escopo.
async function findPedagogicalAssignee({ subdomain, unit, specialty }) {
  const filters = [];
  if (subdomain) filters.push({ type: 'subdomain', value: subdomain });
  if (specialty) filters.push({ type: 'specialty', value: specialty });
  if (unit)      filters.push({ type: 'unit',      value: unit });
  for (const f of filters) {
    const { data } = await supabase
      .from('pedagogical_assignments')
      .select('collaborator_id')
      .eq('scope_type', f.type)
      .eq('scope_value', f.value)
      .limit(1);
    if (data && data.length) {
      const { data: c } = await supabase
        .from('collaborators').select('*').eq('id', data[0].collaborator_id).single();
      if (c) return c;
    }
  }
  return null;
}

// ============================================================
// Sprint 20 — Camada de Gerência: helper de unidade
// ============================================================

// Mapeamento collaborators.unit (snake_case lowercase) → pedagogical_assignments.scope_value (Title Case).
// Necessário porque Sprint 19 usou Title Case em pedagogical_assignments mas a coluna `unit`
// no banco é snake_case lowercased (CHECK constraint).
const UNIT_DB_TO_PEDAG_SCOPE = {
  'campo_grande': 'Campo Grande',
  'recreio':      'Recreio',
  'barra':        'Barra',
};

// Hotfix pós-Sprint20 — Self-introduction unificada com 4 níveis de cadência (Q2).
// Sprint 19 R3 aplicou self-intro só em relay. Hotfix ef72a20 unificou em todo outbound.
// Q2 (2026-05-05): cadência refinada para não soar repetitivo nem brutal.
//
// Lógica de cadência (computada via conversation_history em runtime, sem migration):
//   - Nunca recebeu mensagem do TOM (ou onboarding_completed=false E sem outbound) → FULL INTRO
//   - Última outbound 30+ dias → FULL INTRO (re-apresentação)
//   - Última outbound 7+ dias → MEIO INTRO ("Oi X! TOM aqui de novo.")
//   - Última outbound mesmo dia BRT → CUMPRIMENTO CURTO ("Oi X 👋")
//   - Última outbound 1-6 dias → CUMPRIMENTO CURTO
//
// Decisão D2 (PO ratificado): onboarding_completed=false continua sendo gatilho da intro
// completa enquanto recipient não passou pelo fluxo de 5 perguntas. Quando passar, cai na
// cadência refinada (mesmo dia → curto, 7+ dias → meio).
async function buildSelfIntroPrefix(recipient) {
  if (!recipient) return '';
  const firstName = (recipient.full_name || '').split(' ')[0] || 'oi';

  const FULL = `Oi, ${firstName}! Aqui é o *TOM*, organizador da LA Music. Vou te ajudar a manter o time alinhado pelo WhatsApp — é só me chamar quando precisar atualizar tarefa, pedir pra encaminhar recado, ou abrir nova demanda.\n\n`;
  const HALF = `Oi, ${firstName}! TOM aqui de novo (organizador da LA Music). Faz um tempo a gente não falou — qualquer coisa, é só chamar.\n\n`;
  const SHORT = `Oi, ${firstName} 👋\n\n`;

  // Busca última outbound em conversation_history.
  let lastOutboundAt = null;
  try {
    const { data } = await supabase
      .from('conversation_history')
      .select('created_at')
      .eq('collaborator_id', recipient.id)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(1);
    if (data && data.length) lastOutboundAt = new Date(data[0].created_at);
  } catch (_e) { /* fallback silencioso */ }

  // Caso 1: nunca recebeu nada do TOM.
  if (!lastOutboundAt) return FULL;

  const now = Date.now();
  const ageMs = now - lastOutboundAt.getTime();
  const day = 24 * 3600 * 1000;
  const ageDays = ageMs / day;

  // Caso 2: 30+ dias → re-apresentação completa.
  if (ageDays >= 30) return FULL;

  // Caso 3: onboarding ainda incompleto + última outbound foi há mais de 7 dias → re-apresentação.
  // (D2: enquanto onboarding_completed=false, mantém intro robusta.)
  if (recipient.onboarding_completed === false && ageDays >= 7) return FULL;

  // Caso 4: 7-29 dias → meio-cumprimento.
  if (ageDays >= 7) return HALF;

  // Caso 5: 1-6 dias OU mesmo dia → cumprimento curto.
  return SHORT;
}

// Hotfix pós-Sprint20 — Sugestões de próximos passos por request_type slug.
// Decisão D1 (PO 2026-05-05): hardcoded primeiro. Se piloto comprovar, vira coluna em Sprint 22.
// Inclui pedagogico + gerencia + operacoes-tecnicas + um fallback genérico.
const SUGGESTED_NEXT_STEPS = {
  // Gerência (Sprint 20)
  'risco-de-evasao': [
    'Conversar diretamente com o aluno e a família',
    'Alinhar com o assistente pedagógico da unidade sobre acompanhamento',
    'Se for caso pedagógico misto, eu encaminho via recado para Juliana/Quintela',
  ],
  'recuperacao-de-aluno': [
    'Mapear a última interação que o aluno teve',
    'Definir abordagem (telefone, presencial, e-mail)',
    'Se precisar apoio pedagógico, peça pra eu encaminhar',
  ],
  'alinhamento-com-responsavel': [
    'Decidir o canal (telefone, presencial)',
    'Preparar tópicos a abordar com o responsável',
    'Registrar o resultado do contato comigo depois',
  ],
  'problema-de-atendimento': [
    'Ouvir a parte envolvida e entender o problema',
    'Articular com recepção/secretaria se precisar',
    'Devolver pro Alf se virar tema estratégico',
  ],
  'experiencia-da-unidade': [
    'Conversar com o aluno/responsável sobre a percepção',
    'Verificar se há ajustes operacionais necessários',
    'Articular com pedagógico se for tema de aprendizado',
  ],
  'negociacao-relacional': [
    'Estruturar a conversa antes (objetivo, alternativas, limite)',
    'Considerar opções como congelamento ou condição especial',
    'Registrar o desfecho comigo',
  ],
  'pendencia-gerencial': [
    'Avaliar se cabe um tipo mais específico (risco-evasao, atendimento, articulação)',
    'Definir responsável e prazo',
  ],
  'articulacao-interna': [
    'Listar as áreas envolvidas e o que cada uma precisa fazer',
    'Eu posso encaminhar recados para cada área via relay',
    'Acompanhar até todas darem retorno',
  ],
  // Pedagógico (Sprint 19)
  'acompanhamento-professor': [
    'Conversar com o professor sobre o ponto observado',
    'Definir plano de melhoria (próxima visita à aula, mentoring)',
    'Registrar evolução comigo',
  ],
  'apoio-ao-aluno': [
    'Avaliar dificuldade pedagógica do aluno',
    'Alinhar com professor sobre adaptações de trilha',
    'Conversar com responsável se necessário',
  ],
  'alinhamento-de-turma': [
    'Mapear opções de encaixe',
    'Falar com professor envolvido',
    'Confirmar com responsável e operacionalizar troca',
  ],
  'evento-pedagogico': [
    'Definir cronograma e responsáveis',
    'Alinhar com unidade(s) envolvida(s)',
    'Comunicar pais/alunos no momento certo',
  ],
  'pendencia-pedagogica': [
    'Avaliar se cabe tipo mais específico',
    'Definir responsável e prazo',
  ],
  'suporte-ao-professor': [
    'Verificar disponibilidade do material/recurso',
    'Operacionalizar via Rafinha se for material físico',
    'Confirmar com o professor quando resolver',
  ],
  // Operações Técnicas (Sprint 15)
  'incidente-tecnico': [
    'Avaliar urgência (impacta aula agora?)',
    'Mobilizar Rafinha ou técnico responsável',
    'Comunicar professor/coordenação se afetar aulas',
  ],
  'reposicao-estoque': [
    'Verificar saldo atual',
    'Pedir orçamento e aprovação se valor relevante',
    'Confirmar entrega e dar baixa',
  ],
};

function getSuggestedNextSteps(requestTypeSlug) {
  if (!requestTypeSlug) return null;
  return SUGGESTED_NEXT_STEPS[requestTypeSlug] || null;
}

// Resolve o assistente pedagógico da unidade do gerente.
// Usado quando o gate pedagógico nega followup de manager — TOM oferece relay
// para o assistente da unidade do gerente (em vez de cobrança).
async function findAssistantByUnit(unitDb) {
  const scope = UNIT_DB_TO_PEDAG_SCOPE[unitDb];
  if (!scope) return null;
  const { data } = await supabase
    .from('pedagogical_assignments')
    .select('collaborator_id')
    .eq('scope_type', 'unit')
    .eq('scope_value', scope)
    .limit(1);
  if (!data || !data.length) return null;
  const { data: c } = await supabase
    .from('collaborators').select('*').eq('id', data[0].collaborator_id).single();
  return c || null;
}

async function scopeOverlap(idA, idB) {
  const { data: aSc } = await supabase
    .from('pedagogical_assignments')
    .select('scope_type, scope_value').eq('collaborator_id', idA);
  const { data: bSc } = await supabase
    .from('pedagogical_assignments')
    .select('scope_type, scope_value').eq('collaborator_id', idB);
  if (!aSc || !aSc.length || !bSc || !bSc.length) return false;
  return aSc.some(x => bSc.some(y => x.scope_type === y.scope_type && x.scope_value === y.scope_value));
}

// REGRA DE PRECEDÊNCIA: se este helper retornar false em contexto pedagógico,
// o gate genérico (Sprint 16) NÃO pode autorizar acima dele. DENY = final.
async function canDelegatePedagogical(requester, target) {
  if (!requester || !target) return false;
  const rRole = requester.role;
  const rPed  = getPedagogicalRole(requester);
  const tPed  = getPedagogicalRole(target);

  if (rRole === 'director' || rRole === 'coordinator') return true;
  if (rPed === 'mentor') return false;
  if (rPed === 'lead')   return true;
  if (rPed === 'assistant') {
    if (!tPed) return false;
    if (tPed === 'lead' || tPed === 'mentor') return false;
    if (tPed === 'assistant') return await scopeOverlap(requester.id, target.id);
  }
  return false;
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
        // Sprint 11.2 hotfix — reschedule também aplica new_remind_at quando presente.
        // Bug observado: TOM disse "amanhã 12h" mas só due_date era atualizado, mantendo
        // remind_at antigo (criação inicial). Resultado: PWA mostrava horário velho.
        if (typeof a.new_remind_at === 'string' && isValidRemindAt(a.new_remind_at)) {
          update.remind_at = a.new_remind_at;
        }
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
          const sufx = update.remind_at ? ` remind_at=${update.remind_at}` : '';
          console.log(`[Task] reschedule ${a.id} to ${a.new_due_date}${sufx}`);
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
        // Sprint 15 F2 — operational layer fields (department_id, request_type_id)
        const UUID_RE_TASK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let departmentId = (typeof a.department_id === 'string' && UUID_RE_TASK.test(a.department_id))
          ? a.department_id
          : null;
        const requestTypeId = (typeof a.request_type_id === 'string' && UUID_RE_TASK.test(a.request_type_id))
          ? a.request_type_id
          : null;
        let initialStatus = 'pending';

        // If request_type provided: validate it exists, derive department_id if absent, check requires_approval
        if (requestTypeId) {
          const { data: rt } = await supabase
            .from('department_request_types')
            .select('department_id, requires_approval, is_active')
            .eq('id', requestTypeId)
            .maybeSingle();
          if (!rt || !rt.is_active) {
            console.warn(`[Task] create REJECTED — invalid request_type_id=${requestTypeId.slice(0,8)}`);
            failCount++;
            continue;
          }
          if (departmentId && rt.department_id !== departmentId) {
            console.warn(`[Task] create REJECTED — request_type_id does not belong to provided department_id`);
            failCount++;
            continue;
          }
          if (!departmentId) departmentId = rt.department_id;
          if (rt.requires_approval) initialStatus = 'awaiting_confirmation';
        }

        const context = a.context === 'personal' ? 'personal' : 'work';
        const priority = VALID_PRIORITIES.includes(a.priority) ? a.priority : 'medium';
        // Sprint 12 Bloco D — action_type vem da skill priorizacao-inteligente.
        // Quando ausente/inválido fica NULL (TaskRow no PWA mostra sem badge).
        const actionType = (typeof a.action_type === 'string' && VALID_ACTION_TYPES.includes(a.action_type))
          ? a.action_type
          : null;
        const insertRow = {
          title: a.title.trim().slice(0, 200),
          assigned_to: assignedTo,
          created_by: collaborator.id,
          source: 'manual',
          status: initialStatus,
          context,
          priority,
          action_type: actionType,
        };
        // Sprint 15 F2 — optional operational layer fields
        if (typeof a.description === 'string' && a.description.trim()) {
          insertRow.description = a.description.trim().slice(0, 2000);
        }
        if (typeof a.notes === 'string' && a.notes.trim()) {
          insertRow.notes = a.notes.trim().slice(0, 2000);
        }
        if (departmentId) insertRow.department_id = departmentId;
        if (requestTypeId) insertRow.request_type_id = requestTypeId;
        // Sprint 19 — subdomain pedagógico (school/kids)
        if (a.subdomain !== undefined) {
          if (a.subdomain !== null && !['school','kids'].includes(a.subdomain)) {
            console.warn(`[Task] create REJECTED — invalid subdomain=${a.subdomain}`);
            failCount++;
            continue;
          }
          insertRow.subdomain = a.subdomain;
        }
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
        // Sprint 18 — pre-check de duplicidade semântica (A1: nunca bloqueia auto)
        // Ocorre APÓS validações de role/requestTypeId, ANTES do dedupe defensivo de 60s.
        let _taskIntegrityPayload = null;
        try {
          const _taskDupResult = await detectDuplicateSemanticTask(collaborator, {
            title: a.title,
            description: typeof a.description === 'string' ? a.description : undefined,
            assigned_to: assignedTo,
            department_id: departmentId || undefined,
            request_type_id: requestTypeId || undefined,
          });
          if (_taskDupResult.probable.length > 0) {
            const _d = _taskDupResult.probable[0];
            console.warn(`[IntegrityCheck] DUP_TASK score=${_d._score.toFixed(2)} "${a.title.trim().slice(0,40)}" ~ "${String(_d.title).slice(0,40)}" (${_d.status})`);
            // A1: retornar suspect-payload. INSERT NÃO ocorre. Skill processa no novo turno.
            _taskIntegrityPayload = {
              severity: 'soft',
              type: 'dup_task',
              conflicts: _taskDupResult.probable.slice(0, 3).map(x => ({ id: x.id, title: x.title, status: x.status, due_date: x.due_date, _score: x._score })),
              candidateTitle: a.title.trim(),
            };
          }
        } catch (_detErr) {
          console.warn('[IntegrityCheck] task dup detector err (non-fatal):', _detErr.message);
        }
        if (_taskIntegrityPayload) {
          // Não insere. Sinaliza para applyTaskActions retornar payload.
          // Usa mecanismo de objeto retornado — ver return abaixo.
          return { okCount, failCount: failCount + 1, integrityPayload: _taskIntegrityPayload };
        }

        // Sprint 11.2 hotfix — Dedupe defensivo. Bug observado: TOM emite TASK_CREATE
        // num turno exploratório ("vou criar pra 14h, ok?") e RECRIA no turno de
        // confirmação ("Ta bom" → cria de novo). Evidência: 2 rows idênticas criadas
        // em 30s (ids 9da2c73e + 6ab10e44, 14:04:02 e 14:04:32). Defesa: se title +
        // assigned_to + (remind_at|due_date) match em janela de 60s, skip silencioso.
        // Conta como okCount pra não confundir resposta do TOM. A skill atualizada
        // (priorizacao-inteligente § Regra de criação prematura) ataca a causa-raiz;
        // este dedupe é o cinto de segurança.
        try {
          const dedupeCutoff = new Date(Date.now() - 60_000).toISOString();
          const { data: dupes } = await supabase
            .from('tasks')
            .select('id, created_at, remind_at, due_date')
            .eq('assigned_to', assignedTo)
            .eq('title', insertRow.title)
            .gte('created_at', dedupeCutoff)
            .limit(3);
          const dup = (dupes || []).find(d =>
            (d.remind_at || null) === (insertRow.remind_at || null) &&
            (d.due_date || null) === (insertRow.due_date || null)
          );
          if (dup) {
            console.warn(`[Task] DEDUPE_SKIP existing=${String(dup.id).slice(0,8)} title="${insertRow.title.slice(0,40)}" (recent <60s)`);
            okCount++;
            continue;
          }
        } catch (dErr) {
          // Non-fatal: dedupe failure não pode bloquear criação. Loga e segue.
          console.error('[Task] dedupe check err (non-fatal):', dErr.message);
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
        const deptSuf = departmentId ? ` dept=${departmentId.slice(0,8)}${requestTypeId ? `/rt=${requestTypeId.slice(0,8)}` : ''}` : '';
        const apprSuf = initialStatus === 'awaiting_confirmation' ? ' AWAIT_APPROVAL' : '';
        console.log(`[Task] create "${a.title.trim().slice(0, 60)}" ctx=${context}${sufx}${forSuf}${deptSuf}${apprSuf} (id=${String(taskId || '').slice(0, 8)})`);
        // Notify recipient when created-for-other (best-effort).
        if (recipient && taskId) {
          const creatorName = nameForCollab(collaborator);
          const dueLabel = insertRow.due_date ? ` (prazo ${formatBRDate(insertRow.due_date)})` : '';

          // Hotfix pós-Sprint20: mensagem enriquecida (não mais seca).
          // Inclui: self-intro com cadência (Q2) + descrição + sugestões de próximos passos.
          const introPrefix = await buildSelfIntroPrefix(recipient);
          const description = (typeof a.description === 'string' && a.description.trim()) ? a.description.trim() : null;
          // Lookup request_type slug se task tem request_type_id setado
          let suggestionLines = null;
          if (requestTypeId) {
            try {
              const { data: rtRow } = await supabase
                .from('department_request_types')
                .select('slug').eq('id', requestTypeId).single();
              const steps = getSuggestedNextSteps(rtRow?.slug);
              if (steps && steps.length) {
                suggestionLines = steps.map(s => `• ${s}`).join('\n');
              }
            } catch (_e) { /* fallback silencioso */ }
          }
          let notifText = `${introPrefix}📋 O ${creatorName} abriu uma tarefa pra você:\n*${a.title.trim()}*${dueLabel}`;
          if (description) {
            notifText += `\n\n🧭 *Contexto:* ${description}`;
          }
          if (suggestionLines) {
            notifText += `\n\n💡 *Próximos passos sugeridos:*\n${suggestionLines}`;
          }
          // Hotfix pós-Sprint20: pergunta de TRATAMENTO (mini-Eisenhower) no fim da notificação.
          // Sem isso, recipient vira passivo — TOM perde a governança e vira "menino de recado".
          // Com isso, TOM CONDUZ a decisão (resolve agora? agenda? delega? precisa apoio?).
          notifText += `\n\n❓ *Como você quer tratar?*\n1️⃣ *Resolvo agora* — vou cuidar disso hoje\n2️⃣ *Agendo* — vou tratar nos próximos dias\n3️⃣ *Delego* — passa pra outra pessoa da equipe\n4️⃣ *Preciso de apoio* — me ajuda a destravar\n\n_Responde com o número, ou me chama pra atualizar de outro jeito (ex.: "concluí", "marquei reunião com a família amanhã", "encaminha pro Leo")._`;
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
  return { okCount, failCount, integrityPayload: null };
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
        // Sprint 22.55 — múltiplos lembretes via habit_reminders. Aceita:
        //   - a.reminders: ["08:00","10:30",...] (preferido)
        //   - a.reminder_time: "08:00" (legado, vira 1 row)
        try {
          const reminderTimes = [];
          if (Array.isArray(a.reminders)) {
            for (const t of a.reminders) {
              if (typeof t !== 'string') continue;
              if (!HABIT_TIME_RE.test(t)) continue;
              reminderTimes.push(t.length > 5 ? t.slice(0, 5) : t);
            }
          }
          // Se não veio array mas veio reminder_time legado, usa ele.
          if (reminderTimes.length === 0 && a.reminder_time && HABIT_TIME_RE.test(a.reminder_time)) {
            reminderTimes.push(a.reminder_time.length > 5 ? a.reminder_time.slice(0, 5) : a.reminder_time);
          }
          if (reminderTimes.length > 0) {
            const reminderRows = [...new Set(reminderTimes)].map(t => ({ habit_id: data.id, time: t }));
            const { error: rErr } = await supabase.from('habit_reminders').insert(reminderRows);
            if (rErr) console.error('[Habit] reminders err:', rErr.message);
            else console.log(`[Habit] +${reminderRows.length} reminder(s) for ${String(data.id).slice(0,8)}`);
          }
        } catch (rErr) {
          console.warn('[Habit] reminders attach failed:', rErr.message);
        }
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

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 17 — Active Coordination Context (ACC)
// ─────────────────────────────────────────────────────────────────────────────

/** Retorna os primeiros N chars com "…" se truncado. */
function _accTrunc(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

/** Retorna primeiros 8 chars de um UUID. */
function _accShort(id) {
  return id ? id.slice(0, 8) : '????????';
}

/** Minutos desde uma data ISO. */
function _accMinutesAgo(isoStr) {
  if (!isoStr) return null;
  return Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
}

/** Primeiro nome a partir de full_name. */
function _accFirstName(fullName) {
  if (!fullName) return '?';
  return fullName.split(' ')[0];
}

/** Q1 — último request criado pelo collab (últimos 7 dias, qualquer status). */
async function _accQ1(collabId) {
  const { data, error } = await supabase
    .from('coordination_requests')
    .select(`
      id, recipient_id, mode, message_body, status, created_at,
      recipient:collaborators!coordination_requests_recipient_id_fkey(full_name)
    `)
    .eq('requester_id', collabId)
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.warn('[ACC] Q1 error:', error.message); return null; }
  if (!data) return null;
  return { ...data, recipient_name: data.recipient?.full_name ?? null };
}

/** Q2 — último request onde collab é recipient (últimas 24h, status aberto). */
async function _accQ2(collabId) {
  const { data, error } = await supabase
    .from('coordination_requests')
    .select(`
      id, requester_id, mode, message_body, status, created_at,
      requester:collaborators!coordination_requests_requester_id_fkey(full_name)
    `)
    .eq('recipient_id', collabId)
    .in('status', ['pending', 'sent'])
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.warn('[ACC] Q2 error:', error.message); return null; }
  if (!data) return null;
  return { ...data, requester_name: data.requester?.full_name ?? null };
}

/** Q3 — última resposta recebida pelo collab como requester (últimos 7 dias). */
async function _accQ3(collabId) {
  const { data, error } = await supabase
    .from('coordination_requests')
    .select(`
      id, recipient_id, mode, response_summary, responded_at,
      responder:collaborators!coordination_requests_recipient_id_fkey(full_name)
    `)
    .eq('requester_id', collabId)
    .eq('status', 'responded')
    .gte('responded_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('responded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.warn('[ACC] Q3 error:', error.message); return null; }
  if (!data) return null;
  return { ...data, responder_name: data.responder?.full_name ?? null };
}

/** Q4 — requests abertos envolvendo collab em qualquer lado (últimas 48h, máx 5). */
async function _accQ4(collabId) {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('coordination_requests')
    .select(`
      id, requester_id, recipient_id, mode, message_body, status, created_at,
      requester:collaborators!coordination_requests_requester_id_fkey(full_name),
      recipient:collaborators!coordination_requests_recipient_id_fkey(full_name)
    `)
    .or(`requester_id.eq.${collabId},recipient_id.eq.${collabId}`)
    .in('status', ['pending', 'sent'])
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) { console.warn('[ACC] Q4 error:', error.message); return []; }
  return (data || []).map(r => ({
    ...r,
    requester_name: r.requester?.full_name ?? null,
    recipient_name: r.recipient?.full_name ?? null,
  }));
}

/**
 * Heurística de seleção de FOCUS_CANDIDATE.
 * Avalia em ordem de prioridade decrescente (spec §2.1.2).
 * Retorna { focusCandidate, focusConfidence }.
 */
function _accScoreFocus(collabId, q1, q2, q3, q4) {
  const now = Date.now();
  const min30 = 30 * 60 * 1000;
  const min120 = 120 * 60 * 1000;

  // P1: Q3 com resposta < 30min
  if (q3 && q3.responded_at) {
    const age = now - new Date(q3.responded_at).getTime();
    if (age < min30) {
      return {
        focusCandidate: {
          actorName: _accFirstName(q3.responder_name),
          requestId: q3.id,
          role: 'requester',
          reason: 'última resposta recebida',
        },
        focusConfidence: 'high',
      };
    }
  }

  // P2: Q1 com created_at < 30min e status='sent'
  if (q1 && q1.status === 'sent' && q1.created_at) {
    const age = now - new Date(q1.created_at).getTime();
    if (age < min30) {
      return {
        focusCandidate: {
          actorName: _accFirstName(q1.recipient_name),
          requestId: q1.id,
          role: 'requester',
          reason: 'request recém-criado',
        },
        focusConfidence: 'high',
      };
    }
  }

  // P3: Q4 com exatamente 1 request aberto
  if (q4 && q4.length === 1) {
    const r = q4[0];
    const otherName = r.requester_id === collabId ? r.recipient_name : r.requester_name;
    const role = r.requester_id === collabId ? 'requester' : 'recipient';
    return {
      focusCandidate: {
        actorName: _accFirstName(otherName),
        requestId: r.id,
        role,
        reason: 'único request aberto',
      },
      focusConfidence: 'high',
    };
  }

  // P4: Q4 com 2+ requests todos com o mesmo ator (clustering)
  if (q4 && q4.length > 1) {
    const actorIds = q4.map(r => r.requester_id === collabId ? r.recipient_id : r.requester_id);
    const allSame = actorIds.every(id => id === actorIds[0]);
    if (allSame) {
      const r = q4[0];
      const otherName = r.requester_id === collabId ? r.recipient_name : r.requester_name;
      const role = r.requester_id === collabId ? 'requester' : 'recipient';
      return {
        focusCandidate: {
          actorName: _accFirstName(otherName),
          requestId: r.id,
          role,
          reason: 'múltiplos requests com mesmo ator',
        },
        focusConfidence: 'medium',
      };
    }
  }

  // P5: Q3 com resposta entre 30-120min
  if (q3 && q3.responded_at) {
    const age = now - new Date(q3.responded_at).getTime();
    if (age >= min30 && age < min120) {
      return {
        focusCandidate: {
          actorName: _accFirstName(q3.responder_name),
          requestId: q3.id,
          role: 'requester',
          reason: 'resposta recente (> 30min)',
        },
        focusConfidence: 'medium',
      };
    }
  }

  // P6: Q4 com 2+ requests com atores distintos → low
  if (q4 && q4.length > 1) {
    return { focusCandidate: null, focusConfidence: 'low' };
  }

  // P7: tudo vazio
  return { focusCandidate: null, focusConfidence: 'none' };
}

/**
 * Monta o bloco [ACTIVE_COORDINATION_CONTEXT].
 * Limite duro de 500 chars (spec §2.1.4 + Decisão 5.2).
 * Fallback: se block > 500 chars, reconstrói com max 3 requests abertos.
 */
function _accBuildBlock(collabId, q1, q2, q3, q4, focusCandidate, focusConfidence) {
  function buildLines(openRequests) {
    const lines = ['[ACTIVE_COORDINATION_CONTEXT]'];
    if (q1) {
      const min = _accMinutesAgo(q1.created_at);
      lines.push(`- Último request criado por você: ${_accShort(q1.id)} | recipient=${_accFirstName(q1.recipient_name)} | "${_accTrunc(q1.message_body, 60)}" | há ${min}min`);
    }
    if (q2) {
      const min = _accMinutesAgo(q2.created_at);
      lines.push(`- Último request onde você é recipient: ${_accShort(q2.id)} | from=${_accFirstName(q2.requester_name)} | "${_accTrunc(q2.message_body, 60)}" | há ${min}min`);
    }
    if (q3) {
      const min = _accMinutesAgo(q3.responded_at);
      lines.push(`- Última resposta recebida: ${_accShort(q3.id)} | de=${_accFirstName(q3.responder_name)} | "${_accTrunc(q3.response_summary, 60)}" | há ${min}min`);
    }
    if (openRequests && openRequests.length > 0) {
      lines.push('- Requests abertos:');
      for (const r of openRequests) {
        const other = r.requester_id === collabId ? _accFirstName(r.recipient_name) : _accFirstName(r.requester_name);
        lines.push(`  • ${_accShort(r.id)} ↔ ${other} | mode=${r.mode} | "${_accTrunc(r.message_body, 40)}"`);
      }
    }
    lines.push('');
    if (focusCandidate) {
      lines.push(`FOCUS_CANDIDATE: ${focusCandidate.actorName} (req ${_accShort(focusCandidate.requestId)}, você=${focusCandidate.role}, reason=${focusCandidate.reason})`);
      lines.push(`FOCUS_CONFIDENCE: ${focusConfidence}`);
    } else {
      lines.push(`FOCUS_CONFIDENCE: ${focusConfidence} — sem requests ativos`);
    }
    lines.push('');
    lines.push('Use isso para resolver pronomes/elipsis. Se confidence=low, pergunte citando candidatos pelo nome.');
    return lines.join('\n');
  }

  // Primeira tentativa: até 5 requests abertos
  let block = buildLines(q4 ? q4.slice(0, 5) : []);

  // Fallback: se > 500 chars, truncar para 3 requests abertos (Decisão 5.2)
  if (block.length > 500) {
    block = buildLines(q4 ? q4.slice(0, 3) : []);
  }

  return block;
}

/**
 * Sprint 17 — Constrói o Active Coordination Context para o collab.
 * 4 queries paralelas + scoring + bloco de até 500 chars.
 * Retorna { block, focusCandidate, focusConfidence }.
 * block é null se collab não tem nenhum request relevante.
 */
async function buildActiveCoordinationContext(collab) {
  try {
    const [q1, q2, q3, q4] = await Promise.all([
      _accQ1(collab.id),
      _accQ2(collab.id),
      _accQ3(collab.id),
      _accQ4(collab.id),
    ]);

    // Se tudo vazio, retorna null block
    if (!q1 && !q2 && !q3 && (!q4 || q4.length === 0)) {
      return { block: null, focusCandidate: null, focusConfidence: 'none' };
    }

    const { focusCandidate, focusConfidence } = _accScoreFocus(collab.id, q1, q2, q3, q4);
    const block = _accBuildBlock(collab.id, q1, q2, q3, q4, focusCandidate, focusConfidence);

    return { block, focusCandidate, focusConfidence };
  } catch (err) {
    console.error('[ACC] buildActiveCoordinationContext error:', err.message);
    return { block: null, focusCandidate: null, focusConfidence: 'none' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 18 — Integridade de Agenda e Execução
// Helpers puros de detecção. Fail-open: exceptions são capturadas pelos callers.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Jaro-Winkler similarity — retorna 0..1.
 * Implementação pura, sem dependência npm. Ideal para títulos curtos.
 */
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;
  const len1 = s1.length, len2 = s2.length;
  if (!len1 || !len2) return 0.0;
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - matchDist);
    const hi = Math.min(i + matchDist + 1, len2);
    for (let j = lo; j < hi; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0.0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Normaliza string para comparação: lowercase, remove pontuação, trim. */
function normalizeForSim(s) {
  return String(s || '').toLowerCase().replace(/[^a-záàãâéêíóôõúüç\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Sprint 18 — detecta conflitos temporais antes de criar evento.
 * Fail-open: exceptions retornam { hardConflicts: [], softConflicts: [] }.
 * @param {object} collab — row de collaborators
 * @param {object} candidate — { start_at: ISO, end_at: ISO, modality, location_text }
 * @returns {{ hardConflicts: object[], softConflicts: object[] }}
 */
async function detectTemporalConflict(collab, candidate) {
  try {
    if (!candidate.start_at || !candidate.end_at) return { hardConflicts: [], softConflicts: [] };
    const { data: overlaps, error } = await supabase
      .from('events')
      .select('id, title, start_at, end_at, modality, location_text, category, status')
      .eq('collaborator_id', collab.id)
      .neq('status', 'cancelled')
      .lt('start_at', candidate.end_at)
      .gt('end_at', candidate.start_at)
      .limit(20);
    if (error) {
      console.error('[detectTemporalConflict] query err:', error.message);
      return { hardConflicts: [], softConflicts: [] };
    }
    const hardConflicts = [], softConflicts = [];
    const candStart = new Date(candidate.start_at).getTime();
    const candEnd   = new Date(candidate.end_at).getTime();
    const candDur   = candEnd - candStart;
    for (const ev of (overlaps || [])) {
      const evStart = new Date(ev.start_at).getTime();
      const evEnd   = new Date(ev.end_at).getTime();
      // Diferença < 1min → possível duplicidade; delegado para detectDuplicateSemanticEvent
      if (Math.abs(evStart - candStart) < 60_000) continue;
      const overlapMs    = Math.min(candEnd, evEnd) - Math.max(candStart, evStart);
      const overlapRatio = overlapMs / candDur;
      const bothPresencial = (ev.modality === 'presencial' || ev.modality === 'hibrido')
                          && (candidate.modality === 'presencial' || candidate.modality === 'hibrido');
      const bothOnline  = ev.modality === 'online' && candidate.modality === 'online';
      // HARD: overlap ≥50% + presencial + AMBOS location_text preenchidos e distintos (decisão 5.4)
      const diffLocation = ev.location_text && candidate.location_text
                        && ev.location_text.toLowerCase().trim() !== candidate.location_text.toLowerCase().trim();
      const overlapMin = Math.round(overlapMs / 60_000);
      if (overlapRatio >= 0.5 && bothPresencial && diffLocation) {
        hardConflicts.push({ ...ev, overlapRatio, overlapMin, reason: 'presencial_diff_location' });
      } else if (overlapRatio >= 0.5 && bothPresencial) {
        softConflicts.push({ ...ev, overlapRatio, overlapMin, reason: 'presencial_same_location' });
      } else if (overlapRatio >= 0.5 && bothOnline) {
        softConflicts.push({ ...ev, overlapRatio, overlapMin, reason: 'online_simultaneous' });
      } else if (overlapRatio >= 0.5) {
        softConflicts.push({ ...ev, overlapRatio, overlapMin, reason: 'online_presencial_mixed' });
      } else if (overlapRatio > 0) {
        softConflicts.push({ ...ev, overlapRatio, overlapMin, reason: 'partial_overlap' });
      }
    }
    return { hardConflicts, softConflicts };
  } catch (err) {
    console.error('[IntegrityCheck] detectTemporalConflict err (non-fatal):', err.message);
    return { hardConflicts: [], softConflicts: [] };
  }
}

/**
 * Sprint 18 — detecta duplicidade semântica antes de criar evento.
 * Janela: ±48h em torno de candidate.start_at.
 * Fail-open: exceptions retornam { probable: [], possible: [] }.
 * @returns {{ probable: object[], possible: object[] }}
 *   probable: score > 0.7  (duplicado provável — A1: NUNCA bloqueia auto)
 *   possible: 0.5 < score ≤ 0.7 (alerta leve)
 */
async function detectDuplicateSemanticEvent(collab, candidate) {
  try {
    if (!candidate.title) return { probable: [], possible: [] };
    const candDate = candidate.start_at ? candidate.start_at.slice(0, 10) : null;
    const windowStart = candDate
      ? new Date(new Date(candDate).getTime() - 48 * 3600_000).toISOString() : null;
    const windowEnd = candDate
      ? new Date(new Date(candDate).getTime() + 48 * 3600_000).toISOString() : null;
    let query = supabase
      .from('events')
      .select('id, title, start_at, end_at, category, location_text, status, created_at')
      .eq('collaborator_id', collab.id)
      .neq('status', 'cancelled');
    if (windowStart && windowEnd) query = query.gte('start_at', windowStart).lte('start_at', windowEnd);
    const { data: candidates, error } = await query.limit(30);
    if (error) {
      console.error('[detectDuplicateSemanticEvent] query err:', error.message);
      return { probable: [], possible: [] };
    }
    // Sprint 22.34 hotfix — bug observado: "Reunião com Henrique amanhã" matchava
    // "Reunião Matheus Emusys hoje" como dup probable (false positive). Causa:
    // jaroWinkler dava score alto pelo prefix comum "reuniao". Mesmo padrao de
    // bug fixado em Sprint 21.4 pra tasks (stripVerbPrefix + keyword overlap).
    // Aplicado aqui o mesmo fix.
    const candCore = stripVerbPrefix(candidate.title);
    const candTitleNorm = normalizeForSim(candCore);
    // Keywords distinguidoras (sem stopwords, capitalized = nomes/lugares).
    const candKeywords = (candCore.match(/\b[A-ZÁÀÃÂÉÊÍÓÔÕÚ][a-záàãâéêíóôõúç]{3,}\b/g) || [])
      .filter(k => !KEYWORD_STOPWORDS.has(k.toLowerCase()));
    const probable = [], possible = [];
    for (const ev of (candidates || [])) {
      const evCore = stripVerbPrefix(ev.title);
      let score = jaroWinkler(candTitleNorm, normalizeForSim(evCore));
      const evDate = ev.start_at ? ev.start_at.slice(0, 10) : null;
      if (candDate && evDate && candDate === evDate) score = Math.min(score + 0.3, 1.0);
      if (candidate.category && ev.category === candidate.category) score = Math.min(score + 0.1, 1.0);
      if (candidate.location_text && ev.location_text &&
          normalizeForSim(candidate.location_text) === normalizeForSim(ev.location_text)) {
        score = Math.min(score + 0.1, 1.0);
      }
      // Keyword overlap boost: se compartilha 1+ palavra distinguidora capitalizada.
      const evKeywords = (evCore.match(/\b[A-ZÁÀÃÂÉÊÍÓÔÕÚ][a-záàãâéêíóôõúç]{3,}\b/g) || [])
        .filter(k => !KEYWORD_STOPWORDS.has(k.toLowerCase()));
      const shared = candKeywords.filter(k => evKeywords.includes(k));
      if (shared.length > 0) score = Math.min(score + 0.1 * Math.min(shared.length, 2), 1.0);
      // Sprint 22.34: pra entrar como PROBABLE (bloqueia/pergunta), exigir keyword
      // overlap real OU mesma data + alta similaridade nominal. Sem isso, "Reuniao
      // com Henrique" e "Reuniao com Matheus" continuariam matchando pelo prefix.
      const sameDate = candDate && evDate && candDate === evDate;
      const hasSharedKeyword = shared.length > 0;
      if (score > 0.7 && (hasSharedKeyword || sameDate)) {
        probable.push({ ...ev, _score: score });
      } else if (score > 0.5) {
        possible.push({ ...ev, _score: score });
      }
    }
    probable.sort((a, b) => b._score - a._score);
    possible.sort((a, b) => b._score - a._score);
    return { probable: probable.slice(0, 3), possible: possible.slice(0, 3) };
  } catch (err) {
    console.error('[IntegrityCheck] detectDuplicateSemanticEvent err (non-fatal):', err.message);
    return { probable: [], possible: [] };
  }
}

/**
 * Sprint 18 — detecta task similar já aberta antes de criar.
 * Janela: tasks abertas dos últimos 30 dias.
 * Fail-open: exceptions retornam { probable: [], possible: [] }.
 * @param {object} collab
 * @param {object} candidate — { title, description, assigned_to, department_id, request_type_id }
 * @returns {{ probable: object[], possible: object[] }}
 */
// Sprint 21.4 hotfix — fix de falso positivo no match semântico.
// Bug observado: "Ligar pro Norton" matchava "Ligar pro Flávio" com score ~0.85
// porque o prefixo "ligar pro " (10 chars) dominava o jaroWinkler. O stripSuffix
// piorava removendo o conteúdo distinguidor ("guitarras + baterias Recreio").
// Fix: strip de prefixos verbais genéricos ANTES do JW + filtro de stopwords no
// keyword boost + pré-filtro de contexto (personal ≠ work).
// Sprint 22.3 — adicionados verbos "Re-" pra evitar falso positivo via prefix bonus
// do jaroWinkler (ex: "Revisar contrato" matchava "Reajustar mentoria" por causa do "Re").
const VERB_PREFIX_RE = /^(ligar\s+pr[ao]\s+|falar\s+com\s+|reuni[aã]o\s+com\s+|enviar\s+pra?\s+|enviar\s+para\s+|mandar\s+pra?\s+|mandar\s+para\s+|verificar\s+|checar\s+|comprar\s+|buscar\s+|organizar\s+|resolver\s+|fazer\s+|pedir\s+pra?\s+|pedir\s+para\s+|contatar\s+|chamar\s+|marcar\s+|agendar\s+|combinar\s+com\s+|revisar\s+|reajustar\s+|rever\s+|ajustar\s+|atualizar\s+|reformular\s+)/i;
const KEYWORD_STOPWORDS = new Set([
  'ligar','falar','fazer','pedir','mandar','enviar','comprar','buscar','verificar','checar',
  'organizar','resolver','criar','contatar','chamar','marcar','agendar','combinar',
  'reuniao','reunião','outro','mesmo','para','pelo','pela','sobre','depois','antes',
  'revisar','reajustar','rever','ajustar','atualizar','reformular'
]);
const stripVerbPrefix = s => {
  const stripped = String(s || '').replace(VERB_PREFIX_RE, '').trim();
  return stripped || String(s || '').trim(); // fallback se sobrou vazio
};

async function detectDuplicateSemanticTask(collab, candidate) {
  try {
    if (!candidate.title) return { probable: [], possible: [] };
    const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const { data: openTasks, error } = await supabase
      .from('tasks')
      .select('id, title, description, assigned_to, department_id, request_type_id, context, status, created_at, due_date')
      .eq('assigned_to', candidate.assigned_to || collab.id)
      .not('status', 'in', '("done","cancelled")')
      .gte('created_at', cutoff)
      .limit(50);
    if (error) {
      console.error('[detectDuplicateSemanticTask] query err:', error.message);
      return { probable: [], possible: [] };
    }
    // Sprint 19 hotfix: strip do suffix "— UNIDADE/SALA" antes de comparar.
    // Sprint 21.4: strip também do prefixo verbal antes do JW.
    const stripSuffix = s => String(s || '').split(/\s*[—–]\s+/)[0].trim();
    const candStripped = stripSuffix(candidate.title);
    const candCore = stripVerbPrefix(candStripped);             // núcleo nominal
    const candTitleNorm = normalizeForSim(candCore);
    const probable = [], possible = [];
    for (const task of (openTasks || [])) {
      // Pré-filtro: personal vs work são domínios distintos. Não compara.
      if (candidate.context && task.context && candidate.context !== task.context) continue;
      const taskStripped = stripSuffix(task.title);
      const taskCore = stripVerbPrefix(taskStripped);
      let score = jaroWinkler(candTitleNorm, normalizeForSim(taskCore));
      // Boosts suaves (eram +0.2/+0.2, causavam falsos positivos sistemáticos)
      if (candidate.department_id && task.department_id === candidate.department_id) score = Math.min(score + 0.05, 1.0);
      if (candidate.request_type_id && task.request_type_id === candidate.request_type_id) score = Math.min(score + 0.05, 1.0);
      // Keywords extraídas do núcleo nominal (sem prefixo verbal, sem suffix de unidade).
      // Stopwords filtram verbos comuns que enviesavam o boost ("Ligar" vs "Ligar" → +0.1 burro).
      const candKeywords = (candCore.match(/\b[A-ZÁÀÃÂÉÊÍÓÔÕÚ][a-záàãâéêíóôõúç]{3,}\b/g) || [])
        .filter(k => !KEYWORD_STOPWORDS.has(k.toLowerCase()));
      const taskKeywords = (taskCore.match(/\b[A-ZÁÀÃÂÉÊÍÓÔÕÚ][a-záàãâéêíóôõúç]{3,}\b/g) || [])
        .filter(k => !KEYWORD_STOPWORDS.has(k.toLowerCase()));
      const shared = candKeywords.filter(k => taskKeywords.includes(k));
      if (shared.length > 0) score = Math.min(score + 0.1 * Math.min(shared.length, 2), 1.0);
      // Sprint 22.3 — exigir keyword overlap real pra bloquear (probable). Sem keyword
      // compartilhada, prefix bonus do jaroWinkler ("Re-", "Co-") gera falsos positivos.
      // Score alto sem semântica vira só "possible" (avisa, não bloqueia).
      if (score > 0.7 && shared.length > 0) probable.push({ ...task, _score: score });
      else if (score > 0.5) possible.push({ ...task, _score: score });
    }
    probable.sort((a, b) => b._score - a._score);
    possible.sort((a, b) => b._score - a._score);
    return { probable: probable.slice(0, 3), possible: possible.slice(0, 3) };
  } catch (err) {
    console.error('[IntegrityCheck] detectDuplicateSemanticTask err (non-fatal):', err.message);
    return { probable: [], possible: [] };
  }
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

  // Sprint 16 — COORD_HINT: verifica recados abertos onde collab é recipient
  let coordHint = null;
  {
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: openRequests } = await supabase
      .from('coordination_requests')
      .select('id, requester_id, message_body, created_at')
      .eq('recipient_id', collab.id)
      .eq('status', 'sent')
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(3);

    if (openRequests && openRequests.length > 0) {
      const requesterIds = [...new Set(openRequests.map(r => r.requester_id))];
      const { data: requesters } = await supabase
        .from('collaborators')
        .select('id, full_name')
        .in('id', requesterIds);
      const requesterMap = Object.fromEntries((requesters || []).map(r => [r.id, r]));

      const lines = openRequests.map(r => {
        const req = requesterMap[r.requester_id];
        const reqName = req ? ((req.full_name || '').split(' ')[0] || 'alguém') : 'alguém';
        const preview = r.message_body.slice(0, 60) + (r.message_body.length > 60 ? '...' : '');
        const ago = Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000);
        const agoStr = ago < 60 ? `${ago}min atrás` : `${Math.round(ago / 60)}h atrás`;
        return `- De: ${reqName} | ID: ${r.id} | "${preview}" | ${agoStr}`;
      });
      coordHint = `[COORD_HINT] Há ${openRequests.length} recado(s) aguardando resposta sua:\n${lines.join('\n')}\n\nINSTRUÇÃO CRÍTICA:\n1. Esses recados JÁ FORAM ENTREGUES por WhatsApp ao recipient. NÃO os mencione proativamente ("tem um recado", "chegou um recado", "dele"). O recipient já leu.\n2. Use este hint APENAS para detectar se a mensagem atual É uma resposta a um desses recados. Se for, emita <<COORDINATION_RESPONSE>> com o request_id correspondente.\n3. Se a mensagem atual NÃO é resposta a nenhum deles, IGNORE este hint e responda à mensagem normalmente, sem citar os recados.`;
    }
  }

  // Sprint 17 — ACC: contexto ativo de coordenação (foco dominante + pronomes)
  // COORD_HINT (Sprint 16) permanece inalterado acima — COORD_HINT e ACC convivem (Decisão 5.3)
  let coordContext = null;
  {
    const acc = await buildActiveCoordinationContext(collab);
    if (acc.block) {
      coordContext = acc.block;
      console.log(`[ACC] focusConfidence=${acc.focusConfidence} focusCandidate=${acc.focusCandidate?.actorName ?? 'none'}`);
    }
  }

  // Constrói o system prompt 4-block (regras → identidade → contexto → skill ativa).
  let { systemPrompt, ctx } = await buildSystemPrompt(collab, { lastUserMessage: text, coordHint, coordContext });
  const _tt = ctx.todayTasks || {};
  const _tCount = (_tt.personal?.length || 0) + (_tt.work?.length || 0);
  console.log(`[Engine] system prompt size: ${systemPrompt.length} chars (memories=${ctx.memories.length}, tasks=${_tCount}, notifs=${ctx.notifications.length})`);

  // Sprint 21 — limite suave anti-relay (avisa, não bloqueia)
  try {
    const relayHint = await buildRelayLimitHint(collab.id);
    if (relayHint) systemPrompt += '\n\n' + relayHint;
  } catch (err) {
    console.warn('[RELAY_LIMIT_HINT] failed:', err.message);
  }

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
      // Sprint 21.5 — anti-mentira: se cleanText tem confirmação otimista mas o marker
      // foi rejeitado, o LLM "prometeu" sem persistir. Sobrescreve com aviso honesto.
      // Princípio: TOM nunca confirma sucesso de ação persistente se engine rejeitou o marker.
      let base = parsedTask.cleanText || reply;
      const optimisticPattern = /\b(registrad|agendad|reagendad|atualizad|salvei|salvo|guardad|marqu(ei|amos)|criad|reagendando|agendando|registrando|feito[!.]?\s|pronto[!.]?\s|bora[!.]?$)/i;
      if (optimisticPattern.test(base)) {
        base += '\n\n_⚠️ Tive um problema técnico ao gravar isso. Não confirmei nada no banco — me passa de novo o que você quer registrar?_';
      }
      reply = base;
    } else if (parsedTask) {
      // Sprint 10.1 hotfix: alignment de datas. A âncora temporal no system
      // prompt não basta — Claude erra "amanhã" em frases complexas
      // ("Amanhã preciso pagar X pode me lembrar 8h30?" → gravou 30/04
      // em vez de 29/04). Engine valida texto do user e força a data certa
      // antes de persistir. Defesa de modelo.
      try {
        const userTextLC = String(text || '').toLowerCase();
        const wantsTomorrow = /\b(amanh[ãa])\b/.test(userTextLC);
        const wantsToday = /\b(hoje)\b/.test(userTextLC) && !wantsTomorrow;
        if (wantsTomorrow || wantsToday) {
          const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric', month: '2-digit', day: '2-digit',
          });
          const todayBRT = fmt.format(new Date());
          const tmrw = new Date(todayBRT + 'T03:00:00.000Z');
          tmrw.setUTCDate(tmrw.getUTCDate() + 1);
          const tomorrowBRT = tmrw.toISOString().slice(0, 10);
          const targetDay = wantsTomorrow ? tomorrowBRT : todayBRT;
          let alignedCount = 0;
          for (const a of (parsedTask.actions || [])) {
            if (a.action !== 'create' && a.action !== 'reschedule') continue;
            for (const field of ['remind_at', 'new_remind_at']) {
              if (typeof a[field] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(a[field]) && a[field].slice(0, 10) !== targetDay) {
                const orig = a[field];
                a[field] = targetDay + orig.slice(10);
                alignedCount++;
                console.warn(`[Task] auto-aligned ${field}: ${orig} → ${a[field]} (user said "${wantsTomorrow ? 'amanhã' : 'hoje'}")`);
              }
            }
            for (const field of ['due_date', 'new_due_date']) {
              if (typeof a[field] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a[field]) && a[field] !== targetDay) {
                const orig = a[field];
                a[field] = targetDay;
                alignedCount++;
                console.warn(`[Task] auto-aligned ${field}: ${orig} → ${a[field]}`);
              }
            }
          }
          if (alignedCount > 0) {
            await logMarker(collab.id, 'TASK_DATE_AUTO_ALIGNED', 'executed', `count=${alignedCount} target=${targetDay}`, null);
          }
        }
      } catch (e) {
        console.error('[Task] date alignment err (non-fatal):', e.message);
      }
      const { okCount, failCount, integrityPayload } = await applyTaskActions(collab, parsedTask.actions);
      console.log(`[Task] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      if (integrityPayload) {
        const iType = integrityPayload.type;
        const logReason = `integrity_${iType}:candidate="${String(integrityPayload.candidateTitle).slice(0,40)}"`;
        await logMarker(collab.id, 'TASK_UPDATE', 'rejected', logReason, null);
        console.warn(`[IntegrityCheck] TASK_UPDATE blocked by ${iType} — "${String(integrityPayload.candidateTitle).slice(0,40)}"`);
        // Bug B2 fix (Radar pós-Sprint19): TOM não pode dizer "Registrado!" quando integrity bloqueia.
        // Sobrescreve o cleanText (que pode conter "✅ Registrado!" alucinado) por microconfirmação.
        reply = _buildIntegrityConfirmText(integrityPayload);
      } else {
        const result = okCount > 0 ? 'executed' : 'rejected';
        const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
        await logMarker(collab.id, 'TASK_UPDATE', result, reason, null);
        let base = parsedTask.cleanText || '';
        if (failCount > 0 && okCount === 0) {
          base = (base ? base + '\n\n' : '') + '_não consegui registrar agora, te aviso depois_';
        } else if (failCount > 0 && okCount > 0) {
          // Sprint 21.5 — confirmação parcial honesta. Engine não pode deixar TOM dizer
          // "tudo certo" quando parte falhou. Princípio: fala = persistência.
          base = (base ? base + '\n\n' : '') + `_⚠️ Registrei ${okCount} de ${okCount + failCount}. Algumas falharam — me chama se algo ficar faltando._`;
        }
        reply = base || reply;
      }
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
      } else if (okCount > 0) {
        // Sprint 21.7 — anti-omissão (Classe C). Se TOM verbalizou horário/dia como
        // fato operacional no texto, mas o marker omitiu reminder_time/custom_days,
        // a persistência ficou incompleta. Engine compara texto vs payload e avisa.
        // Princípio: o que TOM afirma operacionalmente DEVE existir no banco — ou
        // o sistema avisa que não salvou.
        try {
          const creates = (parsedHab.actions || []).filter(a => a.action === 'create');
          if (creates.length > 0) {
            const timeMentions = (base.match(/\b\d{1,2}h\d{0,2}\b|\b\d{1,2}:\d{2}\b/g) || []).length;
            const withReminder = creates.filter(a => a.reminder_time || a.target_time).length;
            const dayMentions = /\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|seg|ter|qua|qui|sex|sab|dom)\b/i.test(base);
            const weeklyWithoutDays = creates.some(a => a.frequency === 'weekly' && !(Array.isArray(a.custom_days) && a.custom_days.length));
            const gaps = [];
            if (timeMentions > withReminder) gaps.push('horário(s)');
            if (dayMentions && weeklyWithoutDays) gaps.push('dias específicos');
            if (gaps.length) {
              base += `\n\n_⚠️ Hábitos criados, mas ${gaps.join(' e ')} que mencionei no texto não foram salvos no banco. Me confirma esses detalhes que eu ajusto?_`;
              await logMarker(collab.id, 'HABIT_FIELDS_GAP', 'rejected', `gaps:${gaps.join(',')}`, null);
            }
          }
        } catch (gapErr) {
          console.error('[Habit] field-gap check err (non-fatal):', gapErr.message);
        }
      }
      reply = base || reply;
    }
  }

  // 2.62) Sprint 22.38 — <<PERSONAL_LIST_ACTION>> — listas pessoais do user.
  // Actions: create | add_item | toggle_item | rename | archive
  {
    const re = /<<PERSONAL_LIST_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;
    const m = reply.match(re);
    if (m) {
      const cleanText = reply.replace(re, '').trim();
      let parsed = null;
      try {
        parsed = JSON.parse(m[1].trim());
      } catch (err) {
        await logMarker(collab.id, 'PERSONAL_LIST_ACTION', 'rejected', 'invalid_json: ' + err.message, m[1]);
        reply = cleanText || reply;
      }
      if (parsed) {
        const actions = Array.isArray(parsed) ? parsed : [parsed];
        let okCount = 0, failCount = 0;
        for (const a of actions) {
          try {
            if (!a || typeof a !== 'object') { failCount++; continue; }
            if (a.action === 'create') {
              const name = String(a.name || '').trim();
              if (!name) { failCount++; continue; }
              const listType = ['shopping', 'travel', 'meds', 'general'].includes(a.list_type) ? a.list_type : 'general';
              const { data: list, error: e1 } = await supabase
                .from('personal_checklists')
                .insert({ owner_collab_id: collab.id, name, list_type: listType })
                .select('id').single();
              if (e1) { failCount++; continue; }
              const items = Array.isArray(a.items) ? a.items.filter(x => typeof x === 'string' && x.trim()) : [];
              if (items.length) {
                const rows = items.map((d, i) => ({ list_id: list.id, description: d.trim(), sort_order: i + 1 }));
                const { error: e2 } = await supabase.from('personal_checklist_items').insert(rows);
                if (e2) { failCount++; continue; }
              }
              okCount++;
            } else if (a.action === 'add_item') {
              if (!a.list_id || !a.description) { failCount++; continue; }
              // Validar ownership: lista pertence ao collab.
              const { data: owned } = await supabase
                .from('personal_checklists').select('id')
                .eq('id', a.list_id).eq('owner_collab_id', collab.id).maybeSingle();
              if (!owned) { failCount++; continue; }
              const { data: maxRow } = await supabase
                .from('personal_checklist_items').select('sort_order')
                .eq('list_id', a.list_id)
                .order('sort_order', { ascending: false }).limit(1).maybeSingle();
              const nextOrder = (maxRow && maxRow.sort_order ? maxRow.sort_order : 0) + 1;
              const { error } = await supabase.from('personal_checklist_items').insert({
                list_id: a.list_id, description: String(a.description).trim(), sort_order: nextOrder,
              });
              if (error) { failCount++; continue; }
              okCount++;
            } else if (a.action === 'toggle_item') {
              if (!a.item_id) { failCount++; continue; }
              // Ownership via FK chain: item → list.owner.
              const { data: itemRow } = await supabase
                .from('personal_checklist_items')
                .select('id, personal_checklists!inner(owner_collab_id)')
                .eq('id', a.item_id).maybeSingle();
              if (!itemRow || !itemRow.personal_checklists || itemRow.personal_checklists.owner_collab_id !== collab.id) {
                failCount++; continue;
              }
              const isDone = a.is_done === undefined ? true : !!a.is_done;
              const { error } = await supabase.from('personal_checklist_items')
                .update({ is_done: isDone }).eq('id', a.item_id);
              if (error) { failCount++; continue; }
              okCount++;
            } else if (a.action === 'rename') {
              if (!a.list_id || !a.name) { failCount++; continue; }
              const { error } = await supabase.from('personal_checklists')
                .update({ name: String(a.name).trim() })
                .eq('id', a.list_id).eq('owner_collab_id', collab.id);
              if (error) { failCount++; continue; }
              okCount++;
            } else if (a.action === 'archive') {
              if (!a.list_id) { failCount++; continue; }
              const { error } = await supabase.from('personal_checklists')
                .update({ is_active: false })
                .eq('id', a.list_id).eq('owner_collab_id', collab.id);
              if (error) { failCount++; continue; }
              okCount++;
            } else {
              failCount++;
            }
          } catch (e) {
            console.error('[PersonalList] action err:', e.message);
            failCount++;
          }
        }
        const result = okCount > 0 ? 'executed' : 'rejected';
        const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
        await logMarker(collab.id, 'PERSONAL_LIST_ACTION', result, reason, null);
        console.log(`[PersonalList] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
        reply = cleanText || reply;
      }
    }
  }

  // 2.65) Event create — compromissos com horário (Sprint 4+).
  {
    const parsedEv = parseEventCreateMarker(reply);

    // Sprint 22.34b — Habit redirect: TOM (LLM) tende a emitir EVENT_CREATE
    // quando user fala "academia 18h" / "treino 7h". Skill diz claramente que
    // hábitos com hora são tarefas, mas LLM ignora. Fallback: aqui no engine,
    // antes de validar/rejeitar, checamos se title bate hábito ativo do user
    // → redirect pra task com remind_at. Funciona pra items válidos E inválidos.
    let habitRedirected = 0;
    if (parsedEv) {
      const allItems = [...(parsedEv.events || []), ...(parsedEv.droppedItems || [])];
      if (allItems.length > 0) {
        const { data: userHabits } = await supabase
          .from('habits').select('name')
          .eq('collaborator_id', collab.id).eq('is_active', true);
        const habitNamesNorm = (userHabits || [])
          .map(h => normalizeForSim(String(h.name || '')))
          .filter(s => s.length >= 3);
        if (habitNamesNorm.length > 0) {
          for (const item of allItems) {
            const tNorm = normalizeForSim(String(item.title || ''));
            const matches = tNorm && habitNamesNorm.some(h =>
              tNorm === h || tNorm.includes(h) || h.includes(tNorm),
            );
            if (!matches) continue;
            const dueDate = String(item.start_at || '').slice(0, 10) || null;
            const { error: tErr } = await supabase.from('tasks').insert({
              title: String(item.title).trim().slice(0, 200),
              assigned_to: collab.id,
              created_by: collab.id,
              source: 'tom',
              status: 'pending',
              context: 'personal',
              priority: 'medium',
              due_date: dueDate,
              remind_at: item.start_at || null,
            });
            if (tErr) {
              console.error(`[Event→Task redirect] insert err: ${tErr.message}`);
            } else {
              habitRedirected++;
              // Remove de events/droppedItems pra nao processar duas vezes.
              if (parsedEv.events) parsedEv.events = parsedEv.events.filter(e => e !== item);
              if (parsedEv.droppedItems) parsedEv.droppedItems = parsedEv.droppedItems.filter(e => e !== item);
            }
          }
        }
        // Re-avalia malformed: se sobrou item válido, não é mais malformed.
        if (parsedEv.malformed && parsedEv.events && parsedEv.events.length > 0) {
          parsedEv.malformed = false;
        }
        // Se TUDO virou hábito (nada sobrou em events nem droppedItems),
        // limpa malformed e short-circuit.
        const totalLeft = (parsedEv.events?.length || 0) + (parsedEv.droppedItems?.length || 0);
        if (habitRedirected > 0 && totalLeft === 0) {
          await logMarker(collab.id, 'EVENT_CREATE', 'redirected', `habit→task x${habitRedirected}`, null);
          reply = parsedEv.cleanText || reply;
          parsedEv.malformed = false;  // bypass error path
          parsedEv.events = [];        // bypass applyEventActions
        }
      }
    }

    if (parsedEv && parsedEv.malformed) {
      console.warn('[Event] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'EVENT_CREATE', 'rejected', 'schema_invalid', reply);
      // Sprint 21.5.1 — anti-mentira para EVENT_CREATE (mesma proteção do TASK_UPDATE).
      // Bug observado: LLM emitiu 4 markers EVENT_CREATE separados (parser espera 1 com array),
      // tudo rejeitado, mas TOM disse "vou criar os eventos agora" no chat — mentira.
      let baseEv = parsedEv.cleanText || reply;
      const optimisticEvPattern = /\b(criad|registrad|agendad|marqu(ei|amos)|salvei|salvo|guardad|reagendad|atualizad|registrando|criando|agendando|marcando|feito[!.]?\s|pronto[!.]?\s|bora[!.]?$)/i;
      if (optimisticEvPattern.test(baseEv)) {
        baseEv += '\n\n_⚠️ Tive um problema técnico ao gravar o(s) compromisso(s). Não confirmei nada no banco — me passa de novo?_';
      }
      reply = baseEv;
    } else if (parsedEv && parsedEv.events && parsedEv.events.length > 0) {
      const { okCount, failCount, integrityPayload } = await applyEventActions(collab, parsedEv.events);
      console.log(`[Event] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      if (integrityPayload) {
        // Sprint 18: integrity finding — NÃO persiste; skill apresenta ao user e aguarda confirmação
        const iSeverity = integrityPayload.severity;
        const iType     = integrityPayload.type;
        const logReason = `integrity_${iType}:severity=${iSeverity}:candidate="${String(integrityPayload.candidateTitle).slice(0,40)}"`;
        await logMarker(collab.id, 'EVENT_CREATE', 'rejected', logReason, null);
        console.warn(`[IntegrityCheck] EVENT_CREATE blocked by ${iType} (${iSeverity}) — "${String(integrityPayload.candidateTitle).slice(0,40)}"`);
        // Bug B2 fix: força microconfirmação em vez de aceitar texto que TOM gerou.
        reply = _buildIntegrityConfirmText(integrityPayload);
      } else {
        const result = okCount > 0 ? 'executed' : 'rejected';
        const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
        await logMarker(collab.id, 'EVENT_CREATE', result, reason, null);
        let base = parsedEv.cleanText || '';
        if (failCount > 0 && okCount === 0) {
          base = (base ? base + '\n\n' : '') + '_não consegui salvar o compromisso, te aviso depois_';
        } else if (failCount > 0 && okCount > 0) {
          // Sprint 21.5.1 — confirmação parcial honesta também em EVENT_CREATE.
          base = (base ? base + '\n\n' : '') + `_⚠️ Salvei ${okCount} de ${okCount + failCount} compromissos. Algum falhou — me chama se algo ficar faltando._`;
        }
        reply = base || reply;
      }
    }
  }

  // 2.66) Event update (Sprint 5) — reschedule / cancel / complete.
  {
    const parsedEU = parseEventUpdateMarker(reply);
    if (parsedEU && parsedEU.malformed) {
      console.warn('[Event] WARN: malformed EVENT_UPDATE marker, dropping block');
      await logMarker(collab.id, 'EVENT_UPDATE', 'rejected', 'schema_invalid', reply);
      // Sprint 21.5.1 — anti-mentira em EVENT_UPDATE também.
      let baseEU = parsedEU.cleanText || reply;
      const optimisticEUPattern = /\b(reagendad|atualizad|movid|cancelad|conclu[ií]d|registrad|salvei|feito[!.]?\s|pronto[!.]?\s)/i;
      if (optimisticEUPattern.test(baseEU)) {
        baseEU += '\n\n_⚠️ Tive um problema técnico ao alterar o compromisso. Nada mudou no banco — me confirma o que você quer?_';
      }
      reply = baseEU;
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

  // Sprint 11 F2+ — <<CHECKLIST_ACTION>> — resposta do colaborador a checklist diário.
  {
    const parsedCA = parseChecklistActionMarker(reply);
    if (parsedCA && parsedCA.malformed) {
      console.warn('[ChecklistAction] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'CHECKLIST_ACTION', 'rejected', 'schema_invalid', null);
      reply = parsedCA.cleanText || reply;
    } else if (parsedCA) {
      const result = await applyChecklistAction(collab, parsedCA);
      await logMarker(
        collab.id,
        'CHECKLIST_ACTION',
        result.ok ? 'executed' : 'rejected',
        result.ok
          ? `pct=${result.pct} done=${result.doneCount}/${result.totalCount} late=${result.isLate}`
          : result.reason,
        null
      );
      let base = parsedCA.cleanText || '';
      if (result.ok && !base) {
        const lateNote = result.isLate ? ' _(fora do prazo — não conta no KPI)_' : '';
        base = result.pct >= result.threshold
          ? `✅ Checklist registrado — ${result.doneCount}/${result.totalCount} itens (${result.pct}%).${lateNote}`
          : `⚠️ ${result.doneCount}/${result.totalCount} itens (${result.pct}%) — abaixo do mínimo (${result.threshold}%). Registrado como parcial.${lateNote}`;
      }
      reply = base || reply;
    }
  }

  // Sprint 13 F1 — <<ANNOUNCEMENT_ACTION>> — criar/cancelar comunicado interno.
  {
    const parsedAnn = parseAnnouncementActionMarker(reply);
    if (parsedAnn && parsedAnn.malformed) {
      console.warn('[AnnouncementAction] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'ANNOUNCEMENT_ACTION', 'rejected', 'schema_invalid', null);
      reply = parsedAnn.cleanText || reply;
    } else if (parsedAnn) {
      const result = await applyAnnouncementAction(collab, parsedAnn);
      await logMarker(
        collab.id,
        'ANNOUNCEMENT_ACTION',
        result.ok ? 'executed' : 'rejected',
        result.ok
          ? `action=${result.action} count=${result.recipient_count ?? 0}`
          : result.reason,
        null
      );
      let base = parsedAnn.cleanText || '';
      if (result.ok && !base) {
        if (result.action === 'created') {
          base = `Comunicado criado para ${result.recipient_count} pessoa${result.recipient_count !== 1 ? 's' : ''}. ✓`;
        } else if (result.action === 'cancelled') {
          base = 'Comunicado cancelado. Retratação será enviada para quem já recebeu. ✓';
        }
      } else if (!result.ok && !base) {
        if (result.reason === 'no_recipients') {
          base = 'Nenhum colaborador encontrado para esse público. Verifica os filtros?';
        } else if (result.reason === 'no_active_announcement') {
          base = 'Não encontrei nenhum comunicado ativo para cancelar.';
        } else {
          base = 'Tive um erro ao criar o comunicado. Tenta de novo?';
        }
      }
      reply = base || reply;
    }
  }

  // Sprint 13 F3 T4 — <<ANNOUNCEMENT_APPROVAL>> — director aprova ou rejeita comunicado pendente.
  {
    const approvalMarker = parseAnnouncementApprovalMarker(reply);
    if (approvalMarker) {
      const approvalResult = await applyAnnouncementApproval(collab, approvalMarker);
      await logMarker(
        collab.id,
        'ANNOUNCEMENT_APPROVAL',
        approvalResult.ok ? 'executed' : 'rejected',
        approvalResult.ok
          ? `action=${approvalResult.action} count=${approvalResult.recipient_count ?? 0}`
          : approvalResult.reason,
        null
      );
      let base = '';
      if (approvalResult.ok) {
        const shortId = approvalResult.announcement_id.slice(0, 4);
        if (approvalResult.action === 'approved') {
          base = `Comunicado \`${shortId}\` aprovado. ${approvalResult.recipient_count} mensagem(ns) na fila de envio.`;
          if (approvalResult.jobs_error) {
            base += ` ⚠️ Erro ao enfileirar: ${approvalResult.jobs_error}. Broadcaster pode não enviar — verifique no PWA.`;
          }
        } else if (approvalResult.action === 'rejected') {
          base = `Comunicado \`${shortId}\` rejeitado. Coordinator foi notificado.`;
        }
      } else {
        base = approvalResult.reason || 'Tive um erro ao processar a aprovação. Tenta de novo?';
      }
      reply = base || reply;
    }
  }

  // Sprint 13 F2 — <<SCHOOL_EVENT_ACTION>> — criar/cancelar evento institucional.
  {
    const parsedEv = parseSchoolEventActionMarker(reply);
    if (parsedEv && parsedEv.malformed) {
      console.warn('[SchoolEventAction] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'SCHOOL_EVENT_ACTION', 'rejected', 'schema_invalid', null);
      reply = parsedEv.cleanText || reply;
    } else if (parsedEv) {
      const result = await applySchoolEventAction(collab, parsedEv);
      await logMarker(
        collab.id,
        'SCHOOL_EVENT_ACTION',
        result.ok ? 'executed' : 'rejected',
        result.ok
          ? `action=${result.action} ann_count=${result.announcement_count ?? 0}`
          : result.reason,
        null
      );
      let base = parsedEv.cleanText || '';
      if (result.ok && !base) {
        if (result.action === 'created') {
          base = `Evento criado. ${result.announcement_count} notificaç${result.announcement_count !== 1 ? 'ões' : 'ão'} agendada${result.announcement_count !== 1 ? 's' : ''}. ✓`;
        } else if (result.action === 'cancelled') {
          base = 'Evento cancelado. Notificações pendentes serão removidas. ✓';
        }
      } else if (!result.ok && !base) {
        if (result.reason === 'no_active_event') {
          base = 'Não encontrei nenhum evento ativo para cancelar.';
        } else {
          base = 'Tive um erro ao processar o evento. Tenta de novo?';
        }
      }
      reply = base || reply;
    }
  }

  // Sprint 16 — <<COORDINATION_REQUEST>> — repassar mensagem / cobrar / avisar outro colaborador.
  {
    const parsedCoord = parseCoordinationRequestMarker(reply);
    if (parsedCoord && parsedCoord.malformed) {
      console.warn('[CoordinationRequest] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'COORDINATION_REQUEST', 'rejected', 'schema_invalid', null);
      reply = parsedCoord.cleanText || reply;
    } else if (parsedCoord) {
      const result = await applyCoordinationRequestAction(collab, parsedCoord);
      await logMarker(
        collab.id,
        'COORDINATION_REQUEST',
        result.ok ? 'executed' : 'rejected',
        result.reason,
        null
      );
      reply = parsedCoord.cleanText || result.replyText || reply;
    }
  }

  // 2.67) Sprint 11.4 — Checkpoint batch. TOM emite quando produz checklist
  // estruturado (4+ itens) ligado a um projeto. Persiste como project_checkpoints.
  // Garante que checklist deixa de "virar fumaça em conversation_history" e vira
  // dado de primeira classe — refletido no PWA (ProjetoDetalhe → aba checkpoints).
  {
    const parsedCB = parseCheckpointBatchMarker(reply);
    if (parsedCB && parsedCB.malformed) {
      console.warn('[CheckpointBatch] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'CHECKPOINT_BATCH', 'rejected', 'schema_invalid', reply);
      reply = parsedCB.cleanText || reply;
    } else if (parsedCB) {
      const result = await applyCheckpointBatch(collab, parsedCB);
      const tagSlice = (s) => String(s || '').slice(0, 8);
      const ok = result.okCount > 0;
      const reason = ok
        ? `ok=${result.okCount} fail=${result.failCount} project=${tagSlice(result.projectId)}`
        : `none_inserted:${result.reason || 'unknown'}`;
      await logMarker(collab.id, 'CHECKPOINT_BATCH', ok ? 'executed' : 'rejected', reason, null);
      let base = parsedCB.cleanText || '';
      if (!ok) {
        const why = result.reason === 'project_not_found' ? 'não achei o projeto'
          : result.reason === 'project_not_exists' ? 'projeto não existe'
          : result.reason === 'permission_denied' ? 'sem permissão nesse projeto'
          : 'erro ao salvar';
        base = (base ? base + '\n\n' : '') + `_não consegui salvar o checklist (${why})_`;
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

    // 2.7b) Monthly plan
    const parsedMonthly = parseMonthlyPlanMarker(reply);
    if (parsedMonthly && parsedMonthly.malformed) {
      console.warn('[MonthlyPlan] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'MONTHLY_PLAN', 'rejected', 'schema_invalid', reply);
      reply = parsedMonthly.cleanText || reply;
    } else if (parsedMonthly) {
      try {
        const r = await applyMonthlyPlan(collab, parsedMonthly.plan);
        await logMarker(collab.id, 'MONTHLY_PLAN', 'executed', `${r.action}:${parsedMonthly.plan.action}:${parsedMonthly.plan.month_start}`, null);
        reply = parsedMonthly.cleanText || reply;
      } catch (err) {
        console.error('[MonthlyPlan] persist err:', err.message);
        await logMarker(collab.id, 'MONTHLY_PLAN', 'rejected', `persist_error:${err.message}`, null);
        const base = parsedMonthly.cleanText || '';
        reply = (base ? base + '\n\n' : '') + '_não rolou salvar agora, mas seu plano mensal tá registrado em conversa. Tenta de novo daqui a pouco?_';
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

  // Sprint 16 — <<COORDINATION_RESPONSE>> — recipient respondeu a um recado aberto.
  {
    const parsedCoordResp = parseCoordinationResponseMarker(reply);
    if (parsedCoordResp && parsedCoordResp.malformed) {
      console.warn('[CoordinationResponse] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'COORDINATION_RESPONSE', 'rejected', 'schema_invalid', null);
      reply = parsedCoordResp.cleanText || reply;
    } else if (parsedCoordResp) {
      const result = await applyCoordinationResponseAction(collab, parsedCoordResp);
      await logMarker(
        collab.id,
        'COORDINATION_RESPONSE',
        result.ok ? 'executed' : 'rejected',
        result.reason,
        null
      );
      reply = parsedCoordResp.cleanText || reply;
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
      // Sprint 19 hotfix: pattern original `\btabela\s+[a-z_]` pegava "tabela promocional",
      // "tabela de preços" e outras frases legítimas em pt-BR. Causou TOM a responder
      // "_tive um problema interno aqui_" repetidamente (regressão grave de UX).
      // Apertado para snake_case com underscore (convenção DB) que é o real tell de leak.
      String.raw`\btabela\s+\w+_\w+`,
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

  // Sprint 10.1: detecta regressão silenciosa — user pediu ação mas
  // nenhum marker foi emitido (TOM disse "Anotado!" mas DB ficou vazio).
  // Query marker_logs por ações 'executed' deste user desde o início desta msg.
  try {
    const ACTIONABLE_RE = /\b(anota|me\s+lembra|lembra\s+(?:de|do|da)\b|lembrete|me\s+chama|preciso|surgiu|p[oó]e\s+na\s+lista|adiciona|paguei|fiz|terminei|fechei|completei|delega|marca\s+(?:reuni|m[eé]dico|consulta|ensaio|encontro|aula))/i;
    if (ACTIONABLE_RE.test(String(text || ''))) {
      _metrics.actionable_intent = true;
      const sinceIso = new Date(_t0 - 1000).toISOString();
      const { data: recentMarkers } = await supabase
        .from('marker_logs')
        .select('marker_type')
        .eq('collaborator_id', collab.id)
        .eq('result', 'executed')
        .gte('created_at', sinceIso);
      const fired = (recentMarkers || []).map(r => r.marker_type).filter(t =>
        t && !['LEAK_BLOCKED','UNKNOWN_MARKER_STRIPPED','TOOL_CALL_STRIPPED','PROVIDER'].includes(t));
      if (fired.length === 0) {
        console.warn(`[Engine] ACTIONABLE_NO_MARKER — text="${String(text).slice(0,80)}" reply="${String(reply).slice(0,100)}"`);
        await logMarker(collab.id, 'ACTIONABLE_NO_MARKER', 'rejected',
          `text:${String(text).slice(0,200)}`, String(reply).slice(0,500));
      } else {
        _metrics.marker_emitted = fired.join(',').slice(0, 100);
        _metrics.marker_result = 'executed';
      }
    }
  } catch (e) { /* metric never breaks main flow */ }

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
  // Sprint 11.1: daily_briefing agora é UNIFICADO (pessoal + trabalho na mesma msg).
  // briefing_pessoal e briefing_trabalho ficam como fallback manual.
  const ritualKey = ritualType === 'daily_briefing' ? 'briefing_diario'
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
  // Sprint 11.1: daily_briefing → briefing_diario (unificado pessoal + trabalho).
  if (type === 'daily_briefing') return '[RITUAL: briefing_diario]';
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

async function computeProgress(scope, collabId, refDateOrProjectId, opts = {}) {
  const context = opts.context || 'all';
  let start, end, isProject = false;
  if (scope === 'project') {
    isProject = true;
  } else {
    const ref = new Date(refDateOrProjectId + 'T12:00:00');
    if (scope === 'day') {
      start = end = refDateOrProjectId;
    } else if (scope === 'week') {
      const dow = ref.getDay();
      const monOffset = dow === 0 ? -6 : 1 - dow;
      const mon = new Date(ref); mon.setDate(ref.getDate() + monOffset);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      start = mon.toISOString().slice(0,10);
      end   = sun.toISOString().slice(0,10);
    } else if (scope === 'month') {
      const y = ref.getFullYear(), m = ref.getMonth();
      start = new Date(y, m, 1).toISOString().slice(0,10);
      end   = new Date(y, m+1, 0).toISOString().slice(0,10);
    } else {
      throw new Error(`computeProgress: scope inválido ${scope}`);
    }
  }
  let q = supabase.from('tasks').select('status, context', { count: 'exact' })
    .eq('assigned_to', collabId).neq('status','cancelled');
  if (isProject) {
    q = q.eq('project_id', refDateOrProjectId);
  } else {
    q = q.gte('due_date', start).lte('due_date', end);
  }
  if (context !== 'all') q = q.eq('context', context);
  const { data, count } = await q;
  const total = count || 0;
  if (total === 0) {
    return { pct: null, done: 0, total: 0, scope, period: isProject ? null : { start, end }, empty: true };
  }
  const done = (data || []).filter(t => t.status === 'done').length;
  return { pct: Math.round((done/total)*100), done, total, scope,
           period: isProject ? null : { start, end }, empty: false };
}

async function getRitualIntroDecision(collabId, ritualType) {
  const { data } = await supabase
    .from('ritual_logs')
    .select('status, created_at')
    .eq('collaborator_id', collabId)
    .eq('ritual_type', ritualType)
    .order('created_at', { ascending: false })
    .limit(5);
  if (!data || data.length === 0) return 'show_intro';
  const wasInstructed = data.some(r => r.status === 'sent');
  if (wasInstructed) return 'send_ritual';
  const recent = data.slice(0, 3);
  if (recent.length === 3 && recent.every(r => ['intro_shown','skipped'].includes(r.status))) {
    return 'skip_saturated';
  }
  return 'show_intro';
}

async function countRecentRelaysToRecipient(requesterId, recipientId, refDate) {
  const start = new Date(refDate); start.setHours(0,0,0,0);
  const end   = new Date(refDate); end.setHours(23,59,59,999);
  const { count } = await supabase
    .from('coordination_requests')
    .select('id', { count: 'exact', head: true })
    .eq('requester_id', requesterId)
    .eq('recipient_id', recipientId)
    .in('status', ['sent','responded'])
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());
  return count || 0;
}

async function buildRelayLimitHint(requesterId) {
  const start = new Date(); start.setHours(0,0,0,0);
  const end   = new Date(); end.setHours(23,59,59,999);
  const { data } = await supabase
    .from('coordination_requests')
    .select('recipient_id, recipient:collaborators!coordination_requests_recipient_id_fkey(full_name)')
    .eq('requester_id', requesterId)
    .in('status', ['sent','responded'])
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());
  if (!data?.length) return null;
  const counts = new Map();
  const names  = new Map();
  for (const row of data) {
    counts.set(row.recipient_id, (counts.get(row.recipient_id) || 0) + 1);
    if (row.recipient?.full_name) names.set(row.recipient_id, row.recipient.full_name.split(' ')[0]);
  }
  const heavy = [...counts.entries()]
    .filter(([_, n]) => n >= 5)
    .map(([id, n]) => `- ${names.get(id) || 'destinatário'}: ${n} relays hoje`);
  if (!heavy.length) return null;
  return `[RELAY_LIMIT_HINT]\nCanal saturado com:\n${heavy.join('\n')}\n\nAntes de emitir novo relay para esses destinatários específicos, sugira ao usuário falar direto. Não bloqueie — avise: "Você já usou o TOM N vezes com [nome] hoje. Posso mandar esse, mas talvez valha falar direto com ele/ela depois dessa." Para destinatários não listados acima, opere normalmente.`;
}

// Parse <<MONTHLY_PLAN>>{...}<<END>> — monthly planning marker.
// action='plan' (default) creates/updates the monthly plan; action='close' closes it with wins + retrospective.
function parseMonthlyPlanMarker(text) {
  if (!text) return null;
  const re = /<<MONTHLY_PLAN>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let plan = null;
  try {
    plan = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('MONTHLY_PLAN', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    logSchemaErr('MONTHLY_PLAN', ['not_object'], plan);
    return { malformed: true, cleanText };
  }
  if (!plan.month_start || typeof plan.month_start !== 'string') {
    logSchemaErr('MONTHLY_PLAN', ['month_start:missing_or_invalid'], plan);
    return { malformed: true, cleanText };
  }
  return {
    plan: {
      month_start: plan.month_start,
      goals: Array.isArray(plan.goals) ? plan.goals : [],
      carry_over_notes: plan.carry_over_notes || null,
      wins: Array.isArray(plan.wins) ? plan.wins : [],
      retrospective_notes: plan.retrospective_notes || null,
      action: plan.action === 'close' ? 'close' : 'plan'
    },
    cleanText,
    malformed: false
  };
}

// Persist a monthly plan: monthly_plans table.
// Idempotent on (collaborator_id, month_start) — re-running for the same month updates the row.
// action='close' additionally sets status='completed', wins, and retrospective_notes.
async function applyMonthlyPlan(collaborator, plan) {
  const collId = collaborator.id;
  const { data: existing } = await supabase
    .from('monthly_plans')
    .select('id')
    .eq('collaborator_id', collId)
    .eq('month_start', plan.month_start)
    .maybeSingle();
  const payload = {
    collaborator_id: collId,
    month_start: plan.month_start,
    goals: plan.goals,
    carry_over_notes: plan.carry_over_notes,
    updated_at: new Date().toISOString()
  };
  if (plan.action === 'close') {
    payload.status = 'completed';
    payload.wins = plan.wins;
    payload.retrospective_notes = plan.retrospective_notes;
  }
  if (existing) {
    const { error } = await supabase.from('monthly_plans').update(payload).eq('id', existing.id);
    if (error) throw new Error(error.message);
    return { id: existing.id, action: 'updated' };
  }
  const { data: created, error } = await supabase
    .from('monthly_plans').insert(payload).select('id').single();
  if (error) throw new Error(error.message);
  return { id: created?.id, action: 'created' };
}

module.exports = { processMessage, sendRitual, sendCoordinatorReport, buildTeamSummary, buildWeeklyRetrospective, parseOnboardingMarker, persistOnboarding, parseMemoryMarker, parseProjectMarker, parseTaskUpdateMarker, parseWeeklyPlanMarker, parseHabitMarker, parseDndMarker, persistMemoryRows, persistProject, applyTaskActions, applyWeeklyPlan, applyHabitActions, applyDnd, getDndState, consolidateMemoryFor, decayExpiredMemories, looksLikeMemory, resolveTaskByShortId, applyAnnouncementAction, parseAnnouncementApprovalMarker, applyAnnouncementApproval, applyCoordinationRequestAction, parseCoordinationResponseMarker, applyCoordinationResponseAction, computeProgress, getRitualIntroDecision, countRecentRelaysToRecipient, buildRelayLimitHint, parseMonthlyPlanMarker, applyMonthlyPlan };
