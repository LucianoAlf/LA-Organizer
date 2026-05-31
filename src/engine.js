// src/engine.js — Pipeline principal: webhook → identifica colaborador →
// constrói system prompt rico (SOUL+AGENTS+contexto Supabase) → chama Claude.
// Phase 1: Onboarding state machine via marker block + ritual entry point.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const collaboratorService = require('./services/collaborator');
const collabResolver = require('./services/collaborator-resolver');
const whatsapp = require('./services/whatsapp');
const metricsService = require('./services/metrics');
const ai = require('./ai/provider');
const { buildSystemPrompt, formatMessages } = require('./prompts/system');
const { safeIsoDate, safeDate, withinConfirmWindow } = require('./utils/dates');
const { hasCoordLevel, isDirector, canCreateForOther } = require('./utils/roles');
const supabase = require('./supabase/client');
const OpenAI = require('openai');
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const inventarioService = require('./services/inventario-service');
const inventarioValidators = require('./services/inventario-validators');
const announcementsService = require('./services/announcements');
const pendingIntents = require('./services/pending-intents');
const { buildCoordinationResponseNotification } = require('./services/coordination-notify');
const { isContextQuietField, validateContextQuietField } = require('./services/prefs-quiet-context');
const financeService = require('./services/financeiro-service');
const { mapCategory, normalizeParams } = require('./finance/categorize');
const { crossedThreshold, buildBudgetAlert } = require('./finance/budget-alert');
const { monthsToGoalSimple, monthsToGoalWithInterest, formatMonths, futureValue } = require('./finance/projection');
const selic = require('./services/selic');
const audioDecompose = require('./services/audio-decompose');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

// LA Report — formatador de card de item de inventário (usado por <<INVENTORY_ACTION>> action="ver").
function formatarCardItem(it) {
  const sala = (it.salas && it.salas.nome) || 'sem sala';
  const unid = (it.salas && it.salas.unidades && it.salas.unidades.nome) || '';
  const cond = it.condicao || '?';
  const valor = it.valor_compra ? `R$ ${it.valor_compra}` : 's/ valor';
  const proxRev = it.proxima_revisao ? ` · Próx revisão: ${it.proxima_revisao}` : '';
  return `🎵 *${it.nome}* (${sala}${unid ? ` · ${unid}` : ''})\n• Condição: ${cond}\n• ${valor}${proxRev}`;
}

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
// Aceita short-id (prefixo hex 4-12 chars, ex: "56768dfc") OU UUID completo.
// O bloco [COBRANÇAS ABERTAS] no system prompt entrega target_id como UUID
// inteiro e manda o LLM usar esse id no marker — sem a alternativa de UUID
// abaixo, complete/reschedule/cancel viravam schema_invalid (bug Anne 29/05).
const SHORT_ID_RE = /^([a-f0-9]{4,12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const VALID_TASK_ACTIONS = new Set([
  'complete', 'cancel', 'reschedule', 'create', 'delegate',
  'extension_request', 'extension_decision',
]);
const VALID_COACHING = ['light', 'normal', 'hard'];
const VALID_EVENT_MODALITIES = new Set(['online', 'presencial', 'hibrido']);
// Sprint 23.5 — estado pendente de dup microconfirm por collab.
// Quando engine detecta dup e envia microconfirm 1/2/3, guarda o item aqui.
// Quando user responde "2", o engine aplica diretamente com bypass
// sem depender da LLM emitir o campo (que provou ser não-confiável em 11/05/2026).
const pendingDupEvents = new Map(); // collabId → { event, timestamp }
const pendingDupTasks  = new Map(); // collabId → { task, timestamp }
// Sprint 22.26 — VALID_EVENT_CATEGORIES era set fixo; agora a validacao acontece
// em runtime via lookupEventCategoryBySlug (tabela event_categories). Removido.
const VALID_EVENT_UPDATE_ACTIONS = new Set(['reschedule', 'cancel', 'complete', 'update']);
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
    // Aceita `text` ou `value` como sinônimos de `content` (TOM às vezes usa esses nomes).
    const contentVal = (typeof r.content === 'string' && r.content.trim())
      ? r.content
      : (typeof r.text === 'string' && r.text.trim())
        ? r.text
        : (typeof r.value === 'string' && r.value.trim())
          ? r.value
          : null;
    if (!r || !contentVal) {
      dropped.push(`row[${i}]:missing_content`);
      continue;
    }
    r.content = contentVal; // normaliza pro campo canônico
    validRows.push(r);
  }
  if (dropped.length) logSchemaErr('MEMORY_SAVE', dropped, parsed);
  if (!validRows.length) return { malformed: true, cleanText };
  return { rows: validRows, cleanText, malformed: false };
}

// Parse <<DATA_CLASSIFY>>{...}<<END>> — Sprint 29.1
// Marca tasks/events como teste/real/arquivado. Opcionalmente aprende padrão
// pra próximas inserções automáticas.
// Formato esperado:
//   {"items":[{"type":"task","id":"<uuid>","classification":"test"}],"learn_pattern":true}
function parseDataClassifyMarker(text) {
  if (!text) return null;
  const re = /<<DATA_CLASSIFY>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('DATA_CLASSIFY', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
    logSchemaErr('DATA_CLASSIFY', ['missing_items'], parsed);
    return { malformed: true, cleanText };
  }
  const items = parsed.items.filter(i =>
    i && typeof i === 'object'
    && (i.type === 'task' || i.type === 'event')
    && typeof i.id === 'string' && i.id.length > 0
    && ['real', 'test', 'archived'].includes(i.classification)
  );
  if (items.length === 0) {
    logSchemaErr('DATA_CLASSIFY', ['no_valid_items'], parsed);
    return { malformed: true, cleanText };
  }
  return {
    items,
    learnPattern: parsed.learn_pattern === true,
    cleanText,
    malformed: false,
  };
}

// Aplica DATA_CLASSIFY: atualiza data_classification em tasks/events +
// aprende padrão de title_contains se learn_pattern=true.
async function applyDataClassify(collaborator, parsed) {
  const { applyClassification } = require('./services/data-classifier');
  const results = [];
  for (const item of parsed.items) {
    const targetType = item.type === 'task' ? 'tasks' : 'events';
    const r = await applyClassification({
      collaboratorId: collaborator.id,
      targetType,
      targetId: item.id,
      classification: item.classification,
      learnPattern: parsed.learnPattern,
    });
    results.push({ id: item.id, type: item.type, ...r });
  }
  return results;
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
  // Tolera alias 'checkpoints' que o LLM às vezes usa em vez de 'items'
  const rawItems = Array.isArray(parsed.items) ? parsed.items
    : Array.isArray(parsed.checkpoints) ? parsed.checkpoints
    : null;
  if (!rawItems || rawItems.length === 0) {
    logSchemaErr('CHECKPOINT_BATCH', ['items:empty_or_not_array'], parsed);
    return { malformed: true, cleanText };
  }
  // Threshold mínimo: 2 items (regra de "não vira batch pra listinha trivial").
  // Skill orienta 4+ mas engine aceita 2+ pra flexibilidade.
  if (rawItems.length < 2) {
    logSchemaErr('CHECKPOINT_BATCH', ['items:below_threshold_2'], parsed);
    return { malformed: true, cleanText };
  }
  // Tolera alias 'title' em vez de 'name' (LLM às vezes usa o nome do campo errado)
  const normalizedItems = rawItems.map(item => {
    if (item && typeof item === 'object' && !item.name && item.title) {
      return { ...item, name: String(item.title) };
    }
    return item;
  });
  const valid = [];
  const dropped = [];
  for (let i = 0; i < normalizedItems.length; i++) {
    const why = validateCheckpointItem(normalizedItems[i]);
    if (why) dropped.push(`item[${i}]:${why}`);
    else valid.push(normalizedItems[i]);
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

// ============================================================
// Sprint 23 — 3 markers novos pra fluxo de checklist via WhatsApp:
// CHECKLIST_ATTACHMENT, DERIVE_TASK, CHECKLIST_JUSTIFY
// ============================================================

function parseChecklistAttachmentMarker(text) {
  if (!text) return null;
  const m = text.match(/<<CHECKLIST_ATTACHMENT>>\s*([\s\S]*?)\s*<<END>>/i);
  if (!m) return null;
  try {
    const json = JSON.parse(m[1].trim());
    if (!json.completion_id || !json.item_id || !json.media_id || !json.mime_type) return null;
    return json;
  } catch { return null; }
}

async function applyChecklistAttachment({ completion_id, item_id, mime_type, file_name, media_id, collaborator }) {
  const mediaUrl = `${process.env.UAZAPI_URL}/media/${media_id}`;
  const resp = await fetch(mediaUrl, { headers: { token: process.env.UAZAPI_TOKEN } });
  if (!resp.ok) throw new Error(`UAZAPI media fetch falhou: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());

  const { data: ic, error: icErr } = await supabase
    .from('op_checklist_item_completions')
    .select('id')
    .eq('completion_id', completion_id)
    .eq('item_id', item_id)
    .maybeSingle();
  if (icErr) throw icErr;
  if (!ic) throw new Error('item_completion não existe — colab precisa marcar/desmarcar o item primeiro');

  const ext = (mime_type.split('/')[1] || 'bin').toLowerCase();
  const path = `work/${collaborator.id}/${ic.id}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('checklist-attachments')
    .upload(path, buf, { contentType: mime_type, cacheControl: '3600' });
  if (upErr) throw upErr;

  const { error: insErr } = await supabase.from('checklist_attachments').insert({
    scope: 'work',
    item_completion_id: ic.id,
    storage_path: path,
    file_name: file_name || `anexo.${ext}`,
    mime_type,
    size_bytes: buf.byteLength,
    uploaded_by: collaborator.id,
  });
  if (insErr) throw insErr;

  console.log(`[ChecklistAttachment] OK item_completion=${ic.id} path=${path}`);
  return { ok: true, path };
}

function parseDeriveTaskMarker(text) {
  if (!text) return null;
  const m = text.match(/<<DERIVE_TASK>>\s*([\s\S]*?)\s*<<END>>/i);
  if (!m) return null;
  try {
    const json = JSON.parse(m[1].trim());
    if (!json.completion_id || !json.item_id || !json.title) return null;
    return json;
  } catch { return null; }
}

async function applyDeriveTask({ completion_id, item_id, title, description, collaborator }) {
  const { data: task, error: tErr } = await supabase
    .from('tasks')
    .insert({
      owner_id: collaborator.id,
      title,
      description: description || null,
      status: 'open',
      context: 'work',
      created_via: 'tom_checklist_derive',
    })
    .select('id')
    .single();
  if (tErr) throw tErr;

  const { error: linkErr } = await supabase
    .from('op_checklist_item_completions')
    .upsert({
      completion_id,
      item_id,
      derived_task_id: task.id,
    }, { onConflict: 'completion_id,item_id' });
  if (linkErr) throw linkErr;

  console.log(`[DeriveTask] OK task=${task.id} from completion=${completion_id} item=${item_id}`);
  return { ok: true, task_id: task.id };
}

function parseChecklistJustifyMarker(text) {
  if (!text) return null;
  const m = text.match(/<<CHECKLIST_JUSTIFY>>\s*([\s\S]*?)\s*<<END>>/i);
  if (!m) return null;
  try {
    const json = JSON.parse(m[1].trim());
    if (!json.completion_id || !json.justification) return null;
    return json;
  } catch { return null; }
}

async function applyChecklistJustify({ completion_id, justification, collaborator }) {
  const { error } = await supabase
    .from('op_checklist_completions')
    .update({
      justification,
      justified_at: new Date().toISOString(),
      justified_by_id: collaborator.id,
    })
    .eq('id', completion_id);
  if (error) throw error;
  console.log(`[ChecklistJustify] OK completion=${completion_id}`);
  return { ok: true };
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
  // Sprint 30 — aceita "latest" quando o user responde APROVAR/REJEITAR sem ID
  // (UI nova omite o ID; CEO usa reply do WhatsApp ou contexto da última msg).
  // applyAnnouncementApproval resolve "latest" pegando o pending_approval mais
  // recente.
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

// Sprint 30 hotfix — Wrapper que delega pro service consolidado. Mantém
// assinatura legacy { count, error } pros callers existentes (applyAnnouncementApproval).
// Substituiu cópia bugada que não conhecia `collaborator_ids` nem `role`.
async function createAnnouncementJobs(ann) {
  const result = await announcementsService.createJobsFromAudience(ann.id, ann.audience);
  return { count: result.count || 0, error: result.error || null };
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
  // Sprint 30 — "latest" pula filtro de id e pega o pending_approval mais recente.
  // Usado quando o CEO responde só "APROVAR"/"REJEITAR" sem citar ID (UI nova
  // omite o ID na notificação — aproveita o comportamento natural de reply).
  if (idValue === 'latest') {
    // sem filtro de id; .order().limit(1) abaixo pega o mais recente
  } else if (idValue.length === 4) {
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
    // Sprint 30 Caminho C — Re-valida audience no momento da aprovação.
    // Se algum collaborator foi desativado entre submit e approve (ou se
    // collaborator_ids eram alucinação do LLM que passou pela criação),
    // resolve a 0 destinatários → marca announcement como failed e avisa.
    const preview = await announcementsService.resolveAudienceRecipients(ann.audience);
    if (preview.count === 0) {
      console.warn(`[applyAnnouncementApproval] approval abortada — audience resolve a 0 destinatários para announcement ${ann.id}`);
      await supabase
        .from('announcements')
        .update({
          status: 'cancelled',
          reviewed_by: collaborator.id,
          rejection_reason: 'audience_resolves_to_zero_at_approval',
          updated_at: new Date().toISOString(),
        })
        .eq('id', ann.id);
      return { ok: false, reason: 'audience_resolves_to_zero_at_approval', announcement_id: ann.id };
    }

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
  const { action, body, audience, scheduled_at, announcement_id, requires_confirmation, confirmation_question } = parsed;

  // GUARD A (Sprint 30 hotfix v2) — Quem pode criar/cancelar comunicados:
  // qualquer colaborador com nível operacional de coordenador (director,
  // coordinator, manager com flag, ou collaborator com has_coord_permissions=true,
  // ex: assistentes pedagógicos como Léo, Dai, Jordan, Ramon, Renan, Rodrigo,
  // Matheus Felipe, Kinho, Peterson, Hugo, Rafinha, John).
  // Farmers (Arthur, Gabi) e collaborators sem a flag NÃO podem.
  // Lógica centralizada em utils/roles.js hasCoordLevel().
  if (!hasCoordLevel(collaborator)) {
    console.warn(`[applyAnnouncementAction] negado: collaborator ${collaborator.id} role=${collaborator.role} has_coord_permissions=${collaborator.has_coord_permissions} tentou ${action}`);
    return { ok: false, reason: 'no_permission' };
  }

  // GUARD B (Sprint 30 hotfix) — Para action=create, audience precisa ser válido
  // (ao menos uma chave de filtro com array não-vazio, OU all:true).
  // GUARD C (Sprint 30 Caminho C) — Resolve audience semanticamente. Se LLM
  // alucinou UUIDs ou cargo inexistente e resolve a 0 pessoas, rejeita marker
  // ANTES de criar announcement (evita "comunicado fantasma" aprovado sem disparo).
  let resolvedAudience = null;
  if (action === 'create') {
    const v = announcementsService.validateAudience(audience);
    if (!v.valid) {
      console.warn(`[applyAnnouncementAction] audience inválida (${v.reason}) — recusando create`);
      return { ok: false, reason: `audience_invalid:${v.reason}` };
    }
    resolvedAudience = await announcementsService.resolveAudienceRecipients(audience);
    if (resolvedAudience.count === 0) {
      console.warn(`[applyAnnouncementAction] audience resolve pra 0 destinatários — recusando create`);
      return { ok: false, reason: 'audience_resolves_to_zero' };
    }
    if (resolvedAudience.missing_collaborator_ids?.length) {
      console.warn(`[applyAnnouncementAction] collaborator_ids não encontrados: ${resolvedAudience.missing_collaborator_ids.join(',')} — seguindo só com os ${resolvedAudience.count} válidos`);
    }
  }

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
    // Sprint 30 hotfix v2 — Director pula aprovação (autoridade própria).
    // Qualquer outro com nível operacional de coord (manager, coordinator,
    // collaborator+flag) precisa de aprovação de director.
    const needsApproval = !isDirector(collaborator);

    const { data: ann, error: annErr } = await supabase
      .from('announcements')
      .insert({
        created_by: collaborator.id,
        body: body.trim(),
        audience: audience || { all: true },
        status: needsApproval ? 'pending_approval' : 'scheduled',
        scheduled_at: scheduled_at || null,
        requires_confirmation: !!requires_confirmation,
        confirmation_question: requires_confirmation && typeof confirmation_question === 'string'
          ? confirmation_question.slice(0, 200)
          : null,
      })
      .select('id')
      .single();
    if (annErr) return { ok: false, reason: annErr.message };

    if (needsApproval) {
      // Sprint 30 — só o CEO recebe aprovação. Outros directors (Anne, Admin)
      // usam o TOM como usuários, não como aprovadores.
      const { data: directors, error: dirErr } = await supabase
        .from('collaborators')
        .select('id, full_name, phone')
        .eq('is_ceo', true)
        .not('phone', 'is', null);

      if (dirErr) {
        console.error('[applyAnnouncementAction] Falha ao buscar CEO:', dirErr.message);
        // Don't compensating-delete the announcement — it's still valid in pending_approval and CEO can approve via PWA later.
        return { ok: false, reason: dirErr.message, announcement_id: ann.id };
      }

      const shortId = ann.id.slice(0, 4);
      const audienceStr = describeAudience(parsed.audience);
      // Sprint 30 Caminho C — preview enriquecido com contagem real e nomes
      // resolvidos do banco. Se houver UUIDs alucinados, lista os ausentes.
      const recipientNames = (resolvedAudience?.recipients || []).map(r => r.full_name);
      const audienceDetail = resolvedAudience
        ? `${audienceStr} — *${resolvedAudience.count} pessoa${resolvedAudience.count === 1 ? '' : 's'}*: ${recipientNames.join(', ')}`
        : audienceStr;
      const missingWarning = resolvedAudience?.missing_collaborator_ids?.length
        ? `\n⚠️ *Atenção:* ${resolvedAudience.missing_collaborator_ids.length} ID(s) solicitado(s) não foram encontrados no banco — seguindo só com os ${resolvedAudience.count} válidos.`
        : '';
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
            `De: ${collaborator.full_name} (${collaborator.role}${collaborator.function_role ? ` · ${collaborator.function_role}` : ''})`,
            `Para: ${audienceDetail}${missingWarning}`,
            `Mensagem: "${bodyPreview}"`,
            ``,
            `Responda *APROVAR* ou *REJEITAR [motivo opcional]*.`,
          ].join('\n'));
        } catch (err) {
          console.error(`[applyAnnouncementAction] Falha ao notificar director ${director.id}:`, err.message);
        }
      }

      return { ok: true, action: 'pending_approval', announcement_id: ann.id, recipient_count: directors.length };
    }

    // Sprint 30 hotfix — Director cria comunicado direto: delega resolução de
    // audience pro service consolidado (suporta role, function_role, unidade,
    // turno, collaborator_ids, e rejeita audience vazio).
    const jobsResult = await announcementsService.createJobsFromAudience(ann.id, audience);
    if (jobsResult.error) {
      // compensate: remove the orphaned announcement row
      await supabase.from('announcements').delete().eq('id', ann.id);
      return { ok: false, reason: jobsResult.error };
    }
    if (jobsResult.count === 0) {
      // empty_audience ou nenhum match de filtro: também rollback pra não
      // deixar announcement orfão em scheduled sem jobs.
      await supabase.from('announcements').delete().eq('id', ann.id);
      return { ok: false, reason: jobsResult.empty_audience ? 'empty_audience' : 'no_recipients' };
    }

    return { ok: true, action: 'created', announcement_id: ann.id, recipient_count: jobsResult.count };
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
  const eventDayUtc = safeDate(eventDate ? eventDate + 'T12:00:00Z' : null);
  if (!eventDayUtc) {
    console.error(`[institutional_event_kit] eventDate inválido: ${JSON.stringify(eventDate)} — abortando criação de tasks`);
    return { ok: false, error: 'invalid_event_date' };
  }
  const remindAtIso = safeIsoDate(eventDayUtc.getTime() - 24 * 60 * 60 * 1000);

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
        if (spec.audience.function_role?.length) q = q.in('role', spec.audience.function_role);
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

// Sprint 16 → revisão 26/05 — Marker <<COORDINATION_REQUEST>>.
// Bug histórico: engine só processava o PRIMEIRO marker, ignorando os outros
// silenciosamente. Caso 22/05 do Jereh: pediu pra mandar pra 4 pessoas (Luciano,
// Yuri, John, Rafinha), LLM emitiu 4 markers, engine processou só 1 — Rafinha
// nunca recebeu. Agora retorna ARRAY de items, caller itera.
function parseCoordinationRequestMarker(text) {
  if (!text) return null;
  const reG = /<<COORDINATION_REQUEST>>\s*([\s\S]*?)\s*<<END>>/gi;
  const matches = [...text.matchAll(reG)];
  if (!matches.length) return null;
  const cleanText = text.replace(reG, '').trim();

  const items = [];
  const malformedReasons = [];
  for (let i = 0; i < matches.length; i++) {
    let parsed;
    try {
      parsed = JSON.parse(matches[i][1].trim());
    } catch (err) {
      logSchemaErr('COORDINATION_REQUEST', [`marker[${i}]:invalid_json: ${err.message}`], matches[i][1]);
      malformedReasons.push(`marker[${i}]:invalid_json`);
      continue;
    }
    if (!parsed || typeof parsed !== 'object') {
      malformedReasons.push(`marker[${i}]:not_object`);
      continue;
    }
    if (!parsed.recipient_name || typeof parsed.recipient_name !== 'string') {
      logSchemaErr('COORDINATION_REQUEST', [`marker[${i}]:recipient_name:missing`], parsed);
      malformedReasons.push(`marker[${i}]:recipient_name`);
      continue;
    }
    if (!['relay_literal', 'relay_assisted', 'followup'].includes(parsed.mode)) {
      logSchemaErr('COORDINATION_REQUEST', [`marker[${i}]:mode:invalid`], parsed);
      malformedReasons.push(`marker[${i}]:mode`);
      continue;
    }
    if (!parsed.message_body || typeof parsed.message_body !== 'string') {
      logSchemaErr('COORDINATION_REQUEST', [`marker[${i}]:message_body:missing`], parsed);
      malformedReasons.push(`marker[${i}]:message_body`);
      continue;
    }
    items.push({
      recipient_name:           String(parsed.recipient_name).trim(),
      mode:                     parsed.mode,
      message_body:             String(parsed.message_body).trim(),
      message_original:         parsed.message_original ? String(parsed.message_original).trim() : null,
      expects_response:         Boolean(parsed.expects_response),
      response_deadline_hours:  parsed.response_deadline_hours ? Number(parsed.response_deadline_hours) : null,
    });
  }

  if (items.length === 0) {
    return { malformed: true, cleanText, reasons: malformedReasons };
  }
  if (matches.length > 1) {
    console.log(`[CoordinationRequest] processing ${items.length} markers (${malformedReasons.length} malformed dropped)`);
  }
  return { items, cleanText };
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
async function applyCoordinationResponseAction(collab, parsed, inboundText) {
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

  const recipientFirstName = _displayName(collab);

  if (requester?.phone) {
    // Ancorar na fala VERBATIM do recipient (registro real). O resumo do LLM
    // entra separado/rotulado; sem verbatim, NÃO parafraseia. Ver
    // services/coordination-notify.js e docs/bugfix-coordination-response-2026-05-29.md.
    const msg = buildCoordinationResponseNotification({
      recipientFirstName,
      inboundText,
      summary: parsed.response_summary,
    });
    try {
      await whatsapp.sendMessage(requester.phone, msg);
      await logConversation(requester.id, 'outbound', msg);
    } catch (sendErr) {
      console.error('[CoordinationResponse] notify requester err:', sendErr.message);
    }
  }

  // Cascata: mata outras requests órfãs do mesmo recipient com conteúdo
  // similar ao body da req respondida — evita que uma resposta antiga seja
  // "reaproveitada" 12h depois numa request que ficou pendente.
  // Bug 25/05 (Juliana): REQ A (20:25) e REQ B (20:45) com mesma pergunta;
  // resposta matou só B, A ficou viva e foi casada hoje 07:47 com msg nova.
  try {
    const candNorm = normalizeForSim(req.message_body || '');
    const { data: siblings } = await supabase
      .from('coordination_requests')
      .select('id, message_body')
      .eq('recipient_id', collab.id)
      .eq('mode', req.mode)
      .eq('status', 'sent')
      .neq('id', req.id)
      .gte('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString());
    let cascaded = 0;
    for (const sib of (siblings || [])) {
      const score = jaroWinkler(candNorm, normalizeForSim(sib.message_body || ''));
      if (score >= 0.6) {
        await supabase
          .from('coordination_requests')
          .update({
            status: 'responded',
            responded_at: new Date().toISOString(),
            response_summary: parsed.response_summary,
            cancelled_reason: `cascade_from:${req.id.slice(0,8)}`,
          })
          .eq('id', sib.id);
        cascaded++;
      }
    }
    if (cascaded > 0) {
      console.log(`[CoordinationResponse] cascade closed ${cascaded} sibling(s) of req=${req.id.slice(0,8)}`);
    }
  } catch (cascadeErr) {
    console.warn('[CoordinationResponse] cascade err (non-fatal):', cascadeErr.message);
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

// Sprint 16 → 23.15 UX §6 — display name de qualquer pessoa (requester ou recipient).
// Prefere preferred_name (codinome consciente, ex: "Alf" pra "Luciano Alf").
// Fallback: primeiro nome do full_name. Tom mais leve no relay — sem títulos.
function _displayName(person) {
  if (!person) return 'Alguém';
  const preferred = (person.preferred_name || '').trim();
  if (preferred) return preferred;
  const firstName = (person.full_name || '').split(' ')[0];
  return firstName || 'Alguém';
}
// Alias legacy pra calls existentes.
const _requesterDisplayName = _displayName;

// Bug B2 fix (Radar pós-Sprint19): quando IntegrityCheck bloqueia criação,
// substitui qualquer texto otimista que o LLM possa ter gerado ("✅ Registrado!")
// por uma microconfirmação clara. Determinístico no engine, não confia no Claude.
function _buildIntegrityConfirmText(payload) {
  // Desambiguação de homônimos: payload carrega os candidatos; pergunta direta.
  if (payload && payload.type === 'ambiguous_recipient') {
    return collabResolver.buildAmbiguityQuestion(payload.candidates);
  }
  if (!payload) return '_não consegui registrar agora, te aviso depois_';
  const cand = String(payload.candidateTitle || '').slice(0, 80);
  const conflicts = Array.isArray(payload.conflicts) ? payload.conflicts : [];
  const first = conflicts[0] || {};
  const existing = String(first.title || '').slice(0, 80);
  switch (payload.type) {
    case 'dup_task': {
      // 26/05 — Remove [ref:UUID] e `id` literal do texto pro user.
      // ID interno não interessa pro humano; o LLM aprende via número 1/2/3.
      return `Achei uma tarefa parecida já criada:\n_"${existing}"_\n\nA nova seria:\n_"${cand}"_\n\nResponde com o **número**:\n\n1️⃣ *Mesma situação* — já tá coberta, não preciso criar nova.\n2️⃣ *Outro caso* — crio essa nova mesmo (com nome um pouco diferente pra não confundir).\n3️⃣ Cancela, vou reformular.`;
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
  // 1. Lookup recipient — desambigua homônimos por contexto (requester confiável
  //    via phone + assunto do recado). Ambíguo → pergunta 1x, não cria nada.
  const _recRes = await resolveCollaboratorByName(parsed.recipient_name, {
    requester: collab,
  });
  if (_recRes.status === 'ambiguous') {
    return {
      ok: false,
      reason: 'ambiguous_recipient',
      replyText: collabResolver.buildAmbiguityQuestion(_recRes.candidates),
    };
  }
  const recipient = _recRes.status === 'resolved' ? _recRes.collaborator : null;
  if (!recipient || !recipient.is_active) {
    return {
      ok: false,
      reason: 'recipient_not_found',
      replyText: `Não achei ninguém com o nome "${parsed.recipient_name}" ativo no sistema. Confere o nome completo, ou me avisa se a pessoa ainda não tá cadastrada que eu te oriento.`,
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

  const recipientFirstName = _displayName(recipient);

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

  // 26/05 — Hierarquia de role NÃO bloqueia comunicação operacional.
  // Decisão CEO: collaborator pode emitir followup pra qualquer role,
  // incluindo coordinator/manager/director (caso real: Léo professor pedindo
  // confirmação de datas pra Juliana, Quintela, Jordan e Luciano).
  // Governança fica nos relatórios CEO/líderes, não no bloqueio de fluxo.
  // Único gate preservado: canDelegatePedagogical (acima) — lógica específica.

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

  // 5.5. Dedup defensivo. Janela 30min (era 90s).
  // Bug 25/05 (Juliana): Alf pediu "marca reunião e avisa", e 20min depois
  // "Pede confirmação a ela" — TOM criou 2 requests porque janela era 90s.
  // Resultado: REQ órfã foi casada 12h depois com resposta nova da Juliana,
  // disparando notificação duplicada. 30min cobre o caso de re-pedido humano.
  try {
    const dedupCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
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
  if (!isMember && !hasCoordLevel(collaborator)) {
    console.warn(`[CheckpointBatch] blocked — collab ${last4} not member/owner of ${projectId.slice(0,8)} and not coord-level`);
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
// Sprint 23.12 — Infere category baseado em keywords no título do evento.
// Usado por validateEventItem quando TOM não emite category explícita.
// Substring matching (mais permissivo que \b — pega "pedagógica", "manutenção" etc).
// Ordem: mais específico primeiro (mentoria antes de pedagogico).
function inferEventCategory(title) {
  if (typeof title !== 'string' || !title.trim()) return null;
  const t = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const has = (...words) => words.some(w => t.includes(w));
  if (has('mentor', 'coach', 'benj')) return 'mentoria';
  if (has('acolhimento', 'acolher', 'recepcao', 'recepcionar')) return 'acolhimento';
  if (has('pedagog', 'aula ', 'aula de', 'professor')) return 'pedagogico';
  if (has('marketing', 'midia', 'instagram', 'tiktok', 'youtube', 'reels', 'conteudo')) return 'marketing';
  if (has('financ', 'contador', 'nota fiscal', 'rose ', 'rose(', 'fluxo de caixa')) return 'comercial';
  if (has('comercial', 'venda', 'matricula', 'aluno novo', 'negocia')) return 'comercial';
  if (has('manutenc', 'consertar', 'equipamento', 'loja', 'estoque', 'inventario', 'comprar', 'compra ', 'orcamento', 'abertura escola', 'fechamento escola', 'fiscaliza', 'limpeza', 'canetas', 'apagador')) return 'operacional';
  return null;
}

// Schema mínimo por item:
//   title, start_at (ISO -03:00), end_at (ISO -03:00), modality, category
//   opcionais: context, location_text, meeting_url, description, project_id
// `category=pessoal` força `context=personal` por default (regra UX consistente com PWA).
function validateEventItem(e) {
  if (!e || typeof e !== 'object') return 'not_object';
  if (typeof e.title !== 'string' || !e.title.trim()) return 'title:missing';
  if (typeof e.start_at !== 'string' || !ISO_DATETIME_RE.test(e.start_at)) return 'start_at:invalid';
  // Sprint 23 fallback: end_at ausente → start_at + 1h (default razoavel).
  if (typeof e.end_at !== 'string' || !ISO_DATETIME_RE.test(e.end_at)) {
    const startMs = new Date(e.start_at).getTime();
    if (!Number.isFinite(startMs)) return 'end_at:invalid';
    e.end_at = new Date(startMs + 60 * 60 * 1000).toISOString().replace('Z', '-03:00');
  }
  if (new Date(e.end_at).getTime() <= new Date(e.start_at).getTime()) return 'end_before_start';
  // Sprint 23 fallback: modality ausente → infere de meeting_url, senao presencial.
  if (typeof e.modality !== 'string' || !VALID_EVENT_MODALITIES.has(e.modality)) {
    e.modality = e.meeting_url ? 'online' : 'presencial';
  }
  // Sprint 22.26 — categorias agora vivem em event_categories (DB). TOM aceita
  // qualquer slug; validacao de existencia (system OU pessoal do user) acontece
  // no lookupCategoryId logo antes do INSERT.
  // Sprint 23 fallback: category ausente → default por context (não rejeita).
  // Sprint 23.12 — inferência por keywords no título antes de cair em 'la_music'
  // genérico (que entupia o CEO report). Permite category_leaders rotear corretamente.
  if (typeof e.category !== 'string' || !e.category.trim()) {
    if (e.context === 'personal') {
      e.category = 'pessoal';
    } else {
      e.category = inferEventCategory(e.title) || 'la_music';
    }
  }
  if (e.modality === 'presencial' && e.meeting_url) return 'presencial_with_meeting_url';
  if (e.context !== undefined && e.context !== 'work' && e.context !== 'personal') return 'context:invalid';
  // Sprint 29.4 — recurrence_rule opcional. Se presente, valida via rrule lib.
  if (e.recurrence_rule !== undefined && e.recurrence_rule !== null && e.recurrence_rule !== '') {
    if (typeof e.recurrence_rule !== 'string') return 'recurrence_rule_not_string';
    if (!/^FREQ=/i.test(e.recurrence_rule.trim().replace(/^RRULE:/i, ''))) return 'recurrence_rule_missing_freq';
    try {
      const { parseRule } = require('./services/recurrence-engine');
      const dtstart = e.start_at ? new Date(e.start_at) : new Date();
      parseRule(e.recurrence_rule, dtstart);
    } catch (err) {
      return 'invalid_recurrence_rule';
    }
  }
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
  // Sprint 23 — normaliza formato alternativo: event_date+start_time+end_time → start_at+end_at ISO.
  // TOM às vezes emite esse schema errado; converte em vez de rejeitar.
  for (const item of items) {
    if (item && typeof item === 'object') {
      if ((!item.start_at || !ISO_DATETIME_RE.test(item.start_at)) && item.event_date && item.start_time) {
        const base = String(item.event_date).slice(0, 10); // YYYY-MM-DD
        const st = String(item.start_time).padStart(5, '0'); // HH:MM
        item.start_at = `${base}T${st}:00-03:00`;
        if (item.end_time) {
          const et = String(item.end_time).padStart(5, '0');
          item.end_at = `${base}T${et}:00-03:00`;
        }
      }
    }
  }
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
      // Sprint 29.x — RSVP: confirmar/recusar presença num compromisso existente.
      // TOM emite <<EVENT>>{"action":"rsvp","event_id":"<8chars ou uuid>","status":"confirmed|declined|tentative"}<<END>>
      // O event_id vem do [ev:xxxxxxxx] embedado nas mensagens de convite.
      if (e.action === 'rsvp') {
        const evId   = typeof e.event_id === 'string' ? e.event_id.trim() : null;
        const status = ['confirmed', 'declined', 'tentative'].includes(e.status) ? e.status : 'confirmed';
        if (!evId) {
          console.warn('[Event][RSVP] event_id ausente — ignorado');
          failCount++;
          continue;
        }
        // Resolve UUID completo (pode vir como prefixo de 8 chars)
        let resolvedEventId = evId;
        if (evId.length < 36) {
          const { data: evRows } = await supabase
            .from('events').select('id').ilike('id', `${evId}%`).limit(1);
          if (!evRows || evRows.length === 0) {
            console.warn(`[Event][RSVP] prefix "${evId}" não resolveu para nenhum evento`);
            failCount++;
            continue;
          }
          resolvedEventId = evRows[0].id;
        }
        const { error: rsvpErr } = await supabase.from('event_participants').upsert({
          event_id: resolvedEventId,
          collaborator_id: collaborator.id,
          status,
          responded_at: new Date().toISOString(),
        }, { onConflict: 'event_id,collaborator_id' });
        if (rsvpErr) {
          console.error('[Event][RSVP] upsert err:', rsvpErr.message);
          failCount++;
        } else {
          console.log(`[Event][RSVP] ${String(collaborator.id).slice(0,8)} → event ${String(resolvedEventId).slice(0,8)} status=${status}`);
          okCount++;
        }
        continue;
      }
      // Sprint 18 — pre-check de integridade (fail-open: erros nos detectores não bloqueiam)
      // bypass_integrity: true → skip dup check (user já confirmou "crio mesmo assim")
      const bypassIntegrity = e.bypass_integrity === true;
      let temporalResult = { hardConflicts: [], softConflicts: [] };
      let dupResult      = { probable: [], possible: [] };
      try {
        const detectors = [detectTemporalConflict(collaborator, e)];
        if (!bypassIntegrity) detectors.push(detectDuplicateSemanticEvent(collaborator, e));
        const results = await Promise.all(detectors);
        temporalResult = results[0];
        if (!bypassIntegrity) dupResult = results[1];
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
        // Sprint 23.5 — persiste evento pendente para bypass engine-side quando user responder "2"
        pendingDupEvents.set(collaborator.id, { event: { ...e }, timestamp: Date.now() });
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

      // Sprint 28 — create-for-other (event): opt-in via to_name/to_phone.
      // Cria evento na agenda do destinatário (collaborator_id = recipient),
      // mantém created_by = emissor. Gate Farmer→director aplicado igual a tasks.
      let eventOwnerId = collaborator.id;
      let eventRecipient = null;
      const wantsForOtherEvent = (typeof e.to_name === 'string' && e.to_name.trim()) ||
                                  (typeof e.to_phone === 'string' && e.to_phone.trim());
      if (wantsForOtherEvent) {
        if (e.to_phone) {
          eventRecipient = await findCollaboratorByPhone(e.to_phone);
        } else {
          const _r = await resolveCollaboratorByName(e.to_name, {
            requester: collaborator,
          });
          if (_r.status === 'ambiguous') {
            // Não cria; sinaliza payload (var integrityPayload do applyEventActions).
            integrityPayload = {
              severity: 'soft',
              type: 'ambiguous_recipient',
              candidates: _r.candidates,
              candidateTitle: e.title,
            };
            failCount++;
            continue;
          }
          eventRecipient = _r.status === 'resolved' ? _r.collaborator : null;
        }
        if (!eventRecipient || !eventRecipient.is_active) {
          console.warn(`[Event] create-for-other REJECTED — recipient not found/inactive: ${e.to_phone || e.to_name}`);
          failCount++;
          continue;
        }
        // Sprint 28 — mesmo gate da task (Farmer → director bloqueado, Farmer
        // fora de unidade bloqueado, exceto coord/pedagógico transit).
        const evGate = canCreateForOther(collaborator, eventRecipient);
        if (!evGate.allowed) {
          console.warn(`[Event] create-for-other REJECTED — ${collaborator.full_name} → ${eventRecipient.full_name} reason=${evGate.reason}`);
          await logMarker(collaborator.id, 'EVENT_CREATE', 'rejected', evGate.reason, null);
          failCount++;
          continue;
        }
        if (eventRecipient.id !== collaborator.id) {
          eventOwnerId = eventRecipient.id;
        } else {
          eventRecipient = null; // self → fallback pra fluxo normal
        }
      }

      // Sprint 22.26 — lookup category_id do slug. Procura em system (global)
      // primeiro, depois nas pessoais do user. Falha se nao achar.
      // Sprint 28 — quando create-for-other, lookup usa eventOwnerId (categoria pessoal
      // do destinatário ou system). Senão sempre cai em system, o que é OK.
      const catRow = await lookupEventCategoryBySlug(e.category, eventOwnerId);
      if (!catRow) {
        console.error(`[Event] category slug not found: "${e.category}" (owner ${eventOwnerId})`);
        failCount++;
        continue;
      }
      // Context derivado da categoria (work/personal). e.context override permitido.
      const ctx = e.context || catRow.context;
      const row = {
        title: e.title.trim().slice(0, 200),
        description: typeof e.description === 'string' ? e.description.slice(0, 1000) : null,
        collaborator_id: eventOwnerId,
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
      // Sprint 29.4 — evento com recorrência vira TEMPLATE
      if (typeof e.recurrence_rule === 'string' && e.recurrence_rule.trim()) {
        row.recurrence_rule = e.recurrence_rule.trim().replace(/^RRULE:/i, '');
      }
      // Sprint 29.2 — related_to_collaborator_id pra eventos 1:1.
      // TOM pode passar explícito (skill criar-compromisso atualizada) OU
      // engine infere do título: "1:1 com X", "conversa com X", "alinhamento com X".
      if (typeof e.related_to_collaborator_id === 'string' && e.related_to_collaborator_id) {
        row.related_to_collaborator_id = e.related_to_collaborator_id;
      } else if (typeof e.related_to_name === 'string' && e.related_to_name.trim()) {
        try {
          // Inferência soft: desambigua por quem-fala; se ambíguo, deixa vazio.
          const _r = await resolveCollaboratorByName(e.related_to_name.trim(), {
            requester: collaborator,
          });
          if (_r.status === 'resolved') row.related_to_collaborator_id = _r.collaborator.id;
        } catch (_) { /* silent */ }
      }
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
      console.log(`[Event] create "${row.title.slice(0, 60)}" cat=${row.category} mod=${row.modality} ctx=${ctx} by ${last4} owner=${String(eventOwnerId).slice(0,8)} (id=${String(data?.id || '').slice(0, 8)})`);
      // Sprint 29.2 — registra na timeline do líder se for 1:1
      if (row.related_to_collaborator_id && data?.id) {
        const isOneOnOne = /1\s*:?\s*1|one[\s-]?on[\s-]?one|conversa\s+com|sentar\s+com|alinhamento\s+com|c[áa]?\s+com\s+/i.test(row.title || '');
        if (isOneOnOne) {
          try {
            const leaderTimeline = require('./services/leader-timeline');
            await leaderTimeline.append({
              leaderId: row.related_to_collaborator_id,
              eventType: '1on1_scheduled',
              eventData: { title: row.title, scheduled_for: row.start_at, scheduled_by: collaborator.id },
              relatedEventId: data.id,
            });
            console.log(`[LeaderTimeline] 1on1_scheduled for leader=${String(row.related_to_collaborator_id).slice(0,8)} event=${String(data.id).slice(0,8)}`);
          } catch (lte) { console.warn('[LeaderTimeline] append err:', lte.message); }
        }
      }
      // Sprint 29.4 — se evento é TEMPLATE recorrente, materializa próximas instâncias
      if (row.recurrence_rule && data?.id) {
        try {
          const { materializeSeries } = require('./services/recurrence-engine');
          const { data: fullTpl } = await supabase.from('events').select('*').eq('id', data.id).maybeSingle();
          if (fullTpl) {
            const r = await materializeSeries('events', fullTpl);
            console.log(`[Event] recurrence materialized ${r.created} instances (skipped=${r.skipped})`);
          }
        } catch (re) {
          console.warn('[Event] recurrence initial materialize failed:', re.message);
        }
      }
      // Sprint 29.x — Quando evento é criado para outro (to_name/to_phone), registra
      // o criador como participante confirmado — evento aparece na agenda de ambos.
      if (eventRecipient && data?.id && collaborator.id !== eventOwnerId) {
        try {
          const { error: partErr } = await supabase.from('event_participants').insert({
            event_id: data.id,
            collaborator_id: collaborator.id,
            status: 'confirmed',
            invited_by: collaborator.id,
            invited_at: new Date().toISOString(),
            responded_at: new Date().toISOString(),
          });
          if (partErr) console.warn('[Event] creator-as-participant err:', partErr.message);
          else console.log(`[Event] creator ${String(collaborator.id).slice(0,8)} added as participant for event ${String(data.id).slice(0,8)}`);
        } catch (cpErr) {
          console.warn('[Event] creator-as-participant catch:', cpErr.message);
        }
      }
      // Sprint 28 — Notifica destinatário quando evento foi criado pra outra agenda.
      if (eventRecipient && eventRecipient.phone && eventRecipient.id !== collaborator.id) {
        try {
          const whenStr = (() => {
            try {
              const d = safeDate(e.start_at);
              return d ? d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : e.start_at;
            } catch { return e.start_at; }
          })();
          const senderName = (collaborator.preferred_name || collaborator.full_name || '').split(' ')[0];
          const locPart = e.location_text ? `\n📍 ${String(e.location_text).slice(0, 80)}` : '';
          // Sprint 23.6 — URL em linha própria pra WhatsApp linkar.
          const modPart = e.modality === 'online' && e.meeting_url ? `\n🔗 Link:\n${String(e.meeting_url).slice(0, 120)}` : '';
          // Sprint 29.x — [ev:short_id] para RSVP via WhatsApp.
          const evShortRef = data?.id ? ` [ev:${String(data.id).slice(0, 8)}]` : '';
          const msg = `📅 *${senderName}* marcou um compromisso na sua agenda:\n\n*${row.title}*\n🗓️ ${whenStr}${locPart}${modPart}\n\nSe não puder, fala com ${senderName} pra remarcar.${evShortRef}`;
          whatsapp.sendMessage(eventRecipient.phone, msg).catch(err =>
            console.error(`[Event] notify recipient err: ${err.message}`));
          await logConversation(eventRecipient.id, 'outbound', `[event criado por ${senderName}: ${row.title}]`);
        } catch (notifErr) {
          console.warn(`[Event] notify build err (silent): ${notifErr.message}`);
        }
      }
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
              const startD = safeDate(e.start_at);
              if (!startD) { console.warn(`[Event] reminder skip: start_at inválido ${JSON.stringify(e.start_at)}`); continue; }
              const t = safeIsoDate(startD.getTime() - mins * 60_000);
              if (!t) continue;
              reminderRows.push({ event_id: eventId, remind_at: t });
            }
          }
          if (Array.isArray(e.reminders)) {
            for (const iso of e.reminders) {
              if (typeof iso !== 'string' || !ISO_DATETIME_RE.test(iso)) continue;
              reminderRows.push({ event_id: eventId, remind_at: iso });
            }
          }
          // Sprint 23 — default T-15min se TOM não passou reminder explícito.
          // Health-check 18/05 mostrou 57% dos eventos próximos sem lembrete.
          if (reminderRows.length === 0) {
            const startD = safeDate(e.start_at);
            if (startD) {
              const t = safeIsoDate(startD.getTime() - 15 * 60_000);
              if (t) reminderRows.push({ event_id: eventId, remind_at: t });
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
  // Sprint 28 — aceitar "latest" como id especial (handler já resolve via DB lookup).
  if (typeof a.id !== 'string' || (a.id !== 'latest' && !SHORT_ID_RE.test(a.id))) return 'id:invalid';
  if (a.action === 'reschedule') {
    if (typeof a.new_start_at !== 'string' || !ISO_DATETIME_RE.test(a.new_start_at)) return 'new_start_at:invalid';
    if (typeof a.new_end_at !== 'string' || !ISO_DATETIME_RE.test(a.new_end_at)) return 'new_end_at:invalid';
    if (new Date(a.new_end_at).getTime() <= new Date(a.new_start_at).getTime()) return 'end_before_start';
  }
  if (a.action === 'update') {
    // Sprint 31.6 (B1) — edição de metadados do evento (título, descrição/notas,
    // local, link, modalidade). Exige ao menos 1 campo editável presente.
    const editable = ['title', 'description', 'notes', 'location_text', 'meeting_url', 'modality'];
    const hasField = editable.some(f => typeof a[f] === 'string' && a[f].trim());
    if (!hasField) return 'update:no_editable_field';
    if (typeof a.modality === 'string' && a.modality.trim() && !VALID_EVENT_MODALITIES.has(a.modality)) return 'modality:invalid';
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
  // Sprint 23.5 — normaliza campos alternativos que TOM às vezes emite
  for (const item of items) {
    if (item && typeof item === 'object') {
      // TOM às vezes usa event_id (full UUID) em vez de id (8-char short)
      if (!item.id && item.event_id) item.id = String(item.event_id).slice(0, 8);
      // Garante que id seja sempre short (primeiros 8 chars)
      if (typeof item.id === 'string' && item.id.length > 8) item.id = item.id.slice(0, 8);
    }
  }
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
function extractApprovalTokenBase(name) {
  const upper = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const words = upper.split(/\s+/).filter(Boolean);
  for (const w of words) {
    const cleaned = w.replace(/[^A-Z0-9]/g, '');
    if (cleaned.length >= 3 && !APPROVAL_STOPWORDS.has(cleaned)) return cleaned;
  }
  return (words[0] || '').replace(/[^A-Z0-9]/g, '') || 'PROJETO';
}

function idSuffix4(id) {
  return String(id || '').replace(/-/g, '').slice(0, 4).toUpperCase();
}

function extractApprovalToken(name, id) {
  const base = extractApprovalTokenBase(name);
  if (!id) return base;
  const suffix = idSuffix4(id);
  return suffix ? `${base}-${suffix}` : base;
}

// Quebra token digitado (ex: "VIDEO" ou "VIDEO-3FDA") em { base, suffix? }.
function splitUserToken(raw) {
  const parts = String(raw || '').toUpperCase().split('-');
  return { base: parts[0] || '', suffix: parts[1] || null };
}

// Aliases aceitos pra resiliência contra hallucination do LLM (ex: emitiu
// project_code em vez de token). Sempre normalizamos pra { token }.
const APPROVAL_TOKEN_KEYS = ['token', 'project_code', 'code', 'name', 'slug', 'project'];
function extractApprovalTokenFromParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  for (const k of APPROVAL_TOKEN_KEYS) {
    const v = parsed[k];
    if (typeof v === 'string' && v.trim()) return v.trim().toUpperCase();
  }
  return null;
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
  const token = extractApprovalTokenFromParsed(parsed);
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
  const token = extractApprovalTokenFromParsed(parsed);
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
  const { base, suffix } = splitUserToken(token);
  let matches = (pendings || []).filter(p => extractApprovalTokenBase(p.name) === base);
  if (suffix) {
    matches = matches.filter(p => idSuffix4(p.id) === suffix);
  }
  if (matches.length === 0) return { match: null, ambiguous: false, none: true };
  if (matches.length > 1) return { match: null, ambiguous: true, none: false, candidates: matches };
  return { match: matches[0], ambiguous: false, none: false };
}

async function applyProjectApprove(collab, body) {
  if (!hasCoordLevel(collab)) {
    return { ok: false, reason: 'role_not_authorized', userMsg: '_aprovar projeto é só pra coord/diretor_' };
  }
  const r = await resolveApprovalToken(body.token);
  if (r.error) return { ok: false, reason: `db_error:${r.error}`, userMsg: '_não consegui consultar agora, tenta de novo daqui a pouco_' };
  if (r.none) return { ok: false, reason: `token_not_found:${body.token}`, userMsg: `_não tenho projeto pendente com nome \"${body.token}\". tem certeza?_` };
  if (r.ambiguous) {
    const opts = (r.candidates || []).map(p => `*${p.name}* → ${extractApprovalToken(p.name, p.id)}`).join('\n');
    return { ok: false, reason: `ambiguous_token:${body.token}`, userMsg: `_tenho mais de um projeto começando com "${body.token}". responde com o token completo:_\n${opts}` };
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
  if (!hasCoordLevel(collab)) {
    return { ok: false, reason: 'role_not_authorized', userMsg: '_rejeitar projeto é só pra coord/diretor_' };
  }
  const r = await resolveApprovalToken(body.token);
  if (r.error) return { ok: false, reason: `db_error:${r.error}`, userMsg: '_não consegui consultar agora, tenta de novo daqui a pouco_' };
  if (r.none) return { ok: false, reason: `token_not_found:${body.token}`, userMsg: `_não tenho projeto pendente com nome \"${body.token}\". tem certeza?_` };
  if (r.ambiguous) {
    const opts = (r.candidates || []).map(p => `*${p.name}* → ${extractApprovalToken(p.name, p.id)}`).join('\n');
    return { ok: false, reason: `ambiguous_token:${body.token}`, userMsg: `_tenho mais de um projeto começando com "${body.token}". responde com o token completo:_\n${opts}` };
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
      } else if (a.action === 'update') {
        // Sprint 31.6 (B1) — edita metadados. Só seta os campos presentes.
        if (typeof a.title === 'string' && a.title.trim()) patch.title = a.title.trim().slice(0, 200);
        // events não tem coluna `notes` → mapeia pra description.
        const desc = (typeof a.description === 'string' && a.description.trim()) ? a.description
                   : (typeof a.notes === 'string' && a.notes.trim()) ? a.notes : null;
        if (desc) patch.description = desc.trim().slice(0, 2000);
        if (typeof a.location_text === 'string' && a.location_text.trim()) patch.location_text = a.location_text.trim().slice(0, 200);
        if (typeof a.meeting_url === 'string' && a.meeting_url.trim()) patch.meeting_url = a.meeting_url.trim().slice(0, 500);
        if (typeof a.modality === 'string' && VALID_EVENT_MODALITIES.has(a.modality)) patch.modality = a.modality;
        if (Object.keys(patch).length === 0) { failCount++; continue; }
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
      // Sprint 31.1 — fecha qualquer pending_followup aberto pra esse evento
      try {
        const pendingFollowups = require('./services/pending-followups');
        const actionMap = { complete: 'completed', cancel: 'cancelled', reschedule: 'rescheduled', update: 'updated' };
        await pendingFollowups.resolveByTarget({
          collaboratorId: collaborator.id,
          targetType: 'event',
          targetId: ev.id,
          action: actionMap[a.action] || 'dismissed',
          via: 'marker:EVENT_UPDATE',
        });
      } catch (e) { /* não-fatal */ }
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
    // Sprint 31 — aceita title como alternativa ao id (igual reschedule desde Sprint 28)
    const hasId = typeof a.id === 'string' && SHORT_ID_RE.test(a.id);
    const hasTitle = typeof a.title === 'string' && a.title.trim().length > 0;
    if (!hasId && !hasTitle) return 'bad_id';
  } else if (a.action === 'cancel') {
    // Sprint 31 — cancel: aceita id ou title
    const hasId = typeof a.id === 'string' && SHORT_ID_RE.test(a.id);
    const hasTitle = typeof a.title === 'string' && a.title.trim().length > 0;
    if (!hasId && !hasTitle) return 'bad_id';
  } else if (a.action === 'reschedule') {
    // Sprint 28 hotfix — aceitar title como alternativa ao id.
    // TOM às vezes emite title em vez de id quando não tem o short-id na cabeça.
    // applyTaskActions resolve title→id via DB lookup antes de aplicar.
    const hasId = typeof a.id === 'string' && SHORT_ID_RE.test(a.id);
    const hasTitle = typeof a.title === 'string' && a.title.trim().length > 0;
    if (!hasId && !hasTitle) return 'bad_id';
    // Sprint 31 — new_due_date OU new_remind_at (pelo menos um obrigatório)
    const hasNewDate = typeof a.new_due_date === 'string' && ISO_DATE_RE.test(a.new_due_date);
    const hasNewRemind = typeof a.new_remind_at === 'string' && a.new_remind_at.length > 0;
    if (!hasNewDate && !hasNewRemind) return 'bad_reschedule_needs_date_or_remind';
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
  // Sprint 29.4 — recurrence_rule (opcional em create, ignorado em outras actions)
  if (a.recurrence_rule !== undefined && a.recurrence_rule !== null && a.recurrence_rule !== '') {
    if (typeof a.recurrence_rule !== 'string') return 'recurrence_rule_not_string';
    if (!/^FREQ=/i.test(a.recurrence_rule.trim().replace(/^RRULE:/i, ''))) return 'recurrence_rule_missing_freq';
    try {
      const { parseRule } = require('./services/recurrence-engine');
      const dtstart = a.due_date ? new Date(String(a.due_date) + 'T12:00:00-03:00') : new Date();
      parseRule(a.recurrence_rule, dtstart);
    } catch (e) {
      return 'invalid_recurrence_rule';
    }
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
// 26/05 — Normalização: lowercase + strip diacritics (Gerê → gere).
function _stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Busca colaboradores ativos com os campos necessários pra resolução + domínio.
async function _fetchActiveCollaborators() {
  const { data } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active, role, unit, onboarding_completed, pedagogical_role, function_role, function_title, bio, preferred_name, aliases, has_coord_permissions')
    .eq('is_active', true);
  return data || [];
}

// Resolve por nome com desambiguação por contexto. Retorna
// { status: 'resolved'|'ambiguous'|'not_found', collaborator?|candidates? }.
async function resolveCollaboratorByName(name, opts = {}) {
  return collabResolver.resolveCollaboratorByName(name, {
    requester: opts.requester || null,
    fetchActive: _fetchActiveCollaborators,
  });
}

// Back-compat: devolve o collaborator se resolvido, senão null (ambíguo → null).
// Callers sem contexto (requester/subject) continuam funcionando.
async function findCollaboratorByName(name) {
  const r = await resolveCollaboratorByName(name);
  return r.status === 'resolved' ? r.collaborator : null;
}

async function findCollaboratorByPhone(phone) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  if (!cleaned) return null;
  const { data } = await supabase
    .from('collaborators')
    // Hotfix pós-Sprint20: idem findCollaboratorByName — campos completos.
    // Sprint 23.6: bio + preferred_name para system prompt.
    .select('id, full_name, phone, is_active, role, unit, onboarding_completed, pedagogical_role, function_role, function_title, bio, preferred_name, has_coord_permissions')
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

// Sprint 22.X — PREFS_UPDATE marker: TOM atualiza user_preferences do colab
// (briefing_time, intensity, DND, etc.) quando o user pede. Schema validado.
const HHMM_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const PREFS_TIME_FIELDS = new Set([
  'briefing_time', 'personal_briefing_time', 'closing_time', 'planning_time',
  'monthly_planning_time', 'monthly_closing_time',
]);
const PREFS_INT_FIELDS = new Set(['planning_day', 'max_daily_tasks']);
const PREFS_BOOL_FIELDS = new Set(['notify_deadline_alerts', 'notify_overdue_alerts', 'notify_team_summary', 'quiet_weekends']);
// Sprint VoiceToggle — campos que vão pra tabela `collaborators`, NÃO user_preferences.
const COLLAB_BOOL_FIELDS = new Set(['voice_enabled']);
const PREFS_INTENSITY_VALUES = new Set(['light', 'normal', 'hard']);

function parsePrefsMarker(text) {
  if (!text) return null;
  const re = /<<PREFS_UPDATE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try { parsed = JSON.parse(m[1].trim()); }
  catch (err) {
    logSchemaErr('PREFS_UPDATE', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logSchemaErr('PREFS_UPDATE', ['not_object'], parsed);
    return { malformed: true, cleanText };
  }
  const update = {};
  const dropped = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (PREFS_TIME_FIELDS.has(k)) {
      if (typeof v === 'string' && HHMM_RE.test(v)) {
        update[k] = v.length === 5 ? v + ':00' : v;
      } else dropped.push(`${k}:bad_time`);
    } else if (PREFS_INT_FIELDS.has(k)) {
      const n = Number(v);
      if (Number.isInteger(n)) {
        if (k === 'planning_day' && (n < 0 || n > 6)) dropped.push(`${k}:out_of_range`);
        else if (k === 'max_daily_tasks' && (n < 1 || n > 20)) dropped.push(`${k}:out_of_range`);
        else update[k] = n;
      } else dropped.push(`${k}:not_int`);
    } else if (PREFS_BOOL_FIELDS.has(k)) {
      if (typeof v === 'boolean') update[k] = v;
      else dropped.push(`${k}:not_bool`);
    } else if (COLLAB_BOOL_FIELDS.has(k)) {
      // Vai pra tabela collaborators (não user_preferences) — applyPrefsUpdate separa.
      if (typeof v === 'boolean') update[k] = v;
      else dropped.push(`${k}:not_bool`);
    } else if (k === 'coaching_intensity') {
      if (PREFS_INTENSITY_VALUES.has(v)) update.coaching_intensity = v;
      else dropped.push(`${k}:invalid`);
    } else if (k === 'do_not_disturb_until' || k === 'do_not_disturb_reason') {
      // Pausa temporária (DND) NÃO entra por PREFS_UPDATE — tem marker dedicado
      // e validado (<<DND_SET>>, cap de 24h). Esse path setava do_not_disturb_until
      // sem cap nem validação de futuro (bug: Jhonatan ficou pausado até julho).
      // Fechado: TOM deve usar <<DND_SET>> pra pausar. Logado em dropped p/ observabilidade.
      dropped.push(`${k}:use_DND_SET_marker_instead`);
    } else if (k === 'quiet_days') {
      // Array de ints 0-6 (0=domingo, 6=sábado). Vazio = limpar.
      if (Array.isArray(v) && v.every(n => Number.isInteger(n) && n >= 0 && n <= 6)) {
        update.quiet_days = [...new Set(v)];
      } else dropped.push(`${k}:bad_dow_array`);
    } else if (k === 'quiet_reason') {
      if (v === null || (typeof v === 'string' && v.length <= 200)) update.quiet_reason = v;
      else dropped.push(`${k}:invalid`);
    } else if (k === 'quiet_start_time' || k === 'quiet_end_time') {
      // Sprint QuietHours — intervalo silencioso recorrente diário.
      // null = desativar; HH:MM = ativar. Ambos devem ser setados juntos.
      if (v === null) update[k] = null;
      else if (typeof v === 'string' && HHMM_RE.test(v)) update[k] = v.length === 5 ? v + ':00' : v;
      else dropped.push(`${k}:bad_time`);
    } else if (isContextQuietField(k)) {
      // Silêncio POR CONTEXTO (work/personal) — fonte de verdade do PWA.
      // O TOM pergunta o contexto antes de emitir; aqui só validamos.
      const r = validateContextQuietField(k, v);
      if (r.ok) update[k] = r.value;
      else dropped.push(`${k}:${r.reason}`);
    } else {
      dropped.push(`${k}:unknown_field`);
    }
  }
  if (dropped.length) logSchemaErr('PREFS_UPDATE', dropped, parsed);
  if (Object.keys(update).length === 0) return { malformed: true, cleanText };
  return { update, cleanText, malformed: false };
}

async function applyPrefsUpdate(collab, update) {
  if (!update || Object.keys(update).length === 0) return { okCount: 0, failCount: 1 };

  // Sprint VoiceToggle: separa campos que vão pra tabela `collaborators` (voice_enabled)
  // dos que vão pra `user_preferences`. Aplica em paralelo.
  const collabUpdate = {};
  const prefsUpdate = {};
  for (const [k, v] of Object.entries(update)) {
    if (COLLAB_BOOL_FIELDS.has(k)) collabUpdate[k] = v;
    else prefsUpdate[k] = v;
  }

  // Aplica em collaborators (se houver)
  if (Object.keys(collabUpdate).length > 0) {
    const { error: cErr } = await supabase
      .from('collaborators')
      .update(collabUpdate)
      .eq('id', collab.id);
    if (cErr) {
      console.error('[Prefs] collaborators update err:', cErr.message);
      return { okCount: 0, failCount: 1 };
    }
    console.log(`[Prefs] collaborators updated for ${String(collab.id).slice(0,8)}: ${JSON.stringify(collabUpdate)}`);
  }

  // Se só havia campos de collaborators, retorna sucesso aqui
  if (Object.keys(prefsUpdate).length === 0) return { okCount: 1, failCount: 0 };

  // Upsert em user_preferences: tenta update; se 0 rows afetadas, insert.
  const { data: existing } = await supabase
    .from('user_preferences')
    .select('id')
    .eq('collaborator_id', collab.id)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from('user_preferences')
      .update(prefsUpdate)
      .eq('collaborator_id', collab.id);
    if (error) {
      console.error('[Prefs] update err:', error.message);
      return { okCount: 0, failCount: 1 };
    }
  } else {
    const { error } = await supabase
      .from('user_preferences')
      .insert({ collaborator_id: collab.id, ...prefsUpdate });
    if (error) {
      console.error('[Prefs] insert err:', error.message);
      return { okCount: 0, failCount: 1 };
    }
  }
  console.log(`[Prefs] updated for ${String(collab.phone).slice(-4)} fields=${Object.keys(update).join(',')}`);
  return { okCount: 1, failCount: 0 };
}

// Sprint 22.56 — Audit trail no histórico da task. Quando TOM processa
// TASK_UPDATE com sucesso, grava agent_note no task_comments para que o PWA
// (OperacaoDetalhe) mostre a interação. Best-effort — se falhar, só log.
async function logAgentNote(taskId, content, byCollabId) {
  if (!taskId || !content || !byCollabId) return;
  try {
    await supabase.from('task_comments').insert({
      task_id: taskId,
      content: content.slice(0, 500),
      comment_type: 'agent_note',
      created_by: byCollabId,
    });
  } catch (err) {
    console.warn('[Task] agent_note insert err:', err.message);
  }
}

// 26/05 — Quando uma task delegada (created_by != assigned_to) é fechada
// ou reagendada pelo responsável, notifica o CRIADOR via WhatsApp.
// Sem isso, Léo cria task pra Juliana, Juliana fecha, e Léo nunca sabe.
async function notifyTaskCreatorOfAction(task, actor, action, detail = null) {
  try {
    if (!task || !task.created_by || !task.assigned_to) return;
    if (task.created_by === task.assigned_to) return; // task própria — sem notificação
    const { data: creator } = await supabase
      .from('collaborators')
      .select('id, full_name, preferred_name, phone, is_active')
      .eq('id', task.created_by).maybeSingle();
    if (!creator || !creator.is_active || !creator.phone) return;
    const creatorName = creator.preferred_name || (creator.full_name || '').split(' ')[0];
    const actorName = actor.preferred_name || (actor.full_name || '').split(' ')[0];
    const titleShort = String(task.title || '').slice(0, 80);
    let msg;
    if (action === 'complete') {
      msg = `✅ ${creatorName}, o ${actorName} concluiu a tarefa que você pediu:\n_"${titleShort}"_`;
    } else if (action === 'reschedule') {
      const newDate = detail ? ` pra ${detail}` : '';
      msg = `🗓️ ${creatorName}, o ${actorName} reagendou${newDate}:\n_"${titleShort}"_`;
    } else if (action === 'cancel') {
      msg = `❌ ${creatorName}, o ${actorName} cancelou:\n_"${titleShort}"_${detail ? `\n\nMotivo: ${detail}` : ''}`;
    } else if (action === 'delegate') {
      msg = `↪️ ${creatorName}, o ${actorName} repassou pra outra pessoa:\n_"${titleShort}"_${detail ? `\n\nPra: ${detail}` : ''}`;
    } else {
      return;
    }
    await whatsapp.sendMessage(creator.phone, msg);
    await supabase.from('conversation_history').insert({
      collaborator_id: creator.id,
      direction: 'outbound',
      message_type: 'text',
      content: msg,
    });
    console.log(`[Task] notify creator ${String(creator.phone).slice(-4)} of ${action} by ${String(actor.phone).slice(-4)} on task ${String(task.id).slice(0,8)}`);
  } catch (err) {
    console.warn('[Task] notifyTaskCreator err (non-fatal):', err.message);
  }
}

async function applyTaskActions(collaborator, actions) {
  let okCount = 0;
  let failCount = 0;
  // Sprint 31.6 (E2) — mensagens claras de falha pro user (ex: tarefa de outro dono).
  // Quando preenchido, o caller usa no lugar do genérico "não consegui registrar".
  const failMessages = [];
  const last4 = String(collaborator.phone || '').slice(-4);
  for (const a of actions) {
    if (!a || typeof a.action !== 'string') {
      failCount++;
      continue;
    }
    try {
      if (a.action === 'complete') {
        // Sprint 31 — title-lookup (mesmo padrão de reschedule)
        if (!a.id && a.title) {
          const { data: byTitleC } = await supabase
            .from('tasks')
            .select('id')
            .eq('assigned_to', collaborator.id)
            .ilike('title', `%${String(a.title).slice(0, 60)}%`)
            .not('status', 'in', '("done","cancelled")')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (byTitleC) {
            a.id = byTitleC.id.replace(/-/g, '').slice(0, 8);
            console.log(`[Task] complete title-lookup: "${a.title}" → id=${a.id}`);
          } else {
            console.warn(`[Task] complete title-lookup failed: "${a.title}" not found for ${last4}`);
            failCount++;
            continue;
          }
        }
        const t = await resolveTaskByShortId(collaborator.id, a.id);
        if (!t) {
          console.warn(`[Task] complete REJECTED id=${a.id} (not owned by ${last4} or not found)`);
          failCount++;
          continue;
        }
        // Buscar created_by ANTES do UPDATE pra saber se é task delegada
        const { data: fullTask } = await supabase
          .from('tasks').select('id, title, created_by, assigned_to')
          .eq('id', t.id).maybeSingle();
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
          // Sprint 29.1 — task fechou: zera contador de cobrança pra não
          // poluir a próxima vez que a task voltar (reopen) ou pra historico.
          try {
            const { resetOnComplete } = require('./services/escalation-tracker');
            await resetOnComplete(t.id);
          } catch (e) { /* não-fatal */ }
          // Sprint 29.2 — registra task_closed na timeline do dono (se for líder).
          // Filtro: só persiste se assigned_to é manager/coordinator/director.
          // Pra collaborator regular, timeline não interessa (não tem briefing).
          try {
            if (fullTask?.assigned_to) {
              const { data: owner } = await supabase
                .from('collaborators')
                .select('id, role, has_coord_permissions')
                .eq('id', fullTask.assigned_to)
                .maybeSingle();
              const isLeader = owner && (
                owner.role === 'manager' || owner.role === 'coordinator' ||
                owner.role === 'director' || owner.has_coord_permissions === true
              );
              if (isLeader) {
                const leaderTimeline = require('./services/leader-timeline');
                await leaderTimeline.append({
                  leaderId: owner.id,
                  eventType: 'task_closed',
                  eventData: { title: fullTask.title, completed_by: collaborator.id },
                  relatedTaskId: t.id,
                });
              }
            }
          } catch (e) { /* não-fatal */ }
          await logAgentNote(t.id, `Concluída por ${nameForCollab(collaborator)}`, collaborator.id);
          await notifyTaskCreatorOfAction(fullTask, collaborator, 'complete');
          // Sprint 31.1 — fecha pending_followups dessa task
          try {
            const pendingFollowups = require('./services/pending-followups');
            await pendingFollowups.resolveByTarget({
              collaboratorId: collaborator.id,
              targetType: 'task',
              targetId: t.id,
              action: 'completed',
              via: 'marker:TASK_UPDATE',
            });
          } catch (e) { /* não-fatal */ }
          okCount++;
        }
      } else if (a.action === 'cancel') {
        // Sprint 31 — handler cancel (title-lookup igual complete/reschedule)
        if (!a.id && a.title) {
          const { data: byTitleCan } = await supabase
            .from('tasks')
            .select('id')
            .eq('assigned_to', collaborator.id)
            .ilike('title', `%${String(a.title).slice(0, 60)}%`)
            .not('status', 'in', '("done","cancelled")')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (byTitleCan) {
            a.id = byTitleCan.id.replace(/-/g, '').slice(0, 8);
            console.log(`[Task] cancel title-lookup: "${a.title}" → id=${a.id}`);
          } else {
            console.warn(`[Task] cancel title-lookup failed: "${a.title}" not found for ${last4}`);
            failCount++;
            continue;
          }
        }
        const tCan = await resolveTaskByShortId(collaborator.id, a.id);
        if (!tCan) {
          console.warn(`[Task] cancel REJECTED id=${a.id} (not owned by ${last4} or not found)`);
          failCount++;
          continue;
        }
        const { data: fullTaskCan } = await supabase
          .from('tasks').select('id, title, created_by, assigned_to')
          .eq('id', tCan.id).maybeSingle();
        const { error: errCan } = await supabase
          .from('tasks')
          .update({ status: 'cancelled' })
          .eq('id', tCan.id)
          .eq('assigned_to', collaborator.id);
        if (errCan) {
          console.error('[Task] cancel err:', errCan.message);
          failCount++;
        } else {
          console.log(`[Task] cancel ${a.id} by ${last4}`);
          await logAgentNote(tCan.id, `Cancelada por ${nameForCollab(collaborator)}${a.reason ? ': ' + a.reason : ''}`, collaborator.id);
          await notifyTaskCreatorOfAction(fullTaskCan, collaborator, 'cancel');
          // Sprint 31.1 — fecha pending_followups dessa task
          try {
            const pendingFollowups = require('./services/pending-followups');
            await pendingFollowups.resolveByTarget({
              collaboratorId: collaborator.id,
              targetType: 'task',
              targetId: tCan.id,
              action: 'cancelled',
              via: 'marker:TASK_UPDATE',
            });
          } catch (e) { /* não-fatal */ }
          okCount++;
        }
      } else if (a.action === 'reschedule') {
        // Sprint 28 — resolução title→id quando TOM não emitiu id numérico.
        // Sprint 31.6 (E2) — busca tarefa onde o user é ASSIGNEE *ou* CRIADOR
        // (delegador). Caso real: Krissya delegou "Lembrar Kailane" pro Arthur e
        // quis remarcar — antes o lookup só via assigned_to e falhava silencioso.
        let t = null;
        if (!a.id && a.title) {
          const { data: byTitle } = await supabase
            .from('tasks')
            .select('id, title, status, due_date, assigned_to, created_by')
            .or(`assigned_to.eq.${collaborator.id},created_by.eq.${collaborator.id}`)
            .ilike('title', `%${String(a.title).slice(0, 60)}%`)
            .not('status', 'in', '("done","cancelled")')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (byTitle) {
            t = byTitle;
            a.id = byTitle.id.replace(/-/g, '').slice(0, 8);
            console.log(`[Task] reschedule title-lookup: "${a.title}" → id=${a.id} (assignee=${byTitle.assigned_to === collaborator.id} creator=${byTitle.created_by === collaborator.id})`);
          } else {
            // Não é do user (nem responsável nem criador). Se existe pra OUTRA
            // pessoa, mensagem clara em vez de falha silenciosa (E2).
            const { data: other } = await supabase
              .from('tasks').select('title, assigned_to')
              .ilike('title', `%${String(a.title).slice(0, 60)}%`)
              .not('status', 'in', '("done","cancelled")')
              .order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (other && other.assigned_to) {
              const { data: ow } = await supabase.from('collaborators').select('full_name').eq('id', other.assigned_to).maybeSingle();
              const ownerNm = String(ow?.full_name || 'outra pessoa').split(' ')[0];
              failMessages.push(`A tarefa _"${other.title}"_ é do(a) *${ownerNm}* — como você não criou nem é responsável por ela, não consigo remarcar por você.`);
            }
            console.warn(`[Task] reschedule title-lookup failed: "${a.title}" not found for ${last4}`);
            failCount++;
            continue;
          }
        } else {
          // Veio por id curto — caminho normal (assignee). Mantém defense-in-depth.
          t = await resolveTaskByShortId(collaborator.id, a.id);
        }
        if (!t) {
          console.warn(`[Task] reschedule REJECTED id=${a.id} (not owned by ${last4} or not found)`);
          failCount++;
          continue;
        }
        // Sprint 31 — new_due_date OU new_remind_at (pelo menos um)
        const update = {};
        if (a.new_due_date && isValidISODate(a.new_due_date)) {
          update.due_date = a.new_due_date;
        } else if (!a.new_remind_at) {
          console.warn(`[Task] reschedule REJECTED — needs new_due_date or new_remind_at`);
          failCount++;
          continue;
        }
        if (typeof a.new_remind_at === 'string' && isValidRemindAt(a.new_remind_at)) {
          update.remind_at = a.new_remind_at;
        }
        // Bug 30/05 (Yuri): reschedule de task já done deixava status='done' intacto.
        // Quando user diz "não fiz X, bota pra amanhã", a intenção é REABRIR + REMARCAR.
        // Incluído 'overdue' que é pseudo-status legado (mesmo comportamento).
        if (t.status === 'done' || t.status === 'overdue') {
          update.status = 'pending';
          update.completed_at = null;
          update.completed_by = null;
        }
        const { data: fullTaskR } = await supabase
          .from('tasks').select('id, title, created_by, assigned_to')
          .eq('id', t.id).maybeSingle();
        // Sprint 31.6 (E2) — guard de ownership: assignee OU criador (não mais só
        // assigned_to), pra o delegador conseguir remarcar a tarefa que delegou.
        const { error } = await supabase
          .from('tasks')
          .update(update)
          .eq('id', t.id)
          .or(`assigned_to.eq.${collaborator.id},created_by.eq.${collaborator.id}`);
        if (error) {
          console.error('[Task] reschedule err:', error.message);
          failCount++;
        } else {
          const sufx = update.remind_at ? ` remind_at=${update.remind_at}` : '';
          console.log(`[Task] reschedule ${a.id} to ${update.due_date || 'same'}${sufx}`);
          const oldDue = t.due_date ? formatBRDate(t.due_date) : 'sem prazo';
          const newDue = update.due_date ? formatBRDate(update.due_date) : oldDue;
          const note = `${update.due_date ? `Prazo: ${oldDue} → ${newDue}` : 'Lembrete atualizado'}${update.remind_at ? ` (lembrete ${update.remind_at.slice(11, 16)})` : ''}${a.reason ? ` — ${a.reason}` : ''}`;
          await logAgentNote(t.id, note, collaborator.id);
          await notifyTaskCreatorOfAction(fullTaskR, collaborator, 'reschedule', newDue);
          // Sprint 31.6 (E2) — se quem remarcou foi o CRIADOR (delegador) e a tarefa
          // é de OUTRO responsável, avisa o responsável que o prazo mudou.
          try {
            if (fullTaskR && fullTaskR.assigned_to && fullTaskR.assigned_to !== collaborator.id) {
              const { data: assignee } = await supabase
                .from('collaborators').select('phone, full_name')
                .eq('id', fullTaskR.assigned_to).maybeSingle();
              if (assignee && assignee.phone) {
                const quemRemarcou = String(collaborator.full_name || 'Alguém').split(' ')[0];
                await whatsapp.sendMessage(
                  assignee.phone,
                  `📅 *${quemRemarcou}* remarcou uma tarefa sua: _"${fullTaskR.title}"_ — novo prazo *${newDue}*.`,
                );
              }
            }
          } catch (e) { console.warn('[Task] reschedule notify-assignee err (non-fatal):', e.message); }
          // Sprint 31.1 — fecha pending_followups dessa task (reagendada)
          try {
            const pendingFollowups = require('./services/pending-followups');
            await pendingFollowups.resolveByTarget({
              collaboratorId: collaborator.id,
              targetType: 'task',
              targetId: t.id,
              action: 'rescheduled',
              via: 'marker:TASK_UPDATE',
            });
          } catch (e) { /* não-fatal */ }
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
          // 26/05 — Gate de role removido. Qualquer collab pode criar task pra
          // outra pessoa (caso real: professor delegando pra coordenador).
          if (a.to_phone) {
            recipient = await findCollaboratorByPhone(a.to_phone);
          } else {
            const _r = await resolveCollaboratorByName(a.to_name, {
              requester: collaborator,
            });
            if (_r.status === 'ambiguous') {
              // Espelha o padrão dup_task: não insere, sinaliza payload pro caller.
              return {
                okCount,
                failCount: failCount + 1,
                integrityPayload: {
                  severity: 'soft',
                  type: 'ambiguous_recipient',
                  candidates: _r.candidates,
                  candidateTitle: a.title,
                },
              };
            }
            recipient = _r.status === 'resolved' ? _r.collaborator : null;
          }
          if (!recipient || !recipient.is_active) {
            console.warn(`[Task] create-for-other REJECTED — recipient not found/inactive: ${a.to_phone || a.to_name}`);
            failCount++;
            continue;
          }
          // Sprint 28 — gate Farmer: bloqueia director (qualquer unidade) +
          // bloqueia fora da unidade (exceto coord e pedagógico que transitam).
          const taskGate = canCreateForOther(collaborator, recipient);
          if (!taskGate.allowed) {
            console.warn(`[Task] create-for-other REJECTED — ${collaborator.full_name} → ${recipient.full_name} reason=${taskGate.reason}`);
            await logMarker(collaborator.id, 'TASK_UPDATE', 'rejected', taskGate.reason, null);
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
        // Sprint 29.4 — task com recorrência vira TEMPLATE (engine materializa próximas)
        if (typeof a.recurrence_rule === 'string' && a.recurrence_rule.trim()) {
          insertRow.recurrence_rule = a.recurrence_rule.trim().replace(/^RRULE:/i, '');
        }
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
        // Sprint 27 — LLM confunde com `context` (work/personal). Em vez de
        // rejeitar a task inteira por subdomain inválido, ignora o campo só
        // (a task ainda salva com subdomain=NULL). Tasks perdidas eram falhas
        // silenciosas que o usuário só descobria depois pelo audit.
        if (a.subdomain !== undefined) {
          if (a.subdomain !== null && !['school','kids'].includes(a.subdomain)) {
            console.warn(`[Task] subdomain inválido descartado: ${a.subdomain} (task segue normal)`);
            // não setar insertRow.subdomain — deixa NULL
          } else {
            insertRow.subdomain = a.subdomain;
          }
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
          // Sprint 23.17 — derivar due_date do DIA do remind_at em BRT (não
          // hardcodar hoje). Bug observado: TOM emite remind_at=amanhã 10h
          // sem due_date; engine forçava due_date=hoje; task aparecia em
          // "PRA HOJE" da PWA. Respeita a.due_date se TOM emitiu (raro).
          insertRow.due_date = isValidISODate(a.due_date)
            ? a.due_date
            : _remindAtToYmdBrt(a.remind_at) || todaySaoPaulo();
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
            // Sprint 23.5 — persiste task pendente para bypass engine-side quando user responder "2"
            // Sprint 31.4 Bug-B fix: armazena insertRow validado (não action bruto do LLM)
            // garante created_by correto, context sanitizado, todos os campos validados.
            const _pendingTask = { ...insertRow, created_by: collaborator.id };
            pendingDupTasks.set(collaborator.id, { task: _pendingTask, timestamp: Date.now() });
            // Sprint 31.4 Bug-A fix: persistir no DB pra sobreviver pm2 restart.
            // Usa pending_intents (kind=task_creation, _dup_bypass=true no payload).
            try {
              await pendingIntents.openIntent(
                collaborator.id,
                'task_creation',
                { drafts: [_pendingTask], _dup_bypass: true },
                null,
              );
            } catch (_pie) { console.warn('[DupBypass] pending_intent persist err (non-fatal):', _pie.message); }
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
        // Sprint 29.4 — se task é TEMPLATE recorrente, materializa próximas instâncias imediatamente
        if (insertRow.recurrence_rule && taskId) {
          try {
            const { materializeSeries } = require('./services/recurrence-engine');
            // Refaz fetch pra ter row completa (com defaults aplicados pelo DB)
            const { data: fullTpl } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
            if (fullTpl) {
              const r = await materializeSeries('tasks', fullTpl);
              console.log(`[Task] recurrence materialized ${r.created} instances (skipped=${r.skipped})`);
            }
          } catch (e) {
            console.warn('[Task] recurrence initial materialize failed:', e.message);
          }
        }
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
            .select('id, full_name, phone, is_active, role, has_coord_permissions')
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
        // 26/05 — Gate de role removido. Qualquer collab pode delegar tarefa
        // própria pra outra pessoa.
        const t = await resolveTaskByShortId(collaborator.id, a.id);
        if (!t) {
          console.warn(`[Task] delegate REJECTED id=${a.id} (not owned by ${last4} or not found)`);
          failCount++;
          continue;
        }
        let recipient = null;
        if (a.to_phone) {
          recipient = await findCollaboratorByPhone(a.to_phone);
        } else if (a.to_name) {
          const _r = await resolveCollaboratorByName(a.to_name, {
            requester: collaborator,
          });
          if (_r.status === 'ambiguous') {
            return {
              okCount,
              failCount: failCount + 1,
              integrityPayload: {
                severity: 'soft',
                type: 'ambiguous_recipient',
                candidates: _r.candidates,
                candidateTitle: t.title,
              },
            };
          }
          recipient = _r.status === 'resolved' ? _r.collaborator : null;
        }
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
          await logAgentNote(t.id, `Delegada de ${nameForCollab(collaborator)} para ${recipient.full_name}`, collaborator.id);
          okCount++;
        } catch (err) {
          console.error('[Task] delegate notification err:', err.message);
          // task already updated in DB; still count ok so user sees confirmation
          await logAgentNote(t.id, `Delegada de ${nameForCollab(collaborator)} para ${recipient.full_name}`, collaborator.id);
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
  return { okCount, failCount, integrityPayload: null, failMessages };
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
      const content = r.content.trim();
      // Sprint 23.5+ — dedup semântico antes de inserir.
      // Gera embedding, verifica similaridade > 0.92; se existir, atualiza a existente.
      let dedupDone = false;
      if (process.env.OPENAI_API_KEY) {
        try {
          const { getEmbedding } = require('./services/embeddings');
          const embedding = await getEmbedding(content);
          const { data: similar } = await supabase.rpc('match_memories', {
            p_collaborator_id: collaboratorId,
            p_embedding: embedding,
            p_match_count: 1,
            p_threshold: 0.92,
          });
          if (similar && similar.length > 0) {
            await supabase.from('collaborator_memory')
              .update({ content, embedding, importance })
              .eq('id', similar[0].id);
            console.log(`[Memory] dedup update id=${similar[0].id.slice(0,8)} sim=${similar[0].similarity?.toFixed(2)}`);
            saved++;
            dedupDone = true;
          } else {
            // Insere nova + embedding de uma vez
            const { data: inserted, error } = await supabase.from('collaborator_memory').insert({
              collaborator_id: collaboratorId, memory_type, content, importance, source: 'conversation', is_active: true, embedding,
            }).select('id').single();
            if (error) console.error('[Memory] insert err:', error.message);
            else { saved++; dedupDone = true; }
          }
        } catch (embErr) {
          console.warn('[Memory] embedding/dedup err (fallback to plain insert):', embErr.message);
        }
      }
      if (!dedupDone) {
        const { error } = await supabase.from('collaborator_memory').insert({
          collaborator_id: collaboratorId, memory_type, content, importance, source: 'conversation', is_active: true,
        });
        if (error) console.error('[Memory] insert err:', error.message);
        else saved++;
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

// Sprint 23.17 — converte ISO timestamp (Z ou ±HH:MM) pra YYYY-MM-DD no fuso BRT.
// Usado pra derivar due_date do dia do remind_at quando TOM emite só o lembrete.
// Retorna null se ISO inválido.
function _remindAtToYmdBrt(iso) {
  try {
    if (typeof iso !== 'string') return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const dd = parts.find(p => p.type === 'day')?.value;
    return (y && m && dd) ? `${y}-${m}-${dd}` : null;
  } catch (_) { return null; }
}

// Validates ISO 8601 timestamp with timezone (Z or ±HH:MM). Sanity-check parses.
function isValidRemindAt(s) {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t);
}

async function persistProject(collaborator, p) {
  // Sprint 28 — usa hasCoordLevel (inclui role coord/director + has_coord_permissions=true).
  // Fecha gap da refatoração anterior em que esse spot continuava literal.
  if (!hasCoordLevel(collaborator)) {
    console.log(`[Project] BLOCKED: ${collaborator.full_name} (role=${collaborator.role} coord_perm=${!!collaborator.has_coord_permissions}) tried to create project. Server gate.`);
    return {
      error: true,
      userFacingReply: '_Eu te ajudo a anotar a ideia, mas só quem tem permissão de coordenação pode criar projeto direto._ Quer que eu repasse pra alguém?'
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
    // Sprint 31.6 (B3) — normaliza aliases que TOM emite (consistente com tasks/events,
    // que usam `title`). Antes: create com `title` caía em name_missing; log com
    // `habit_slug` caía em bad_habit_id. Agora aceita ambos.
    if (a && typeof a === 'object') {
      if (a.action === 'create' && !a.name && typeof a.title === 'string') a.name = a.title;
      if (a.action === 'log' && !a.habit_id && !a.habit_name && typeof a.habit_slug === 'string') {
        a.habit_name = a.habit_slug.replace(/[-_]+/g, ' ').trim();
      }
    }
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
    // Quantitativo: tipo/meta/unidade são derivados no handler (deriveHabitQuant) — nunca
    // dropar o create por causa deles. Validação leniente de propósito.
  } else if (a.action === 'log') {
    const hasId = typeof a.habit_id === 'string' && SHORT_ID_RE.test(a.habit_id);
    const hasName = typeof a.habit_name === 'string' && a.habit_name.trim().length > 0;
    if (!hasId && !hasName) return 'bad_habit_id';
    if (a.completed !== undefined && typeof a.completed !== 'boolean') return 'completed_not_bool';
    // Quantitativo: amount (número ou string) é tolerado e resolvido no handler
    // (resolveLogAmount), inclusive inferido do texto. Nunca dropar o log por isso.
    if (a.mode !== undefined && a.mode !== 'add' && a.mode !== 'set') return 'bad_mode';
  } else if (a.action === 'query_progress') {
    const hasId = typeof a.habit_id === 'string' && SHORT_ID_RE.test(a.habit_id);
    const hasName = typeof a.habit_name === 'string' && a.habit_name.trim().length > 0;
    if (!hasId && !hasName) return 'bad_habit_id';
  } else if (a.action === 'delete') {
    const hasId = typeof a.habit_id === 'string' && SHORT_ID_RE.test(a.habit_id);
    const hasName = typeof a.habit_name === 'string' && a.habit_name.trim().length > 0;
    if (!hasId && !hasName) return 'bad_habit_id';
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
    .from('habits').select('id, name, icon, current_streak, best_streak, is_active, habit_type, target_value, unit')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).limit(200);
  if (!data || !data.length) return null;
  const matches = data.filter(h => String(h.id).toLowerCase().startsWith(prefix));
  if (matches.length !== 1) return null;
  return matches[0];
}

// Resolve habit by exact name (case-insensitive, accent-insensitive), scoped to collaborator.
async function resolveHabitByName(collaboratorId, name) {
  if (!name || typeof name !== 'string') return null;
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const target = norm(name);
  if (!target) return null;
  const { data } = await supabase
    .from('habits').select('id, name, icon, current_streak, best_streak, is_active, habit_type, target_value, unit')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).limit(200);
  if (!data || !data.length) return null;
  const exact = data.filter(h => norm(h.name) === target);
  if (exact.length === 1) return exact[0];
  const partial = data.filter(h => norm(h.name).includes(target) || target.includes(norm(h.name)));
  if (partial.length === 1) return partial[0];
  return null;
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

// ---------- Hábito quantitativo: helpers (NÚMERO vem do código, nunca do LLM) ----------

// Barra visual de 10 blocos (espelha src/finance/ritual-messages.js bar()).
function habitBar(pct) {
  const filled = Math.max(0, Math.min(10, Math.round((pct || 0) / 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// Formata número PT-BR sem casas decimais desnecessárias (1150 -> "1.150", 1.5 -> "1,5").
function fmtQty(n) {
  const v = Number(n) || 0;
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

// Lê o value acumulado de hoje pra um hábito (0 se não houver log).
async function readHabitTodayValue(habitId, today) {
  const { data } = await supabase
    .from('habit_logs').select('value')
    .eq('habit_id', habitId).eq('log_date', today).maybeSingle();
  return data && data.value != null ? Number(data.value) : 0;
}

// Monta o footer de progresso pro WhatsApp. Ex:
// "💧 Água: ████░░░░░░ 38% — 1.150/3.000 ml · faltam 1.850 ml"
function buildHabitProgressFooter(habit, value) {
  const target = Number(habit.target_value) || 0;
  const unit = habit.unit ? ` ${habit.unit}` : '';
  const icon = habit.icon || '💧';
  if (!(target > 0)) {
    return `${icon} ${habit.name}: ${fmtQty(value)}${unit} hoje`;
  }
  const pct = Math.min(100, Math.round((value / target) * 100));
  const remaining = Math.max(0, target - value);
  const done = value >= target ? ' ✅ meta batida!' : ` · faltam ${fmtQty(remaining)}${unit}`;
  return `${icon} ${habit.name}: ${habitBar(pct)} ${pct}% — ${fmtQty(value)}/${fmtQty(target)}${unit}${done}`;
}

// Parse número PT-BR tolerante: "3.000" -> 3000 (milhar), "2,5" -> 2.5, "650" -> 650.
function parseQtyNum(raw) {
  let s = String(raw).trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 3.000 -> 3000
  s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Rede determinística: infere {habit_type:'quantitative', target_value, unit} do texto do
// usuário quando ele menciona "N <unidade>". Normaliza litros->ml. Unidades de TEMPO só
// disparam se houver palavra de meta ("meta"/"objetivo"/"quantidade"/"por dia") — evita
// confundir horário de lembrete ("às 6h") com meta de tempo.
function inferQuantFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase();
  const hasMetaKw = /\b(meta|objetivo|quantidade)\b|por\s+dia/.test(t);
  const m = t.match(/(\d[\d.,]*)\s*(litros?|l|ml|mililitros?|p[áa]ginas?|p[áa]g|km|quil[ôo]metros?|copos?|passos?|reps?|repeti[çc][õo]es|minutos?|min|horas?|h)\b/);
  if (!m) return null;
  const value = parseQtyNum(m[1]);
  if (!(value > 0)) return null;
  const raw = m[2];
  let unit = null, factor = 1, isTime = false;
  if (/^(litros?|l)$/.test(raw)) { unit = 'ml'; factor = 1000; }
  else if (/^(ml|mililitros?)$/.test(raw)) { unit = 'ml'; }
  else if (/^(p[áa]ginas?|p[áa]g)$/.test(raw)) { unit = 'páginas'; }
  else if (/^(km|quil[ôo]metros?)$/.test(raw)) { unit = 'km'; }
  else if (/^copos?$/.test(raw)) { unit = 'copos'; }
  else if (/^passos?$/.test(raw)) { unit = 'passos'; }
  else if (/^(reps?|repeti[çc][õo]es)$/.test(raw)) { unit = 'reps'; }
  else if (/^(minutos?|min)$/.test(raw)) { unit = 'min'; isTime = true; }
  else if (/^(horas?|h)$/.test(raw)) { unit = 'min'; factor = 60; isTime = true; }
  else return null;
  if (isTime && !hasMetaKw) return null; // "às 6h" é lembrete, não meta
  return { habit_type: 'quantitative', target_value: value * factor, unit };
}

// Decide tipo/meta/unidade de um create: campos explícitos do TOM têm prioridade
// (normalizando litros->ml); senão tenta inferir do texto; senão binário.
function deriveHabitQuant(a, userText) {
  const explicitUnit = typeof a.unit === 'string' && a.unit.trim() ? a.unit.trim() : null;
  const explicitTarget = typeof a.target_value === 'number' && a.target_value > 0 ? a.target_value : null;
  if (explicitTarget && explicitUnit) {
    if (/^(l|litros?)$/i.test(explicitUnit)) return { habit_type: 'quantitative', target_value: explicitTarget * 1000, unit: 'ml' };
    return { habit_type: 'quantitative', target_value: explicitTarget, unit: explicitUnit.slice(0, 20) };
  }
  const inferred = inferQuantFromText(userText);
  if (inferred) return inferred;
  return { habit_type: 'binary', target_value: null, unit: null };
}

// Infere o valor a registrar do texto ("bebi 650ml" -> 650), convertendo pra unidade
// do hábito (litros->ml, horas->min). Sem unidade no texto, assume a unidade do hábito.
function inferLogAmountFromText(text, habit) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase();
  const m = t.match(/(\d[\d.,]*)\s*(litros?|l|ml|mililitros?|p[áa]ginas?|p[áa]g|km|quil[ôo]metros?|copos?|passos?|reps?|repeti[çc][õo]es|minutos?|min|horas?|h)?\b/);
  if (!m) return null;
  const value = parseQtyNum(m[1]);
  if (!(value > 0)) return null;
  const u = m[2] || '';
  const hu = (habit.unit || '').toLowerCase();
  if (hu === 'ml') {
    if (/^(litros?|l)$/.test(u)) return value * 1000;
    return value; // ml ou número solto
  }
  if (hu === 'min') {
    if (/^(horas?|h)$/.test(u)) return value * 60;
    return value;
  }
  return value; // páginas/km/copos/passos/reps ou número solto
}

// Resolve o delta de um log: numérico explícito > string parseável > inferência do texto.
function resolveLogAmount(a, habit, userText) {
  if (typeof a.amount === 'number' && !Number.isNaN(a.amount)) return a.amount;
  if (typeof a.amount === 'string') {
    const n = parseQtyNum(a.amount.replace(/[^\d.,]/g, ''));
    if (n != null && n > 0) return n;
  }
  return inferLogAmountFromText(userText, habit);
}

async function applyHabitActions(collaborator, actions, userText = '') {
  const today = todaySaoPaulo();
  let okCount = 0, failCount = 0;
  const last4 = String(collaborator.phone || '').slice(-4);
  // We collect created/logged habits so caller can append a friendly footer if needed.
  const created = [], logged = [];
  const progressFooters = []; // strings de barra (quantitativo) anexadas à resposta
  for (const a of actions) {
    try {
      if (a.action === 'create') {
        // Tipo/meta/unidade: explícito do TOM > inferência do texto > binário.
        const quant = deriveHabitQuant(a, userText);
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
          habit_type: quant.habit_type,
          target_value: quant.target_value,
          unit: quant.unit,
        };
        const { data, error } = await supabase
          .from('habits').insert(insertRow).select('id, name, icon').single();
        if (error) {
          console.error('[Habit] create err:', error.message);
          failCount++;
          continue;
        }
        console.log(`[Habit] create "${insertRow.name}" freq=${insertRow.frequency} type=${insertRow.habit_type}${insertRow.target_value ? `/${insertRow.target_value}${insertRow.unit || ''}` : ''} id=${String(data.id).slice(0,8)} by ${last4}`);
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
        let h = null;
        if (typeof a.habit_id === 'string' && SHORT_ID_RE.test(a.habit_id)) {
          h = await resolveHabitByShortId(collaborator.id, a.habit_id);
        }
        if (!h && typeof a.habit_name === 'string' && a.habit_name.trim()) {
          h = await resolveHabitByName(collaborator.id, a.habit_name);
        }
        if (!h) {
          console.warn(`[Habit] log REJECTED — habit ${a.habit_id || a.habit_name} not owned by ${last4}`);
          failCount++;
          continue;
        }
        const isQuant = h.habit_type === 'quantitative' && Number(h.target_value) > 0;
        // amount: explícito do TOM > string > inferido do texto ("bebi 650ml" -> 650).
        const amount = resolveLogAmount(a, h, userText);
        // Valor acumulado do dia: add (default) soma ao existente; set substitui.
        let newValue = 0;
        if (isQuant) {
          const prev = await readHabitTodayValue(h.id, today);
          if (a.mode === 'set' && amount != null) newValue = amount;
          else newValue = prev + (amount != null ? amount : 0);
          if (newValue < 0) newValue = 0;
        }
        // is_completed: quantitativo fecha quando value>=target; binário usa o flag.
        const isCompleted = isQuant ? (newValue >= Number(h.target_value)) : completed;
        // Upsert habit_logs (habit_id, log_date) — manual SELECT/UPDATE/INSERT.
        const { data: existing } = await supabase
          .from('habit_logs').select('id')
          .eq('habit_id', h.id).eq('log_date', today).maybeSingle();
        const row = {
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
          notes: a.notes || null,
        };
        if (isQuant) row.value = newValue;
        if (existing) {
          await supabase.from('habit_logs').update(row).eq('id', existing.id);
        } else {
          await supabase.from('habit_logs').insert({
            habit_id: h.id,
            collaborator_id: collaborator.id,
            log_date: today,
            ...row,
          });
        }
        // Recompute streak.
        const newStreak = await calcHabitStreak(h.id, today);
        const newBest = Math.max(newStreak, h.best_streak || 0);
        await supabase.from('habits').update({
          current_streak: newStreak,
          best_streak: newBest,
        }).eq('id', h.id);
        console.log(`[Habit] log "${h.name}" qty=${isQuant ? newValue : 'n/a'} completed=${isCompleted} streak=${newStreak} (best=${newBest})`);
        if (isQuant) progressFooters.push(buildHabitProgressFooter(h, newValue));
        logged.push({ habit: h, streak: newStreak, completed: isCompleted });
        okCount++;
      } else if (a.action === 'query_progress') {
        let h = null;
        if (typeof a.habit_id === 'string' && SHORT_ID_RE.test(a.habit_id)) {
          h = await resolveHabitByShortId(collaborator.id, a.habit_id);
        }
        if (!h && typeof a.habit_name === 'string' && a.habit_name.trim()) {
          h = await resolveHabitByName(collaborator.id, a.habit_name);
        }
        if (!h) {
          console.warn(`[Habit] query_progress REJECTED — habit ${a.habit_id || a.habit_name} not owned by ${last4}`);
          failCount++;
          continue;
        }
        const value = await readHabitTodayValue(h.id, today);
        progressFooters.push(buildHabitProgressFooter(h, value));
        console.log(`[Habit] query_progress "${h.name}" value=${value}/${h.target_value}`);
        okCount++;
      } else if (a.action === 'delete') {
        // Soft delete — espelha a remove mutation do PWA (HabitoDetalhe.tsx): is_active=false.
        // Nunca apaga dados de verdade. Scoped a collaborator.id (defense in depth).
        let h = null;
        if (typeof a.habit_id === 'string' && SHORT_ID_RE.test(a.habit_id)) {
          h = await resolveHabitByShortId(collaborator.id, a.habit_id);
        }
        if (!h && typeof a.habit_name === 'string' && a.habit_name.trim()) {
          h = await resolveHabitByName(collaborator.id, a.habit_name);
        }
        if (!h) {
          console.warn(`[Habit] delete REJECTED — habit ${a.habit_id || a.habit_name} not owned by ${last4}`);
          failCount++;
          continue;
        }
        const { error: delErr } = await supabase
          .from('habits')
          .update({ is_active: false })
          .eq('id', h.id)
          .eq('collaborator_id', collaborator.id);
        if (delErr) {
          console.error('[Habit] delete err:', delErr.message);
          failCount++;
          continue;
        }
        console.log(`[Habit] delete "${h.name}" id=${String(h.id).slice(0,8)} by ${last4} (soft, is_active=false)`);
        okCount++;
      }
    } catch (err) {
      console.error('[Habit] exception:', err.message);
      failCount++;
    }
  }
  return { okCount, failCount, created, logged, progressFooters };
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
    const candAnchor = safeDate(candDate);
    const windowStart = candAnchor ? safeIsoDate(candAnchor.getTime() - 48 * 3600_000) : null;
    const windowEnd   = candAnchor ? safeIsoDate(candAnchor.getTime() + 48 * 3600_000) : null;
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
      // Sprint 23.6: caso "Reunião com Rayan" (ontem) vs "Reunião com Juliana" (hoje)
      // entrava como "possible" pelo prefix "Reunião" + score 0.7. Agora exige
      // keyword shared (nome próprio diferente NÃO compartilha) E score mais alto.
      // sameDate sozinho não é mais suficiente — precisa keyword shared também.
      const sameDate = candDate && evDate && candDate === evDate;
      const hasSharedKeyword = shared.length > 0;
      if (score >= 0.85 && hasSharedKeyword) {
        probable.push({ ...ev, _score: score });
      } else if (score > 0.7 && (hasSharedKeyword || sameDate)) {
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
  'revisar','reajustar','rever','ajustar','atualizar','reformular',
  // Sprint 23.5 — termos financeiros genéricos e verbos de pagamento
  'pagar','boleto','conta','fatura','pagamento','nota','recibo','valor',
  // 26/05 — verbos de validação que geravam falsos positivos
  // (Caso Léo: "Confirmar datas do evento de teclas" vs "Confirmar repertório
  // e ordem de apresentação" — JW alto pelo prefixo + shared['Confirmar'] = dup falso)
  'confirmar','validar','aprovar','definir','escolher','decidir','alinhar','combinar',
  'finalizar','fechar','responder','perguntar','tirar','retirar'
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
    // Sprint 31.6 (B2) — extrai o sufixo APÓS "—" (o que distingue "X — Renan" de "X — Kinho").
    const extractSuffix = s => {
      const parts = String(s || '').split(/\s*[—–]\s+/);
      return parts.length > 1 ? parts.slice(1).join(' — ').trim() : '';
    };
    const candStripped = stripSuffix(candidate.title);
    const candCore = stripVerbPrefix(candStripped);             // núcleo nominal
    const candTitleNorm = normalizeForSim(candCore);
    const candSuffixNorm = normalizeForSim(extractSuffix(candidate.title));
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
      // compartilhada, prefix bonus do jaroWinkler gera falsos positivos.
      // Sprint 23.5 — threshold elevado de 0.7→0.85 (reduz falsos positivos tipo
      // "pagar boleto academia" vs "pagar boleto peixaria"). Também exige prazo próximo
      // (±3 dias) quando ambos têm due_date, para não bloquear boletos diferentes.
      // Sprint 23.6 — caso "Colocar papel A4 na planilha" vs "Colocar falta do Willian
      // na planilha" passava: ambos compartilham 1 keyword ("planilha") + boost de
      // strip-verbo gera 0.86. Agora: probable exige 2+ keywords compartilhadas
      // OU score muito alto (>=0.95). Reduz falso positivo sem perder duplicatas reais.
      let isDupProbable = (score >= 0.95 && shared.length > 0) || (score > 0.85 && shared.length >= 2);
      if (isDupProbable && candidate.due_date && task.due_date) {
        const diffDays = Math.abs(new Date(candidate.due_date) - new Date(task.due_date)) / 86400000;
        if (diffDays > 3) isDupProbable = false; // prazos diferentes → não é dup
      }
      // Sprint 31.6 (B2) — "Tarefa — Fulano" vs "Tarefa — Sicrano": mesmo núcleo,
      // sufixos DISTINTOS = itens deliberadamente diferentes (1 por pessoa/grupo).
      // Caso real Quintela: "Avaliação de estagiários — Renan/Kinho/Leo" travavam.
      // Rebaixa de probable→possible (não bloqueia o fluxo, mas ainda registra sinal).
      if (isDupProbable && candSuffixNorm) {
        const taskSuffixNorm = normalizeForSim(extractSuffix(task.title));
        if (taskSuffixNorm && taskSuffixNorm !== candSuffixNorm) isDupProbable = false;
      }
      if (isDupProbable) probable.push({ ...task, _score: score });
      else if (score > 0.6) possible.push({ ...task, _score: score });
    }
    probable.sort((a, b) => b._score - a._score);
    possible.sort((a, b) => b._score - a._score);
    return { probable: probable.slice(0, 3), possible: possible.slice(0, 3) };
  } catch (err) {
    console.error('[IntegrityCheck] detectDuplicateSemanticTask err (non-fatal):', err.message);
    return { probable: [], possible: [] };
  }
}

// Sprint 22.X — Detector de confirmação de comunicado.
// Procura por jobs entregues nas últimas 48h com requires_confirmation=true
// e confirmed_at IS NULL. Se a mensagem atual for afirmativa, marca confirmado.
// Retorna true se consumiu a mensagem (curto-circuita o pipeline).
const ANNOUNCEMENT_CONFIRM_RE = /^\s*(ok\b|okk\b|okay\b|sim\b|confirmo\b|confirmado[as]?\b|confirmad[ao]\b|recebi\b|recebido[as]?\b|ciente\b|estarei\b|vou\s+estar\b|tô\s+ciente\b|tudo\s+(?:bem|certo)\b|👍|✅|✓)/i;

async function tryHandleAnnouncementConfirmation(collab, text) {
  if (!collab || !collab.id || !text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  if (!ANNOUNCEMENT_CONFIRM_RE.test(trimmed)) return false;

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: jobs, error } = await supabase
    .from('announcement_jobs')
    .select('id, announcement_id, sent_at, announcements!inner(requires_confirmation, body)')
    .eq('recipient_id', collab.id)
    .eq('status', 'sent')
    .is('confirmed_at', null)
    .gte('sent_at', cutoff)
    .eq('announcements.requires_confirmation', true)
    .order('sent_at', { ascending: false })
    .limit(1);

  if (error) {
    console.warn('[Announcement] confirmation lookup err:', error.message);
    return false;
  }
  if (!jobs || jobs.length === 0) return false;

  const job = jobs[0];
  const { error: updErr } = await supabase
    .from('announcement_jobs')
    .update({
      confirmed_at: new Date().toISOString(),
      confirmation_response: trimmed.slice(0, 200),
    })
    .eq('id', job.id);

  if (updErr) {
    console.warn('[Announcement] confirmation update err:', updErr.message);
    return false;
  }

  console.log(`[Announcement] confirmation registered: job=${job.id.slice(0,8)} ann=${job.announcement_id.slice(0,8)} collab=${String(collab.phone).slice(-4)}`);

  try {
    const { sendMessage } = require('./services/whatsapp');
    await sendMessage(collab.phone, '✅ Confirmação registrada. Obrigado!');
    await logConversation(collab.id, 'outbound', '✅ Confirmação registrada. Obrigado!');
  } catch (err) {
    console.warn('[Announcement] confirmation ack send err:', err.message);
  }
  return true;
}

// Sprint 23.5 — bypass engine-side para dup microconfirm (eventos e tasks).
// Retorna { reply } se tratou direto (user respondeu 1/2/3 após dup bloqueado),
// ou null se deve seguir fluxo normal (chamar LLM).
async function tryDupBypass(collab, text) {
  const lm = (text || '').trim();
  // Aceita "2", "2.", "2 - texto..." (user às vezes inclui contexto junto)
  const choiceMatch = lm.match(/^([123])[.\-\s]?/);
  if (!choiceMatch) return null;
  const choice = choiceMatch[1];
  const EXP_MS = 10 * 60 * 1000;
  const pendingEv = pendingDupEvents.get(collab.id);
  let pendingTk = pendingDupTasks.get(collab.id);
  // Só age se houver algo pendente e não expirado
  let hasEv = pendingEv && (Date.now() - pendingEv.timestamp < EXP_MS);
  let hasTk = pendingTk && (Date.now() - pendingTk.timestamp < EXP_MS);

  // Sprint 31.4 Bug-A fix: DB fallback pra sobreviver pm2 restart.
  // Se Map vazio (processo reiniciou entre a pergunta e o "2"), recupera do pending_intents.
  if (!hasEv && !hasTk) {
    try {
      const _dbIntents = await pendingIntents.listOpenIntents(collab.id);
      const _dbDup = _dbIntents.find(i =>
        i.kind === 'task_creation' && i.payload?._dup_bypass === true &&
        Array.isArray(i.payload?.drafts) && i.payload.drafts.length > 0
      );
      if (_dbDup) {
        pendingTk = { task: _dbDup.payload.drafts[0], timestamp: Date.now(), _intentId: _dbDup.id };
        hasTk = true;
        console.log(`[DupBypass] DB fallback task="${String(_dbDup.payload.drafts[0]?.title || '').slice(0,40)}" intent=${_dbDup.id.slice(0,8)}`);
      }
    } catch (_e) {
      console.warn('[DupBypass] DB fallback err (non-fatal):', _e.message);
    }
    if (!hasEv && !hasTk) return null;
  }

  if (choice === '3') {
    if (hasEv) pendingDupEvents.delete(collab.id);
    if (hasTk) pendingDupTasks.delete(collab.id);
    return { reply: 'Ok, cancelado. Me passa de novo quando quiser criar.' };
  }

  // Evento pendente tem prioridade (microconfirm de evento vem antes de task)
  if (hasEv) {
    pendingDupEvents.delete(collab.id);
    const e = pendingEv.event;
    console.log(`[DupBypass] event choice=${choice} "${String(e.title).slice(0,40)}"`);
    if (choice === '1') return { reply: `Certo! Já está na agenda como _${e.title}_. Nada mudou.` };
    // choice === '2': criar com bypass
    const eventWithBypass = { ...e, bypass_integrity: true };
    const { okCount, integrityPayload } = await applyEventActions(collab, [eventWithBypass]);
    if (integrityPayload) return { reply: _buildIntegrityConfirmText(integrityPayload) };
    if (okCount > 0) {
      const dtOptions = { timeZone: 'America/Sao_Paulo' };
      const dateStr = new Date(e.start_at).toLocaleDateString('pt-BR', { ...dtOptions, weekday: 'short', day: '2-digit', month: '2-digit' });
      const timeStr = new Date(e.start_at).toLocaleTimeString('pt-BR', { ...dtOptions, hour: '2-digit', minute: '2-digit' });
      return { reply: `✅ Criado — *${e.title}*, ${dateStr} às ${timeStr}.` };
    }
    return { reply: '_Não consegui salvar o compromisso. Me passa os dados de novo?_' };
  }

  // Task pendente
  if (hasTk) {
    pendingDupTasks.delete(collab.id);
    const tk = pendingTk.task;
    console.log(`[DupBypass] task choice=${choice} "${String(tk.title).slice(0,40)}"`);
    if (choice === '1') return { reply: `Certo! Já está anotado como _${tk.title}_. Nada mudou.` };
    // choice === '2': inserir task diretamente (bypass dup check)
    // Sprint 31.4 Bug-B fix: insertRow vem do validated insertRow (armazenado no Map/DB),
    // não mais reconstruído do action bruto do LLM. Garante created_by=collab.id,
    // context sanitizado, department_id/request_type_id/description preservados.
    const insertRow = {
      ...tk,
      created_by: collab.id,  // sempre o sender como creator (não LLM action)
      // Sprint 31.4 Bug-C fix (raiz real): 'tom' viola tasks_source_check.
      // Valores válidos: manual|agent_briefing|agent_closing|checkpoint_decomposition|
      // coordinator_assignment|system|mental_dump|retroactive_capture. Usa 'manual'
      // (mesmo do fluxo normal de create). Esse era o bug ANTIGO que sempre quebrou o bypass.
      source: 'manual',
      status: 'pending',       // sempre pending (não herdar awaiting_confirmation)
    };
    delete insertRow._dup_bypass;  // limpar marker interno antes de inserir
    delete insertRow._intentId;    // idem
    if (!insertRow.assigned_to) insertRow.assigned_to = collab.id;
    if (!insertRow.assigned_to) {
      console.error('[DupBypass] task insert ABORT: no assignedTo');
      return { reply: '_Não consegui salvar a tarefa porque não identifiquei pra quem é. Tenta de novo me dizendo o que é._' };
    }
    // Resolve intent do DB se veio do fallback (DB fallback path)
    if (pendingTk._intentId) {
      try { await pendingIntents.resolveIntent(pendingTk._intentId, 'confirmed', 'dup_bypass choice=2'); } catch (_e) { /* non-fatal */ }
    } else {
      // Limpa intent ativa do DB mesmo quando veio do Map (Map foi populado recentemente)
      try {
        const _dbI = (await pendingIntents.listOpenIntents(collab.id)).find(i => i.kind === 'task_creation' && i.payload?._dup_bypass);
        if (_dbI) await pendingIntents.resolveIntent(_dbI.id, 'confirmed', 'dup_bypass choice=2');
      } catch (_e) { /* non-fatal */ }
    }
    const { data: inserted, error: insErr } = await supabase.from('tasks').insert(insertRow).select('id, title').single();
    if (insErr) {
      // Sprint 23.6 — log detalhado pra diagnosticar (FK? RLS? not-null violation?)
      console.error('[DupBypass] task insert err:', {
        code: insErr.code,
        message: insErr.message,
        details: insErr.details,
        hint: insErr.hint,
        row: { ...insertRow, title: insertRow.title.slice(0, 50) },
      });
      // Erro categorizado pro user
      const m = (insErr.message || '').toLowerCase();
      if (m.includes('row-level security') || m.includes('policy')) {
        return { reply: '_Não consegui salvar essa tarefa por restrição de permissão. Avisa o coordenador._' };
      }
      if (m.includes('foreign key') || m.includes('violates')) {
        return { reply: '_Não consegui salvar (referência inválida no banco). Tenta de novo._' };
      }
      return { reply: `_Não consegui salvar a tarefa (${insErr.code || 'erro'}). Me passa de novo?_` };
    }
    return { reply: `✅ Anotado: *${inserted?.title || tk.title}*${tk.due_date ? ` — até ${tk.due_date}` : ''}.` };
  }

  return null;
}

// ---- Sprint 27 — Financas Pessoais: marker <<FINANCE_ACTION>> + dispatcher ----
const FINANCE_ACTIONS = [
  'register_transaction', 'register_bill', 'pay_bill', 'create_goal',
  'update_goal', 'set_budget', 'query_summary', 'query_budget', 'query_goal', 'query_accounts', 'create_account',
  'simulate_interest',
  // cartão de crédito + transferência
  'create_card', 'card_purchase', 'query_invoice', 'pay_invoice', 'transfer',
];
const MONTH_TAXA = 0.0083; // ~10,5%/ano (referencia; Fase B troca pela Selic viva)

function parseFinanceMarker(text) {
  if (!text) return null;
  const re = /<<FINANCE_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let json;
  try {
    json = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('FINANCE_ACTION', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!json || !FINANCE_ACTIONS.includes(json.action)) {
    logSchemaErr('FINANCE_ACTION', ['action_invalida: ' + (json && json.action)], m[1]);
    return { malformed: true, cleanText };
  }
  return { action: json.action, params: json.params || {}, cleanText, malformed: false };
}

// SEGURANCA (spec §6.2): cid SEMPRE = collab.id (remetente resolvido server-side). NUNCA params.collaborator_id.
async function handleFinanceAction(collab, action, params) {
  const cid = collab.id;
  const p = normalizeParams(params || {});
  const financeFmt = require('./services/finance-format');

  switch (action) {
    case 'register_transaction': {
      if (!p.amount || p.amount <= 0) return '❓ Qual foi o valor?';
      const type = p.type || 'expense';
      const category = p.category || mapCategory(p.description || '');
      // Vínculo à carteira por nome ("gastei 50 no Nubank"): resolve nome→id. null = sem carteira.
      let account_id = p.account_id || null; // trigger BEFORE barra conta de outro dono
      let account = null; // {name, icon, balance(pré-insert)}
      const acctName = params.account_name || params.account || p.account_name;
      if (!account_id && acctName) {
        const acct = await financeService.findAccountByName(cid, acctName);
        if (acct) { account_id = acct.id; account = acct; }
      }
      const prev = type === 'expense' ? await financeService.monthCategoryTotal(cid, category) : 0;
      await financeService.insertTransaction(cid, { type, category, amount: p.amount, description: p.description, transaction_date: p.date, account_id });

      // Bloco de orçamento (só despesa com limite), reaproveitando buildBudgetAlert.
      let budgetBlock = null;
      if (type === 'expense') {
        const limit = await financeService.getBudget(cid, category);
        if (limit) {
          const novo = prev + Number(p.amount);
          const pct = Math.round((novo / limit) * 100);
          const meta = financeFmt.CAT_META[category] || { label: category };
          budgetBlock = `📊 ${meta.label}: ${financeFmt.money(novo)} / ${financeFmt.money(limit)} (${pct}%)`;
          const cruzou = crossedThreshold(prev, novo, limit);
          if (cruzou) budgetBlock += `\n${buildBudgetAlert(category, novo, limit, cruzou)}`;
        }
      }

      // Saldo pós-trigger por cálculo determinístico (trigger: income +amount, expense -amount).
      const meta = financeFmt.CAT_META[category] || { emoji: '📦', label: category };
      const newBalance = account ? Number(account.balance) + (type === 'income' ? Number(p.amount) : -Number(p.amount)) : null;
      const footer = financeFmt.buildTxnFooter({
        categoryMissing: category === 'outros',
        accountLinked: !!account_id,
        tipSeed: new Date().getUTCDate(),
      });
      return financeFmt.buildTxnConfirmation({
        type, description: p.description, amount: Number(p.amount),
        categoryLabel: meta.label,
        account: account ? { name: account.name, icon: account.icon } : null,
        newBalance, budgetBlock, footer,
      });
    }
    case 'register_bill': {
      const b = await financeService.createBill(cid, {
        name: params.name, amount: params.amount, due_day: params.due_day,
        category: params.category || mapCategory(params.name || ''),
        type: params.type || 'expense', remind_days_before: params.remind_days_before,
      });
      return `✅ Conta cadastrada: ${b.name} (R$${b.amount}, dia ${b.due_day}).`;
    }
    case 'pay_bill': {
      const cands = await financeService.findBills(cid, params.bill_name || params.name || '');
      if (cands.length === 0) return 'Não achei conta com esse nome.';
      if (cands.length > 1) return 'Achei mais de uma: ' + cands.map((c, i) => `${i + 1}) ${c.name}`).join(', ') + '. Qual delas?';
      const paid = await financeService.payBill(cid, cands[0]);
      return `✅ ${paid.name} marcada como paga (R$${paid.amount}).`;
    }
    case 'create_goal': {
      const g = await financeService.createGoal(cid, {
        name: params.name, target_amount: params.target_amount,
        monthly_contribution: params.monthly_contribution, deadline: params.deadline, icon: params.icon,
      });
      let reply = `${g.icon || '🎯'} Meta criada: ${g.name} (R$${g.target_amount}).`;
      if (g.monthly_contribution) {
        const ms = monthsToGoalSimple(g.target_amount, g.current_amount, g.monthly_contribution);
        const mj = monthsToGoalWithInterest(g.target_amount, g.current_amount, g.monthly_contribution, MONTH_TAXA);
        reply += `\n💰 Guardando R$${g.monthly_contribution}/mês, você chega em ${formatMonths(ms)}.`;
        reply += `\nInvestindo a ~10,5%/ano: ${formatMonths(mj)}. Bora!`;
      }
      return reply;
    }
    case 'update_goal': {
      const cands = await financeService.findGoal(cid, params.goal_name || params.name || '');
      if (cands.length === 0) return 'Não achei essa meta.';
      const g = await financeService.addToGoal(cid, cands[0], params.add_amount || 0);
      const pct = Math.round((g.current_amount / g.target_amount) * 100);
      return `✅ Guardou R$${params.add_amount} em ${g.name}. Progresso: ${pct}% (R$${g.current_amount}/R$${g.target_amount}).`;
    }
    case 'set_budget': {
      const b = await financeService.setBudget(cid, { category: params.category, monthly_limit: params.monthly_limit });
      return `✅ Orçamento de ${b.category}: R$${b.monthly_limit}/mês.`;
    }
    case 'create_account': {
      const a = await financeService.createAccount(cid, { name: params.name, type: params.type, icon: params.icon, goal_monthly: params.goal_monthly });
      return `✅ Carteira criada: ${a.icon || '🏦'} ${a.name}.`;
    }
    case 'query_accounts': {
      const accs = await financeService.listAccounts(cid);
      if (!accs.length) return 'Você ainda não tem carteiras. Quer criar uma? Ex: "cria carteira Nubank".';
      const linhas = accs.map((a) => `${a.icon || '🏦'} ${a.name}: ${financeFmt.money(Number(a.balance))}`).join('\n');
      const total = accs.reduce((s, a) => s + Number(a.balance), 0);
      return `👛 Suas carteiras:\n${linhas}\n\nTotal: ${financeFmt.money(total)}`;
    }
    case 'create_card': {
      // Idempotente: se já existe cartão com esse nome (match exato), ATUALIZA em vez de duplicar.
      const existentes = await financeService.findCard(cid, params.name || '');
      const exato = existentes.find((c) => c.name.toLowerCase() === String(params.name || '').toLowerCase());
      if (exato) {
        const patch = {};
        if (params.credit_limit != null) patch.credit_limit = params.credit_limit;
        if (params.closing_day != null) patch.closing_day = params.closing_day;
        if (params.due_day != null) patch.due_day = params.due_day;
        if (params.brand != null) patch.brand = params.brand;
        if (params.color != null) patch.color = params.color;
        if (Object.keys(patch).length > 0) {
          const u = await financeService.updateCard(cid, exato.id, patch);
          return `👽 O cartão *${u.name}* já existia — atualizei: limite ${financeFmt.money(u.credit_limit)}, fecha dia ${u.closing_day}, vence dia ${u.due_day}.`;
        }
        return `👽 Você já tem o cartão *${exato.name}* (limite ${financeFmt.money(exato.credit_limit)}, fecha dia ${exato.closing_day}, vence dia ${exato.due_day}). Quer mudar algum dado?`;
      }
      const c = await financeService.createCard(cid, {
        name: params.name, brand: params.brand, color: params.color,
        credit_limit: params.credit_limit, closing_day: params.closing_day, due_day: params.due_day, icon: params.icon,
      });
      return `👽 Cartão *${c.name}* cadastrado! Limite ${financeFmt.money(c.credit_limit)}, fecha dia ${c.closing_day}, vence dia ${c.due_day}.`;
    }
    case 'card_purchase': {
      const cards = await financeService.findCard(cid, params.card || '');
      if (cards.length === 0) {
        const all = await financeService.listCards(cid);
        return `Não achei o cartão "${params.card}". Seus cartões: ${all.map((c) => c.name).join(', ') || 'nenhum cadastrado'}.`;
      }
      if (cards.length > 1) return `Tenho mais de um cartão parecido com "${params.card}": ${cards.map((c) => c.name).join(', ')}. Qual?`;
      const card = cards[0];
      const amount = Number(params.amount);
      if (!amount || amount <= 0) return '❓ Qual foi o valor da compra?';
      const installments = parseInt(params.installments || 1, 10);
      const category = params.category || mapCategory(params.description || '');
      const rows = await financeService.insertCardPurchase(cid, card, {
        category, amount, description: params.description, transaction_date: params.date, installments,
      });
      const usage = await financeService.cardUsage(cid, card);
      let reply = financeFmt.txnRegistered(card, {
        description: params.description, amount, category, installments, competencia: rows[0].competencia,
      }, usage);
      const al = await financeService.checkAndMarkLimitAlert(cid, card);
      if (al) reply += '\n\n' + financeFmt.limitAlert(card, al.band, al.usage);
      return reply;
    }
    case 'query_invoice': {
      const cards = await financeService.findCard(cid, params.card || '');
      if (cards.length !== 1) {
        const all = await financeService.listCards(cid);
        return `Qual cartão? Tenho: ${all.map((c) => c.name).join(', ') || 'nenhum'}.`;
      }
      const card = cards[0];
      const comp = params.competencia || financeService.currentCompetencia(card);
      const inv = await financeService.cardInvoice(cid, card.id, comp);
      const usage = await financeService.cardUsage(cid, card);
      return financeFmt.invoiceSummary(card, inv, usage);
    }
    case 'pay_invoice': {
      const cards = await financeService.findCard(cid, params.card || '');
      if (cards.length !== 1) {
        const all = await financeService.listCards(cid);
        return `Qual cartão você pagou? Tenho: ${all.map((c) => c.name).join(', ') || 'nenhum'}.`;
      }
      const card = cards[0];
      const comp = params.competencia || financeService.currentCompetencia(card);
      const inv = await financeService.cardInvoice(cid, card.id, comp);
      if (inv.total <= 0) return `A fatura do *${card.name}* está zerada.`;
      const amount = Number(params.amount) > 0 ? Number(params.amount) : inv.remaining;
      let fromId = null;
      if (params.from_account) {
        const accs = (await financeService.listAccounts(cid)).filter((a) => a.name.toLowerCase().includes(String(params.from_account).toLowerCase()));
        if (accs.length === 1) fromId = accs[0].id;
      }
      await financeService.payCardInvoice(cid, card, { competencia: comp, amount, paid_from_account: fromId });
      const after = await financeService.cardInvoice(cid, card.id, comp);
      return `✅ Pagamento de *${financeFmt.money(amount)}* na fatura do *${card.name}* registrado.\n` +
        (after.isPaid ? '🎉 Fatura quitada!' : `Ainda faltam *${financeFmt.money(after.remaining)}*.`);
    }
    case 'transfer': {
      const accs = await financeService.listAccounts(cid);
      const from = accs.find((a) => a.name.toLowerCase().includes(String(params.from || '').toLowerCase()));
      const to = accs.find((a) => a.name.toLowerCase().includes(String(params.to || '').toLowerCase()));
      if (!from || !to || from.id === to.id) return `Não consegui identificar as contas. Tenho: ${accs.map((a) => a.name).join(', ')}.`;
      const amount = Number(params.amount);
      if (!amount || amount <= 0) return '❓ Qual o valor da transferência?';
      await financeService.createTransfer(cid, { from_account: from.id, to_account: to.id, amount, description: params.description });
      return `🔁 Transferi *${financeFmt.money(amount)}* de *${from.name}* → *${to.name}*. Saldo total inalterado.`;
    }
    case 'query_summary': {
      const s = await financeService.querySummary(cid);
      const top = s.top.map(([c, v]) => `• ${c}: R$${v}`).join('\n');
      return `💰 Mês atual:\n📈 Receitas: R$${s.receitas}\n📉 Despesas: R$${s.despesas}\n💵 Saldo: ${s.saldo >= 0 ? '+' : ''}R$${s.saldo}` + (top ? `\n\nTop gastos:\n${top}` : '');
    }
    case 'query_budget': {
      const rows = await financeService.queryBudget(cid);
      if (rows.length === 0) return 'Você ainda não definiu orçamento por categoria.';
      const linhas = rows.map((r) => `${r.category}: ${Math.round((r.spent / r.limit) * 100)}% (R$${r.spent}/R$${r.limit})`).join('\n');
      return `📊 Orçamento:\n${linhas}`;
    }
    case 'query_goal': {
      const gs = await financeService.listGoals(cid);
      if (gs.length === 0) return 'Você ainda não tem metas. Bora criar uma?';
      const linhas = gs.map((g) => {
        const pct = Math.round((g.current_amount / g.target_amount) * 100);
        return `${g.icon || '🎯'} ${g.name}: ${pct}% (R$${g.current_amount}/R$${g.target_amount})`;
      }).join('\n');
      return `🎯 Suas metas:\n${linhas}`;
    }
    case 'simulate_interest': {
      const monthly = Number(p.monthly || params.monthly || 0);
      const years = Number(params.years || p.years || 0);
      if (!monthly || !years) return '❓ Me diz quanto por mês e por quantos anos.';
      const months = Math.round(years * 12);
      const annual = await selic.getAnnualRate();
      const i = Math.pow(1 + annual / 100, 1 / 12) - 1;
      const semJuros = monthly * months;
      const comJuros = Math.round(futureValue(monthly, i, months));
      const ganho = comJuros - semJuros;
      return `🧮 Simulação: R$${monthly}/mês por ${years} ano(s)\n\nSó guardando: R$${semJuros}\nInvestindo a ${annual}%/ano: R$${comJuros}\n\nDiferença: R$${ganho} que o dinheiro trabalhou pra você. Bora? 💪`;
    }
    default:
      return null;
  }
}

async function processMessage(phone, text, raw = {}) {
  const _t0 = Date.now();
  // Snapshot da fala inbound ANTES de qualquer mutação (ex: ctxHint de
  // pending_intent é anexado a `text` abaixo). Usado para citar verbatim a
  // resposta do recipient em COORDINATION_RESPONSE, sem vazar scaffolding interno.
  const inboundVerbatimText = text;
  const _phoneTail = String(phone).slice(-4);
  console.log(`[Engine] processMessage START phone=${_phoneTail} text="${String(text).slice(0, 60).replace(/\n/g, ' ')}"`);
  // Sprint 10: telemetria operacional. Acumulada durante o pipeline e gravada
  // em tom_metrics no fim. Falha silenciosa via metricsService.
  const _metrics = {
    message_kind: /^\[áudio transcrito\]/i.test(String(text || '')) ? 'audio' : 'text',
  };

  // Sprint 32 — Decompositor de áudio longo. Quando o transcript é grande e tem
  // múltiplas intenções, faz uma pré-passada LLM enxuta (sem ~100KB de skills)
  // só pra extrair a lista. Reescreve `text` com a lista enumerada anexada pra
  // que o LLM principal não precise extrair sozinho competindo contra o timeout.
  // Causa-raiz: caso Peterson — áudio com 6+ demandas virava ACTIONABLE_NO_MARKER
  // porque a chamada única não dava conta de transcrever+decidir+emitir tudo.
  const _decompose = await audioDecompose.decomposeIfLarge(text);
  _metrics.decompose_triggered = _decompose.decomposed;
  _metrics.decompose_items_count = _decompose.decomposed ? _decompose.items.length : null;
  _metrics.decompose_latency_ms = _decompose.latencyMs || null;
  _metrics.decompose_skipped_reason = _decompose.reason || null;
  if (_decompose.decomposed) {
    console.log(`[Engine] DECOMPOSE_OK items=${_decompose.items.length} latency=${_decompose.latencyMs}ms phone=${_phoneTail}`);
    text = _decompose.rewrittenText;
  } else if (_decompose.reason === 'extractor_failed') {
    console.warn(`[Engine] DECOMPOSE_FAIL — seguindo com texto original phone=${_phoneTail}`);
  }

  const collab = await collaboratorService.findByPhone(phone);
  if (!collab) {
    await whatsapp.sendMessage(phone, 'Nao te encontrei no sistema. Fala com seu coordenador pra te cadastrar.');
    console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (unknown_collab)`);
    return;
  }
  _metrics.collaborator_id = collab.id;
  console.log('[Engine] Mensagem de', collab.full_name);
  await logConversation(collab.id, 'inbound', text);

  // ---- Sprint 30.3 — Pending Intents: auto-resolve quando user confirma ----
  // Se TOM perguntou "Crio?" turnos atrás (intent aberta) e o user agora
  // respondeu "sim/ok/pode/cria", injeta contexto extra no `text` pra forçar
  // o LLM a emitir o marker. A intent é resolvida ao final do turno.
  let _pendingIntentToResolve = null;
  try {
    const openIntents = await pendingIntents.listOpenIntents(collab.id, { limit: 3 });
    if (openIntents.length > 0) {
      const userConfirm = pendingIntents.detectUserConfirmation(String(text || ''));
      const target = openIntents[0];  // mais recente
      // Janela de confirmação: um "sim/não" cru só resolve a intent se ela foi
      // perguntada há pouco (~20min). Fora disso NÃO resolve e NÃO apaga — a intent
      // segue aberta pro fluxo natural/expiração. (Bug: "sim" pra criar meta
      // confirmava intent stale de horas atrás, ex. "cobrar o Rafinha".)
      const fresh = withinConfirmWindow(target.asked_at, 20);
      if (userConfirm && !fresh) {
        console.log(`[PendingIntents] skip auto-resolve (stale >20min) — intent=${target.id.slice(0,8)} kind=${target.kind} asked=${target.asked_at}`);
      } else if (userConfirm === 'yes') {
        _pendingIntentToResolve = { intent: target, resolution: 'confirmed' };
        // Injeta contexto inline pra LLM saber o que confirmar.
        const payloadStr = JSON.stringify(target.payload || {}).slice(0, 800);
        const ctxHint = `\n\n[CONTEXTO INTERNO — não verbalize ao usuário]\nVocê tinha aberto uma intent (${target.kind}) com a pergunta: "${(target.question_text || '').slice(0, 200)}".\nPayload pendente: ${payloadStr}\nO usuário CONFIRMOU. Emita o marker apropriado AGORA (ex: <<TASK_UPDATE>> com action=create para cada draft).`;
        text = String(text || '') + ctxHint;
        console.log(`[PendingIntents] auto-resolve YES — intent=${target.id.slice(0,8)} kind=${target.kind}`);
      } else if (userConfirm === 'no') {
        _pendingIntentToResolve = { intent: target, resolution: 'denied' };
        console.log(`[PendingIntents] auto-resolve NO — intent=${target.id.slice(0,8)} kind=${target.kind}`);
      }
    }
  } catch (e) {
    console.warn('[PendingIntents] auto-resolve check err:', e.message);
  }

  // Sprint Fase B — Bypass do LLM pra operações simples de lojinha.
  // Quando a intenção é clara (query/venda/entrada), pulamos o LLM (que vinha
  // emitindo JSON malformado ou texto humano sem marker) e executamos
  // handleShopAction direto. Resposta em ~1-2s, determinística.
  if (typeof text === 'string') {
    const shopBypass = tryShopBypass(text);
    if (shopBypass) {
      console.log(`[ShopBypass] detectado action=${shopBypass.action} params=${JSON.stringify(shopBypass.params)}`);
      try {
        const result = await handleShopAction(
          { action: shopBypass.action, params: shopBypass.params },
          collab,
          collab.full_name
        );
        const reply = result || 'Sem retorno.';
        await whatsapp.sendMessage(phone, reply);
        await logConversation(collab.id, 'outbound', reply);
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (shop_bypass)`);
        return;
      } catch (e) {
        console.error('[ShopBypass] err:', e.message);
        await whatsapp.sendMessage(phone, `⚠️ Falha na lojinha: ${e.message}`);
        return;
      }
    }
  }

  // G11 — Comando rápido /educa <nome>
  if (typeof text === 'string' && /^\/educa\s+/i.test(text)) {
    const nome = text.replace(/^\/educa\s+/i, '').trim();
    if (!nome) {
      await whatsapp.sendMessage(phone, 'Uso: /educa <nome do estagiário>');
      return;
    }
    try {
      const { data: matches } = await supabase
        .from('la_educa_progresso')
        .select('id, nome, unidade, mentor_nome, trilha_icone, trilha_nome, checkpoints_ancorados, checkpoints_total, percentual, certificado_emitido, certificado_emitido_em, ultima_atualizacao')
        .ilike('nome', `%${nome}%`)
        .limit(5);
      if (!matches || matches.length === 0) {
        await whatsapp.sendMessage(phone, `🔍 Nenhum estagiário encontrado com "${nome}".`);
        return;
      }
      if (matches.length > 1) {
        const lista = matches.map(e => `• ${e.nome} (${e.unidade})`).join('\n');
        await whatsapp.sendMessage(phone, `🔍 Encontrei vários:\n${lista}\n\nUse o nome completo.`);
        return;
      }
      const e = matches[0];
      const dias = e.ultima_atualizacao ? Math.floor((Date.now() - new Date(e.ultima_atualizacao).getTime()) / 86400000) : null;
      const msg =
        `🎓 ${e.nome}\n` +
        `${e.trilha_icone || ''} ${e.trilha_nome || '—'} · ${e.unidade}\n` +
        `Mentor: ${e.mentor_nome || '—'}\n` +
        `Progresso: ${e.checkpoints_ancorados}/${e.checkpoints_total} (${Math.round(e.percentual || 0)}%)\n` +
        `Última atualização: ${dias !== null ? dias + 'd atrás' : 'nunca'}` +
        (e.certificado_emitido ? `\n🏆 Certificado Alfa emitido em ${e.certificado_emitido_em?.slice(0,10)}` : '');
      await whatsapp.sendMessage(phone, msg);
    } catch (err) {
      await whatsapp.sendMessage(phone, `Erro ao buscar: ${err.message}`);
    }
    return;  // não passar pra IA
  }

  // LA JOURNEY — Comando rápido /journey [subcomando|curso]
  if (typeof text === 'string' && /^\s*\/journey\b/i.test(text)) {
    const arg = text.replace(/^\s*\/journey\s*/i, '').trim();
    const lower = arg.toLowerCase();
    try {
      // ─── /journey atrasados ─────────
      if (lower === 'atrasados' || lower === 'atraso') {
        const { data: rows } = await supabase
          .from('la_journey_conteudo_checkpoint')
          .select('id, programa_id, curso_id, checkpoint_id, status, updated_at, la_journey_cursos(nome), la_journey_checkpoints(nome)')
          .neq('status', 'publicado')
          .lt('updated_at', new Date(Date.now() - 14 * 86400000).toISOString());
        if (!rows || rows.length === 0) {
          await whatsapp.sendMessage(phone, '✅ Nenhum checkpoint atrasado (>14d).');
        } else {
          const linhas = rows.map(r => {
            const dias = Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 86400000);
            return `• ${r.la_journey_cursos?.nome} · ${r.la_journey_checkpoints?.nome} — ${dias}d`;
          });
          await whatsapp.sendMessage(phone, `⚠️ *Atrasados >14d:*\n\n${linhas.join('\n')}`);
        }
        return;
      }

      // ─── /journey pendencias ─────────
      if (lower === 'pendencias' || lower === 'pendências' || lower === 'revisao' || lower === 'revisão') {
        const { data: rows } = await supabase
          .from('la_journey_conteudo_checkpoint')
          .select('id, la_journey_cursos(nome), la_journey_checkpoints(nome), updated_at')
          .eq('status', 'em_revisao')
          .order('updated_at', { ascending: true });
        if (!rows || rows.length === 0) {
          await whatsapp.sendMessage(phone, '✅ Nenhum checkpoint aguardando revisão.');
        } else {
          const linhas = rows.map(r => `• ${r.la_journey_cursos?.nome} · ${r.la_journey_checkpoints?.nome}`);
          await whatsapp.sendMessage(phone, `🟡 *Em revisão (${rows.length}):*\n\n${linhas.join('\n')}\n\nVer: la-organizer.com/la-journey/admin`);
        }
        return;
      }

      // ─── /journey publicados ─────────
      if (lower === 'publicados' || lower === 'publicado') {
        const { data: rows } = await supabase
          .from('la_journey_conteudo_checkpoint')
          .select('id, publicado_em, la_journey_cursos(nome), la_journey_checkpoints(nome), collaborators!publicado_por(full_name)')
          .eq('status', 'publicado')
          .order('publicado_em', { ascending: false })
          .limit(10);
        if (!rows || rows.length === 0) {
          await whatsapp.sendMessage(phone, '📭 Nenhum checkpoint publicado ainda.');
        } else {
          const linhas = rows.map(r => {
            const data = r.publicado_em ? new Date(r.publicado_em).toLocaleDateString('pt-BR') : '?';
            const por = r.collaborators?.full_name ?? '?';
            return `• ${r.la_journey_cursos?.nome} · ${r.la_journey_checkpoints?.nome} — ${data} por ${por}`;
          });
          await whatsapp.sendMessage(phone, `✅ *Últimos publicados:*\n\n${linhas.join('\n')}`);
        }
        return;
      }

      // ─── /journey mentor [nome] ─────────
      const mentorMatch = arg.match(/^mentor\s+(.+)$/i);
      if (mentorMatch) {
        const nome = mentorMatch[1].trim().toLowerCase();
        const { data: coll } = await supabase
          .from('collaborators').select('id, full_name')
          .ilike('full_name', `%${nome}%`).limit(1).maybeSingle();
        if (!coll) {
          await whatsapp.sendMessage(phone, `Não achei nenhum colaborador com "${nome}".`);
        } else {
          const { data: cursosMent } = await supabase
            .from('la_journey_curso_mentores')
            .select('curso_id, programa_id, papel, la_journey_cursos(nome)')
            .eq('collaborator_id', coll.id).eq('ativo', true);
          if (!cursosMent || cursosMent.length === 0) {
            await whatsapp.sendMessage(phone, `${coll.full_name} não é mentor de nenhum curso no LA Journey.`);
          } else {
            let reply = `👤 *${coll.full_name}* — cursos:\n`;
            for (const cm of cursosMent) {
              reply += `• ${cm.la_journey_cursos?.nome} (${cm.programa_id}, ${cm.papel.replace('mentor_', '')})\n`;
            }
            await whatsapp.sendMessage(phone, reply.trim());
          }
        }
        return;
      }

      // ─── /journey ping [mentor] ─────────
      const pingMatch = arg.match(/^ping\s+(.+)$/i);
      if (pingMatch) {
        const nome = pingMatch[1].trim().toLowerCase();
        const { data: coll } = await supabase
          .from('collaborators').select('id, full_name, phone, notification_opt_in')
          .ilike('full_name', `%${nome}%`).limit(1).maybeSingle();
        if (!coll) {
          await whatsapp.sendMessage(phone, `Não achei "${nome}". Tente o primeiro nome.`);
        } else if (!coll.phone || !coll.notification_opt_in) {
          await whatsapp.sendMessage(phone, `${coll.full_name} não tem WhatsApp/opt-in configurado.`);
        } else {
          await supabase.from('la_journey_lembretes_log').insert({
            tipo: 'ping_manual',
            destinatario_id: coll.id,
            mensagem: `👋 Oi ${coll.full_name.split(' ')[0]}, a coordenação pediu pra eu te lembrar do LA Journey. Quando puder, dá uma olhada em https://la-organizer.com/la-journey`,
          });
          await whatsapp.sendMessage(phone, `✅ Ping enfileirado pra ${coll.full_name}. Será enviado no próximo tick (5min).`);
        }
        return;
      }

      // ─── /journey [curso] ou /journey (visão geral) ─────────
      const [{ data: schoolRows }, { data: kidsRows }] = await Promise.all([
        supabase.rpc('la_journey_lista_progresso', { p_programa_id: 'school' }),
        supabase.rpc('la_journey_lista_progresso', { p_programa_id: 'kids' }),
      ]);
      const allRows = [...(schoolRows || []), ...(kidsRows || [])];

      function journeyEmoji(status, pct) {
        if (status === 'publicado') return '✅';
        if (status === 'em_revisao') return '🟡';
        if (pct > 0) return '⚪';
        return '⬜';
      }

      if (lower) {
        const filtrados = allRows.filter(r =>
          (r.curso_nome || r.curso_id || '').toLowerCase().includes(lower)
        );
        if (filtrados.length === 0) {
          await whatsapp.sendMessage(phone,
            `🔍 Nenhum curso encontrado com "${arg}".\nCursos disponíveis: bateria, canto, cordas, teclas, musicalização.`
          );
        } else {
          const linhas = filtrados.map(r => {
            const emoji = journeyEmoji(r.status, r.pct_publicado || 0);
            return `${emoji} ${r.curso_nome || r.curso_id} (${r.programa_id}): ${Math.round(r.pct_publicado || 0)}%`;
          });
          await whatsapp.sendMessage(phone, `🎓 LA Journey — ${arg}\n${linhas.join('\n')}`);
        }
      } else {
        // Visão geral por programa
        function resumePrograma(rows, label) {
          if (!rows || rows.length === 0) return `*${label}:* sem dados`;
          const publicados = rows.filter(r => r.status === 'publicado').length;
          const pct = Math.round((publicados / rows.length) * 100);
          const linhas = rows.map(r => {
            const emoji = journeyEmoji(r.status, r.pct_publicado || 0);
            return `  ${emoji} ${r.curso_nome || r.curso_id}: ${Math.round(r.pct_publicado || 0)}%`;
          });
          return `*${label}* (${pct}% publicado):\n${linhas.join('\n')}`;
        }
        const msg =
          `🎓 *LA Journey — Status Geral*\n\n` +
          resumePrograma(schoolRows, 'School') + '\n\n' +
          resumePrograma(kidsRows, 'Kids');
        await whatsapp.sendMessage(phone, msg);
      }
    } catch (err) {
      await whatsapp.sendMessage(phone, `Erro ao carregar LA Journey: ${err.message}`);
    }
    return; // não passar pra IA
  }

  // ─── /inv [...] ──────────────────────────────────────────────────────────────
  const invMatch = (typeof text === 'string') && text.trim().match(/^\/inv(?:\s+(.+))?$/i);
  if (invMatch) {
    const arg = (invMatch[1] || '').trim();
    const tokens = arg.split(/\s+/).filter(Boolean);
    try {
      if (tokens.length === 0) {
        const u = await inventarioService.listarUnidades();
        const linhas = u.map(x => `• ${x.nome} — /inv ${x.nome.toLowerCase()}`);
        await whatsapp.sendMessage(phone, `📦 *Inventário* — escolha a unidade:\n\n${linhas.join('\n')}`);
        return;
      }
      if (tokens[0].toLowerCase() === 'alertas') {
        const [estoque, manut, revisoes] = await Promise.all([
          inventarioService.listarEstoqueBaixo(),
          inventarioService.listarManutencoesPendentes(14),
          inventarioService.listarRevisoesProgramadas(7),
        ]);
        let replyInv = `🔔 *Alertas inventário*\n\n`;
        replyInv += `🔴 Estoque baixo: ${estoque.length}\n`;
        replyInv += `🔧 Manutenções +14d: ${manut.length}\n`;
        replyInv += `🗓 Revisões próximas (7d): ${revisoes.length}\n`;
        await whatsapp.sendMessage(phone, replyInv);
        return;
      }
      // /inv <unidade>: lista salas
      const u = await inventarioService.listarUnidades();
      const unidade = u.find(x => x.nome.toLowerCase().includes(tokens[0].toLowerCase()));
      if (!unidade) {
        await whatsapp.sendMessage(phone, `Unidade "${tokens[0]}" não encontrada. Use: ${u.map(x => x.nome).join(', ')}`);
        return;
      }
      const salas = await inventarioService.listarSalasPorUnidade(unidade.id);
      let replyInv = `📦 *Inventário ${unidade.nome}* — ${salas.length} salas:\n\n`;
      for (const s of salas) {
        replyInv += `• ${s.nome} (${s.tipo_sala || 'multiuso'}) — ${s.itens_count || 0} itens\n`;
      }
      await whatsapp.sendMessage(phone, replyInv.trim());
    } catch (e) {
      await whatsapp.sendMessage(phone, `Erro: ${e.message}`);
    }
    return;
  }

  // ─── /loja [...] ─────────────────────────────────────────────────────────────
  const lojaMatch = (typeof text === 'string') && text.trim().match(/^\/loja(?:\s+(.+))?$/i);
  if (lojaMatch) {
    const arg = (lojaMatch[1] || '').trim().toLowerCase();
    try {
      if (!arg) {
        const u = await inventarioService.listarUnidades();
        const linhas = u.map(x => `• ${x.nome} — /loja ${x.nome.toLowerCase()}`);
        await whatsapp.sendMessage(phone, `🛍 *Lojinha* — escolha a unidade:\n\n${linhas.join('\n')}`);
        return;
      }
      if (arg === 'encomenda' || arg.startsWith('encomenda ')) {
        const unitMatch = arg.match(/^encomenda\s+(.+)$/);
        let unitId = null;
        if (unitMatch) {
          const u = await inventarioService.listarUnidades();
          const found = u.find(x => x.nome.toLowerCase().includes(unitMatch[1]));
          if (found) unitId = found.id;
        }
        const baixos = await inventarioService.listarEstoqueBaixo(unitId);
        if (baixos.length === 0) {
          await whatsapp.sendMessage(phone, '✅ Sem produtos abaixo do mínimo.');
          return;
        }
        const linhas = baixos.map(p => `• ${p.nome} — ${p.estoque_atual}/${p.estoque_minimo} (custo R$${p.custo || '?'})`);
        await whatsapp.sendMessage(phone, `🛒 *Lista de encomenda:*\n\n${linhas.join('\n')}`);
        return;
      }
      const u = await inventarioService.listarUnidades();
      const unidade = u.find(x => x.nome.toLowerCase().includes(arg));
      if (!unidade) {
        await whatsapp.sendMessage(phone, `Unidade "${arg}" não encontrada. Use: ${u.map(x => x.nome).join(', ')}`);
        return;
      }
      const produtos = await inventarioService.listarLojaPorUnidade(unidade.id);
      let replyLoja = `🛍 *Lojinha · ${unidade.nome}*\n\n`;
      for (const p of produtos) {
        const flag = p.zerado ? '🔴' : p.abaixo_minimo ? '🟠' : '✅';
        replyLoja += `${flag} ${p.nome}: ${p.estoque_atual} un (R$${p.preco})\n`;
      }
      await whatsapp.sendMessage(phone, replyLoja.trim());
    } catch (e) {
      await whatsapp.sendMessage(phone, `Erro: ${e.message}`);
    }
    return;
  }

  // Sprint 23.5 — bypass engine-side para dup microconfirm.
  // Intercepta "1/2/3" quando há pending dup event, resolve sem chamar LLM.
  const dupBypass = await tryDupBypass(collab, String(text || ''));
  if (dupBypass) {
    await logConversation(collab.id, 'outbound', dupBypass.reply);
    await whatsapp.sendMessage(collab.phone, dupBypass.reply);
    console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (dup_bypass)`);
    return;
  }

  // Sprint 22.X — Comunicados Fatia 1: detector de confirmação de leitura.
  // Se o user respondeu "ok/sim/confirmo/recebi/etc" e tem um announcement_jobs
  // entregue recentemente (com requires_confirmation=true) e não confirmado,
  // marca confirmação. Curto-circuita o pipeline pra não rodar skills.
  const confirmed = await tryHandleAnnouncementConfirmation(collab, String(text || ''));
  if (confirmed) {
    console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (announcement_confirmed)`);
    return;
  }

  // Sprint 16 — COORD_HINT: verifica recados abertos onde collab é recipient.
  // Janela 2h (era 24h). Bug 25/05: REQ órfã de ontem 20:25 foi casada com
  // resposta de hoje 07:47 porque o LLM viu a request fantasma de 11h atrás.
  // 2h cobre o uso real (resposta no mesmo turno de conversa) sem expor o
  // LLM a requests velhas que devem ser tratadas pelo auto-close cron.
  let coordHint = null;
  {
    const cutoff2h = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: openRequests } = await supabase
      .from('coordination_requests')
      .select('id, requester_id, message_body, created_at')
      .eq('recipient_id', collab.id)
      .eq('status', 'sent')
      .gte('created_at', cutoff2h)
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
        const body = String(r.message_body || '');
        const preview = body.slice(0, 60) + (body.length > 60 ? '...' : '');
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
  const _memCount = (ctx.criticalMemories?.length || 0) + (ctx.preferenceMemories?.length || 0) + (ctx.recentContextMemories?.length || 0);
  console.log(`[Engine] system prompt size: ${systemPrompt.length} chars (memories=${_memCount}, tasks=${_tCount}, notifs=${ctx.notifications.length})`);

  // Sprint 21 — limite suave anti-relay (avisa, não bloqueia)
  try {
    const relayHint = await buildRelayLimitHint(collab.id);
    if (relayHint) systemPrompt += '\n\n' + relayHint;
  } catch (err) {
    console.warn('[RELAY_LIMIT_HINT] failed:', err.message);
  }

  if (_decompose.decomposed) {
    systemPrompt +=
      `\n\n>>> AVISO INTERNO: o colaborador mandou um áudio longo. ` +
      `Um decompositor extraiu ${_decompose.items.length} demandas distintas ` +
      `(estão enumeradas no final da mensagem dele). ` +
      `Emita o marker correspondente pra CADA demanda. Não perca nenhuma. ` +
      `Se ficou em dúvida em alguma, salve as que captou e pergunte só sobre a que ficou em dúvida (padrão P5).`;
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
      // Não vaza o texto "aprovado" alucinado — substitui por erro claro.
      reply = '_tive um problema técnico processando a aprovação. Manda de novo no formato:_ *APROVA <NOME-DO-PROJETO>*';
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
      // Não vaza o texto "rejeitado" alucinado — substitui por erro claro.
      reply = '_tive um problema técnico processando a rejeição. Manda de novo no formato:_ *REJEITA <NOME-DO-PROJETO> motivo*';
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
      // Sprint 31.7 (bug Dai 30/05) — inclui vocabulário de CONCLUSÃO de cobrança
      // ("✅ Fechado", "Concluí", "Resolvido", "Finalizado"). Antes o regex só
      // pegava criação/agendamento, então "Fechado" passava batido e a blindagem
      // não disparava quando o complete era rejeitado (schema_invalid).
      const optimisticPattern = /\b(registrad|agendad|reagendad|atualizad|salvei|salvo|guardad|marqu(ei|amos)|criad|conclu[ií]|fechad|fechei|resolvid|finalizad|encerrad|reagendando|agendando|registrando|feito[!.*\]]?|pronto[!.]?\s|bora[!.]?$)/i;
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
        // Sprint 28 — auto-align SÓ quando há 1 action no marker. Em batch
        // (vários itens), o user disse "hoje/amanhã" sobre UMA das tasks, e o
        // auto-align estava sobrescrevendo as datas das OUTRAS (caso Bass Night
        // 26/05: data 28/05 foi forçada pra 26/05). Confia em Claude pro resto.
        const isSingleAction = Array.isArray(parsedTask.actions) && parsedTask.actions.length === 1;
        if ((wantsTomorrow || wantsToday) && isSingleAction) {
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
      const { okCount, failCount, integrityPayload, failMessages } = await applyTaskActions(collab, parsedTask.actions);
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
          // Sprint 31.6 (E2) — se há msg específica (ex: tarefa de outro dono), usa ela
          // e SUBSTITUI o texto otimista do LLM (evita "✅ Reagendado" + "não consegui").
          // O genérico antigo dizia "te aviso depois" — falsa promessa; trocado por honesto.
          if (failMessages && failMessages.length) {
            base = failMessages.join('\n');
          } else {
            base = (base ? base + '\n\n' : '') + '_não consegui registrar agora. Me passa de novo?_';
          }
        } else if (failCount > 0 && okCount > 0) {
          // Sprint 21.5 — confirmação parcial honesta. Engine não pode deixar TOM dizer
          // "tudo certo" quando parte falhou. Princípio: fala = persistência.
          base = (base ? base + '\n\n' : '') + `_⚠️ Registrei ${okCount} de ${okCount + failCount}. Algumas falharam — me chama se algo ficar faltando._`;
        }
        reply = base || reply;
      }
    }
  }

  // 2.55) PREFS_UPDATE — TOM atualiza user_preferences (briefing, intensity, DND, etc.)
  {
    const parsedPrefs = parsePrefsMarker(reply);
    if (parsedPrefs && parsedPrefs.malformed) {
      console.warn('[Prefs] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'PREFS_UPDATE', 'rejected', 'schema_invalid', reply);
      reply = parsedPrefs.cleanText || reply;
    } else if (parsedPrefs) {
      const { okCount, failCount } = await applyPrefsUpdate(collab, parsedPrefs.update);
      const result = okCount > 0 ? 'executed' : 'rejected';
      const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
      await logMarker(collab.id, 'PREFS_UPDATE', result, reason, null);
      let base = parsedPrefs.cleanText || '';
      if (failCount > 0 && okCount === 0) {
        base = (base ? base + '\n\n' : '') + '_não consegui salvar a configuração agora — tenta de novo em instantes_';
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
      const { okCount, failCount, progressFooters } = await applyHabitActions(collab, parsedHab.actions, text);
      console.log(`[Habit] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      const result = okCount > 0 ? 'executed' : 'rejected';
      const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
      await logMarker(collab.id, 'HABIT_ACTION', result, reason, null);
      let base = parsedHab.cleanText || '';
      // Progresso quantitativo: número vem do engine (não do LLM). Anexa a barra exata.
      if (Array.isArray(progressFooters) && progressFooters.length) {
        base = (base ? base.trim() + '\n\n' : '') + progressFooters.join('\n');
      }
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
        console.log('[PersonalList] raw parsed:', JSON.stringify(parsed).slice(0, 300));
        const actions = Array.isArray(parsed) ? parsed : [parsed];
        let okCount = 0, failCount = 0;
        for (const a of actions) {
          try {
            if (!a || typeof a !== 'object') { console.warn('[PersonalList] FAIL: not object'); failCount++; continue; }
            console.log('[PersonalList] action:', a.action, 'name:', a.name);
            if (a.action === 'create' || a.action === 'create_list') {
              // aceita 'title' como alias de 'name' (TOM às vezes gera title em vez de name)
              const name = String(a.name || a.title || '').trim();
              if (!name) { console.warn('[PersonalList] FAIL: no name'); failCount++; continue; }
              const listType = ['shopping', 'travel', 'meds', 'general'].includes(a.list_type) ? a.list_type : 'general';
              const context = ['work', 'personal'].includes(a.context) ? a.context : 'personal';
              console.log('[PersonalList] inserting list:', { name, listType, context });
              const { data: list, error: e1 } = await supabase
                .from('personal_checklists')
                .insert({ owner_collab_id: collab.id, name, list_type: listType, context })
                .select('id').single();
              if (e1) { console.error('[PersonalList] FAIL list insert:', e1.message); failCount++; continue; }
              console.log('[PersonalList] list created id:', list?.id);
              const items = Array.isArray(a.items) ? a.items.filter(x => typeof x === 'string' && x.trim()) : [];
              console.log('[PersonalList] items count:', items.length);
              if (items.length) {
                const rows = items.map((d, i) => ({ list_id: list.id, description: d.trim(), sort_order: i + 1 }));
                const { error: e2 } = await supabase.from('personal_checklist_items').insert(rows);
                if (e2) { console.error('[PersonalList] FAIL items insert:', e2.message); failCount++; continue; }
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
              // Ownership + dados da lista (recurrence) via FK chain: item → list.owner.
              const { data: itemRow } = await supabase
                .from('personal_checklist_items')
                .select('id, list_id, personal_checklists!inner(id, owner_collab_id, recurrence_type, days_of_week, day_of_month)')
                .eq('id', a.item_id).maybeSingle();
              if (!itemRow || !itemRow.personal_checklists || itemRow.personal_checklists.owner_collab_id !== collab.id) {
                failCount++; continue;
              }
              const isDone = a.is_done === undefined ? true : !!a.is_done;
              const pcList = itemRow.personal_checklists;
              if (pcList.recurrence_type && pcList.recurrence_type !== 'once') {
                // Recorrente: escreve na completion do dia (não em is_done).
                const pc = require('./services/personalCompletions');
                const completion = await pc.ensurePersonalCompletion(pcList.id, collab.id);
                await pc.togglePersonalCompletionItem(completion.id, a.item_id, isDone);
                okCount++;
              } else {
                const { error } = await supabase.from('personal_checklist_items')
                  .update({ is_done: isDone }).eq('id', a.item_id);
                if (error) { failCount++; continue; }
                okCount++;
              }
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
              // Sprint 31.4 Bug-C fix: 'tom' viola tasks_source_check (só events aceita 'tom').
              source: 'manual',
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
      const optimisticEUPattern = /\b(reagendad|atualizad|movid|cancelad|conclu[ií]d|fechad|fechei|resolvid|finalizad|encerrad|registrad|salvei|feito[!.*\]]?|pronto[!.]?\s)/i;
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

    // Sprint 23 — 3 markers novos
    const parsedAttach = parseChecklistAttachmentMarker(reply);
    if (parsedAttach) {
      try {
        await applyChecklistAttachment({ ...parsedAttach, collaborator: collab });
        await logMarker(collab.id, 'CHECKLIST_ATTACHMENT', 'executed', `path=ok`, null);
        reply = reply.replace(/<<CHECKLIST_ATTACHMENT>>[\s\S]*?<<END>>/i, '').trim() || 'Anexo registrado ✅';
      } catch (e) {
        await logMarker(collab.id, 'CHECKLIST_ATTACHMENT', 'rejected', e.message.slice(0,200), null);
        console.error('[CHECKLIST_ATTACHMENT] failed:', e.message);
      }
    }

    const parsedDerive = parseDeriveTaskMarker(reply);
    if (parsedDerive) {
      try {
        const r = await applyDeriveTask({ ...parsedDerive, collaborator: collab });
        await logMarker(collab.id, 'DERIVE_TASK', 'executed', `task=${r.task_id}`, null);
        reply = reply.replace(/<<DERIVE_TASK>>[\s\S]*?<<END>>/i, '').trim() || `✅ Tarefa criada: "${parsedDerive.title}"`;
      } catch (e) {
        await logMarker(collab.id, 'DERIVE_TASK', 'rejected', e.message.slice(0,200), null);
        console.error('[DERIVE_TASK] failed:', e.message);
      }
    }

    const parsedJustify = parseChecklistJustifyMarker(reply);
    if (parsedJustify) {
      try {
        await applyChecklistJustify({ ...parsedJustify, collaborator: collab });
        await logMarker(collab.id, 'CHECKLIST_JUSTIFY', 'executed', `len=${parsedJustify.justification.length}`, null);
        reply = reply.replace(/<<CHECKLIST_JUSTIFY>>[\s\S]*?<<END>>/i, '').trim() || 'Anotei a justificativa ✅';
      } catch (e) {
        await logMarker(collab.id, 'CHECKLIST_JUSTIFY', 'rejected', e.message.slice(0,200), null);
        console.error('[CHECKLIST_JUSTIFY] failed:', e.message);
      }
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

  // LA REPORT — <<INVENTORY_ACTION>> — operações de inventário e lojinha.
  {
    const invActionMatch = reply.match(/<<INVENTORY_ACTION>>([\s\S]*?)<<END>>/i);
    if (invActionMatch) {
      let payload;
      try { payload = JSON.parse(invActionMatch[1].trim()); }
      catch (e) {
        console.warn('[InventoryAction] JSON inválido:', e.message);
        reply = reply.replace(/<<INVENTORY_ACTION>>[\s\S]*?<<END>>/gi, '').trim();
        reply = (reply ? reply + '\n\n' : '') + 'Não consegui interpretar o pedido. Pode reformular?';
        payload = null;
      }
      if (payload) {
        // Normaliza: aceita payload "flat" (sem `params` aninhado). O LLM frequentemente esquece.
        if (payload && typeof payload === 'object' && payload.action && !payload.params) {
          const { action, ...rest } = payload;
          if (Object.keys(rest).length > 0) {
            payload = { action, params: rest };
            console.log('[InventoryAction] normalizado flat→params:', JSON.stringify(payload));
          }
        }
        // Normaliza aliases de FIELDS em params (LLM inventa item_name, room, unit, quantity, etc)
        if (payload.params && typeof payload.params === 'object') {
          const fieldAliases = {
            item_name: 'nome', itemname: 'nome', item: 'nome', name: 'nome',
            room: 'sala_nome', sala: 'sala_nome', room_name: 'sala_nome', roomname: 'sala_nome',
            unit: 'unidade_nome', unidade: 'unidade_nome', unit_name: 'unidade_nome', unitname: 'unidade_nome',
            quantity: 'quantidade', qty: 'quantidade', qtd: 'quantidade',
            category: 'categoria',
            brand: 'marca', model: 'modelo',
            serial_number: 'numero_serie', serial: 'numero_serie', serialnumber: 'numero_serie',
            heritage_code: 'codigo_patrimonio', patrimony_code: 'codigo_patrimonio',
            condition: 'condicao',
            purchase_value: 'valor_compra', price: 'valor_compra', value: 'valor_compra', valor: 'valor_compra',
            purchase_date: 'data_compra', date: 'data_compra',
            invoice: 'nota_fiscal', nf: 'nota_fiscal',
            supplier: 'fornecedor', vendor: 'fornecedor',
            photo_url: 'foto_url', photo: 'foto_url', foto: 'foto_url',
            notes: 'observacoes', observations: 'observacoes', obs: 'observacoes',
            destination_room: 'sala_destino_nome', destination: 'sala_destino_nome', dest_room: 'sala_destino_nome',
            source_room: 'sala_origem_nome', origin: 'sala_origem_nome',
            reason: 'motivo', motivation: 'motivo',
            description: 'descricao', desc: 'descricao',
            cost: 'custo',
            service_provider: 'fornecedor_servico', service: 'fornecedor_servico',
            type: 'tipo', kind: 'tipo',
            product_name: 'produto_nome', product: 'produto_nome',
          };
          const novoParams = {};
          for (const [k, v] of Object.entries(payload.params)) {
            const target = fieldAliases[String(k).toLowerCase()] || k;
            // só escreve se ainda não tiver (não sobrescreve key correta vinda em paralelo)
            if (novoParams[target] === undefined) novoParams[target] = v;
          }
          if (JSON.stringify(novoParams) !== JSON.stringify(payload.params)) {
            console.log(`[InventoryAction] normalizado fields:`, JSON.stringify(novoParams));
            payload.params = novoParams;
          }
        }
        // Normaliza aliases de action que o LLM costuma inventar
        const actionAliases = {
          // criar
          create: 'add_item', criar: 'add_item', cadastrar: 'add_item', adicionar: 'add_item',
          novo: 'add_item', add: 'add_item', register: 'add_item', registrar: 'add_item', inserir: 'add_item',
          // editar / atualizar (qualquer variação)
          update: 'edit_item', update_item: 'edit_item', update_quantity: 'edit_item', update_qty: 'edit_item',
          update_field: 'edit_item', update_status: 'edit_item', update_condition: 'edit_item', update_condicao: 'edit_item',
          atualizar: 'edit_item', atualizar_quantidade: 'edit_item', editar: 'edit_item', edit: 'edit_item',
          alterar: 'edit_item', modificar: 'edit_item', change: 'edit_item', change_quantity: 'edit_item',
          patch: 'edit_item', set: 'edit_item', set_quantity: 'edit_item', set_field: 'edit_item',
          // mover
          mover: 'move_item', move: 'move_item', transferir: 'move_item', transfer: 'move_item', relocate: 'move_item',
          // manutenção
          manutencao: 'maintenance', manutenção: 'maintenance', reparar: 'maintenance', consertar: 'maintenance',
          conserto: 'maintenance', repair: 'maintenance', fix: 'maintenance', report_issue: 'maintenance',
          // baixa / deletar
          baixa: 'delete_item', desativar: 'delete_item', remover: 'delete_item', delete: 'delete_item',
          excluir: 'delete_item', remove: 'delete_item', inativar: 'delete_item', deactivate: 'delete_item',
          // shop
          loja: 'shop_movement', estoque: 'shop_movement',
          // consultar / ver
          consultar: 'ver', query: 'ver', buscar: 'ver', search: 'ver', get: 'ver', view: 'ver',
          listar: 'query_rooms', list: 'query_rooms', list_rooms: 'query_rooms',
        };
        const KNOWN_ACTIONS = ['add_item', 'edit_item', 'delete_item', 'move_item', 'maintenance', 'shop_movement', 'ver', 'query_room', 'query_shop', 'query_rooms'];
        if (payload.action && actionAliases[String(payload.action).toLowerCase()]) {
          const novo = actionAliases[String(payload.action).toLowerCase()];
          console.log(`[InventoryAction] alias action: ${payload.action} → ${novo}`);
          payload.action = novo;
        }
        // Fallback inteligente: action desconhecida + params tem campos de update → edit_item
        if (payload.action && !KNOWN_ACTIONS.includes(payload.action) && payload.params) {
          const p2 = payload.params;
          const hasUpdateField = ['quantidade', 'condicao', 'status', 'marca', 'modelo', 'valor_compra', 'fornecedor', 'observacoes', 'foto_url', 'codigo_patrimonio', 'numero_serie', 'data_compra', 'nota_fiscal', 'proxima_revisao'].some(k => p2[k] !== undefined);
          if (hasUpdateField && (p2.nome || p2.item_id)) {
            console.log(`[InventoryAction] fallback unknown→edit_item (action era "${payload.action}")`);
            payload.action = 'edit_item';
          }
        }
        const baseCheck = inventarioValidators.validateAction(payload);
        if (!baseCheck.ok) {
          console.warn('[InventoryAction] validateAction failed:', baseCheck.errors);
          reply = reply.replace(/<<INVENTORY_ACTION>>[\s\S]*?<<END>>/gi, '').trim();
          reply = (reply ? reply + '\n\n' : '') + `Pedido inválido: ${baseCheck.errors.join(', ')}`;
        } else {
          reply = reply.replace(/<<INVENTORY_ACTION>>[\s\S]*?<<END>>/gi, '').trim();
          const userName = (collab && collab.full_name) ? collab.full_name : 'usuário';
          const p = payload.params;

          async function resolverUnidadeId(nome) {
            if (p.unidade_id) return p.unidade_id;
            if (!nome) return null;
            const u = await inventarioService.listarUnidades();
            const m = u.find(x => x.nome.toLowerCase() === nome.toLowerCase()) ||
                      u.find(x => x.nome.toLowerCase().includes(nome.toLowerCase()));
            return m ? m.id : null;
          }
          async function resolverSalaId(nomeSala, unidadeId) {
            if (p.sala_id) return p.sala_id;
            if (!nomeSala) return null;
            const r = await inventarioService.buscarSalaPorNome(nomeSala, unidadeId);
            if (r.length === 0) return null;
            if (r.length > 1) return { ambiguous: r.map(x => `${x.nome} (id ${x.id})`).join(', ') };
            return r[0].id;
          }

          try {
            if (payload.action === 'add_item') {
              const vc = inventarioValidators.validateAddItem(p);
              if (!vc.ok) { reply = (reply ? reply + '\n\n' : '') + `Faltam dados: ${vc.errors.join(', ')}`; }
              else {
                let unidadeId = await resolverUnidadeId(p.unidade_nome);
                // Se faltou unidade, tenta inferir pela sala (busca sala — se única, pega unidade dela)
                if (!unidadeId && (p.sala_id || p.sala_nome)) {
                  if (p.sala_id) {
                    const { laReportClient } = require('./services/la-report-client');
                    const { data: s } = await laReportClient.from('salas').select('unidade_id').eq('id', p.sala_id).maybeSingle();
                    if (s) unidadeId = s.unidade_id;
                  } else {
                    const salas = await inventarioService.buscarSalaPorNome(p.sala_nome);
                    if (salas.length === 1) unidadeId = salas[0].unidade_id;
                    else if (salas.length > 1) {
                      reply = (reply ? reply + '\n\n' : '') + `Mais de uma sala "${p.sala_nome}" em unidades diferentes: ${salas.map(s => `id ${s.id}`).join(', ')}. Diz a unidade (Barra/Recreio/CG).`;
                      unidadeId = 'AMBIGUOUS';
                    }
                  }
                }
                if (unidadeId === 'AMBIGUOUS') {
                  // já mandou pergunta — não prossegue
                } else if (!unidadeId) {
                  reply = (reply ? reply + '\n\n' : '') + `Não consegui identificar a unidade${p.unidade_nome ? ` "${p.unidade_nome}"` : ''}. Diz a unidade (Barra/Recreio/CG).`;
                } else {
                  const salaId = await resolverSalaId(p.sala_nome, unidadeId);
                  if (salaId == null) { reply = (reply ? reply + '\n\n' : '') + `Sala "${p.sala_nome}" não encontrada.`; }
                  else if (typeof salaId === 'object' && salaId.ambiguous) { reply = (reply ? reply + '\n\n' : '') + `Mais de uma sala: ${salaId.ambiguous}. Qual?`; }
                  else {
                    // Normaliza defaults — LLM nunca preenche tudo, e os campos opcionais aceitam null no DB
                    const qtyParsed = parseInt(p.quantidade, 10);
                    const itemPayload = {
                      nome: String(p.nome).trim(),
                      sala_id: salaId,
                      unidade_id: unidadeId,
                      categoria: p.categoria || null,
                      marca: p.marca || null,
                      modelo: p.modelo || null,
                      numero_serie: p.numero_serie || null,
                      codigo_patrimonio: p.codigo_patrimonio || null,
                      quantidade: Number.isInteger(qtyParsed) && qtyParsed > 0 ? qtyParsed : 1,
                      condicao: p.condicao || 'bom',
                      status: p.status || 'ativo',
                      valor_compra: typeof p.valor_compra === 'number' ? p.valor_compra : null,
                      data_compra: p.data_compra || null,
                      nota_fiscal: p.nota_fiscal || null,
                      fornecedor: p.fornecedor || null,
                      foto_url: p.foto_url || null,
                      observacoes: p.observacoes || null,
                    };
                    const item = await inventarioService.inserirItem(itemPayload, userName);
                    reply = (reply ? reply + '\n\n' : '') + `✅ Item adicionado: ${item.nome}${item.codigo_patrimonio ? ` (${item.codigo_patrimonio})` : ''}`;
                  }
                }
              }
            } else if (payload.action === 'shop_movement') {
              const vc = inventarioValidators.validateShopMovement(p);
              if (!vc.ok) { reply = (reply ? reply + '\n\n' : '') + `Faltam dados: ${vc.errors.join(', ')}`; }
              else {
                const unidadeId = await resolverUnidadeId(p.unidade_nome);
                if (!unidadeId) { reply = (reply ? reply + '\n\n' : '') + `Unidade "${p.unidade_nome}" não encontrada.`; }
                else {
                  let produtoId = p.produto_id;
                  if (!produtoId) {
                    const prods = await inventarioService.buscarProdutoPorNome(p.produto_nome);
                    if (prods.length === 0) { reply = (reply ? reply + '\n\n' : '') + `Produto "${p.produto_nome}" não cadastrado na lojinha.`; produtoId = null; }
                    else if (prods.length > 1) { reply = (reply ? reply + '\n\n' : '') + `Mais de um produto: ${prods.map(x => x.nome).join(', ')}. Qual?`; produtoId = null; }
                    else produtoId = prods[0].id;
                  }
                  if (produtoId) {
                    const qty = p.tipo === 'entrada' ? Math.abs(p.quantidade) : -Math.abs(p.quantidade);
                    const res = await inventarioService.ajustarEstoqueLoja({
                      produto_id: produtoId, unidade_id: unidadeId, quantidade: qty, tipo: p.tipo,
                      nota_fiscal: p.nota_fiscal, motivo: p.motivo,
                    }, userName);
                    reply = (reply ? reply + '\n\n' : '') + `✅ Estoque atualizado. Saldo agora: ${res.saldo_apos} un.`;
                  }
                }
              }
            } else if (payload.action === 'move_item') {
              // Normaliza aliases ANTES de validar.
              // LLM varia muito: from_room/to_room, from_location/to_location, etc.
              const stripSala = (v) => typeof v === 'string'
                ? v.replace(/^\s*sala\s+/i, '').trim()
                : v;
              p.item_nome = p.item_nome || p.item || p.nome || p.name || p.item_name;
              p.sala_destino_nome = stripSala(p.sala_destino_nome || p.sala_destino || p.destino
                || p.destination || p.sala_para || p.para || p.to
                || p.to_room || p.to_location || p.destination_room || p.destination_location);
              p.sala_origem_nome = stripSala(p.sala_origem_nome || p.sala_nome || p.sala
                || p.room || p.origem || p.from
                || p.from_room || p.from_location || p.source_room || p.source_location);
              if (!p.tipo || !inventarioValidators.VALID_MOV_TIPOS.includes(p.tipo)) p.tipo = 'transferencia';
              const vc = inventarioValidators.validateMoveItem(p);
              if (!vc.ok) { reply = (reply ? reply + '\n\n' : '') + `Faltam dados: ${vc.errors.join(', ')}`; }
              else {
                let itemId = p.item_id;
                if (!itemId && p.item_nome) {
                  const { laReportClient } = require('./services/la-report-client');
                  let q = laReportClient.from('inventario').select('id, nome, sala_id').ilike('nome', `%${p.item_nome}%`).eq('ativo', true);
                  // Se a origem foi dita, filtra por ela pra desambiguar
                  if (p.sala_origem_nome) {
                    const ro = await inventarioService.buscarSalaPorNome(p.sala_origem_nome);
                    if (ro.length === 1) q = q.eq('sala_id', ro[0].id);
                  }
                  const { data } = await q.limit(5);
                  if (!data || data.length === 0) { reply = (reply ? reply + '\n\n' : '') + `Item "${p.item_nome}" não encontrado.`; itemId = null; }
                  else if (data.length > 1) { reply = (reply ? reply + '\n\n' : '') + `Mais de um item: ${data.map(x => x.nome).join(', ')}. Qual?`; itemId = null; }
                  else itemId = data[0].id;
                }
                if (itemId) {
                  let destinoId = p.sala_destino_id;
                  if (!destinoId && p.sala_destino_nome) {
                    const r = await inventarioService.buscarSalaPorNome(p.sala_destino_nome);
                    if (r.length === 1) destinoId = r[0].id;
                    else if (r.length === 0) { reply = (reply ? reply + '\n\n' : '') + `Sala "${p.sala_destino_nome}" não encontrada.`; }
                    else { reply = (reply ? reply + '\n\n' : '') + `Mais de uma sala bate "${p.sala_destino_nome}": ${r.map(x => x.nome).join(', ')}. Qual?`; }
                  }
                  if (destinoId) {
                    await inventarioService.registrarMovimentacao({
                      item_id: itemId, tipo: p.tipo, sala_destino_id: destinoId, motivo: p.motivo || `via TOM por ${userName}`,
                    }, userName);
                    reply = (reply ? reply + '\n\n' : '') + `✅ Movimentação registrada.`;
                  }
                }
              }
            } else if (payload.action === 'maintenance') {
              const vc = inventarioValidators.validateMaintenance(p);
              if (!vc.ok) { reply = (reply ? reply + '\n\n' : '') + `Faltam dados: ${vc.errors.join(', ')}`; }
              else {
                let itemId = p.item_id;
                if (!itemId && p.item_nome) {
                  const { laReportClient } = require('./services/la-report-client');
                  const { data } = await laReportClient.from('inventario').select('id, nome').ilike('nome', `%${p.item_nome}%`).eq('ativo', true).limit(5);
                  if (!data || data.length === 0) { reply = (reply ? reply + '\n\n' : '') + `Item "${p.item_nome}" não encontrado.`; itemId = null; }
                  else if (data.length > 1) { reply = (reply ? reply + '\n\n' : '') + `Mais de um item: ${data.map(x => x.nome).join(', ')}. Qual?`; itemId = null; }
                  else itemId = data[0].id;
                }
                if (itemId) {
                  await inventarioService.registrarManutencao({
                    item_id: itemId, tipo: p.tipo, descricao: p.descricao, custo: p.custo,
                    fornecedor_servico: p.fornecedor_servico,
                  }, userName);
                  reply = (reply ? reply + '\n\n' : '') + `🔧 Manutenção registrada.`;
                }
              }
            } else if (payload.action === 'edit_item') {
              const { laReportClient } = require('./services/la-report-client');
              // Resolve item por id ou nome (+ sala opcional)
              let itemId = p.item_id;
              if (!itemId && p.nome) {
                let q = laReportClient.from('inventario').select('id, nome, sala_id, unidade_id').ilike('nome', `%${p.nome}%`).eq('ativo', true);
                if (p.sala_nome) {
                  const r = await inventarioService.buscarSalaPorNome(p.sala_nome);
                  if (r.length === 1) q = q.eq('sala_id', r[0].id);
                }
                const { data } = await q.limit(5);
                if (!data || data.length === 0) { reply = (reply ? reply + '\n\n' : '') + `Item "${p.nome}" não encontrado${p.sala_nome ? ` na sala ${p.sala_nome}` : ''}.`; itemId = null; }
                else if (data.length > 1) { reply = (reply ? reply + '\n\n' : '') + `Mais de um item bate "${p.nome}": ${data.map(x => x.nome).join(', ')}. Qual?`; itemId = null; }
                else itemId = data[0].id;
              }
              if (itemId) {
                // Monta patch só com os campos que vieram (não sobrescreve com null)
                const patch = {};
                const camposEditaveis = ['nome', 'categoria', 'marca', 'modelo', 'numero_serie', 'codigo_patrimonio',
                  'quantidade', 'condicao', 'status', 'valor_compra', 'data_compra', 'nota_fiscal', 'fornecedor',
                  'foto_url', 'observacoes', 'sala_id', 'unidade_id', 'vida_util_meses', 'proxima_revisao', 'alertar_dias_antes'];
                for (const c of camposEditaveis) if (p[c] !== undefined) patch[c] = p[c];
                if (Object.keys(patch).length === 0) {
                  reply = (reply ? reply + '\n\n' : '') + `Nenhum campo pra editar. Diz o que mudar (qtd, condição, marca, etc).`;
                } else {
                  if (typeof patch.quantidade !== 'undefined') patch.quantidade = parseInt(patch.quantidade, 10);
                  patch.updated_at = new Date().toISOString();
                  const { data: upd, error } = await laReportClient.from('inventario').update(patch).eq('id', itemId).select('id, nome, quantidade, condicao, status').single();
                  if (error) reply = (reply ? reply + '\n\n' : '') + `Erro ao atualizar: ${error.message}`;
                  else reply = (reply ? reply + '\n\n' : '') + `✏️ Atualizado: ${upd.nome} → qtd ${upd.quantidade}, cond ${upd.condicao}, status ${upd.status}`;
                }
              }
            } else if (payload.action === 'delete_item') {
              const { laReportClient } = require('./services/la-report-client');
              let itemId = p.item_id;
              if (!itemId && p.nome) {
                let q = laReportClient.from('inventario').select('id, nome').ilike('nome', `%${p.nome}%`).eq('ativo', true);
                if (p.sala_nome) {
                  const r = await inventarioService.buscarSalaPorNome(p.sala_nome);
                  if (r.length === 1) q = q.eq('sala_id', r[0].id);
                }
                const { data } = await q.limit(5);
                if (!data || data.length === 0) { reply = (reply ? reply + '\n\n' : '') + `Item "${p.nome}" não encontrado.`; itemId = null; }
                else if (data.length > 1) { reply = (reply ? reply + '\n\n' : '') + `Mais de um item bate: ${data.map(x => x.nome).join(', ')}. Qual?`; itemId = null; }
                else itemId = data[0].id;
              }
              if (itemId) {
                const obs = `Baixa via TOM por ${userName}${p.motivo ? ' — ' + p.motivo : ''}`;
                const { data: del, error } = await laReportClient.from('inventario')
                  .update({ status: 'baixa', ativo: false, observacoes: obs, updated_at: new Date().toISOString() })
                  .eq('id', itemId).select('id, nome').single();
                if (error) reply = (reply ? reply + '\n\n' : '') + `Erro na baixa: ${error.message}`;
                else reply = (reply ? reply + '\n\n' : '') + `🗑️ Baixado: ${del.nome}`;
              }
            } else if (payload.action === 'ver') {
              const nome = p && p.nome ? p.nome : payload.nome;
              if (!nome) {
                reply = (reply ? reply + '\n\n' : '') + 'Falta o nome do item. Ex: "/inv ver piano"';
              } else {
                try {
                  const itens = await inventarioService.buscarItemPorNome(nome, null, collab);
                  if (!itens || itens.length === 0) {
                    reply = (reply ? reply + '\n\n' : '') + `Nenhum item com "${nome}" encontrado.`;
                  } else {
                    reply = (reply ? reply + '\n\n' : '') + itens.map(formatarCardItem).join('\n\n');
                  }
                } catch (e) {
                  if (e.code === 'ACCESS_DENIED') {
                    reply = (reply ? reply + '\n\n' : '') + e.message;
                  } else {
                    throw e;
                  }
                }
              }
            } else if (['query_room', 'query_shop', 'query_rooms'].includes(payload.action)) {
              // Query handled by system prompt snapshot — reply already set by LLM
            } else {
              reply = (reply ? reply + '\n\n' : '') + `Ação ${payload.action} ainda não suportada.`;
            }
          } catch (e) {
            console.error('[engine] INVENTORY_ACTION execução:', e);
            reply = (reply ? reply + '\n\n' : '') + `Erro ao executar: ${e.message}`;
          }
        }
      }
    }
  }

  // Sprint Fase B — <<SHOP_ACTION>> — venda, entrada, ajuste e consulta da lojinha.
  {
    const shop = parseShopAction(reply);
    if (shop) {
      const _userName = (collab && collab.full_name) ? collab.full_name : 'usuário';
      try {
        const shopResult = await handleShopAction(shop, collab, _userName);
        if (shopResult) reply = (reply.replace(/<<SHOP_ACTION>>[\s\S]*?<<(?:\/?SHOP_ACTION|END)>>/g, '') + '\n\n' + shopResult).trim();
      } catch (e) {
        console.error('[ShopAction] handler err:', e.message);
        reply = (reply.replace(/<<SHOP_ACTION>>[\s\S]*?<<(?:\/?SHOP_ACTION|END)>>/g, '') + '\n\n⚠️ Não consegui registrar: ' + e.message).trim();
      }
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

  // Sprint 16 → revisão 26/05 — <<COORDINATION_REQUEST>>: processa TODOS os
  // markers (antes só o primeiro). Caso real: broadcast pra 4 pessoas em 1 turn.
  {
    const parsedCoord = parseCoordinationRequestMarker(reply);
    if (parsedCoord && parsedCoord.malformed) {
      console.warn('[CoordinationRequest] WARN: all markers malformed, dropping block', parsedCoord.reasons);
      await logMarker(collab.id, 'COORDINATION_REQUEST', 'rejected', 'schema_invalid', null);
      reply = parsedCoord.cleanText || reply;
    } else if (parsedCoord && parsedCoord.items) {
      let okCount = 0, failCount = 0;
      const failedRecipients = [];
      const failedResults = [];
      for (const item of parsedCoord.items) {
        const result = await applyCoordinationRequestAction(collab, item);
        await logMarker(
          collab.id,
          'COORDINATION_REQUEST',
          result.ok ? 'executed' : 'rejected',
          `${item.recipient_name}:${result.reason}`,
          null
        );
        if (result.ok) okCount++;
        else { failCount++; failedRecipients.push(`${item.recipient_name} (${result.reason})`); failedResults.push(result); }
      }
      if (parsedCoord.items.length > 1) {
        console.log(`[CoordinationRequest] batch: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      }
      // Limpa texto da resposta e, se houver falhas, expõe pro user (não esconde).
      reply = parsedCoord.cleanText || reply;
      // Sprint 31.6 (B5) — superficia falha mesmo com 1 destinatário (antes só >1).
      // Caso real "avisa a Diana": Diana não cadastrada → TOM dizia "Mandando agora" e
      // o erro era engolido. Agora: 1 destinatário usa a msg específica do handler
      // (sabe distinguir não-encontrado / sem-alçada / etc); vários, lista resumida.
      if (failCount > 0) {
        if (parsedCoord.items.length === 1 && okCount === 0 && failedResults[0]?.replyText) {
          reply = failedResults[0].replyText; // substitui o texto otimista do LLM
        } else if (failCount > 0) {
          reply = (reply || '') + `\n\n⚠️ Não consegui enviar pra: ${failedRecipients.join(', ')}.`;
        }
      }
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

    // 2.7c) Data classification (Sprint 29.1) — marca task/event como teste/real/archived
    const parsedClassify = parseDataClassifyMarker(reply);
    if (parsedClassify && parsedClassify.malformed) {
      console.warn('[DATA_CLASSIFY] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'DATA_CLASSIFY', 'rejected', 'schema_invalid', reply);
      reply = parsedClassify.cleanText || reply;
    } else if (parsedClassify) {
      try {
        const results = await applyDataClassify(collab, parsedClassify);
        const okCount = results.filter(r => r.ok).length;
        const learned = results.find(r => r.patternLearned)?.patternLearned;
        const detail = `items_ok:${okCount}/${results.length}` + (learned ? ` pattern:${learned.type}=${learned.value}(hits=${learned.hits})` : '');
        await logMarker(collab.id, 'DATA_CLASSIFY', 'executed', detail, JSON.stringify(parsedClassify.items).slice(0, 400));
        reply = parsedClassify.cleanText || reply;
      } catch (err) {
        console.error('[DATA_CLASSIFY] persist err:', err.message);
        await logMarker(collab.id, 'DATA_CLASSIFY', 'rejected', `persist_error:${err.message}`, JSON.stringify(parsedClassify.items).slice(0, 400));
        reply = parsedClassify.cleanText || reply;
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
      const result = await applyCoordinationResponseAction(collab, parsedCoordResp, inboundVerbatimText);
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

  // 2.9) Finance action (Sprint 27). SEGURANCA: collab.id (remetente), nunca o id do marker.
  {
    const fin = parseFinanceMarker(reply);
    if (fin && fin.malformed) {
      console.warn('[Finance] WARN: malformed marker');
      await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', 'schema_invalid', reply);
      reply = fin.cleanText || reply;
    } else if (fin) {
      try {
        const finReply = await handleFinanceAction(collab, fin.action, fin.params);
        await logMarker(collab.id, 'FINANCE_ACTION', 'executed', fin.action, null);
        // Bug 3: o engine é a fonte da confirmação. Se o handler respondeu, usa SÓ ela
        // (descarta a narração do LLM em cleanText, que duplicava/recalculava o número).
        reply = (finReply && finReply.trim()) ? finReply : (fin.cleanText || reply);
      } catch (err) {
        console.error('[Finance] erro:', err.message);
        await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', `error:${err.message}`, null);
        reply = (fin.cleanText || '') + '\nDeu ruim ao registrar isso aqui — tenta de novo?';
      }
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

  // ---- Sprint 28 — Parser <<REACT>>emoji<<END>>
  // TOM reage à mensagem do user com emoji (🚀🔥❤️😂👍...) pra humanizar.
  // Roda ANTES do catch-all stripper (senão <<REACT>> seria removido como unknown).
  // Se reply ficar vazio após strip, só a reação é enviada (sem texto).
  // messageId vem do payload bruto via whatsapp.extractMessageId(raw).
  let _reactionsToSend = [];
  try {
    if (typeof reply === 'string') {
      const reactRe = /<<REACT>>\s*([\s\S]*?)\s*<<END>>/gi;
      const matches = [...reply.matchAll(reactRe)];
      for (const m of matches) {
        const emoji = String(m[1] || '').trim();
        if (emoji && emoji.length <= 8) _reactionsToSend.push(emoji);
      }
      if (_reactionsToSend.length) {
        reply = reply.replace(reactRe, '').replace(/\n{3,}/g, '\n\n').trim();
        console.log(`[Engine] REACT marker(s): ${_reactionsToSend.join(' ')} (residual_len=${reply.length})`);
        const targetMsgId = whatsapp.extractMessageId(raw);
        if (targetMsgId) {
          whatsapp.sendReaction(phone, targetMsgId, _reactionsToSend[0])
            .catch(e => console.warn('[Engine] sendReaction async err:', e.message));
          await logMarker(collab.id, 'REACT', 'executed', _reactionsToSend[0], null);
        } else {
          console.warn('[Engine] REACT skipped — no messageId in raw payload');
          await logMarker(collab.id, 'REACT', 'rejected', 'no_message_id', null);
        }
      }
    }
  } catch (e) {
    console.warn('[Engine] REACT parse/dispatch err (silent):', e.message);
  }

  // STICKER markers — extrai nomes ANTES do catch-all stripar. Envio é feito
  // como follow-up depois do reply de texto. Máx 1 por mensagem (rule no skill
  // figurinhas.md). Slug válido = [a-z][a-z0-9_]{0,40}.
  let _pendingStickers = [];
  try {
    if (typeof reply === 'string') {
      const STICKER_RE = /<<STICKER>>\s*([a-z][a-z0-9_]{0,40})\s*<<END>>/gi;
      let _sm;
      while ((_sm = STICKER_RE.exec(reply)) !== null) {
        _pendingStickers.push(_sm[1].toLowerCase());
      }
      _pendingStickers = _pendingStickers.slice(0, 1);
      // Sprint 31.6 (B4) — REMOVE o marker do reply aqui (igual o REACT faz no 7288).
      // Antes não removia: o catch-all stripper logo abaixo o via e logava como
      // UNKNOWN_MARKER_STRIPPED — ruído que inflava "markers rejeitados" na auditoria,
      // mesmo o sticker sendo enviado normalmente no follow-up.
      if (_pendingStickers.length) {
        reply = reply.replace(/<<STICKER>>\s*[a-z][a-z0-9_]{0,40}\s*<<END>>/gi, '')
          .replace(/\n{3,}/g, '\n\n').trim();
      }
    }
  } catch (_) { /* silent */ }

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
        const delta = before.length - reply.length;
        console.warn(`[Engine] tool_call/narration stripped (${before.length}→${reply.length} chars, delta=${delta})`);
        // delta ≤ 10 = normalização de whitespace (\n\n\n\n→\n\n) — não é tool_call real.
        // Só loga no marker_logs se houve remoção substantiva de conteúdo.
        if (delta > 10) {
          await logMarker(collab.id, 'TOOL_CALL_STRIPPED', 'rejected', `delta:${delta}`, before.slice(0, 500));
        }
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
      // Sprint 28: EXCETO quando TOM emitiu só <<REACT>>emoji<<END>> — aí
      // reply vazio é intencional (só a reação será enviada), sem fallback.
      if (!reply.trim() && (!_reactionsToSend || _reactionsToSend.length === 0)) {
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
  //
  // Sprint 28.2: Camada 1 do guardrail — retry automático quando promessa
  // explícita aparece na REPLY do TOM mas nenhum marker foi emitido.
  // Conservador: só dispara em gatilhos cristalinos. Reply visual NÃO muda;
  // apenas os efeitos colaterais (persistência) são corrigidos.
  try {
    const ACTIONABLE_RE = /\b(anota|me\s+lembra|lembra\s+(?:de|do|da)\b|lembrete|me\s+chama|preciso|surgiu|p[oó]e\s+na\s+lista|adiciona|paguei|fiz|terminei|fechei|completei|delega|marca\s+(?:reuni|m[eé]dico|consulta|ensaio|encontro|aula)|compr(?:a|ar|e)\s|consert(?:a|ar)|trocar?|reparar?|montar?|instalar?|limpar?|verificar?|vai\s+criando|vai\s+anotando|vou\s+te\s+mandar|t[eô]\s+(?:te\s+)?mandando\s+as?\s+(?:pend|demanda|tarefa)|tem\s+(?:que|pra)\s+(?:fazer|comprar|consertar|trocar))/i;
    // Detector de promessa EXPLÍCITA na reply do TOM (gatilhos conservadores).
    // Cobre casos onde TOM verbaliza intenção de persistir sem emitir o marker:
    // - "lembrete às X" / "te aviso às X" → cron/remind
    // - "reagendei pra X" / "marquei pra X" → reschedule
    // - "registrar/registrei/anotando/criando/adicionando/crio as/juntando/no pacote/na lista" → create operacional
    const REPLY_PROMISE_RE = /(?:lembrete|lembro|te\s+(?:aviso|cobro|lembro))\s+(?:hoje\s+|amanh[aã]\s+|j[aá]\s+|de\s+novo\s+|mais\s+tarde\s+)?(?:[aà]s?\s+|nas?\s+)?\d{1,2}\s*[h:]|(?:reagendei|reagendo|reagendado|reagendamento|marquei\s+(?:pra|para)|agendei\s+(?:pra|para)|coloquei\s+(?:pra|para)|movi\s+(?:pra|para))\s+(?:hoje|amanh[aã]|segunda|terça|quarta|quinta|sexta|sábado|domingo|próxima|semana\s+que\s+vem|\d{1,2}\/\d{1,2})|\b(?:registr(?:ar|ei|ando|o)|anot(?:ar|ei|ando|ado)|adicion(?:ar|ei|ando|ado|o)|juntando|criando|criei|vou\s+criar|crio\s+as?|colocando\s+(?:na|no)\s+(?:lista|pacote|fila)|(?:t[oô]|estou)\s+(?:adicionando|registrando|anotando|criando)|adicionando\s+ao\s+pacote)\b/i;
    const inputActionable = ACTIONABLE_RE.test(String(text || ''));
    const replyHasPromise = REPLY_PROMISE_RE.test(String(reply || ''));
    // Sprint 31 — pula quando TOM está coletando info (pergunta sem tarefa bold)
    // ex: "Claro! De que é o lembrete?" → info-gathering, não promessa quebrada
    const _replyEndsQ = /\?\s*$/.test((reply || '').trim());
    const _replyHasBoldTask = /\*[^*]{3,80}\*/.test(reply || '');
    const _replyIsInfoGathering = _replyEndsQ && !_replyHasBoldTask;
    // Sprint 31.6 (C1) — reduz falso-positivo da métrica ACTIONABLE_NO_MARKER.
    // O `inputActionable` pegava (a) PERGUNTAS do user ("E o evento que criei?")
    // e (b) AUTO-RELATO do próprio user ("estou verificando", "eu já criei") —
    // nenhum é ação pendente PRO TOM. `replyHasPromise` (TOM se comprometeu) sempre
    // conta. `inputActionable` só conta se NÃO for pergunta nem auto-relato.
    const _inputIsQuestion = /\?\s*$/.test(String(text || '').trim());
    const _inputSelfReport = /\b(est(?:ou|á)|t[oô]u?|tava)\s+[a-zà-ú]+ndo\b|\b(?:eu\s+)?j[aá]\s+(?:fiz|criei|terminei|fechei|completei|resolvi|mandei|enviei|verifiquei)\b/i.test(String(text || ''));
    const _flagActionable = replyHasPromise || (inputActionable && !_inputIsQuestion && !_inputSelfReport);
    if (!_replyIsInfoGathering && _flagActionable) {
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

        // --- Sprint 28.2: Camada 1 — retry com prompt cirúrgico ---
        // Só ataca quando há promessa EXPLÍCITA na reply (caso cristalino).
        // Não toca na reply visual; só persiste o marker via chamada dedicada.
        if (replyHasPromise && !(raw && raw._isMarkerRetry)) {
          try {
            const todayBrt = todaySaoPaulo();
            const tomorrowBrt = (() => {
              const d = new Date(todayBrt + 'T12:00:00-03:00');
              d.setUTCDate(d.getUTCDate() + 1);
              return d.toISOString().slice(0,10);
            })();
            const miniSys = `Você é um conversor mecânico texto→marker. Sua única saída é UM marker JSON, sem nenhum texto fora dele.

Contexto:
- Data hoje (BRT): ${todayBrt}
- Data amanhã (BRT): ${tomorrowBrt}
- Colaborador: ${collab.full_name || '?'} (role=${collab.role || '?'})
- User disse: "${String(text || '').slice(0, 500)}"
- TOM respondeu verbalizando promessa: "${String(reply || '').slice(0, 900)}"

TOM prometeu uma ação mas esqueceu de emitir o marker. Sua tarefa: emitir o marker correto. PODE EMITIR ARRAY com várias actions se TOM prometeu múltiplas coisas (ex: "adicionando ao pacote" com 3 itens).

Regras por tipo de promessa:

1) **Lembrete/aviso** ("lembrete às X", "te aviso às X", "te cobro às X") → action="reschedule" (se task existe) ou "create" (se nova) com remind_at ISO BRT "YYYY-MM-DDTHH:mm:ss-03:00"

2) **Reagendamento** ("marquei pra amanhã", "reagendei pra segunda", "coloquei pra X") → action="reschedule" com new_due_date (e new_remind_at se mencionou hora)

3) **Criação genérica** ("criei", "abri", "anotei") → action="create" com title

4) **DEMANDA OPERACIONAL** (compras, manutenção, reparo, montagem — vistas em "registrar", "adicionando ao pacote", "crio as duas/três", "juntando", "tá na fila") → action="create" + category="operational" + action_type="task" + priority="medium" + título descritivo extraído da fala do user/TOM (ex: "Comprar 2 lâmpadas 8w — Sala Bateria Kids Recreio"). Se TOM listou N itens, emitir ARRAY com N actions, uma por item.

AÇÕES PROIBIDAS NESTE CONTEXTO — retorne NO_MARKER se a promessa for deste tipo:
- action="complete" — conclusão de tarefa NUNCA é feita por auto-retry. Requer confirmação explícita do usuário no fluxo principal.
- action="cancel" — cancelamento também requer confirmação explícita.
- Qualquer action que desfaça ou finalize uma tarefa existente.

IMPORTANTE:
- Use title (não id) pra referenciar a task — o engine resolve por título
- Múltiplas demandas → ARRAY com várias actions no MESMO marker
- Se ambíguo ou faltar dado crítico em TUDO, retorne literalmente: NO_MARKER
- Se conseguir extrair PELO MENOS UMA ação clara (create/reschedule), emita só ela (não retorne NO_MARKER por causa de itens duvidosos)

Formato de saída — exemplo de demanda operacional múltipla:
<<TASK_UPDATE>>
[
  {"action":"create","title":"Comprar 2 lâmpadas 8w — Sala Bateria Kids Recreio","category":"operational","action_type":"task","priority":"medium"},
  {"action":"create","title":"Limpeza ar-condicionado York — Sala Bateria Kids Recreio","category":"operational","action_type":"task","priority":"medium"},
  {"action":"create","title":"Prender quadro na parede — Recreio","category":"operational","action_type":"task","priority":"medium"}
]
<<END>>

Exemplo de lembrete temporal:
<<TASK_UPDATE>>
[{"action":"create","title":"Almoçar","remind_at":"${todayBrt}T13:30:00-03:00","priority":"medium"}]
<<END>>

Output AGORA, apenas o marker:`;
            const retryResp = await ai.chat(miniSys, [{ role: 'user', content: 'Emita o marker correto.' }]);
            const retryText = String(retryResp?.text || retryResp?.reply || retryResp?.content || '');
            if (retryText && !/NO_MARKER/i.test(retryText)) {
              const parsedRetry = parseTaskUpdateMarker(retryText);
              if (parsedRetry && Array.isArray(parsedRetry.actions) && parsedRetry.actions.length > 0) {
                try {
                  // Bug 30/05 (Yuri/Agenda): auto-retry NÃO pode emitir complete/cancel.
                  // Filtra antes do apply como defesa em profundidade, mesmo que o mini LLM
                  // ignore a instrução no prompt (camada dupla de proteção).
                  const safeActions = parsedRetry.actions.filter(a => {
                    if (a && (a.action === 'complete' || a.action === 'cancel')) {
                      console.warn(`[Engine] AUTO_RETRY_BLOCKED_ACTION — action=${a.action} title="${a.title || a.id}" (complete/cancel proibido em auto-retry)`);
                      return false;
                    }
                    return true;
                  });
                  if (safeActions.length === 0) {
                    console.warn('[Engine] AUTO_RETRY_ALL_BLOCKED — todas as actions eram complete/cancel, ignorando');
                    await logMarker(collab.id, 'TASK_UPDATE_AUTO_RETRY', 'rejected',
                      'all_blocked:complete_cancel_forbidden', retryText.slice(0, 500));
                  } else {
                  // Sprint 31.2 — telemetria honesta: olha okCount/failCount em vez de
                  // assumir sucesso. Bug observado 28/05/2026 (Yuri): AUTO_RETRY com 4
                  // títulos alucinados logava "executed actions:4" mesmo quando todas
                  // falharam — escondia o problema do health-check.
                  const retryResult = await applyTaskActions(collab, safeActions) || { okCount: 0, failCount: safeActions.length };
                  const ok = retryResult.okCount || 0;
                  const fail = retryResult.failCount || 0;
                  if (ok > 0) {
                    console.log(`[Engine] AUTO_RETRY_OK — marker=TASK_UPDATE ok=${ok} fail=${fail}`);
                    await logMarker(collab.id, 'TASK_UPDATE_AUTO_RETRY',
                      fail > 0 ? 'partial' : 'executed',
                      `ok=${ok} fail=${fail}`, retryText.slice(0, 500));
                    _metrics.auto_retry_succeeded = true;
                  } else {
                    console.warn(`[Engine] AUTO_RETRY_ALL_FAILED — fail=${fail}`);
                    await logMarker(collab.id, 'TASK_UPDATE_AUTO_RETRY', 'rejected',
                      `all_failed:${fail}`, retryText.slice(0, 500));
                  }
                  }
                } catch (applyErr) {
                  console.warn(`[Engine] AUTO_RETRY_APPLY_FAILED — ${applyErr.message}`);
                  await logMarker(collab.id, 'TASK_UPDATE_AUTO_RETRY', 'rejected',
                    `apply_failed:${String(applyErr.message).slice(0,180)}`, retryText.slice(0, 500));
                }
              } else {
                console.warn('[Engine] AUTO_RETRY_NO_PARSE — retry sem TASK_UPDATE válido');
                await logMarker(collab.id, 'AUTO_RETRY_NO_PARSE', 'rejected',
                  'no_task_update_in_retry', retryText.slice(0, 500));
              }
            } else {
              console.log('[Engine] AUTO_RETRY skipped — LLM retornou NO_MARKER ou vazio');
            }
          } catch (retryErr) {
            console.warn(`[Engine] AUTO_RETRY_ERR — ${retryErr.message}`);
          }
        }
      } else {
        _metrics.marker_emitted = fired.join(',').slice(0, 100);
        _metrics.marker_result = 'executed';
      }
    }
  } catch (e) { /* metric never breaks main flow */ }

  // ---- Sprint 30.3 — Pending Intents: fecha intent confirmada/negada + abre nova
  try {
    // 1) Se este turno resolveu uma intent (yes/no detectado no início), fecha agora
    if (_pendingIntentToResolve && _pendingIntentToResolve.intent && _pendingIntentToResolve.intent.id) {
      const intentId = _pendingIntentToResolve.intent.id;
      const resolution = _pendingIntentToResolve.resolution;
      const note = `auto-resolved on turn ${new Date().toISOString()}`;
      await pendingIntents.resolveIntent(intentId, resolution, note);
      console.log(`[PendingIntents] resolved ${intentId.slice(0,8)} as ${resolution}`);
    }

    // 2) Detecta nova pergunta de confirmação na reply do TOM e abre intent.
    //    Só abre se NENHUM marker foi emitido neste turno (senão a ação já foi
    //    persistida — não há intent pendente real).
    const noMarkerEmitted = !_metrics.marker_emitted && !_metrics.auto_retry_succeeded;
    if (reply && typeof reply === 'string' && noMarkerEmitted) {
      const detected = pendingIntents.detectConfirmationQuestion(reply);
      if (detected) {
        // Payload mínimo: salva o user_text e a reply pra recuperação no próximo turno.
        // O LLM lê isso no hook inicial e gera o marker certo.
        const payload = {
          last_user_text: String(text || '').slice(0, 600),
          last_tom_reply: reply.slice(0, 900),
        };
        await pendingIntents.openIntent(collab.id, detected.kind, payload, reply.slice(0, 500));
        _metrics.pending_intent_opened = detected.kind;
      }
    }
  } catch (e) {
    console.warn('[PendingIntents] hook err:', e.message);
  }

  // ---- Sprint 28 — TOM Voice (TTS via ElevenLabs)
  // Decide se manda áudio em vez de (ou junto com) texto. Gates em
  // shouldSendVoice: feature flag + allowlist + cap diário + matriz contextual.
  // Fallback explícito: se TTS/sendVoice falhar, manda só texto.
  let _voiceSent = false;
  if (reply && reply.trim()) {
    try {
      const tts = require('./services/tts');
      const { shouldSendVoice } = require('./utils/shouldSendVoice');
      if (tts.isConfigured()) {
        // Conta áudios de hoje pro cap diário (00:00 BRT — usa UTC simplificado)
        const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: voiceCountToday } = await supabase
          .from('voice_message_log')
          .select('id', { count: 'exact', head: true })
          .eq('collaborator_id', collab.id)
          .gte('sent_at', sinceIso);
        const voiceCtx = {
          voiceCountToday: voiceCountToday || 0,
          isAudioMessage: /\[áudio transcrito\]/i.test(String(text || '')),
          isRelay: /<<COORDINATION_REQUEST>>/i.test(reply),
          isRitual: false, // processMessage path não é ritual; sendRitual seria separado
          userInDND: false, // já filtrado upstream
        };
        const decision = shouldSendVoice(collab, text, reply, voiceCtx);
        if (decision.send) {
          console.log(`[Voice] DECISION send=true reason=${decision.reason} count=${voiceCtx.voiceCountToday}`);
          // Stripa qualquer marker residual e prefixos sintéticos antes de gerar TTS.
          // Mantém só o texto humano que TOM disse.
          const ttsText = reply
            .replace(/\[O usuário (?:ACABOU DE ENVIAR|está RESPONDENDO|enviou \d+).*?\]/g, '')
            .replace(/<<[^>]+>>[\s\S]*?<<END>>/g, '')
            .replace(/<<[^>]+>>/g, '')
            .replace(/\[mensagem \d+\/\d+\]/g, '')
            .trim();
          try {
            const audioBuf = await tts.textToSpeech(ttsText);
            await whatsapp.sendVoice(phone, audioBuf);
            await supabase.from('voice_message_log').insert({
              collaborator_id: collab.id,
              duration_chars: ttsText.length,
            });
            await logMarker(collab.id, 'VOICE_SENT', 'executed', decision.reason, null);
            await logConversation(collab.id, 'outbound', `[áudio TOM: ${ttsText.slice(0, 200)}]`);
            _voiceSent = true;
          } catch (e) {
            console.warn(`[Voice] TTS/sendVoice falhou (${e.message}) — fallback pra texto`);
            await logMarker(collab.id, 'VOICE_SENT', 'rejected', `error:${e.message.slice(0,60)}`, null);
          }
        } else {
          console.log(`[Voice] DECISION send=false reason=${decision.reason}`);
        }
      }
    } catch (e) {
      console.warn('[Voice] pipeline err (silent):', e.message);
    }
  }

  if (reply && reply.trim() && !_voiceSent) {
    await whatsapp.sendMessage(phone, reply);
    await logConversation(collab.id, 'outbound', reply);
  } else if (_reactionsToSend && _reactionsToSend.length && !_voiceSent) {
    console.log(`[Engine] reply vazio pós-REACT — só reação enviada (${_reactionsToSend[0]})`);
    await logConversation(collab.id, 'outbound', `[reação: ${_reactionsToSend[0]}]`);
  }

  // STICKER follow-up — depois do reply de texto, manda figurinha(s) extraída(s)
  // do marker <<STICKER>>nome<<END>>. Lookup em tom_stickers, fire-and-forget
  // por sticker (uma falha não bloqueia próximos nem afeta o fluxo principal).
  if (_pendingStickers && _pendingStickers.length > 0) {
    try {
      const { data: stickersData } = await supabase
        .from('tom_stickers')
        .select('name, url')
        .in('name', _pendingStickers)
        .eq('is_active', true);
      const byName = Object.fromEntries((stickersData || []).map(s => [s.name, s.url]));
      for (const name of _pendingStickers) {
        const url = byName[name];
        if (!url) {
          console.warn(`[Engine] STICKER not found in DB: '${name}'`);
          continue;
        }
        try {
          await whatsapp.sendMedia(phone, { url, type: 'sticker' });
          console.log(`[Engine] STICKER sent: ${name} → ${phone.slice(-4)}`);
          await logConversation(collab.id, 'outbound', `[sticker: ${name}]`);
        } catch (err) {
          console.error(`[Engine] STICKER send err (${name}):`, err.message);
        }
      }
    } catch (err) {
      console.error('[Engine] STICKER block err:', err.message);
    }
  }

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

  // Sprint 27 — seção financeira no briefing pessoal/diário (PRD §6.5).
  // DETERMINÍSTICO: a linha "💰 Vence hoje" é montada em código e ANEXADA ao texto do LLM,
  // pra o número nunca depender do LLM (lição do Bug 3).
  let finalText = response.text;
  if (ritualType === 'daily_briefing' || ritualType === 'personal_briefing') {
    try {
      const financeService = require('./services/financeiro-service');
      const { buildBriefingFinanceLine } = require('./finance/ritual-messages');
      const dom = Number(todaySaoPaulo().slice(8, 10));
      const billsToday = (await financeService.billsDueWithin(collaboratorId, 0)).filter((b) => b.due_day === dom);
      const finLine = buildBriefingFinanceLine(billsToday);
      if (finLine) finalText = `${finalText}\n\n${finLine}`;
    } catch (e) { console.error('[Briefing finance line]', e.message); }
  }

  await whatsapp.sendMessage(collab.phone, finalText);
  await logConversation(collab.id, 'outbound', finalText);

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

async function _consolidateExtract(collab, historyText, existingMems) {
  // existingMems: array de { content, memory_type, importance }
  const existingTexts = Array.isArray(existingMems) ? existingMems.map(m => m.content || m) : (existingMems || []);
  const sysPrompt = `Você é um extrator e organizador de memória durável para o colaborador ${collab.full_name}.
Receberá o histórico recente de conversa + memórias já salvas.
Sua tarefa: identificar até 5 itens dignos de memória futura que ainda NÃO estão salvos, OU que devem ser atualizados por recorrência.

Tipos válidos (use exatamente um): fact | decision | lesson | preference | context
- fact: dado concreto duradouro (mora em X, toca instrumento Y)
- decision: decisão consciente (vai pausar projeto Z até agosto)
- lesson: padrão aprendido/recorrente (evitar reunião sexta após 17h)
- preference: gosto/forma de trabalhar (prefere reuniões curtas)
- context: situação temporária (filha nasceu em mar/2026 — sempre defina decay_at)

Importance: critical | high | normal | low

REGRAS DE ELEVAÇÃO E SÍNTESE:
- Se um tema aparece nas memórias existentes E no histórico de hoje → eleve importance para "high" ou "critical"
- Se vê o mesmo padrão mencionado 2+ vezes nas existentes → sintetize em uma nova "lesson" em vez de criar entradas separadas
- 1 memória boa > 4 banais. Se nada novo/relevante, retorne [].
- Conteúdo: 1 frase curta, terceira pessoa, neutra
- NÃO duplique algo que já está nas memórias existentes sem mudança de importance
- NÃO salve fofoca/julgamento de terceiros
- NÃO salve estado momentâneo (cansaço de hoje) — só padrão duradouro
- decay_at obrigatório se memory_type='context'

Saída OBRIGATÓRIA: array JSON puro, sem texto antes/depois. Vazio se nada digno:
[
  {"memory_type":"fact","content":"...","importance":"normal"},
  {"memory_type":"context","content":"...","importance":"normal","decay_at":"2026-08-01"}
]`;

  const existingBlock = Array.isArray(existingMems) && existingMems.length > 0
    ? existingMems.slice(0, 30).map(m => {
        const type = m.memory_type || 'fact';
        const imp = m.importance || 'normal';
        const content = m.content || m;
        return `[${type}/${imp}] ${content}`;
      }).join('\n')
    : '(nenhuma)';

  const userPrompt = `Memórias existentes do colaborador:
${existingBlock}

Histórico recente de conversa:
${historyText}

Extraia até 5 itens novos ou elevados. Apenas JSON.`;

  const nanoRes = await openaiClient.chat.completions.create({
    model: 'gpt-4.1-nano',
    messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: userPrompt }],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });
  const raw = String(nanoRes.choices[0].message.content || '').trim();
  // OpenAI `response_format: json_object` força resposta como objeto `{}`. gpt-4.1-nano
  // ignora o "retorne array" do prompt e retorna 1 objeto direto OU {} vazio OU
  // {memories:[...]} embrulhado. Parser cobre TODOS os 4 casos:
  //   1) [{...}, ...]            (raro — modelo respeitou prompt)
  //   2) {memories: [...]}       (objeto wrapper com key array)
  //   3) {memory_type, content}  (1 memória direto, mais comum com nano)
  //   4) {}                      (vazio = nada novo, não é erro)
  if (!raw) return []; // raw vazio = nada novo, sem warning
  let parsed = null;
  try {
    const obj = JSON.parse(raw);
    if (Array.isArray(obj)) {
      parsed = obj;
    } else if (obj && typeof obj === 'object') {
      const arrKey = Object.keys(obj).find(k => Array.isArray(obj[k]));
      if (arrKey) parsed = obj[arrKey];
      else if (Object.keys(obj).length === 0) parsed = []; // {} = nada novo, OK
      // Objeto único com schema de memória → trata como [obj]
      else if (typeof obj.content === 'string' && typeof obj.memory_type === 'string') parsed = [obj];
    }
  } catch (_err) {
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch (_err2) { /* fall through */ }
    }
  }
  if (!Array.isArray(parsed)) {
    console.warn(`[MemConsolidate] no JSON array in extractor output for ${collab.full_name} — raw="${raw.slice(0, 200).replace(/\s+/g, ' ')}"`);
    return [];
  }
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
    .select('content, memory_type, importance')
    .eq('collaborator_id', collab.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(100);
  const existingMems = existing || [];
  const existingTexts = existingMems.map(e => e.content);

  let candidates;
  try {
    candidates = await _consolidateExtract(collab, historyText, existingMems);
  } catch (err) {
    console.error(`[MemConsolidate] extract err for ${collab.full_name}:`, err.message);
    return { collab: collab.full_name, saved: 0, skipped: 'extract_error', error: err.message };
  }

  let saved = 0, dedup = 0;
  for (const c of candidates) {
    const dup = existingTexts.some(t => looksLikeMemory(c.content, t));
    if (dup) { dedup++; continue; }
    let embedding = null;
    try {
      const { getEmbedding } = require('./services/embeddings');
      embedding = await getEmbedding(c.content);
    } catch (embErr) {
      console.warn('[MemConsolidate] embedding err (inserindo sem embedding):', embErr.message);
    }
    const { error } = await supabase.from('collaborator_memory').insert({
      collaborator_id: collab.id,
      memory_type: c.memory_type,
      content: c.content,
      importance: c.importance,
      decay_at: c.decay_at,
      source: 'observation',
      is_active: true,
      ...(embedding ? { embedding } : {}),
    });
    if (error) console.error('[MemConsolidate] insert err:', error.message);
    else { saved++; existingTexts.push(c.content); }
  }
  console.log(`[MemConsolidate] ${collab.full_name}: candidates=${candidates.length} saved=${saved} dedup=${dedup}`);

  // Sprint 23.5+ — atualiza perfil comportamental após consolidar memórias
  // msgs são só inbound; passa com direction anotado para o profiler
  const msgsForProfile = (msgs || []).map(m => ({ ...m, direction: 'inbound' }));
  await updateCollaboratorProfile(collab, msgsForProfile);

  return { collab: collab.full_name, candidates: candidates.length, saved, dedup };
}

// Sprint 23.5+ — atualiza collaborator_profiles com perfil comportamental via LLM.
// Chamado após consolidateMemoryFor, reutilizando as mesmas mensagens do dia.
async function updateCollaboratorProfile(collab, messages) {
  try {
    // Janela adaptativa: se as mensagens passadas forem < 5, busca histórico mais amplo.
    // Cascata: 24h → 7d → 30d. Garante baseline mesmo para colaboradores inativos.
    const WINDOWS = [
      { label: '24h', ms: 24 * 60 * 60 * 1000,        minMsgs: 5 },
      { label: '7d',  ms: 7  * 24 * 60 * 60 * 1000,   minMsgs: 5 },
      { label: '30d', ms: 30 * 24 * 60 * 60 * 1000,   minMsgs: 5 },
    ];

    let resolvedMsgs = messages || [];
    let usedWindow = 'caller';
    if (resolvedMsgs.length < 5) {
      for (const w of WINDOWS) {
        const cutoff = new Date(Date.now() - w.ms).toISOString();
        const { data } = await supabase.from('conversation_history')
          .select('direction, content, created_at')
          .eq('collaborator_id', collab.id)
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(200);
        resolvedMsgs = data || [];
        if (resolvedMsgs.length >= w.minMsgs) {
          usedWindow = w.label;
          break;
        }
      }
    }

    if (!resolvedMsgs.length) {
      console.log(`[Dream] profile skip: ${collab.full_name} (sem histórico em 30d)`);
      return { skipped: 'no_history' };
    }
    console.log(`[Dream] profile janela: ${collab.full_name} usou ${usedWindow} (${resolvedMsgs.length} msgs)`);

    const { data: current } = await supabase
      .from('collaborator_profiles')
      .select('*')
      .eq('collaborator_id', collab.id)
      .maybeSingle();

    const { data: taskStats } = await supabase.rpc('get_collaborator_task_stats', {
      p_collaborator_id: collab.id,
    });
    const stat = taskStats?.[0] || {};

    const { count: totalInteractions } = await supabase
      .from('conversation_history')
      .select('id', { count: 'exact', head: true })
      .eq('collaborator_id', collab.id)
      .eq('direction', 'inbound');

    const currentProfile = current
      ? Object.fromEntries(
          Object.entries(current).filter(([k, v]) =>
            v !== null && !['id','collaborator_id','created_at','updated_at'].includes(k)
          )
        )
      : {};

    const sysPrompt = `Você analisa conversas e extrai o perfil comportamental de ${collab.full_name}.
Retorne APENAS JSON válido com esses campos (só preencha onde há evidência real):
{
  "communication_style": "como se comunica (ex: direto/usa áudio/usa emoji/detalhista)",
  "response_pattern": "quando/como responde (ex: rápido de manhã/demora à noite)",
  "best_coaching_approach": "o que funciona para cobrar/motivar",
  "strengths": "padrões positivos observados",
  "growth_areas": "dificuldades recorrentes",
  "personal_context": "contexto pessoal mencionado voluntariamente",
  "vocabulary_notes": "expressões e sinais úteis para interpretar",
  "profile_notes": "observações operacionais consolidadas",
  "maturity_level": "beginner|developing|proficient|advanced"
}
REGRAS:
- Só escreva um traço se aparecer em 2+ mensagens diferentes (episódio único = não é padrão)
- Não invente. Se não tem evidência repetida, omita o campo
- Mantenha o existente se não houver evidência nova para mudar
- Máximo 2 linhas por campo
maturity_level: beginner=novo no sistema, developing=usa mas oscila, proficient=consistente, advanced=autônomo.`;

    const msgBlock = resolvedMsgs
      .map(m => `[${m.direction === 'inbound' ? 'User' : 'TOM'}] ${String(m.content || '').slice(0, 200)}`)
      .join('\n')
      .slice(0, 8000);

    const userMsg = `PERFIL ATUAL:
${JSON.stringify(currentProfile, null, 2) || '(vazio)'}

CONVERSAS RECENTES (janela: ${usedWindow}):
${msgBlock || '(sem mensagens)'}

Atualize o perfil. Apenas JSON.`;

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4.1-nano',
      messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: userMsg }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });
    const raw = String(response.choices[0].message.content || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const updates = JSON.parse(jsonMatch[0]);

    const VALID_MATURITY = ['beginner', 'developing', 'proficient', 'advanced'];
    await supabase.from('collaborator_profiles').upsert({
      collaborator_id: collab.id,
      communication_style: updates.communication_style || current?.communication_style || null,
      response_pattern: updates.response_pattern || current?.response_pattern || null,
      best_coaching_approach: updates.best_coaching_approach || current?.best_coaching_approach || null,
      strengths: updates.strengths || current?.strengths || null,
      growth_areas: updates.growth_areas || current?.growth_areas || null,
      personal_context: updates.personal_context || current?.personal_context || null,
      vocabulary_notes: updates.vocabulary_notes || current?.vocabulary_notes || null,
      profile_notes: updates.profile_notes || current?.profile_notes || null,
      maturity_level: VALID_MATURITY.includes(updates.maturity_level) ? updates.maturity_level : (current?.maturity_level || 'beginner'),
      total_interactions: totalInteractions || 0,
      completion_rate_30d: stat.completion_rate_30d ?? current?.completion_rate_30d ?? null,
      last_profile_update: new Date().toISOString(),
    }, { onConflict: 'collaborator_id' });

    console.log(`[Dream] profile atualizado: ${collab.full_name} (${updates.maturity_level || '?'})`);
  } catch (err) {
    console.error(`[Dream] updateProfile err for ${collab.full_name}:`, err.message);
  }
}

// Decays expired memories: is_active flips to false. Returns count.
async function decayExpiredMemories() {
  const nowIso = new Date().toISOString();
  // Sprint 30 — Rede de segurança: memórias importantes (importance high/critical)
  // NUNCA expiram pelo decay automático, mesmo com decay_at vencido. Protege
  // contra o LLM marcar por engano um fato/decisão relevante com validade curta.
  // Só normal/low são elegíveis a esquecimento por validade.
  const { data, error } = await supabase
    .from('collaborator_memory')
    .update({ is_active: false })
    .lt('decay_at', nowIso)
    .eq('is_active', true)
    .in('importance', ['normal', 'low'])
    .select('id');
  if (error) {
    console.error('[MemDecay] err:', error.message);
    return 0;
  }
  const n = (data || []).length;
  if (n) console.log(`[MemDecay] ${n} memory rows decayed (high/critical preservados)`);
  return n;
}

// Sprint 23.5+ — gera resumo semanal via LLM e salva em collaborator_weekly_summaries.
// Chamado pelo dispatcher todo domingo 22h (junto com consolidateMemoryFor).
async function generateWeeklySummaryFor(collab) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const weekStart = sevenDaysAgo.slice(0, 10);

  // Evita re-geração se já existe resumo para esta semana
  const { data: existing } = await supabase
    .from('collaborator_weekly_summaries')
    .select('id')
    .eq('collaborator_id', collab.id)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (existing) return { collab: collab.full_name, skipped: 'already_exists' };

  const { data: msgs } = await supabase
    .from('conversation_history')
    .select('direction, content, created_at')
    .eq('collaborator_id', collab.id)
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: true })
    .limit(300);

  const historyText = (msgs || [])
    .map(m => `[${m.direction === 'inbound' ? 'User' : 'TOM'}] ${String(m.content || '').slice(0, 400)}`)
    .join('\n')
    .slice(0, 15000);

  if (historyText.length < 100) return { collab: collab.full_name, skipped: 'too_thin' };

  const prompt = `Você é um assistente que cria resumos semanais de contexto para ${collab.full_name}.

Com base no histórico de conversa abaixo (última semana), escreva um resumo conciso em português (máximo 300 palavras) cobrindo:
- Principais tarefas e compromissos que surgiram
- Decisões importantes tomadas
- Contexto pessoal relevante mencionado
- Padrões ou temas recorrentes

NÃO invente informações. Se algo não ficou claro, omita. Seja direto e útil.

HISTÓRICO:
${historyText}

RESUMO:`;

  let summary;
  try {
    const aiProvider = require('./ai/provider');
    const response = await aiProvider.chat(prompt, [{ role: 'user', content: 'Gera o resumo da semana.' }]);
    summary = (response.text || '').trim().slice(0, 2000);
  } catch (aiErr) {
    console.error(`[WeeklySummary] AI err for ${collab.full_name}:`, aiErr.message);
    return { collab: collab.full_name, skipped: 'ai_error' };
  }

  if (!summary || summary.length < 20) return { collab: collab.full_name, skipped: 'empty_summary' };

  const { error: insErr } = await supabase.from('collaborator_weekly_summaries').upsert({
    collaborator_id: collab.id,
    week_start: weekStart,
    summary,
  }, { onConflict: 'collaborator_id,week_start' });

  if (insErr) {
    console.error(`[WeeklySummary] insert err for ${collab.full_name}:`, insErr.message);
    return { collab: collab.full_name, skipped: 'insert_error' };
  }

  // Gera embedding assíncrono (fail-silent)
  if (process.env.OPENAI_API_KEY) {
    const { getEmbedding } = require('./services/embeddings');
    getEmbedding(summary).then(embedding =>
      supabase.from('collaborator_weekly_summaries').update({ embedding })
        .eq('collaborator_id', collab.id).eq('week_start', weekStart)
    ).catch(e => console.warn('[WeeklySummary] embedding err:', e.message));
  }

  console.log(`[WeeklySummary] gerado para ${collab.full_name} (${weekStart}, ${summary.length} chars)`);
  return { collab: collab.full_name, saved: true };
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
    .select('id, full_name, phone, role, is_active, has_coord_permissions')
    .eq('id', collaboratorId).single();
  if (!collab || !collab.is_active) {
    console.warn(`[CoordReport] skipped ${type} — collaborator inactive/missing`);
    return false;
  }
  if (!hasCoordLevel(collab)) {
    console.warn(`[CoordReport] DENIED ${type} for ${collab.full_name} — role=${collab.role || 'collaborator'} coord_perm=${!!collab.has_coord_permissions}`);
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

// Sprint Fase B — Bypass do LLM pra operações simples de lojinha via WhatsApp.
// Retorna { action, params } se a frase bate um padrão simples; null caso contrário.
//
// Padrões cobertos:
//   QUERY:
//     /loja                              → todas as unidades
//     /loja <unidade>                    → unidade específica
//     "o que tem na lojinha [da/de X]?"
//     "lista/mostra produtos da lojinha [da X]"
//     "estoque da lojinha [da X]"
//     "lojinha da/do/de X"
//
//   VENDA (shop_sale):
//     "vendi (N)? <produto> (na|da|de|pra) <unidade> [pgto]?"
//     "vendeu (N)? <produto> ..."
//     "venda (N)? <produto> ..."
//     Se forma_pagamento não vier, handler vai pedir.
//
//   ENTRADA (shop_entry):
//     "chegou (N)? <produto> (pra|na|da) <unidade>"
//     "recebi (N)? <produto> ..."
//     "entrou (N)? <produto> ..."
function tryShopBypass(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  // Slash command (query)
  const slash = t.match(/^\/loja(?:\s+(.+?))?\s*$/i);
  if (slash) return { action: 'query_shop', params: { unidade: extractUnidadeFromText(slash[1] || '') } };

  // VENDA: "vendi/vendeu/venda [N] <produto> (na/da/de) <unidade> [pgto]"
  const vendaMatch = t.match(/^\s*(?:vendi|vendeu|venda|vendendo)\s+(?:(\d+)\s+)?(.+?)\s+(?:na|da|do|em|pra)\s+(.+?)(?:\s+(pix|cr[eé]dito|d[eé]bito|dinheiro|cash))?\s*[.!?]?\s*$/i);
  if (vendaMatch) {
    const qtd = parseInt(vendaMatch[1] || '1', 10);
    const produto = vendaMatch[2].trim();
    const restoUnidade = vendaMatch[3].trim();
    const pgto = vendaMatch[4] ? normalizarPagamento(vendaMatch[4]) : null;
    const unidade = extractUnidadeFromText(restoUnidade) || restoUnidade;
    return {
      action: 'shop_sale',
      params: { nome: produto, quantidade: qtd, unidade, forma_pagamento: pgto },
    };
  }

  // ENTRADA: "chegou/recebi/entrou [N] <produto> (pra/na/da) <unidade>"
  const entradaMatch = t.match(/^\s*(?:chegou|chegaram|recebi|entrou|entraram)\s+(?:(\d+)\s+)?(.+?)\s+(?:na|da|do|em|pra|para)\s+(.+?)\s*[.!?]?\s*$/i);
  if (entradaMatch) {
    const qtd = parseInt(entradaMatch[1] || '1', 10);
    const produto = entradaMatch[2].trim();
    const restoUnidade = entradaMatch[3].trim();
    const unidade = extractUnidadeFromText(restoUnidade) || restoUnidade;
    return {
      action: 'shop_entry',
      params: { nome: produto, quantidade: qtd, unidade },
    };
  }

  // Fase 2.3 — ESTORNO: "estornar/cancelar venda #N [motivo: ...]"
  const estornoMatch = t.match(/^\s*(?:estornar?|cancelar)\s+venda\s+#?(\d+)(?:\s*[-:,.]?\s*(?:motivo\s*[:=]?\s*)?(.+?))?\s*[.!?]?\s*$/i);
  if (estornoMatch) {
    const vendaId = parseInt(estornoMatch[1], 10);
    let motivo = (estornoMatch[2] || '').trim();
    // Limpa prefixos comuns
    motivo = motivo.replace(/^(motivo|porque|por que|razao|razão)\s*[:=]?\s*/i, '').trim();
    return {
      action: 'shop_estorno',
      params: { venda_id: vendaId, motivo: motivo || null },
    };
  }

  // Fase 2.3 — RESERVA: "reserva/reservar [N] <produto> pra/para <cliente>"
  const reservaMatch = t.match(/^\s*(?:reserva|reservar|separa|separar)\s+(\d+)\s+(.+?)\s+(?:pra|para)\s+(.+?)\s*[.!?]?\s*$/i);
  if (reservaMatch) {
    const qtd = parseInt(reservaMatch[1], 10);
    const produto = reservaMatch[2].trim();
    const cliente = reservaMatch[3].trim();
    // Só processar se cliente parecer nome (não conter palavras que sugiram outro intent)
    if (qtd > 0 && produto && cliente && cliente.length >= 2 && cliente.length <= 80
        && !/\b(loja|estoque|unidade|venda)\b/i.test(cliente)) {
      return {
        action: 'shop_reserve',
        params: { produto_termo: produto, quantidade: qtd, cliente_nome: cliente },
      };
    }
  }

  // PENDÊNCIA DE INVENTÁRIO: "precisa comprar X pra sala Y [, urgente]"
  // "tá faltando X na sala Y", "pendência: ...", "anota: ..."
  const pendRe = /^\s*(?:precisa\s+(?:comprar|repor|reparar|trocar)|t[áa]\s+faltando|pend[êe]ncia[:\s]+|anota[:\s]+(?:que\s+)?(?:precisa|comprar|repor|t[áa])|falta\s+um)\s+(.+?)(?:\s+(?:pra|para|na|no)\s+sala\s+(.+?))?(?:\s*[-,]\s*(urgente|urgent[íi]ssimo|importante|futuro|futuramente))?\s*[.!?]?\s*$/i;
  const pendMatch = t.match(pendRe);
  if (pendMatch) {
    const tituloBruto = (pendMatch[1] || '').trim();
    const salaTermo = (pendMatch[2] || '').trim() || null;
    const prioKw = (pendMatch[3] || '').toLowerCase();
    let prioridade = 'importante';
    if (/^urgent/.test(prioKw)) prioridade = 'urgente';
    else if (/^futur/.test(prioKw)) prioridade = 'futuramente';
    else if (/^importante/.test(prioKw)) prioridade = 'importante';
    // Conservador: título mínimo de 3 chars e não puramente genérico
    const generic = /^(isso|aquilo|coisa|negocio|negócio|algo|uma\s+coisa)$/i;
    if (tituloBruto.length >= 3 && !generic.test(tituloBruto)) {
      return {
        action: 'shop_pendencia',
        params: { titulo: tituloBruto, sala_termo: salaTermo, prioridade },
      };
    }
  }

  // QUERY: tem que mencionar "loja" ou "lojinha"
  if (!/\b(lojinha|loja)\b/i.test(t)) return null;

  const queryIntent = /\b(o\s+que\s+tem|lista(?:r)?|mostra(?:r|e)?|me\s+mostra|estoque|consultar|ver|mostr[ae]\s+(?:o|a))\b/i;
  const shortLoc = /^\s*lojinha\s+(?:da|de|do)\s+([\wÀ-ú\s]+?)\s*[?!.\s]*$/i;

  if (queryIntent.test(t) || shortLoc.test(t)) {
    return { action: 'query_shop', params: { unidade: extractUnidadeFromText(t) } };
  }
  return null;
}

function normalizarPagamento(s) {
  const x = String(s || '').toLowerCase().replace(/[éê]/g, 'e');
  if (x.includes('pix')) return 'pix';
  if (x.includes('cred')) return 'credito';
  if (x.includes('deb')) return 'debito';
  if (x.includes('dinh') || x.includes('cash')) return 'dinheiro';
  return null;
}

// Extrai nome de unidade ("Barra", "Recreio", "Campo Grande"/"CG") do texto.
// Procura padrão "da/de/do/no/na <unidade>" ou unidade isolada.
function extractUnidadeFromText(t) {
  const txt = String(t || '');
  // Padrões diretos primeiro
  if (/\b(campo\s+grande|\bcg\b)\b/i.test(txt)) return 'Campo Grande';
  if (/\brecreio\b/i.test(txt)) return 'Recreio';
  if (/\bbarra\b/i.test(txt)) return 'Barra';
  // Fallback: pega 1ª palavra depois de "da/de/do/na/no"
  const m = txt.match(/\b(?:da|de|do|na|no)\s+([A-ZÀ-Ú][\wÀ-ú]+(?:\s+[A-ZÀ-Ú][\wÀ-ú]+)?)\b/);
  return m ? m[1] : null;
}

// Sprint Fase B — parser do marker <<SHOP_ACTION>>
// Sprint 23.7 hotfix: aceita fechamento <<END>> (padrão global declarado em
// system.js) além do <</SHOP_ACTION>> legado da skill lojinha.md. Sem isso,
// TOM emite <<SHOP_ACTION>>...<<END>> e o catch-all stripa como UNKNOWN_MARKER.
function parseShopAction(text) {
  const m = text.match(/<<SHOP_ACTION>>\s*([\s\S]*?)\s*<<(?:\/?SHOP_ACTION|END)>>/);
  if (!m) return null;
  try {
    const payload = JSON.parse(m[1]);
    if (!payload?.action) return null;
    const ACTION_ALIASES = {
      sale: 'shop_sale', vender: 'shop_sale', venda: 'shop_sale',
      entry: 'shop_entry', entrada: 'shop_entry', chegada: 'shop_entry',
      adjust: 'shop_adjust', ajuste: 'shop_adjust', ajustar: 'shop_adjust',
      query: 'query_shop', consulta: 'query_shop', listar: 'query_shop',
      estorno: 'shop_estorno', estornar: 'shop_estorno', cancelar_venda: 'shop_estorno',
      reserva: 'shop_reserve', reservar: 'shop_reserve', separar: 'shop_reserve',
      pendencia: 'shop_pendencia', pedido: 'shop_pendencia',
      pendency: 'shop_pendencia', pending_item: 'shop_pendencia',
    };
    const canonical = ACTION_ALIASES[payload.action] || payload.action;
    return { action: canonical, params: payload.params || {} };
  } catch (e) {
    console.warn('[ShopAction] JSON parse fail:', e.message);
    return null;
  }
}

// Normaliza params do LLM (aliases comuns)
function normalizeShopParams(p) {
  return {
    nome: p.nome || p.produto || p.product || p.item || p.name,
    produto_termo: p.produto_termo || p.termo || p.search_term || p.nome || p.produto || null,
    quantidade: parseInt(p.quantidade || p.qtd || p.qty || p.amount || 1, 10),
    unidade: p.unidade || p.unit || p.loja || p.local,
    unidade_id: p.unidade_id || p.uid || null,
    forma_pagamento: p.forma_pagamento || p.pagamento || p.payment || p.forma || p.pgto,
    cliente_nome: p.cliente_nome || p.cliente || p.customer || p.nome_cliente || null,
    tipo_cliente: p.tipo_cliente || p.customer_type || 'avulso',
    professor_indicador: p.professor_indicador || p.professor || p.indicador || null,
    delta: typeof p.delta === 'number' ? p.delta : (parseInt(p.delta, 10) || 0),
    motivo: p.motivo || p.reason || p.razao || null,
    observacoes: p.observacoes || p.obs || p.notes || null,
    venda_id: parseInt(p.venda_id || p.id_venda || p.sale_id || p.venda || 0, 10) || null,
    aluno_id: p.aluno_id || p.student_id || null,
    prazo: p.prazo || p.deadline || p.data_limite || null,
    // Pendência de inventário (shop_pendencia)
    titulo: p.titulo || p.title || p.assunto || null,
    sala_termo: p.sala_termo || p.sala_nome || p.sala || p.room || null,
    prioridade: (() => {
      const raw = String(p.prioridade || p.priority || 'importante').toLowerCase();
      if (raw === 'urgent' || raw === 'urgente' || raw === 'urgentissimo' || raw === 'urgentíssimo' || raw === 'high') return 'urgente';
      if (raw === 'low' || raw === 'futuro' || raw === 'futuramente') return 'futuramente';
      if (raw === 'medium' || raw === 'importante' || raw === 'normal') return 'importante';
      return 'importante';
    })(),
    categoria: (() => {
      const raw = String(p.categoria || p.category || '').toLowerCase();
      if (['compra', 'reposicao', 'reparo', 'melhoria'].includes(raw)) return raw;
      return null;
    })(),
    descricao: p.descricao || p.description || p.desc || null,
  };
}

async function resolveUnidadeIdShop(unidadeNome) {
  if (!unidadeNome) return null;
  const { laReportClient: _lrc } = require('./services/la-report-client');
  const { data } = await _lrc
    .from('unidades').select('id, nome')
    .ilike('nome', `%${unidadeNome}%`).limit(3);
  if (!data || data.length === 0) return null;
  if (data.length > 1) {
    const exact = data.find(u => u.nome.toLowerCase() === unidadeNome.toLowerCase());
    if (exact) return exact.id;
    return null;
  }
  return data[0].id;
}

async function resolveProfessorIndicadorId(nome) {
  if (!nome) return null;
  try {
    const { laReportClient: _lrc } = require('./services/la-report-client');
    const { data } = await _lrc
      .from('professores').select('id, nome')
      .ilike('nome', `%${nome}%`).limit(3);
    if (!data || data.length !== 1) return null;
    return data[0].id;
  } catch (e) {
    console.warn('[ShopAction] resolveProfessorIndicadorId fallback:', e.message);
    return null;
  }
}

async function handleShopAction(shop, collab, userName) {
  const { laReportClient: _lrc } = require('./services/la-report-client');
  const p = normalizeShopParams(shop.params);
  const viaAudit = `via TOM por ${userName}`;

  if (shop.action === 'shop_sale') {
    if (!p.nome) return 'Qual produto você vendeu?';
    if (!p.unidade) return 'Em qual unidade? (Barra, Recreio, CG)';
    if (!p.forma_pagamento) return 'Forma de pagamento? (pix, crédito, débito, dinheiro)';

    const unidadeId = await resolveUnidadeIdShop(p.unidade);
    if (!unidadeId) return `Unidade "${p.unidade}" não encontrada.`;

    const { data: matches, error: e1 } = await _lrc.rpc('buscar_produto_fuzzy',
      { p_termo: p.nome, p_unidade_id: unidadeId });
    if (e1) return `Erro buscando produto: ${e1.message}`;
    if (!matches || matches.length === 0) return `Não achei "${p.nome}" na lojinha de ${p.unidade}.`;
    if (matches.length > 1 && matches[0].score < 0.7) {
      return `Mais de um produto bate. Qual?\n` + matches.slice(0, 5).map(
        (m, i) => `${i + 1}. ${m.nome} (R$${m.preco})`
      ).join('\n');
    }
    const produto = matches[0];

    let professorId = null;
    if (p.professor_indicador) {
      professorId = await resolveProfessorIndicadorId(p.professor_indicador);
    }

    const { data, error } = await _lrc.rpc('registrar_venda', {
      p_produto_id: produto.id,
      p_unidade_id: unidadeId,
      p_quantidade: p.quantidade,
      p_forma_pagamento: p.forma_pagamento,
      p_via_audit: viaAudit,
      p_tipo_cliente: p.tipo_cliente,
      p_cliente_nome: p.cliente_nome,
      p_professor_indicador_id: professorId,
      p_observacoes: p.observacoes,
    });
    if (error) return `⚠️ ${error.message}`;
    const r = data?.[0];
    if (!r) return '⚠️ Venda não retornou resultado.';

    const total = produto.preco * p.quantidade;
    let msg = `✅ Venda registrada — ${produto.nome} ×${p.quantidade} (R$${total.toFixed(2)}, ${p.forma_pagamento}). Estoque ${p.unidade}: ${r.saldo_apos}.`;
    if (r.comissao_professor > 0) {
      msg += `\n💰 Comissão R$${Number(r.comissao_professor).toFixed(2)} creditada pra ${p.professor_indicador}.`;
    }

    // Alerta tempo real ZERO
    if (r.saldo_apos === 0) {
      try {
        const { data: resp } = await _lrc
          .from('loja_responsaveis_reposicao')
          .select('nome, whatsapp').eq('unidade_id', unidadeId).eq('ativo', true);
        const alertMsg = `🚨 *${produto.nome}* zerou na ${p.unidade}. Repor URGENTE.`;
        for (const res of (resp || [])) {
          if (res.whatsapp) await whatsapp.sendMessage(res.whatsapp, alertMsg);
        }
        console.log(`[ShopAction] Alerta ZERO disparado pra ${(resp||[]).length} responsável(eis)`);
      } catch (e) {
        console.warn('[ShopAction] alerta ZERO falhou:', e.message);
      }
    }
    return msg;
  }

  if (shop.action === 'shop_entry') {
    if (!p.nome) return 'Qual produto chegou?';
    if (!p.unidade) return 'Pra qual unidade? (Barra, Recreio, CG)';
    if (!p.quantidade || p.quantidade <= 0) return 'Quantos chegaram?';

    const unidadeId = await resolveUnidadeIdShop(p.unidade);
    if (!unidadeId) return `Unidade "${p.unidade}" não encontrada.`;

    const { data: matches } = await _lrc.rpc('buscar_produto_fuzzy',
      { p_termo: p.nome, p_unidade_id: unidadeId });
    if (!matches || matches.length === 0) return `Não achei "${p.nome}" no catálogo.`;
    if (matches.length > 1 && matches[0].score < 0.7) {
      return `Qual produto?\n` + matches.slice(0, 5).map(
        (m, i) => `${i + 1}. ${m.nome}`).join('\n');
    }
    const produto = matches[0];

    const { data, error } = await _lrc.rpc('registrar_entrada_estoque', {
      p_produto_id: produto.id,
      p_unidade_id: unidadeId,
      p_quantidade: p.quantidade,
      p_via_audit: viaAudit,
      p_observacoes: p.observacoes,
    });
    if (error) return `⚠️ ${error.message}`;
    return `📦 Entrada registrada — ${produto.nome} +${p.quantidade}. Saldo ${p.unidade}: ${data?.[0]?.saldo_apos}.`;
  }

  if (shop.action === 'shop_adjust') {
    if (!p.nome) return 'Qual produto?';
    if (!p.unidade) return 'Em qual unidade?';
    if (!p.delta || p.delta === 0) return 'Quanto ajustar? (+ ou -)';
    if (!p.motivo) return 'Qual o motivo do ajuste? (perda, sobra contada, etc)';

    const unidadeId = await resolveUnidadeIdShop(p.unidade);
    if (!unidadeId) return `Unidade "${p.unidade}" não encontrada.`;

    const { data: matches } = await _lrc.rpc('buscar_produto_fuzzy',
      { p_termo: p.nome, p_unidade_id: unidadeId });
    if (!matches || matches.length === 0) return `Não achei "${p.nome}".`;
    if (matches.length > 1 && matches[0].score < 0.7) {
      return `Qual produto?\n` + matches.slice(0, 5).map(
        (m, i) => `${i + 1}. ${m.nome}`).join('\n');
    }
    const produto = matches[0];

    const { data, error } = await _lrc.rpc('ajustar_estoque_manual', {
      p_produto_id: produto.id,
      p_unidade_id: unidadeId,
      p_delta: p.delta,
      p_motivo: p.motivo,
      p_via_audit: viaAudit,
    });
    if (error) return `⚠️ ${error.message}`;
    const sinal = p.delta > 0 ? '+' : '';
    return `🔧 Ajuste aplicado — ${produto.nome} ${sinal}${p.delta}. Saldo ${p.unidade}: ${data?.[0]?.saldo_apos}.`;
  }

  if (shop.action === 'query_shop') {
    let unidadeId = null;
    if (p.unidade) {
      unidadeId = await resolveUnidadeIdShop(p.unidade);
      if (!unidadeId) return `Unidade "${p.unidade}" não encontrada.`;
    }

    const { data: produtos } = await _lrc.from('loja_produtos')
      .select('id, nome, preco, loja_categorias(nome, icone)')
      .eq('ativo', true).limit(50);
    if (!produtos || produtos.length === 0) return 'Nenhum produto ativo na lojinha.';

    let estoqueQuery = _lrc.from('loja_estoque')
      .select('produto_id, quantidade, unidade_id')
      .in('produto_id', produtos.map(x => x.id))
      .gt('quantidade', 0);
    if (unidadeId) estoqueQuery = estoqueQuery.eq('unidade_id', unidadeId);
    const { data: estoque } = await estoqueQuery;

    const stockMap = new Map();
    for (const e of (estoque || [])) {
      stockMap.set(e.produto_id, (stockMap.get(e.produto_id) || 0) + e.quantidade);
    }

    const comEstoque = produtos.filter(pr => stockMap.get(pr.id) > 0);
    if (comEstoque.length === 0) return `📭 Nada com estoque${p.unidade ? ' em ' + p.unidade : ''}.`;

    const byCat = new Map();
    for (const pr of comEstoque) {
      const cat = (pr.loja_categorias?.icone || '') + ' ' + (pr.loja_categorias?.nome || 'Outros');
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(`• ${pr.nome} (R$${pr.preco}) — ${stockMap.get(pr.id)} un`);
    }

    let out = `🛍 *Lojinha${p.unidade ? ' — ' + p.unidade : ''}*\n`;
    for (const [cat, itens] of byCat) {
      out += `\n${cat}\n` + itens.join('\n');
    }
    return out;
  }

  // Fase 2.3 — Estorno de venda
  if (shop.action === 'shop_estorno') {
    const vendaId = p.venda_id;
    const motivo = (p.motivo || '').trim();
    if (!vendaId) {
      return '🤔 Qual venda quer estornar? Diz tipo "estornar venda #42 motivo: cliente desistiu".';
    }
    if (!motivo || motivo.length < 5) {
      return `⚠️ Preciso de um motivo (mín 5 chars) pra estornar a venda #${vendaId}. Diz tipo "estornar venda #${vendaId} motivo: produto com defeito".`;
    }
    const { data, error } = await _lrc.rpc('estornar_venda', {
      p_venda_id: vendaId,
      p_motivo: motivo,
      p_via_audit: viaAudit,
    });
    if (error) {
      if (/ja_estornada|j[aá]\s+estornada/i.test(error.message)) {
        return `⚠️ Venda #${vendaId} já está estornada.`;
      }
      if (/inexistente|not\s*found|n[aã]o\s+encontrad/i.test(error.message)) {
        return `❌ Venda #${vendaId} não existe.`;
      }
      return `❌ Erro ao estornar: ${error.message}`;
    }
    const det = data && (Array.isArray(data) ? data[0] : data) || {};
    const comissao = det.comissao_debitada || det.comissao_estornada || 0;
    const extra = comissao > 0 ? `, R$${Number(comissao).toFixed(2)} debitado da carteira do professor` : '';
    return `✅ Venda #${vendaId} estornada. Estoque devolvido${extra}.`;
  }

  // Fase 2.3 — Reserva de produto
  if (shop.action === 'shop_reserve') {
    const termo = p.produto_termo || p.nome;
    const qtd = p.quantidade;
    const cliente = (p.cliente_nome || '').trim();
    if (!termo) return '🤔 Qual produto quer reservar?';
    if (!qtd || qtd <= 0) return '🤔 Quantas unidades reservar?';
    if (!cliente) return '🤔 Pra quem é a reserva? (nome do cliente)';

    // Resolver unidade: param ou collaborator
    let uid = p.unidade_id;
    if (!uid && p.unidade) {
      uid = await resolveUnidadeIdShop(p.unidade);
      if (!uid) return `Unidade "${p.unidade}" não encontrada.`;
    }
    if (!uid) uid = collab?.unidade_id;
    if (!uid) return '🤔 Em qual unidade? (Barra, Recreio, Campo Grande)';

    // Fuzzy buscar produto — usa v2 se existir, fallback no v1
    let prods = null;
    let bErr = null;
    try {
      const r = await _lrc.rpc('loja_buscar_produto_fuzzy_v2', {
        p_termo: termo, p_unidade_id: uid, p_limit: 3,
      });
      prods = r.data; bErr = r.error;
    } catch (e) {
      bErr = { message: e.message };
    }
    // Fallback v1
    if (bErr || !prods) {
      const r2 = await _lrc.rpc('buscar_produto_fuzzy',
        { p_termo: termo, p_unidade_id: uid });
      prods = r2.data; bErr = r2.error;
    }
    if (bErr) return `❌ Erro buscando produto: ${bErr.message}`;
    if (!prods || prods.length === 0) {
      return `🤔 Não achei produto "${termo}". Tenta um nome mais específico.`;
    }
    if (prods.length > 1 && (prods[0].score == null || prods[0].score < 0.7)) {
      const opts = prods.slice(0, 5).map((pr, i) =>
        `${i + 1}. ${pr.nome}${pr.estoque_disponivel != null ? ` (disp: ${pr.estoque_disponivel})` : ''}`
      ).join('\n');
      return `🤔 Achei ${prods.length} produtos. Qual?\n${opts}`;
    }
    const prod = prods[0];

    // Validar estoque disponível se disponível no resultado
    const disp = prod.estoque_disponivel;
    if (disp != null && disp < qtd) {
      return `⚠️ Estoque insuficiente — disponível ${disp}, pedido ${qtd}.`;
    }

    // Calcular prazo: default hoje+7 dias
    const prazoDate = p.prazo || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: reserva, error: rErr } = await _lrc
      .from('loja_reservas')
      .insert({
        produto_id: prod.id,
        unidade_id: uid,
        quantidade: qtd,
        cliente_nome: cliente,
        aluno_id: p.aluno_id || null,
        prazo: prazoDate,
        status: 'ativa',
        created_via: 'tom',
      })
      .select('id, prazo')
      .single();
    if (rErr) return `❌ Erro ao reservar: ${rErr.message}`;
    return `✅ Reserva #${reserva.id} criada: ${qtd}x ${prod.nome} pra ${cliente} até ${reserva.prazo}.`;
  }

  // Pendência de inventário (LA Report) — cria registro em inventario_pendencias
  if (shop.action === 'shop_pendencia') {
    const titulo = (p.titulo || '').trim();
    const salaTermo = (p.sala_termo || '').trim();
    const prioridade = p.prioridade || 'importante';
    const descricao = p.descricao || null;

    // Inferir categoria do verbo no título (se LLM não passou)
    function inferirCategoria(t) {
      const s = t.toLowerCase();
      if (/\b(comprar|adquirir|encomendar)\b/.test(s)) return 'compra';
      if (/\b(repor|reposi[çc][aã]o|refil)\b/.test(s)) return 'reposicao';
      if (/\b(reparar|consertar|trocar|arrumar|conserto|reparo|quebrad[oa]|com\s+defeito)\b/.test(s)) return 'reparo';
      if (/\b(melhorar|melhoria|upgrade|atualizar|modernizar)\b/.test(s)) return 'melhoria';
      return null;
    }
    const categoria = p.categoria || inferirCategoria(titulo);

    if (!titulo || titulo.length < 3) {
      return '🤔 Não entendi o que precisa. Diz tipo "precisa comprar fone abafador pra sala Amy, urgente".';
    }
    if (!salaTermo) {
      return '🤔 Pra qual sala? Diz tipo "...pra sala Amy".';
    }

    // Resolver unidade — se não fornecida, busca sala em TODAS unidades (caso de Direção)
    let uid = p.unidade_id;
    if (!uid && p.unidade) {
      uid = await resolveUnidadeIdShop(p.unidade);
      if (!uid) return `Unidade "${p.unidade}" não encontrada.`;
    }
    if (!uid) uid = collab?.unidade_id;

    let salasQuery = _lrc
      .from('salas')
      .select('id, nome, unidade_id, unidades(nome)')
      .eq('ativo', true)
      .ilike('nome', `%${salaTermo}%`)
      .limit(5);
    if (uid) salasQuery = salasQuery.eq('unidade_id', uid);

    const { data: salas, error: salasErr } = await salasQuery;
    if (salasErr) return `❌ Erro buscando sala: ${salasErr.message}`;
    if (!salas || salas.length === 0) {
      return uid
        ? `🤔 Não achei sala "${salaTermo}" nessa unidade. Tenta um nome mais específico.`
        : `🤔 Não achei sala "${salaTermo}" em nenhuma unidade. Tenta um nome mais específico.`;
    }
    if (salas.length > 1) {
      const opts = salas.map((s, i) => `${i + 1}. ${s.nome} (${s.unidades?.nome || '?'})`).join('\n');
      return `🤔 Achei ${salas.length} salas com "${salaTermo}". Qual?\n${opts}`;
    }
    const sala = salas[0];
    uid = sala.unidade_id; // ajusta uid com a unidade real da sala resolvida

    const solicitante = (collab && (collab.full_name || collab.nome)) || userName || 'TOM user';

    const { data: created, error: insErr } = await _lrc
      .from('inventario_pendencias')
      .insert({
        sala_id: sala.id,
        unidade_id: uid,
        titulo: titulo.slice(0, 200),
        descricao,
        categoria,
        prioridade,
        status: 'aberta',
        solicitante,
        created_via: `via TOM por ${solicitante}`,
      })
      .select('id, titulo, prioridade')
      .single();

    if (insErr) return `❌ Erro ao registrar pendência: ${insErr.message}`;

    const emoji = prioridade === 'urgente' ? '🔴' : prioridade === 'futuramente' ? '🟡' : '🟠';
    const unidadeNome = sala.unidades?.nome ? ` · ${sala.unidades.nome}` : '';
    const catTxt = categoria ? ` · ${categoria}` : '';
    return `✅ Pendência #${created.id} registrada — ${emoji} ${created.titulo}\n📍 ${sala.nome}${unidadeNome}${catTxt}`;
  }

  return null;
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

module.exports = { processMessage, sendRitual, sendCoordinatorReport, buildTeamSummary, buildWeeklyRetrospective, parseOnboardingMarker, persistOnboarding, parseMemoryMarker, parseProjectMarker, parseTaskUpdateMarker, parseWeeklyPlanMarker, parseHabitMarker, parseDndMarker, parseDataClassifyMarker, applyDataClassify, persistMemoryRows, persistProject, applyTaskActions, applyWeeklyPlan, applyHabitActions, applyDnd, getDndState, consolidateMemoryFor, decayExpiredMemories, generateWeeklySummaryFor, updateCollaboratorProfile, looksLikeMemory, resolveTaskByShortId, applyAnnouncementAction, parseAnnouncementApprovalMarker, applyAnnouncementApproval, applyCoordinationRequestAction, parseCoordinationResponseMarker, applyCoordinationResponseAction, computeProgress, getRitualIntroDecision, countRecentRelaysToRecipient, buildRelayLimitHint, parseMonthlyPlanMarker, applyMonthlyPlan };
