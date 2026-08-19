// src/engine.js — Pipeline principal: webhook → identifica colaborador →
// constrói system prompt rico (SOUL+AGENTS+contexto Supabase) → chama Claude.
// Phase 1: Onboarding state machine via marker block + ritual entry point.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const collaboratorService = require('./services/collaborator');
const collabResolver = require('./services/collaborator-resolver');
const whatsapp = require('./services/whatsapp');
// Fatia 2 do router: a UAZAPI devolve o id da mensagem enviada, mas 86% dos outbounds
// saíam sem ele — e sem id a resposta do TOM não é citável nem roteável.
const { extractSentMessageId } = require('./services/sent-message-id');
const { extrairConteudoMemoria } = require('./services/memory-fields');
const metricsService = require('./services/metrics');
const ai = require('./ai/provider');
const { buildSystemPrompt, formatMessages } = require('./prompts/system');
const { safeIsoDate, safeDate, withinConfirmWindow, todayYmdSP } = require('./utils/dates');
const { extractMediaAnalysis } = require('./utils/media-context');
const { hasCoordLevel, isDirector, canCreateForOther } = require('./utils/roles');
const supabase = require('./supabase/client');
const OpenAI = require('openai');
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const inventarioService = require('./services/inventario-service');
const { hasTrailingQuestion, isInfoGatheringReply, isContentSolicitationReply } = require('./services/reply-classify');
const { shiftRemindersByReschedule, shiftTaskRemindAt, planReminderFloor, planRescheduleReminders } = require('./services/reschedule-reminders');
const { buildEventReminderRows } = require('./services/event-reminders');
const { matchRowsByShortId } = require('./services/short-id-match');
const { getActiveWindow } = require('./services/active-window');
const inventarioValidators = require('./services/inventario-validators');
const announcementsService = require('./services/announcements');
const pendingIntents = require('./services/pending-intents');
const approvalsService = require('./services/approvals');
const noteMarker = require('./services/note-marker');
const verbatimNote = require('./services/verbatim-note');
const notesService = require('./services/notes');
const taskReturn = require('./services/task-return');
const { jaroWinkler, normalizeForSim } = require('./services/text-similarity');
const { findDuplicateNote } = require('./services/note-dedup');
// NOTE-DEDUP: bypass de re-tentativa. Se o usuário insistir ("cria outra mesmo") logo após
// um bloqueio, a 2ª tentativa do MESMO título passa. Em memória (espelha pendingDupTasks);
// no pior caso de restart, o usuário leva 1 aviso "já existe?" a mais. TTL curto.
const recentNoteDupBlocks = new Map(); // key: `${collabId}|${normTitle}` -> ts
const NOTE_DEDUP_BYPASS_MS = 5 * 60 * 1000;
const workGroups = require('./services/work-groups');
const { detectApprovalReply, stripReplyScaffold } = require('./events/detect-approval-reply');
const { detectProjectStatusIntent } = require('./lib/detect-project-status-intent');
const projectStatusLib = require('./lib/project-status');
const { applyProjectStatusChange } = require('./services/project-status-exec');
const { detectExplicitDayIntent, resolveExplicitWeekdayDate } = require('./utils/temporal-intent');
const { resolveTaskTarget, serieDe } = require('./lib/task-target');
const { resolverConclusaoDeLembrete } = require('./lib/completion-from-reminder');
const { buildReminderRefsQuery, mapRefRows } = require('./lib/reminder-refs-query');
const { isFutureCompletion } = require('./utils/complete-guards');
const { sanitizeOptimisticConfirm, hasOptimisticConfirm, enforceNoMarkerHonesty, hasCompletionClaim, hasWeakCompletionClaim, isProgressStatusReply, restatesRecentWrite } = require('./lib/optimistic-confirm');
const { isActionConfirmQuestion } = require('./lib/confirm-question');
const { buildIntegrityReply } = require('./lib/integrity-reply');
const { validateDndWindow, DND_MAX_MS } = require('./lib/dnd-window');
const { isVisibleForDay } = require('./lib/day-visibility');
const { classifyAutoRetry } = require('./lib/auto-retry-outcome');
const { friendlyInventoryError } = require('./lib/inventory-error-message');
const { decideTaskDoneFromQuote } = require('./services/taskdone-quote');
const { enforceNoSyncExcuse } = require('./lib/sync-excuse-guard');
const { classifyDupChoice, pickFreshDupBypassIntent, pickDupBypassIntentForReply } = require('./lib/dup-choice');
const { buildClosingItems, parseClosingReply } = require('./utils/closing-reply');
const { normalizeHabitAliases } = require('./utils/habit-field-alias');
const { normalizeHabitFrequency } = require('./utils/habit-frequency');
const { detectaDataAfirmadaErrada, neutralizaDataAfirmada } = require('./utils/date-claim');
const { buildCoordinationResponseNotification, safeResponseSummary } = require('./services/coordination-notify');
const { isContextQuietField, validateContextQuietField } = require('./services/prefs-quiet-context');
const pendingInventoryPhoto = require('./services/pending-inventory-photo');
const { salaConfirmada } = require('./services/inventory-sala-guard');
const financeService = require('./services/financeiro-service');
const { mapCategory, normalizeParams } = require('./finance/categorize');
const { crossedThreshold, buildBudgetAlert } = require('./finance/budget-alert');
const { monthsToGoalSimple, monthsToGoalWithInterest, formatMonths, futureValue } = require('./finance/projection');
const invoiceImport = require('./finance/invoice-import');
const statementParse = require('./finance/statement-parse');
const spendingAnomaly = require('./finance/spending-anomaly');
const proactiveMsg = require('./finance/proactive-messages');
const { reconcileInstallments } = require('./finance/parse-installments');
const launchConfirm = require('./finance/launch-confirm');
const confirmPrecedence = require('./finance/confirm-precedence');
const invoiceReceipt = require('./finance/invoice-receipt');
const { resolveFinanceCapability, EDIT_WINDOW_HOURS } = require('./finance/finance-capability');
const { buildHonestRedirect } = require('./finance/finance-honest-redirect');
const gemini = require('./services/gemini');
const { splitBulkIdenticalCreates } = require('./task-guardrail');
const selic = require('./services/selic');
const audioDecompose = require('./services/audio-decompose');
const { classifyIntent } = require('./prompts/intent-map'); // 🗺️ O Mapa (Fase 1)
const TOM_MAPA = process.env.TOM_MAPA === '1';

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

// LA Report — rótulo de desambiguação (bug INVENTORY-DUP-DISAMBIG-LOOP).
// Quando vários itens batem o MESMO nome, repetir só o nome ("PX-160, PX-160. Qual?")
// é insuficiente: o usuário escolhe e o TOM repete a mesma pergunta → loop infinito.
// Aqui mostramos um atributo diferenciador (sala · unidade · patrimônio) + o id estável,
// que sempre desambigua — inclusive quando dois itens dividem nome E sala (id é único).
// Aceita linhas vindas com join `salas(nome, unidades(nome))` ou com sala_nome/unidade_nome flat.
function rotularItensAmbiguos(itens) {
  return (itens || []).map((x) => {
    const sala = (x.salas && x.salas.nome) || x.sala_nome || null;
    const unid = (x.salas && x.salas.unidades && x.salas.unidades.nome) || x.unidade_nome || null;
    const partes = [];
    if (sala) partes.push(sala);
    if (unid) partes.push(unid);
    if (x.codigo_patrimonio) partes.push(`patrim. ${x.codigo_patrimonio}`);
    const detalhe = partes.length ? ` — ${partes.join(' · ')}` : '';
    return `• ${x.nome}${detalhe} (id ${x.id})`;
  }).join('\n');
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
  'extension_request', 'extension_decision', 'governance_reassign',
  'snooze_reminders', 'return',
  'mark-item', 'mark_item', // Checklist ativo (2026-06-28): marca sub-item (filha via parent_task_id)
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
const VALID_EVENT_UPDATE_ACTIONS = new Set(['reschedule', 'cancel', 'complete', 'update', 'add_participants', 'remove_participants']);
// Sprint 31.15 (Quintela/Luciano 03/06) — verbos naturais de RSVP que o LLM emite no lugar
// do canônico action:rsvp. Em vez de rejeitar (action:invalid → "Sim, confirmo" virava
// confabulação "presença confirmada"), são roteados pro applyRsvp (lookup GLOBAL do evento,
// já que o convidado não é dono do evento). Valor = status; null em 'rsvp' (usa campo status).
const RSVP_ALIASES = new Map([
  ['rsvp', null],
  ['confirm', 'confirmed'], ['confirmar', 'confirmed'], ['confirmado', 'confirmed'], ['confirmed', 'confirmed'],
  ['accept', 'confirmed'], ['aceitar', 'confirmed'], ['aceito', 'confirmed'], ['going', 'confirmed'], ['attend', 'confirmed'],
  ['decline', 'declined'], ['recusar', 'declined'], ['recusado', 'declined'], ['declined', 'declined'], ['reject', 'declined'],
  ['tentative', 'tentative'], ['maybe', 'tentative'], ['talvez', 'tentative'],
]);
function rsvpStatusFor(action, statusField) {
  const mapped = RSVP_ALIASES.get(action);
  if (mapped) return mapped;
  return ['confirmed', 'declined', 'tentative'].includes(statusField) ? statusField : 'confirmed';
}
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
//
// `rawLimit` existe para o payload de TASK_TARGET_AMBIGUOUS (Fatia A do alvo de tarefa), que
// precisa carregar a lista de candidatos para desenhar a Fatia B. Em 500 chars ele chegaria
// cortado no meio do JSON — o que é pior do que não gravar, porque parece dado e não é. A
// coluna `marker_logs.raw_excerpt` é `text` SEM limite no banco: o corte sempre foi só aqui.
//
// ATENÇÃO para quem for chamar: `result` tem CHECK no banco e só aceita
// ['executed','rejected','skipped','redirected','fallback']. Qualquer outro valor viola a
// constraint e esta função NÃO lança — só faz console.error. A linha some em silêncio.
async function logMarker(collaboratorId, markerType, result, reason = null, raw = null, { rawLimit = 500 } = {}) {
  try {
    let excerpt = null;
    if (raw) excerpt = typeof raw === 'string' ? raw.slice(0, rawLimit) : JSON.stringify(raw).slice(0, rawLimit);
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

// Ambiguidade real (linhagens distintas) NÃO é resolvida na Fatia A — mantém o comportamento
// legado e registra. O payload precisa ser rico: contar ocorrência diz QUANTO, não diz O QUE, e
// é o o-que que desenha o desempate da Fatia B. `vencedor_legado` é o campo que depois
// transforma "7% ambíguo" em "X% ambíguo E ERRADO" — sem ele não dá para saber quantas vezes o
// comportamento mantido aqui acertou por acaso.
async function _logAlvoAmbiguo(handler, tituloPedido, collaboratorId, candidatos) {
  try {
    const porLegado = candidatos.slice().sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    const comData = candidatos.filter((t) => t.due_date)
      .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
    const payload = {
      handler,
      titulo_pedido: String(tituloPedido || ''),
      collaborator_id: collaboratorId,
      n: candidatos.length,
      motivo: 'linhagens_distintas',
      // Cap de 10 na LISTA (o `n` acima continua exato). Grupos ambíguos reais medidos em 06/08
      // têm ~3 candidatos; 10 é folga. Sem cap, uma série de 42 geraria 6 KB por linha de log.
      candidatos: candidatos.slice(0, 10).map((t) => ({
        id: t.id, title: t.title, due_date: t.due_date,
        serie: serieDe(t), created_at: t.created_at,
      })),
      linhagens: [...new Set(candidatos.map(serieDe))],
      vencedor_legado: porLegado[0] ? porLegado[0].id : null,
      vencedor_serie: comData[0] ? comData[0].id : null,
    };
    console.warn(`[TaskTarget] ambiguo handler=${handler} n=${candidatos.length} motivo=linhagens_distintas pedido="${String(tituloPedido).slice(0, 60)}" legado=${String(payload.vencedor_legado).slice(0, 8)}`);
    // `result` tem CHECK no banco: só ['executed','rejected','skipped','redirected','fallback'].
    // Qualquer outro valor viola a constraint, e `logMarker` NÃO lança — só faz console.error.
    // O log rico morreria em silêncio, que é exatamente o que esta instrumentação existe para
    // evitar. 'fallback' é o valor honesto: a Fatia A caiu no comportamento legado.
    await logMarker(collaboratorId, 'TASK_TARGET_AMBIGUOUS', 'fallback', handler, payload, { rawLimit: 4000 });
  } catch (e) {
    console.error('[TaskTarget] falha ao logar ambiguidade:', e.message);
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
    // Sinônimos aceitos e instrumentação em services/memory-fields.js. `body` entrou em
    // 05/08 (caso Matheus): o TOM escrevia o texto nele, o parser recusava, e a pessoa
    // repetia a instrução três vezes achando que o TOM não entendia.
    const memCampo = extrairConteudoMemoria(r);
    if (!memCampo.ok) {
      // O motivo agora NOMEIA as chaves que vieram — sem isso, cada campo novo custa
      // uma investigação no banco pra descobrir o que o modelo mandou.
      dropped.push(`row[${i}]:${memCampo.motivo}`);
      continue;
    }
    r.content = memCampo.content; // normaliza pro campo canônico
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
    // F4: "latest" escopado ao que foi NOTIFICADO a este aprovador (intents da F1) —
    // antes era o pending_approval mais recente GLOBAL (qualquer director aprovava
    // comunicado que nunca lhe foi mostrado). Sem intent: CEO mantém o global
    // (compat com pendências pré-F1); os demais recebem erro claro.
    try {
      const mineAp = await approvalsService.listOpenApprovals(supabase, collaborator.id);
      const refs = mineAp.filter((i) => i.payload.domain === 'announcement').map((i) => i.payload.ref_id);
      if (refs.length) query = query.in('id', refs);
      else if (!collaborator.is_ceo) {
        return { ok: false, reason: 'Nenhum comunicado aguardando SUA aprovação.' };
      }
    } catch (e) { console.warn('[applyAnnouncementApproval] scope err (segue global):', e.message); }
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

    // F4: guarda de status no UPDATE (anti-corrida) — dupla aprovação simultânea não
    // gera jobs em dobro: só a primeira transição pending_approval→scheduled passa.
    const { data: updRows, error: updErr } = await supabase
      .from('announcements')
      .update({
        status: 'scheduled',
        reviewed_by: collaborator.id,
      })
      .eq('id', ann.id)
      .eq('status', 'pending_approval')
      .select('id');
    if (updErr) {
      console.error('[applyAnnouncementApproval] erro UPDATE approve:', updErr.message);
      return { ok: false, reason: 'Erro ao aprovar o comunicado.' };
    }
    if (!updRows || updRows.length === 0) {
      return { ok: false, reason: 'Esse comunicado já foi aprovado/rejeitado por outra pessoa.' };
    }

    // F1 (APROVACAO-SEM-FUNIL) — fecha as intents de aprovação deste comunicado.
    try { await approvalsService.resolveApprovalByRef(supabase, ann.id, 'confirmed', `aprovado por ${collaborator.full_name}`); } catch (_) { /* não quebra */ }

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

    // F1 (APROVACAO-SEM-FUNIL) — fecha as intents de aprovação deste comunicado.
    try { await approvalsService.resolveApprovalByRef(supabase, ann.id, 'denied', `rejeitado por ${collaborator.full_name}`); } catch (_) { /* não quebra */ }

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
      // F4 (GOV-APROVADOR-DIVERGENTE): aprovador = líder de quem criou (matriz de
      // governança), não mais hardcode is_ceo. Pro org atual dá no mesmo (fallback CEO),
      // mas agora é REGRA — e acompanha a matriz quando ela mudar (Rafinha→Alf por regra).
      let directors = [];
      let dirErr = null;
      try {
        const approver = await approvalsService.resolveApproverFor(supabase, collaborator.id);
        directors = approver ? [approver] : [];
      } catch (e) { dirErr = e; }

      if (dirErr) {
        console.error('[applyAnnouncementAction] Falha ao resolver aprovador:', dirErr.message);
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
        // F1 (APROVACAO-SEM-FUNIL): card volta a ter o ID curto (era computado e descartado —
        // GAP do Incidente B) e o pedido vira ESTADO: intent no aprovador + card no histórico
        // (reply-quote passa a enriquecer; intercept e prompt enxergam a pendência).
        const cardText = [
          '📋 *Comunicado pendente de aprovação*',
          `De: ${collaborator.full_name} (${collaborator.role}${collaborator.function_role ? ` · ${collaborator.function_role}` : ''})`,
          `Para: ${audienceDetail}${missingWarning}`,
          `Mensagem: "${bodyPreview}"`,
          ``,
          `Responda *APROVAR ${shortId}* ou *REJEITAR ${shortId} [motivo opcional]*.`,
        ].join('\n');
        try {
          await whatsapp.sendMessage(director.phone, cardText);
          try {
            await approvalsService.openAnnouncementApproval(supabase, { approverId: director.id, announcementId: ann.id, shortId });
            await logConversation(director.id, 'outbound', cardText);
          } catch (stateErr) {
            console.warn('[applyAnnouncementAction] approval state err:', stateErr.message);
          }
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
    // Cascata (SCHOOLEVENT-CANCEL-ORPHAN-TASKS, 3º caminho — TOM cancela o show via WhatsApp):
    // cancelar o show cancela as tarefas de PREPARO (school_event_id), senão viram órfãs e o
    // bom-dia/overdue seguem cobrando ensaio/repertório/divulgar (a rede do dispatcher só silencia
    // o lembrete T-1). Espelha a PWA (AgendaEscolar.tsx). Preserva done (histórico).
    await supabase
      .from('tasks')
      .update({ status: 'cancelled' })
      .eq('school_event_id', evId)
      .not('status', 'in', '("done","cancelled")');
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
    // BUG-5 (11/06): normaliza aliases de campos e mode antes da validação.
    // LLM varia: recipient/to/name em vez de recipient_name; relay/literal em vez de relay_literal, etc.
    // COORD-REQUEST-TONAME-ALIAS (14/07): + to_name (destinatário) — dominava 100% das rejeições
    // de julho (John, Anne…). Bloco extraído p/ helper puro coordination/coord-alias.js (TDD).
    const { normalizeCoordinationFields } = require('./coordination/coord-alias');
    normalizeCoordinationFields(parsed);
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
  // Audit 08/07 (Jereh): aceita SHORT-ID (4-12 hex) OU UUID completo — o LLM devolve
  // o short-id de 8 hex que enxerga no histórico (ex.: "9d08f967"). A resolução
  // short→linha real acontece no executor (matchRowsByShortId, escopo recipient+sent).
  const { isValidCoordRequestId } = require('./coordination/coord-request-id');
  if (!isValidCoordRequestId(parsed.request_id)) {
    logSchemaErr('COORDINATION_RESPONSE', ['request_id:invalid_id'], parsed);
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
  // Audit 08/07 (Jereh): request_id pode vir SHORT-ID (8 hex). Busca os recados
  // 'sent' abertos deste recipient e resolve por prefixo (matchRowsByShortId),
  // ordenado por mais recente → desempata ambiguidade. Antes: .eq('id', ...) exigia
  // UUID exato, então o short-id do LLM nunca casava e a resposta era descartada.
  const { resolveCoordRequest } = require('./coordination/coord-request-id');
  const { data: candRows, error: fetchErr } = await supabase
    .from('coordination_requests')
    .select('id, requester_id, recipient_id, mode, message_body, status')
    .eq('recipient_id', collab.id)
    .eq('status', 'sent')
    .order('created_at', { ascending: false });

  const resolution = (!fetchErr && Array.isArray(candRows))
    ? resolveCoordRequest(candRows, parsed.request_id)
    : { status: 'none' };
  // Parecer catraca 08/07: short-id ambíguo (N>1 recados abertos) → NÃO chuta o
  // mais recente; rejeita e cai no fluxo de "não encontrei" (evita notificar o
  // requester errado em silêncio).
  if (resolution.status === 'ambiguous') {
    console.warn('[CoordinationResponse] ambiguous short_id:', String(parsed.request_id).slice(0, 8), 'matches=', resolution.matches.length);
    return { ok: false, reason: 'ambiguous_short_id' };
  }
  const req = resolution.req || null;

  if (fetchErr || !req) {
    console.warn('[CoordinationResponse] request not found or not sent:', String(parsed.request_id).slice(0, 8));
    return { ok: false, reason: 'request_not_found' };
  }

  const { error: updErr } = await supabase
    .from('coordination_requests')
    .update({
      status:           'responded',
      responded_at:     new Date().toISOString(),
      response_summary: safeResponseSummary(inboundText, parsed.response_summary),
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
            response_summary: safeResponseSummary(inboundText, parsed.response_summary),
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

// Krissya 08/06 (AUDIT-DUP-CONFIRM) + AUDIT-OPTIMISTIC-CONFIRM (12/06): a remoção
// de confirmação otimista falsa (quando o IntegrityCheck/falha bloqueia a criação)
// foi unificada em src/lib/optimistic-confirm.js → sanitizeOptimisticConfirm().
// O strip antigo (_stripPrematureCreateConfirm) só pegava VERBO logo após o emoji,
// deixando "✅ *Título*" passar — agora coberto pelo sanitizador.

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
      // BYPASS-INTEGRITY-LLM-FREE (Luciano 02/07 00:09): o LLM emitiu bypass_integrity:true
      // por conta própria ("dessa vez o marker vai com bypass_integrity") e furou a trava de
      // duplicata → evento duplicado criado por cima dos existentes. O bypass é PRIVILÉGIO do
      // fluxo determinístico 1/2/3 (DupBypass ~7222 injeta o flag PÓS-parse, no objeto JS —
      // não passa por aqui). Vindo do JSON do marker, é dropado sempre.
      if ('bypass_integrity' in item) delete item.bypass_integrity;
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

async function applyEventActions(collaborator, events, opts = {}) {
  let okCount = 0, failCount = 0;
  let integrityPayload = null;
  const last4 = String(collaborator.phone || '').slice(-4);
  // Sprint 22.34b — Habit redirect (titles que batem habito ativo do user)
  // acontece no caller, ANTES de chegar aqui. Aqui só processa events reais.
  for (const e of events) {
    try {
      // Sprint 29.x — RSVP: confirmar/recusar presença num compromisso existente.
      // TOM emite <<EVENT_UPDATE>>{"action":"rsvp","status":"confirmed|declined|tentative"}<<END>>.
      // event_id é OPCIONAL (Sprint EV-LEAK 08/06): sem ele, applyRsvp resolve o
      // convite PENDENTE do colaborador — antes vinha do [ev:xxxx] que vazava pro usuário.
      if (RSVP_ALIASES.has(e.action)) {
        // Sprint 31.15 — aceita action:rsvp E verbos naturais (confirm/aceito/recuso...).
        const evId = typeof e.event_id === 'string' ? e.event_id.trim() : null;
        const r = await applyRsvp(collaborator, evId, rsvpStatusFor(e.action, e.status));
        if (r.ok) okCount++; else failCount++;
        continue;
      }
      // Sprint 18 — pre-check de integridade (fail-open: erros nos detectores não bloqueiam)
      // bypass_integrity: true → skip dup check (user já confirmou "crio mesmo assim")
      const bypassIntegrity = e.bypass_integrity === true;
      let temporalResult = { hardConflicts: [], softConflicts: [] };
      let dupResult      = { probable: [], possible: [] };
      // EVENT-DEDUP-TONAME-FALSEBLOCK (audit 01/07): o dedup checa a agenda do CRIADOR (collab.id).
      // Num broadcast "avisa os 8 e marca na agenda deles", TOM emite N EVENT_CREATE com to_name
      // diferente — mesmo título+data. O 1º cria; os demais batem NELE (agenda do criador) e viram
      // held_dup → os destinatários ficam SEM evento (caso Reunião Time Gestão: 8 bloqueados). Evento
      // DIRIGIDO (to_name/to_phone) vai pra OUTRA agenda: o dedup do criador não se aplica. (Checar a
      // agenda do destinatário é Fase 2; aqui destravamos o broadcast legítimo — o temporal do criador
      // segue rodando.)
      const _directedEvent = !!(e.to_name || e.to_phone);
      const _runDup = !bypassIntegrity && !_directedEvent;
      try {
        const detectors = [detectTemporalConflict(collaborator, e)];
        if (_runDup) detectors.push(detectDuplicateSemanticEvent(collaborator, e));
        const results = await Promise.all(detectors);
        temporalResult = results[0];
        if (_runDup) dupResult = results[1];
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
      // MARKER-NO-EISENHOWER-FIELD (Alf 07/07) — quadrant opcional (1-4) no marker.
      // Fora do range/não-numérico: ignora silencioso (evento salva sem prioridade).
      const evQuad = Number(e.quadrant);
      if (Number.isInteger(evQuad) && evQuad >= 1 && evQuad <= 4) row.eisenhower_quadrant = evQuad;
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
      // Fase 3 chat de grupo: opts.suppressNotify trava o zap (TOM cria evento no chat sem notificar).
      if (!opts.suppressNotify && eventRecipient && eventRecipient.phone && eventRecipient.id !== collaborator.id) {
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
          // Sprint EV-LEAK (08/06) — sem [ev:short_id] visível (vazava código). RSVP
          // resolvido pelo engine via convite pendente do colaborador (applyRsvp).
          const msg = `📅 *${senderName}* marcou um compromisso na sua agenda:\n\n*${row.title}*\n🗓️ ${whenStr}${locPart}${modPart}\n\nSe não puder, fala com ${senderName} pra remarcar.`;
          whatsapp.sendMessage(eventRecipient.phone, msg).catch(err =>
            console.error(`[Event] notify recipient err: ${err.message}`));
          await logConversation(eventRecipient.id, 'outbound', `[event criado por ${senderName}: ${row.title}]`);
        } catch (notifErr) {
          console.warn(`[Event] notify build err (silent): ${notifErr.message}`);
        }
      }
      // 👥 Reunião de grupo (F1) — attendees: 1 evento (agenda do criador) + N participantes.
      // NÃO usa to_name (o evento fica com o criador); os convidados viram event_participants.
      // Resolve nomes, insere (status=invited) e convida cada um. Nome não resolvido/ambíguo →
      // só loga (o skill de grupo confirma a lista antes de criar). Ver spec reuniao-grupo.
      if (data?.id && Array.isArray(e.attendees) && e.attendees.length > 0) {
        try {
          const { resolveAttendees } = require('./lib/resolve-attendees');
          const { enqueueOutbound } = require('./lib/outbound-queue');
          const { resolved, unresolved } = await resolveAttendees(
            e.attendees,
            (nm) => resolveCollaboratorByName(nm, { requester: collaborator })
          );
          let invited = 0;
          const inviteRows = [];
          for (const { collaborator: part } of resolved) {
            if (!part || part.id === collaborator.id || part.is_active === false) continue;
            const { error: partErr } = await supabase.from('event_participants').insert({
              event_id: data.id, collaborator_id: part.id, status: 'invited',
              invited_by: collaborator.id, invited_at: new Date().toISOString(),
            });
            if (partErr) { console.warn(`[Event] attendee insert err ${String(part.id).slice(0, 8)}: ${partErr.message}`); continue; }
            invited++;
            if (!opts.suppressNotify && part.phone) {
              const senderName = (collaborator.preferred_name || collaborator.full_name || '').split(' ')[0];
              const whenStr = (() => { try { const d = safeDate(e.start_at); return d ? d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : e.start_at; } catch { return e.start_at; } })();
              const locPart = e.location_text ? `\n📍 ${String(e.location_text).slice(0, 80)}` : '';
              const inviteMsg = `📅 *${senderName}* te convidou pra um compromisso:\n\n*${row.title}*\n🗓️ ${whenStr}${locPart}\n\nConfirma presença? Responde *"vou"* ou *"não posso"*.`;
              // Fila durável (anti-ban): em vez de disparar os N convites juntos, enfileira espaçado.
              inviteRows.push({ phone: part.phone, body: inviteMsg, meta: { collaborator_id: part.id, kind: 'event_invite', event_id: data.id, sender_name: senderName } });
              await logConversation(part.id, 'outbound', `[convite de ${senderName}: ${row.title}]`);
            }
          }
          if (inviteRows.length) await enqueueOutbound(supabase, inviteRows, {});
          console.log(`[Event] attendees event=${String(data.id).slice(0, 8)}: ${invited} convidados${unresolved.length ? `, ${unresolved.length} não resolvidos (${unresolved.join(', ')})` : ''} (${inviteRows.length} convites enfileirados)`);
        } catch (attErr) {
          console.warn('[Event] attendees branch err (non-fatal):', attErr.message);
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
      // Checklist (pauta) do compromisso — TOM pode passar checklist:["item1","item2"].
      // Best-effort: NUNCA derruba a criação do evento. Defensivo a malformado (não-array =
      // ignora; itens não-string = filtra). Recorrência: NÃO cria (ficaria no template
      // invisível, igual ao PWA/tarefa). created_by = remetente real.
      try {
        const eventId = data && data.id;
        if (eventId && !row.recurrence_rule && Array.isArray(e.checklist)) {
          const clRows = e.checklist
            .map(t => (typeof t === 'string' ? t.trim() : ''))
            .filter(Boolean)
            .map((title, i) => ({
              event_id: eventId,
              title: title.slice(0, 200),
              done: false,
              sort_position: i + 1,
              created_by: collaborator.id,
            }));
          if (clRows.length > 0) {
            const { error: clErr } = await supabase.from('event_checklist_items').insert(clRows);
            if (clErr) console.error('[Event] checklist err:', clErr.message);
            else console.log(`[Event] +${clRows.length} checklist item(s) for event ${String(eventId).slice(0,8)}`);
          }
        }
      } catch (clErr) {
        console.warn('[Event] checklist attach failed:', clErr.message);
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
  if (!VALID_EVENT_UPDATE_ACTIONS.has(a.action)) {
    // Sprint 31.15 — verbo de RSVP (confirm/aceito/recuso...) não é EVENT_UPDATE real;
    // é roteado pro applyRsvp no applyEventUpdates. Aceita aqui se houver event_id/id.
    if (RSVP_ALIASES.has(a.action)) {
      // Sprint EV-LEAK (08/06) — event_id é OPCIONAL. Antes exigia o ref vindo do
      // [ev:xxxx] visível na mensagem de convite, que vazava código pro usuário.
      // Sem ref, o applyRsvp resolve o convite PENDENTE do colaborador.
      return null;
    }
    return 'action:invalid';
  }
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
    // Sprint 31.x — lembrete do evento também é editável. reminders_minutes_before é um
    // ARRAY (minutos antes do início; [] = remover), não string, então tem check próprio.
    // Antes era rejeitado como no_editable_field (caso Rose/ADM 09/06, evento 6778d729).
    const hasReminders = Array.isArray(a.reminders_minutes_before);
    // MARKER-NO-EISENHOWER-FIELD (Alf 07/07) — quadrant (1-4) também é campo editável.
    const hasQuadrant = Number.isInteger(Number(a.quadrant)) && Number(a.quadrant) >= 1 && Number(a.quadrant) <= 4;
    if (!hasField && !hasReminders && !hasQuadrant) return 'update:no_editable_field';
    if (typeof a.modality === 'string' && a.modality.trim() && !VALID_EVENT_MODALITIES.has(a.modality)) return 'modality:invalid';
  }
  if (a.action === 'add_participants' || a.action === 'remove_participants') {
    // 02/07 — edição de participantes por chat. Exige lista de nomes não-vazia.
    if (!Array.isArray(a.names) || !a.names.some((n) => typeof n === 'string' && n.trim())) return 'names:invalid';
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
  // F4 (GOV-APROVADOR-DIVERGENTE): anti-auto-aprovação (paridade com comunicado) +
  // execução escopada — quem não é director só aprova o que foi NOTIFICADO a ele (intent F1).
  if (project.created_by === collab.id) {
    return { ok: false, reason: 'self_approval_blocked', userMsg: '_você não pode aprovar o próprio projeto — quem aprova é seu líder_' };
  }
  if (collab.role !== 'director') {
    try {
      const openAp = await approvalsService.listOpenApprovals(supabase, collab.id);
      const assigned = openAp.some((i) => i.payload.domain === 'project' && i.payload.ref_id === project.id);
      if (!assigned) {
        return { ok: false, reason: 'not_assigned_approver', userMsg: '_essa aprovação não está com você — quem aprova é o líder de quem criou o projeto_' };
      }
    } catch (e) { console.warn('[Project] approver scope check err (deixa passar):', e.message); }
  }
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

  // F1 (APROVACAO-SEM-FUNIL) — fecha as intents de aprovação deste projeto (todos os notificados).
  try { await approvalsService.resolveApprovalByRef(supabase, project.id, 'confirmed', `aprovado por ${collab.full_name}`); } catch (_) { /* não quebra a aprovação */ }

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
  // F4: mesmas guardas da aprovação (anti-self + escopo ao notificado).
  if (project.created_by === collab.id) {
    return { ok: false, reason: 'self_approval_blocked', userMsg: '_você não pode rejeitar o próprio projeto — fala com seu líder_' };
  }
  if (collab.role !== 'director') {
    try {
      const openRj = await approvalsService.listOpenApprovals(supabase, collab.id);
      const assigned = openRj.some((i) => i.payload.domain === 'project' && i.payload.ref_id === project.id);
      if (!assigned) {
        return { ok: false, reason: 'not_assigned_approver', userMsg: '_essa aprovação não está com você — quem decide é o líder de quem criou o projeto_' };
      }
    } catch (e) { console.warn('[Project] approver scope check err (deixa passar):', e.message); }
  }
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

  // F1 (APROVACAO-SEM-FUNIL) — fecha as intents de aprovação deste projeto.
  try { await approvalsService.resolveApprovalByRef(supabase, project.id, 'denied', `rejeitado por ${collab.full_name}: ${reason}`); } catch (_) { /* não quebra a rejeição */ }

  const { data: creator } = await supabase
    .from('collaborators').select('phone, full_name').eq('id', project.created_by).single();
  if (creator?.phone) {
    const msg = `❌ Seu projeto *${project.name}* foi rejeitado por *${collab.full_name}*.\n\n_Motivo:_ ${reason}\n\nSe quiser ajustar e tentar de novo, é só me chamar.`;
    whatsapp.sendMessage(creator.phone, msg).catch(e => console.error(`[Project] REJECT WA creator err: ${e.message}`));
  }
  return { ok: true, project };
}

// Defesa-em-profundidade na resolução de short_id: filtra eventos do colaborador.
// BUG-1 (11/06): fallback via event_participants — convidados (Jereh, Leo, Daiana, Clayton,
// Krissya) tentavam completar eventos onde não eram dono → all_failed:1 silencioso.
// O retorno { ...ev, fromParticipant: true } sinaliza ao caller que só 'complete' é permitido.
async function resolveEventByShortId(collaboratorId, shortId) {
  if (!shortId || !SHORT_ID_RE.test(String(shortId))) return null;
  // Janela ampla — eventos cancelados ou já feitos podem precisar ser referenciados.
  const sinceIso = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();

  // 1) Owner lookup (caminho original)
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
  if (data && data.length > 0) {
    const matches = matchRowsByShortId(data, shortId); // tolerante a UUID alucinado (Sprint 31.14)
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      console.warn(`[Event] short_id ambíguo ${shortId} (${matches.length} matches owner) — rejeitando`);
      return null;
    }
  }

  // 2) Participant fallback — convidado tenta completar evento de outro dono
  try {
    const { data: parts } = await supabase
      .from('event_participants')
      .select('event_id')
      .eq('collaborator_id', collaboratorId);
    if (!parts || parts.length === 0) return null;
    const eventIds = parts.map(p => p.event_id);
    const { data: evts } = await supabase
      .from('events')
      .select('id, title, status, start_at, end_at, collaborator_id')
      .in('id', eventIds)
      .gte('start_at', sinceIso)
      .limit(500);
    if (!evts || evts.length === 0) return null;
    const pmatches = matchRowsByShortId(evts, shortId);
    if (pmatches.length === 0) return null;
    if (pmatches.length > 1) {
      console.warn(`[Event] short_id ambíguo ${shortId} (${pmatches.length} matches participant) — rejeitando`);
      return null;
    }
    console.log(`[Event] resolveEventByShortId: participante encontrou evento ${pmatches[0].id.slice(0,8)} (dono ${pmatches[0].collaborator_id.slice(0,8)})`);
    return { ...pmatches[0], fromParticipant: true };
  } catch (e) {
    console.warn('[Event] resolveEventByShortId participant fallback err:', e.message);
    return null;
  }
}

// Sprint EV-LEAK (08/06) — resolve o convite PENDENTE mais provável de um colaborador,
// para RSVP sem event_id explícito (o token [ev:xxxx] foi removido das mensagens por
// vazar código pro usuário). Regra: participações ainda NÃO respondidas (responded_at
// NULL), preferindo o evento futuro mais próximo (não cancelado); desempate pelo convite
// mais recente. Retorna o event_id (uuid) ou null.
async function resolvePendingInviteEventId(collaboratorId) {
  const { data, error } = await supabase.from('event_participants')
    .select('event_id, invited_at, events:event_id(start_at, status)')
    .eq('collaborator_id', collaboratorId)
    .is('responded_at', null)
    .order('invited_at', { ascending: false })
    .limit(30);
  if (error || !data || data.length === 0) return null;
  const now = Date.now();
  // só convites de eventos FUTUROS e não cancelados (não faz sentido RSVP em evento
  // passado). data já vem invited_at DESC → o convite MAIS RECENTE é o que a pessoa
  // está respondendo (o que ela acabou de receber), não o de data mais próxima.
  const candidates = data
    .map(p => ({ event_id: p.event_id, ev: Array.isArray(p.events) ? p.events[0] : p.events }))
    .filter(p => p.ev && p.ev.status !== 'cancelled'
              && p.ev.start_at && new Date(p.ev.start_at).getTime() >= now - 3600e3);
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    console.warn(`[Event][RSVP] ${String(collaboratorId).slice(0, 8)} tem ${candidates.length} convites pendentes futuros — usando o convite MAIS RECENTE`);
  }
  return candidates[0].event_id; // convite mais recente (invited_at desc)
}

// Sprint 31.15 — upsert de PRESENÇA (RSVP). Resolve o evento por id GLOBAL (o convidado
// NÃO é dono — resolveEventByShortId, escopado por owner, não acharia). Compartilhado entre
// o marker <<EVENT>> action:rsvp e o reroute de verbos naturais no <<EVENT_UPDATE>>.
async function applyRsvp(collaborator, eventIdRef, status) {
  const evId = typeof eventIdRef === 'string' ? eventIdRef.trim() : null;
  const st = ['confirmed', 'declined', 'tentative'].includes(status) ? status : 'confirmed';
  let resolvedEventId = null;
  if (evId && evId.length >= 36) {
    resolvedEventId = evId;
  } else if (evId) {
    // prefixo 8char (back-compat) → casa contra os eventos do colaborador em JS
    // (ilike não funciona em coluna uuid). 1 match usa; 0/ambíguo cai pro resolver
    // de convite pendente abaixo.
    const head = evId.replace(/-/g, '').toLowerCase();
    const { data: parts } = await supabase.from('event_participants')
      .select('event_id').eq('collaborator_id', collaborator.id);
    const { data: own } = await supabase.from('events')
      .select('id').eq('collaborator_id', collaborator.id)
      .gte('start_at', new Date(Date.now() - 90 * 864e5).toISOString()).limit(500);
    const ids = [...new Set([...(parts || []).map(p => p.event_id), ...(own || []).map(e => e.id)])];
    const matches = ids.filter(id => String(id).replace(/-/g, '').toLowerCase().startsWith(head));
    if (matches.length === 1) resolvedEventId = matches[0];
    else if (matches.length > 1) console.warn(`[Event][RSVP] prefix "${evId}" ambíguo (${matches.length}) — tentando convite pendente`);
    else console.warn(`[Event][RSVP] prefix "${evId}" não resolveu — tentando convite pendente`);
  }
  // Sprint EV-LEAK — sem id resolvido (LLM não mandou event_id porque o token foi
  // removido das mensagens): resolve o convite pendente do colaborador.
  if (!resolvedEventId) {
    resolvedEventId = await resolvePendingInviteEventId(collaborator.id);
  }
  if (!resolvedEventId) { console.warn('[Event][RSVP] não resolveu evento (sem id e sem convite pendente)'); return { ok: false }; }
  const { error } = await supabase.from('event_participants').upsert({
    event_id: resolvedEventId, collaborator_id: collaborator.id, status: st, responded_at: new Date().toISOString(),
  }, { onConflict: 'event_id,collaborator_id' });
  if (error) { console.error('[Event][RSVP] upsert err:', error.message); return { ok: false }; }
  console.log(`[Event][RSVP] ${String(collaborator.id).slice(0, 8)} → event ${String(resolvedEventId).slice(0, 8)} status=${st}`);

  // RSVP-NOTIFY-OWNER (06/06) — avisa o DONO do evento, no WhatsApp, quando um
  // convidado confirma/recusa/talvez. Antes o applyRsvp só gravava no banco e o dono
  // não sabia que alguém respondeu. Inclui contador (X/Y confirmaram). Nunca quebra o
  // RSVP (try/catch isolado). Não notifica se quem respondeu é o próprio dono.
  try {
    const { data: ev } = await supabase.from('events')
      .select('title, start_at, collaborator_id')
      .eq('id', resolvedEventId).maybeSingle();
    if (ev && ev.collaborator_id && ev.collaborator_id !== collaborator.id) {
      const { data: owner } = await supabase.from('collaborators')
        .select('full_name, phone').eq('id', ev.collaborator_id).maybeSingle();
      if (owner && owner.phone) {
        const { data: allParts } = await supabase.from('event_participants')
          .select('status').eq('event_id', resolvedEventId);
        const total = (allParts || []).length;
        const confCount = (allParts || []).filter((p) => p.status === 'confirmed').length;
        const tally = total ? ` (${confCount}/${total} confirmaram)` : '';
        const emoji = st === 'confirmed' ? '✅' : (st === 'declined' ? '❌' : '🤔');
        const verbo = st === 'confirmed' ? 'confirmou presença' : (st === 'declined' ? 'recusou' : 'marcou como talvez');
        const who = (collaborator.full_name || 'Alguém').split(' ')[0];
        const quando = ev.start_at
          ? new Date(ev.start_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          : '';
        const titulo = ev.title || 'compromisso';
        const msg = `${emoji} *${who}* ${verbo} em _"${titulo}"_${tally}${quando ? `\n🗓️ ${quando}` : ''}`;
        await whatsapp.sendMessage(owner.phone, msg);
        // RSVP-HISTORY-MISSING (caso Rose 09/06): sem persistir, o LLM nunca "vê" os
        // repasses e responde "não tenho a lista" com 5/7 confirmados no banco.
        // collaborator_id = dono vindo do BANCO (ev.collaborator_id), nunca de marker.
        await supabase.from('conversation_history').insert({
          collaborator_id: ev.collaborator_id,
          direction: 'outbound',
          message_type: 'text',
          content: msg,
        });
        console.log(`[Event][RSVP] dono avisado ...${String(owner.phone).slice(-4)} status=${st} ${confCount}/${total}`);
      }
    }
  } catch (e) { console.error('[Event][RSVP] notify owner err:', e.message); }

  return { ok: true, eventId: resolvedEventId };
}

// Sprint 22.38 / 31.16 — aplica ações de lista pessoal (create|add_item|toggle_item|rename|
// archive). Extraído de processMessage pra ser testável (smoke). Retorna { okCount, failCount }.
async function applyPersonalListActions(collab, actions) {
  let okCount = 0, failCount = 0;
  for (const a of actions) {
    try {
      if (!a || typeof a !== 'object') { console.warn('[PersonalList] FAIL: not object'); failCount++; continue; }
      console.log('[PersonalList] action:', a.action, 'name:', a.name);
      if (a.action === 'create' || a.action === 'create_list') {
        const name = String(a.name || a.title || '').trim();
        if (!name) { console.warn('[PersonalList] FAIL: no name'); failCount++; continue; }
        const listType = ['shopping', 'travel', 'meds', 'general'].includes(a.list_type) ? a.list_type : 'general';
        const context = ['work', 'personal'].includes(a.context) ? a.context : 'personal';
        const { data: list, error: e1 } = await supabase
          .from('personal_checklists')
          .insert({ owner_collab_id: collab.id, name, list_type: listType, context })
          .select('id').single();
        if (e1) { console.error('[PersonalList] FAIL list insert:', e1.message); failCount++; continue; }
        const items = Array.isArray(a.items) ? a.items.filter(x => typeof x === 'string' && x.trim()) : [];
        if (items.length) {
          const rows = items.map((d, i) => ({ list_id: list.id, description: d.trim(), sort_order: i + 1 }));
          const { error: e2 } = await supabase.from('personal_checklist_items').insert(rows);
          if (e2) { console.error('[PersonalList] FAIL items insert:', e2.message); failCount++; continue; }
        }
        okCount++;
      } else if (a.action === 'add_item' || a.action === 'add_items') {
        // Sprint 31.16 (Mercado/Luciano 03/06) — TOLERANTE ao que o LLM naturalmente emite.
        // Antes só {list_id, description} único → LLM mandou `text`, `items[]`, `add_items`
        // → 4/4 rejeitados por nome/formato → o TOM confabulou. Agora: description|text|item;
        // items[] pra múltiplos; add_items alias; list_id por id OU prefixo (escopo dono).
        const listRef = typeof a.list_id === 'string' ? a.list_id.trim() : '';
        if (!listRef) { console.warn('[PersonalList] add_item: sem list_id'); failCount++; continue; }
        const { data: ownedLists } = await supabase
          .from('personal_checklists').select('id')
          .eq('owner_collab_id', collab.id).eq('is_active', true);
        const head = listRef.replace(/-/g, '').toLowerCase();
        const lm = (ownedLists || []).filter(l => String(l.id).replace(/-/g, '').toLowerCase().startsWith(head));
        if (lm.length !== 1) { console.warn(`[PersonalList] add_item: list_id "${listRef}" ${lm.length === 0 ? 'não encontrado/owned' : 'ambíguo'}`); failCount++; continue; }
        const listId = lm[0].id;
        let descs = Array.isArray(a.items) ? a.items
                  : Array.isArray(a.descriptions) ? a.descriptions
                  : [a.description ?? a.text ?? a.item];
        descs = descs.filter(d => typeof d === 'string' && d.trim()).map(d => d.trim().slice(0, 300));
        if (!descs.length) { console.warn('[PersonalList] add_item: sem descrição'); failCount++; continue; }
        const { data: maxRow } = await supabase
          .from('personal_checklist_items').select('sort_order')
          .eq('list_id', listId).order('sort_order', { ascending: false }).limit(1).maybeSingle();
        let nextOrder = (maxRow && maxRow.sort_order ? maxRow.sort_order : 0) + 1;
        const rows = descs.map(d => ({ list_id: listId, description: d, sort_order: nextOrder++ }));
        const { error } = await supabase.from('personal_checklist_items').insert(rows);
        if (error) { console.error('[PersonalList] add_item insert err:', error.message); failCount++; continue; }
        console.log(`[PersonalList] add_item: +${rows.length} item(s) na lista ${String(listId).slice(0, 8)}`);
        okCount++;
      } else if (a.action === 'toggle_item') {
        if (!a.item_id) { failCount++; continue; }
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
          const pc = require('./services/personalCompletions');
          // Âncora do CICLO (não "hoje"): paridade com o PWA — marcar lista mensal
          // fora do dia-alvo grava no ciclo corrente (caso Rose 09/06).
          const completion = await pc.ensurePersonalCompletion(pcList.id, collab.id, pc.cycleAnchor(pcList));
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
  return { okCount, failCount };
}

async function applyEventUpdates(collaborator, actions) {
  let okCount = 0, failCount = 0;
  let awaitingConfirm = false; // 02/07 — turno é pergunta/relato de participant-edit → o caller
                               // seta _metrics.awaiting_user_confirm (senão ACTIONABLE_NO_MARKER rebaixa)
  const failMessages = []; // F5 — perguntas/avisos da guarda temporal sobem pro caller
  const last4 = String(collaborator.phone || '').slice(-4);
  for (const a of actions) {
    try {
      // Sprint 31.15 — verbo de RSVP veio (erroneamente) como EVENT_UPDATE: roteia pro
      // applyRsvp (lookup global) em vez de resolveEventByShortId (owner-scoped, não acharia).
      if (RSVP_ALIASES.has(a.action)) {
        const r = await applyRsvp(collaborator, a.event_id || a.id, rsvpStatusFor(a.action, a.status));
        if (r.ok) okCount++; else failCount++;
        continue;
      }
      const ev = await resolveEventByShortId(collaborator.id, a.id);
      if (!ev) {
        console.warn(`[Event] ${a.action} REJECTED id=${a.id} (not owned by ${last4} or not found)`);
        failCount++;
        continue;
      }
      // BUG-1: participante só pode completar; cancel/reschedule/update são do dono
      if (ev.fromParticipant && a.action !== 'complete') {
        console.warn(`[Event] ${a.action} REJECTED — participante só pode completar, não ${a.action} id=${a.id}`);
        // EVENT-PARTICIPANT-GATE-MUDO (Alf 19/08): este gate rejeitava SEM failMessage e o
        // usuário recebia o genérico "_não consegui atualizar_" — soa como defeito técnico
        // quando a verdade é permissão. A mensagem nomeia o dono e oferece o recado (a
        // coordenação já existe; o "sim" segue o fluxo normal de COORDINATION_REQUEST).
        try {
          const { buildOwnerGateMessage } = require('./lib/event-owner-gate');
          let _ownerName = null;
          try {
            const { data: _own } = await supabase.from('collaborators')
              .select('preferred_name, full_name').eq('id', ev.collaborator_id).maybeSingle();
            _ownerName = (_own && (_own.preferred_name || _own.full_name)) || null;
          } catch (_) {}
          failMessages.push(buildOwnerGateMessage(a.action, ev.title, _ownerName));
          awaitingConfirm = true; // o turno vira pergunta (oferta de recado) → não é ACTIONABLE_NO_MARKER
        } catch (_) {}
        failCount++;
        continue;
      }
      // 02/07 — add/remove participantes: CONFIRM-FIRST. NÃO aplica aqui; resolve nomes,
      // planeja o diff idempotente e ABRE intent 'confirmation' (payload.participant_edit).
      // O executor determinístico roda só no "sim" (closing-interceptor). Espelha o guard de
      // complete-futuro: failCount++ + pergunta em failMessages (o caller mostra a pergunta e
      // descarta a prosa otimista do LLM). NUNCA diz "adicionei" antes do sim.
      if (a.action === 'add_participants' || a.action === 'remove_participants') {
        const op = a.action === 'add_participants' ? 'add' : 'remove';
        // O turno é 100% desta rede (pergunta de confirmação, relato de noop, ou erro honesto):
        // nunca é "ação sem marker" — suprime o ACTIONABLE_NO_MARKER que rebaixaria a pergunta.
        awaitingConfirm = true;
        try {
          const { resolveAttendees } = require('./lib/resolve-attendees');
          const { planParticipantEdit } = require('./lib/participant-edit');
          const { resolved, unresolved } = await resolveAttendees(
            a.names, (nm) => resolveCollaboratorByName(nm, { requester: collaborator })
          );
          const resolvedIds = resolved.map((r) => r.collaborator && r.collaborator.id).filter(Boolean);
          const nameById = new Map(resolved.map((r) => [
            r.collaborator && r.collaborator.id,
            (r.collaborator && (r.collaborator.preferred_name || r.collaborator.full_name)) || r.name,
          ]));
          const { data: existing } = await supabase.from('event_participants')
            .select('collaborator_id').eq('event_id', ev.id);
          const existingIds = (existing || []).map((x) => x.collaborator_id);
          const plan = planParticipantEdit({ op, resolvedIds, existingIds, organizerId: collaborator.id });
          const targetIds = op === 'add' ? plan.toAdd : plan.toRemove;
          if (!targetIds.length) {
            // nada real a fazer → reporta honesto (não-resolvido / noop / rejeitado), sem abrir confirm.
            const parts = [];
            if (unresolved.length) parts.push(`não achei: ${unresolved.join(', ')}`);
            if (plan.rejected.length) parts.push(op === 'remove' ? 'você é o organizador, não dá pra se remover' : 'você já é o dono do evento');
            if (plan.noops.length) parts.push(op === 'add' ? 'já estava(m) na lista' : 'não estava(m) na lista');
            failMessages.push(`Sobre *${ev.title}*: ${parts.join('; ') || 'nada a mudar'}.`);
            failCount++;
            continue;
          }
          const nomes = targetIds.map((id) => nameById.get(id) || 'alguém');
          const quando = ev.start_at ? new Date(ev.start_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '';
          const verbo = op === 'add' ? 'Adicionar' : 'Remover';
          const prep = op === 'add' ? 'à' : 'da';
          const tail = op === 'add' ? ' e enviar o convite' : '';
          const q = `${verbo} *${nomes.join(', ')}* ${prep} reunião *${ev.title}*${quando ? ` (${quando})` : ''}${tail}? Responde *sim* ou *não*.`;
          // SEM anchor.type='event' de propósito: isola do guard de complete-futuro (que chaveia
          // por anchor-id do evento) — um "sim" daqui nunca autoriza um complete. Consumer keia por
          // payload.participant_edit.
          await pendingIntents.openIntent(collaborator.id, 'confirmation',
            { participant_edit: { event_id: ev.id, op, ids: targetIds, names: nomes, title: ev.title } },
            q);
          failMessages.push(q);
          failCount++;
          console.log(`[Event] ${a.action} PROPOSTO id=${String(ev.id).slice(0, 8)} → ${targetIds.length} alvo(s), aguardando "sim"`);
          continue;
        } catch (peErr) {
          console.warn('[Event] participant-edit propose err (não-fatal):', peErr.message);
          failMessages.push(`Tive um problema pra ${op === 'add' ? 'adicionar' : 'remover'} participante(s) em *${ev.title}*. Tenta de novo?`);
          failCount++;
          continue;
        }
      }
      let patch = {};
      // Sprint 31.x — edição de lembrete do evento (reminders_minutes_before). É um array,
      // pode vir SOZINHO (sem metadados) e até vazio ([] = remover). Tratado fora do `patch`.
      const remindersEdit = (a.action === 'update' && Array.isArray(a.reminders_minutes_before));
      if (a.action === 'reschedule') {
        patch = { start_at: a.new_start_at, end_at: a.new_end_at };
        if (ev.status === 'cancelled') patch.status = 'scheduled';
      } else if (a.action === 'cancel') {
        patch = { status: 'cancelled' };
      } else if (a.action === 'complete') {
        // F5 (ALVO-FUTURO-RESPOSTA-CURTA): concluir evento de data FUTURA exige confirmação.
        // GUARD-CONFIRM-LOOP (Matheus 10/06): pergunta UMA vez por item por janela —
        // ver guarda de task (applyTaskUpdates) pro racional completo.
        if (isFutureCompletion({ startAt: ev.start_at })) {
          const askedRecentlyEv = await pendingIntents.wasAnchorAskedRecently(collaborator.id, ev.id, 20);
          if (!askedRecentlyEv) {
            const diaEv = ev.start_at
              ? new Date(ev.start_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
              : 'data futura';
            failMessages.push(`⚠️ *${ev.title}* está marcado pra *${diaEv}* (ainda não chegou). Confirma que já aconteceu mesmo assim?`);
            try {
              await pendingIntents.openIntent(collaborator.id, 'confirmation',
                { anchor: { type: 'event', id: ev.id, title: ev.title }, action: 'complete' },
                `⚠️ ${ev.title} está marcado pra ${diaEv} — confirma que já aconteceu?`);
            } catch (_) { /* best-effort */ }
            console.warn(`[Event] complete BLOQUEADO (start futura ${ev.start_at}) — pedindo confirmação id=${String(ev.id).slice(0, 8)}`);
            failCount++;
            continue;
          }
          console.log(`[Event] complete LIBERADO pós-confirmação (start futura ${ev.start_at}) id=${String(ev.id).slice(0, 8)}`);
          try { await pendingIntents.resolveAnchoredIntents(collaborator.id, ev.id, 'confirmed', 'guard pass-through (asked recently)'); } catch (_) { /* best-effort */ }
        }
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
        // MARKER-NO-EISENHOWER-FIELD (Alf 07/07) — "marca como importante" vira quadrant.
        const upQuad = Number(a.quadrant);
        if (Number.isInteger(upQuad) && upQuad >= 1 && upQuad <= 4) patch.eisenhower_quadrant = upQuad;
        // edição só-de-lembrete é válida mesmo sem metadados no patch.
        if (Object.keys(patch).length === 0 && !remindersEdit) { failCount++; continue; }
      }
      // events update só roda se há coluna a mudar (cancel/complete/reschedule sempre têm;
      // update só-de-lembrete tem patch vazio → pula a escrita em events, mexe só nos reminders).
      if (Object.keys(patch).length > 0) {
        // BUG-1: participante não é dono — filtrar só por id (owner já checado acima)
        let upQuery = supabase.from('events').update(patch).eq('id', ev.id);
        if (!ev.fromParticipant) upQuery = upQuery.eq('collaborator_id', collaborator.id);
        const { error } = await upQuery;
        if (error) {
          console.error(`[Event] ${a.action} err:`, error.message);
          failCount++;
          continue;
        }
      }
      console.log(`[Event] ${a.action} ${a.id} by ${last4}${a.action === 'reschedule' ? ` to ${a.new_start_at.slice(0, 16)}` : ''}`);
      okCount++;
      // #2D1 (EVENT-COMPLETE-MULTI-INSTANCE, caso Leo "Entre Teclas" 26+27) — ao COMPLETAR um
      // evento PASSADO, fecha junto os HOMÔNIMOS abertos do mesmo dono na janela ±3d (helper
      // puro, escopo apertado p/ não pegar recorrência semanal). Faz o "dá baixa nos dois"
      // acontecer DE VERDADE — e, com o #2D2, a contagem da prosa passa a bater (okCount sobe).
      if (a.action === 'complete' && !ev.fromParticipant && ev.start_at) {
        try {
          const { pickHomonymSiblingsToComplete } = require('./lib/event-homonyms');
          const baseMs = Date.parse(ev.start_at);
          const since = new Date(baseMs - 4 * 86400000).toISOString();
          const until = new Date(baseMs + 4 * 86400000).toISOString();
          const { data: cands } = await supabase
            .from('events')
            .select('id, title, status, start_at')
            .eq('collaborator_id', collaborator.id)
            .eq('title', ev.title)
            .gte('start_at', since).lte('start_at', until)
            .limit(20);
          const sibIds = pickHomonymSiblingsToComplete(ev, cands || [], Date.now());
          if (sibIds.length) {
            const { error: sibErr } = await supabase
              .from('events').update({ status: 'done' })
              .in('id', sibIds).eq('collaborator_id', collaborator.id);
            if (!sibErr) {
              okCount += sibIds.length;
              console.log(`[Event] complete fan-out: +${sibIds.length} homônimo(s) de "${ev.title}"`);
            } else {
              console.warn('[Event] homônimo fan-out update err:', sibErr.message);
            }
          }
        } catch (e) { console.warn('[Event] homônimo fan-out falhou (não-fatal):', e.message); }
      }
      // Sprint 31.12 — reschedule precisa MOVER os lembretes junto. Antes só mudava
      // start_at e os event_reminders velhos disparavam no horário antigo (caso
      // Matheus/Bia 03/06: evento foi pra segunda, lembrete tocou hoje).
      if (a.action === 'reschedule') {
        try {
          const { data: rems } = await supabase
            .from('event_reminders')
            .select('id, remind_at')
            .eq('event_id', ev.id)
            .is('sent_at', null);
          // EVENT-RESCHED-REMINDER-NOREGEN (28/06): além de deslocar os pendentes, GARANTE 1
          // lembrete default quando 0 pendente (a única row já tinha disparado antes do reschedule
          // → evento ficaria mudo). O firing é na tabela event_reminders, não na coluna remind_at.
          const { shifts, inserts } = planRescheduleReminders({
            unsentRows: rems || [], oldStartIso: ev.start_at, newStartIso: a.new_start_at, eventId: ev.id,
          });
          for (const s of shifts) {
            await supabase.from('event_reminders').update({ remind_at: s.remind_at }).eq('id', s.id);
          }
          if (inserts.length) {
            const { error: insErr } = await supabase.from('event_reminders').insert(inserts);
            if (insErr) console.error('[Event] reschedule ensure-pending insert err:', insErr.message);
          }
          if (shifts.length || inserts.length) console.log(`[Event] reschedule: ${shifts.length} deslocado(s) + ${inserts.length} default p/ ${String(ev.id).slice(0, 8)}`);
        } catch (e) {
          console.warn('[Event] reschedule reminders resync falhou (não-fatal):', e.message);
        }
      }
      // 02/07 — reschedule AVISA todos os convidados (invited+confirmed+tentative, exclui
      // declined e o próprio organizador). Via fila durável (anti-ban). Só o dono reagenda,
      // então isto só dispara quando ev tem participantes de verdade.
      if (a.action === 'reschedule') {
        // Fonte única com o caminho APP (endpoint /internal/event-rescheduled) — ver
        // src/services/event-reschedule-notify.js (audit John 17/08: reagendar no app não avisava).
        const { notifyEventReschedule } = require('./services/event-reschedule-notify');
        await notifyEventReschedule(supabase, { event: ev, actorId: collaborator.id, newStartIso: a.new_start_at });
      }
      // Sprint 31.x — edição de lembrete: substitui os event_reminders NÃO-ENVIADOS pelo
      // novo conjunto computado de reminders_minutes_before (relativo ao start_at atual).
      // [] = remover todos os pendentes. Os já enviados (sent_at != null) ficam como
      // histórico. Caso Rose/ADM 09/06: ajuste pra T-30/T-0 era rejeitado e sumia.
      if (remindersEdit) {
        try {
          await supabase.from('event_reminders').delete().eq('event_id', ev.id).is('sent_at', null);
          const rows = buildEventReminderRows(ev.id, ev.start_at, a.reminders_minutes_before);
          if (rows.length) {
            const { error: insErr } = await supabase.from('event_reminders').insert(rows);
            if (insErr) console.error('[Event] update reminders insert err:', insErr.message);
          }
          console.log(`[Event] update reminders ${a.id}: ${rows.length} lembrete(s) pendente(s) (substituídos)`);
        } catch (e) {
          console.warn('[Event] update reminders falhou (não-fatal):', e.message);
        }
      }
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
  return { okCount, failCount, failMessages, awaitingConfirm };
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
  // WEEKLY-PLAN-SCHEMA-DRIFT (Quintela 03/08): o planejamento é MULTI-TURNO e a skill que
  // documenta o schema sai do prompt antes de o marker ser emitido — às 19:24:29 a skill
  // carregada era `planejamento-semanal`, às 19:25:03 já era `criar-recorrencia`, e o marker
  // saiu às 19:25:21 com formato inventado ({days:{monday:…}}; na segunda tentativa,
  // {items:[{day,title}]}). Os dois foram rejeitados e o plano morreu em silêncio — e
  // `schema_invalid` não tem retry, o auto-retry do engine só cobre "não emitiu marker".
  // Normaliza o que dá pra aproveitar antes de validar; sem dado suficiente devolve o payload
  // original e a validação abaixo rejeita como sempre. Mesmo remédio que o MEMORY_SAVE
  // recebeu em 05/08 (extrairConteudoMemoria aceita sinônimos) — defesa de modelo, não
  // afrouxamento: o schema canônico continua sendo o único aceito daqui pra frente.
  try {
    const { normalizeWeeklyPlan } = require('./lib/weekly-plan-normalize');
    const norm = normalizeWeeklyPlan(plan);
    if (norm && norm !== plan) {
      console.log(`[WeeklyPlan] payload normalizado (${Object.keys(plan).join(',')} → goals+distribution)`);
      plan = norm;
    }
  } catch (e) { console.warn('[WeeklyPlan] normalize err:', e.message); }
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
  // SET variant: valida via validateDndWindow (compartilhado com applyDnd + rota do PREFS).
  const v = validateDndWindow(payload.until, payload.reason);
  if (!v.ok) {
    logSchemaErr('DND_SET', ['until:' + v.code], payload);
    return { malformed: true, cleanText };
  }
  if (v.capped) logSchemaErr('DND_SET', ['until:capped_to_24h'], payload);
  return { until: v.until, reason: v.reason, cleanText, malformed: false };
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
    if (a.action === 'mark_item') a.action = 'mark-item'; // canoniza underscore→hífen (checklist ativo)
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
  } else if (a.action === 'governance_reassign') {
    if (typeof a.id !== 'string' || !SHORT_ID_RE.test(a.id)) return 'bad_id';
    const hasName = typeof a.to_name === 'string' && a.to_name.trim();
    const hasPhone = typeof a.to_phone === 'string' && a.to_phone.trim();
    if (!hasName && !hasPhone) return 'recipient_missing';
  } else if (a.action === 'snooze_reminders') {
    // Snooze/silêncio de lembrete POR TAREFA (item #5 audit 15/06). Aceita id OU title
    // (resolução em applyTaskActions, igual reschedule). Exige not_before (piso ISO com
    // timezone) OU clear_all=true ("não me lembra mais dessa tarefa").
    const hasId = typeof a.id === 'string' && SHORT_ID_RE.test(a.id);
    const hasTitle = typeof a.title === 'string' && a.title.trim().length > 0;
    if (!hasId && !hasTitle) return 'bad_id';
    const clearAll = a.clear_all === true || a.clear_all === 'true';
    // Audit 08/07 (Matheus B): aceita until/snooze_until como alias de not_before (o LLM
    // erra o nome do campo). Mesma família dos aliases já tolerados no engine.
    const { snoozeNotBefore } = require('./utils/snooze-fields');
    if (!clearAll && !isValidRemindAt(snoozeNotBefore(a))) return 'snooze_needs_not_before_or_clear_all';
  } else if (a.action === 'return') {
    // Devolutiva avulsa (A2, 2026-07-02): retorno numa tarefa delegada, SEM concluir.
    // Aceita id OU title (resolvido no handler entre tarefas que executo/acompanho) + note.
    const hasId = typeof a.id === 'string' && SHORT_ID_RE.test(a.id);
    const hasTitle = typeof a.title === 'string' && a.title.trim().length > 0;
    if (!hasId && !hasTitle) return 'bad_id';
    if (typeof a.note !== 'string' || !a.note.trim()) return 'note_missing';
  } else if (a.action === 'mark-item') {
    // Checklist ativo (2026-06-28): marca/desmarca um sub-item (filha via parent_task_id).
    // Exige parent_id (short-id) + (item_id short-id OU item_title). done opcional (default true).
    // Resolução do item e posse (a mãe tem de ser do remetente) são feitas no handler.
    const hasParent = typeof a.parent_id === 'string' && SHORT_ID_RE.test(a.parent_id);
    if (!hasParent) return 'bad_parent_id';
    const hasItemId = typeof a.item_id === 'string' && SHORT_ID_RE.test(a.item_id);
    const hasItemTitle = typeof a.item_title === 'string' && a.item_title.trim().length > 0;
    if (!hasItemId && !hasItemTitle) return 'mark_item_needs_item';
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
  // PHONE-9DIGIT-LOOKUP (Vitória 24/06): casa com/sem o 9º dígito (JID BR varia).
  const { brPhoneVariants, digitsOnly } = require('./utils/phone');
  const variants = brPhoneVariants(phone);
  if (!variants.length) return null;
  const { data } = await supabase
    .from('collaborators')
    // Hotfix pós-Sprint20: idem findCollaboratorByName — campos completos.
    // Sprint 23.6: bio + preferred_name para system prompt.
    .select('id, full_name, phone, is_active, role, unit, onboarding_completed, pedagogical_role, function_role, function_title, bio, preferred_name, has_coord_permissions')
    .in('phone', variants);
  if (!data || !data.length) return null;
  if (data.length === 1) return data[0];
  // múltiplos (raro): prefere o match exato da forma recebida
  const exact = digitsOnly(phone);
  return data.find((c) => digitsOnly(c.phone) === exact) || data[0];
}

// Normaliza sinônimos coloquiais de departamento para group_key canônico da tabela governance_leaders.
// Retorna null se não reconhecer.
function normalizeGroupKey(name) {
  if (!name || typeof name !== 'string') return null;
  const n = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (/financ/.test(n)) return 'financeiro';
  if (/comerci/.test(n)) return 'comercial';
  if (/pedag/.test(n)) return 'pedagogico';
  if (/market/.test(n)) return 'marketing';
  if (/opera/.test(n)) return 'ops_tecnicas';
  if (/sucesso.*(cliente|aluno)|cs\b/.test(n)) return 'sucesso_cliente';
  if (/farmer/.test(n)) return 'farmer';
  return null;
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
    .select('id, title, status, due_date, assigned_to, assigned_group_id')
    .eq('assigned_to', collaboratorId)
    .or(`due_date.gte.${sinceIso},due_date.is.null`) // Item 2: inclui tarefas SEM prazo (null)
    .limit(500);
  if (error) {
    console.error('[Task] resolveTaskByShortId err:', error.message);
    return null;
  }
  // Grupos de trabalho (spec 2026-06-10): membro também gerencia tarefas do POOL
  // dos seus grupos via WhatsApp. Mesma defesa-em-profundidade: só grupos em que
  // o remetente é membro de verdade (work_group_members), nunca o id do marker.
  let rows = data || [];
  try {
    const gids = await workGroups.groupIdsOfCollaborator(supabase, collaboratorId);
    if (gids.length) {
      const { data: gTasks } = await supabase
        .from('tasks')
        .select('id, title, status, due_date, assigned_to, assigned_group_id')
        .in('assigned_group_id', gids)
        .or(`due_date.gte.${sinceIso},due_date.is.null`)
        .limit(200);
      const seen = new Set(rows.map((t) => t.id));
      for (const t of gTasks || []) if (!seen.has(t.id)) rows.push(t);
    }
  } catch (eG) { console.warn('[Task] group tasks fetch err (segue só pessoais):', eG.message); }
  if (!rows || rows.length === 0) return null;
  const matches = matchRowsByShortId(rows, shortId); // tolerante a UUID alucinado (Sprint 31.14)
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
const PREFS_BOOL_FIELDS = new Set(['notify_deadline_alerts', 'notify_overdue_alerts', 'notify_team_summary', 'quiet_weekends', 'briefing_enabled', 'closing_enabled']);
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
  let dnd = null; // PREFS-DND-ROUTE: do_not_disturb_until roteado pro DND (cap 24h via validateDndWindow)
  for (const [k, v] of Object.entries(parsed)) {
    if (PREFS_TIME_FIELDS.has(k)) {
      if (v === null && (k === 'briefing_time' || k === 'closing_time')) {
        // PREFS-NULL-FEITO-FALSO (caso Rose 10/06): null = DESLIGAR o ritual. Não
        // zera a coluna time (null lá = "usa default 07:00" pra quem nunca configurou);
        // vira flag *_enabled=false que o dispatcher respeita.
        update[k === 'briefing_time' ? 'briefing_enabled' : 'closing_enabled'] = false;
      } else if (typeof v === 'string' && HHMM_RE.test(v)) {
        update[k] = v.length === 5 ? v + ':00' : v;
        // Setar horário re-liga o ritual (a pessoa claramente quer recebê-lo).
        if (k === 'briefing_time') update.briefing_enabled = true;
        if (k === 'closing_time') update.closing_enabled = true;
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
    } else if (k === 'do_not_disturb_until') {
      // PREFS-DND-ROUTE (26/06, caso Jhonatan): o LLM às vezes emite do_not_disturb_until no
      // PREFS_UPDATE em vez do <<DND_SET>> dedicado. Antes era dropado → update vazio →
      // schema_invalid → confab "fico quieto". Agora ROTA pro DND COM a mesma validação
      // (validateDndWindow: futuro + cap 24h) — o cap impede o bug antigo "pausado até julho".
      const r = validateDndWindow(v, parsed.do_not_disturb_reason);
      if (r.ok) dnd = { until: r.until, reason: r.reason };
      else dropped.push(`${k}:${r.code}`);
    } else if (k === 'do_not_disturb_reason') {
      // consumido junto com do_not_disturb_until (acima) — não dropa sozinho nem é unknown_field
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
    } else if (k === 'task_checkin_times') {
      // Check-ins de tarefa por horário (array "HH:MM"). [] = DESLIGAR. Espelha quiet_days.
      // O usuário PODE desligar/ajustar pelo chat — NÃO é ritual fixo (PROJECT-PERM caso
      // Quintela 15/06: TOM dizia "não consigo desligar, vai no app", falso).
      if (Array.isArray(v) && v.every((s) => typeof s === 'string' && HHMM_RE.test(s))) {
        update.task_checkin_times = v.map((s) => (s.length === 5 ? s + ':00' : s));
      } else dropped.push(`${k}:bad_time_array`);
    } else if (k === 'reminder_lead') {
      // #antecedencia (Fabi 29/06): antecedência de lembrete de tarefa com prazo.
      // same_day = só no dia; eve_and_day = véspera + dia (padrão); daily = todos os dias.
      // O usuário PODE configurar pelo chat ("me lembra só no dia") — não é ritual fixo.
      if (['same_day', 'eve_and_day', 'daily'].includes(v)) update.reminder_lead = v;
      else dropped.push(`${k}:invalid`);
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
  if (Object.keys(update).length === 0 && !dnd) return { malformed: true, cleanText };
  return { update, dnd, cleanText, malformed: false };
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

async function applyTaskActions(collaborator, actions, opts = {}) {
  let okCount = 0;
  let failCount = 0;
  let integrityPayload = null; // Sprint 31 — acumula o 1º soft-dup sem abortar o lote
  // Sprint 31.6 (E2) — mensagens claras de falha pro user (ex: tarefa de outro dono).
  // Quando preenchido, o caller usa no lugar do genérico "não consegui registrar".
  const failMessages = [];
  // Avisos de sucesso de grupos (cascata) — anexados à resposta no caminho de SUCESSO.
  const groupNotices = [];
  // FATIA 6 (#1): horários de lembrete das tarefas CRIADAS neste lote (remind_at one-shot +
  // reminders_at). O caller anexa "🔔 Lembro às HHh" quando a fala do TOM omite a hora.
  const createdReminderTimes = [];
  const last4 = String(collaborator.phone || '').slice(-4);
  // Guardrail anti-bomba (BULK-RECUR): se o lote tem >10 creates de título
  // idêntico, bloqueia esse grupo e orienta o caminho recorrente. Backstop
  // independente da skill (mesmo se o LLM ignorar a orientação).
  {
    const { allowed, blocked } = splitBulkIdenticalCreates(actions, 10);
    if (blocked.length > 0) {
      const exemplo = (blocked[0].title || '').trim().slice(0, 60);
      console.warn(`[Task] BULK_CREATE_BLOCKED — ${blocked.length} creates idênticos "${exemplo}" (collab ${last4})`);
      try {
        await logMarker(collaborator.id, 'BULK_CREATE_BLOCKED', 'rejected',
          `count=${blocked.length} title=${exemplo}`, null);
      } catch (_) { /* não-fatal */ }
      failMessages.push(
        `Isso parece uma rotina que se repete ("${exemplo}"). Em vez de criar ${blocked.length} tarefas iguais, melhor 1 tarefa recorrente com lembretes nos horários. Quer que eu monte assim?`
      );
      actions = allowed;
    }
  }

  // A2 (CLOSING-INTERCEPTOR-OVERCAPTURE / caso Leo): complete em LOTE (2+) onde o usuário
  // NÃO citou nenhuma das tarefas = provável sequestro pelo contexto de briefing (o LLM
  // "fecha" atrasadas salientes em vez de tratar o pedido real). Confirma antes de fechar,
  // usando a MESMA plumbing do guard de data-futura (failMessages + failCount). Só roda no
  // caminho de mensagem do usuário (opts.inboundText presente); AUTO_RETRY não passa → pula.
  if (opts && opts.inboundText) {
    try {
      const { batchCompleteNeedsConfirm, formatBatchTitles } = require('./utils/closing-reply');
      const completes = actions.filter((a) => a && a.action === 'complete');
      if (completes.length >= 2) {
        const titles = [];
        for (const c of completes) {
          if (c.title) { titles.push(c.title); continue; }
          const tt = await resolveTaskByShortId(collaborator.id, c.id).catch(() => null);
          if (tt && tt.title) titles.push(tt.title);
        }
        if (batchCompleteNeedsConfirm({ completedTitles: titles, inboundText: opts.inboundText })) {
          // Agrupa títulos repetidos ("X (3×)") — instâncias de recorrência têm o mesmo nome
          // e a lista virava "X, Y, Z, Y, X, Y" (BATCH-CONFIRM-DUP-TITLES, caso Arthur 01/08).
          const lista = formatBatchTitles(titles);
          const plural = titles.length > 1;
          // BATCH-CONFIRM-MSG-CONTRADIZ (Rose/2088 28/06): a msg antiga dizia "Não vi você citar
          // elas na mensagem" enquanto LISTAVA os nomes — contradição que confundia. Pergunta limpa.
          failMessages.push(`Confirma o fechamento ${plural ? `destas ${titles.length} tarefas` : 'desta tarefa'}: ${lista}?`);
          try {
            await pendingIntents.openIntent(collaborator.id, 'confirmation',
              { batch_complete: completes.map((c) => c.id).filter(Boolean) },
              `Confirmar fechamento em lote: ${lista}?`);
          } catch (_) { /* intent best-effort */ }
          actions = actions.filter((a) => !(a && a.action === 'complete'));
          failCount += completes.length;
          console.warn(`[Task] A2 batch-complete nao-ancorado (${titles.length}) -> pediu confirmacao, removido do lote`);
        }
      }
    } catch (e) { console.warn('[Task] A2 guard err:', e.message); }
  }

  for (const a of actions) {
    if (!a || typeof a.action !== 'string') {
      failCount++;
      continue;
    }
    try {
      if (a.action === 'complete') {
        // Sprint 31 — title-lookup (mesmo padrão de reschedule)
        if (!a.id && a.title) {
          // Fatia A do alvo de tarefa: "conclui a Presença Emusys" marcava a instância de
          // SETEMBRO como feita e deixava a de agosto, atrasada, aberta — e o TOM ainda
          // afirmava "✅ concluí". O `.limit(1)` por `created_at desc` fingia certeza onde
          // havia várias instâncias da mesma série. Escopo deste handler é SÓ o responsável
          // (`assigned_to`), diferente do reschedule — preservado de propósito.
          const _SERIE_ON_C = process.env.TOM_TASK_TARGET_SERIES === '1';
          const _qC = supabase
            .from('tasks')
            .select('id, title, due_date, recurrence_rule, recurrence_parent_id, created_at')
            .eq('assigned_to', collaborator.id)
            .ilike('title', `%${String(a.title).slice(0, 60)}%`)
            .not('status', 'in', '("done","cancelled")');
          const { data: _candsC } = _SERIE_ON_C
            ? await _qC.order('due_date', { ascending: true, nullsFirst: false }).limit(100)
            : await _qC.order('created_at', { ascending: false }).limit(1);
          if (_SERIE_ON_C && _candsC && _candsC.length === 100) {
            console.warn(`[TaskTarget] cap atingido handler=complete pedido="${String(a.title).slice(0, 60)}"`);
          }
          let byTitleC = null;
          if (!_SERIE_ON_C) {
            byTitleC = (_candsC && _candsC[0]) || null;
          } else {
            const _rC = resolveTaskTarget({ candidatos: _candsC || [] });
            if (_rC.modo === 'exato') {
              byTitleC = _rC.tarefa;
              if (_rC.motivo === 'serie') console.log(`[TaskTarget] serie handler=complete n=${(_candsC || []).length} → ${String(byTitleC.id).slice(0, 8)} due=${byTitleC.due_date}`);
            } else if (_rC.modo === 'ambiguo') {
              await _logAlvoAmbiguo('complete', a.title, collaborator.id, _rC.candidatos);
              byTitleC = _rC.candidatos.slice().sort((x, y) => (Date.parse(y.created_at) || 0) - (Date.parse(x.created_at) || 0))[0] || null;
            }
          }
          if (byTitleC) {
            a.id = byTitleC.id.replace(/-/g, '').slice(0, 8);
            console.log(`[Task] complete title-lookup: "${a.title}" → id=${a.id}`);
          } else {
            // FALLBACK FUZZY (audit 27/07 dor #1; Dai 17/08 "registrei 1 de 4"): o substring
            // `.ilike('%titulo%')` acima falha quando o TOM ABREVIA/reordena o título (as palavras
            // não ficam contíguas). Aqui buscamos o pool ABERTO do usuário e resolvemos por
            // SOBREPOSIÇÃO DE TOKENS — SÓ aceita match ÚNICO; ≥2 candidatos → pergunta (guard contra
            // os 60% de títulos duplicados: 6× "Reunião ADM" do Marcos vira pergunta, não chute).
            // Exclui molde recorrente (recurrence_rule) — fechar o molde mata a série.
            try {
              const { resolveByTitleFuzzy } = require('./lib/task-title-resolver');
              const { data: _poolF } = await supabase
                .from('tasks').select('id, title')
                .eq('assigned_to', collaborator.id)
                .is('recurrence_rule', null)
                .not('status', 'in', '("done","cancelled")')
                .order('created_at', { ascending: false }).limit(200);
              const _rf = resolveByTitleFuzzy(a.title, _poolF || []);
              if (_rf.match) {
                a.id = _rf.match.id.replace(/-/g, '').slice(0, 8);
                console.log(`[Task] complete FUZZY-lookup: "${a.title}" → "${_rf.match.title}" id=${a.id}`);
                try { await logMarker(collaborator.id, 'TASK_TARGET_FUZZY', 'executed', `handler=complete pedido="${String(a.title).slice(0, 60)}" alvo="${String(_rf.match.title).slice(0, 60)}"`, null); } catch (_) { /* best-effort */ }
              } else if (_rf.ambiguous) {
                const _lista = _rf.scored.filter((s) => s.contain >= 1).slice(0, 4).map((s) => `• *${s.c.title}*`).join('\n');
                failMessages.push(`Achei mais de uma tarefa que combina com _"${String(a.title).slice(0, 60)}"_ — qual delas?\n${_lista}`);
                try { await logMarker(collaborator.id, 'TASK_TARGET_FUZZY', 'skipped', `handler=complete AMBIGUO pedido="${String(a.title).slice(0, 60)}" n=${_rf.scored.filter((s) => s.contain >= 1).length}`, null); } catch (_) { /* best-effort */ }
                console.warn(`[Task] complete FUZZY ambiguo: "${a.title}" (${_rf.scored.filter((s) => s.contain >= 1).length} candidatos)`);
                failCount++;
                continue;
              }
            } catch (_e) { console.warn('[Task] complete fuzzy fallback err:', _e.message); }
          }
          if (!a.id) {
            // TASK-COMPLETE-ALVO-NAO-ACHADO (Clayton 11/08, Mayra 11/08): sair daqui sem
            // failMessage joga o caller no genérico "me manda de novo" (engine.js:11054) — que
            // é beco quando a tarefa é de outra pessoa, porque este handler casa só por
            // `assigned_to`. Mesma cortesia que reschedule (E2) e snooze já tinham.
            let _donoNome = null;
            try {
              const { data: _outra } = await supabase
                .from('tasks').select('assigned_to')
                .ilike('title', `%${String(a.title).slice(0, 60)}%`)
                .not('status', 'in', '("done","cancelled")')
                .order('created_at', { ascending: false }).limit(1).maybeSingle();
              if (_outra && _outra.assigned_to && _outra.assigned_to !== collaborator.id) {
                const { data: _ow } = await supabase
                  .from('collaborators').select('full_name').eq('id', _outra.assigned_to).maybeSingle();
                _donoNome = (_ow && _ow.full_name) || null;
              }
            } catch (e) { console.warn('[Task] complete dono-lookup err:', e.message); }
            const { mensagemAlvoNaoAchado } = require('./lib/task-complete-alvo-nao-achado');
            failMessages.push(mensagemAlvoNaoAchado(a.title, _donoNome));
            console.warn(`[Task] complete title-lookup failed: "${a.title}" not found for ${last4} (dono=${_donoNome || '-'})`);
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
          .from('tasks').select('id, title, created_by, assigned_to, due_date')
          .eq('id', t.id).maybeSingle();
        // F5 (ALVO-FUTURO-RESPOSTA-CURTA): completar tarefa datada NO FUTURO exige
        // confirmação — Incidente C (Ana): "Reunião ok tbm" fechou a Reunião ADM de AMANHÃ.
        // Abre intent ANCORADA: o "sim" seguinte completa direto o id certo (sem LLM).
        // GUARD-CONFIRM-LOOP (Matheus 10/06): pergunta UMA vez por item por janela.
        // Se já perguntamos sobre ESTE item há <20min (e não houve "não"), o complete
        // novo é a própria confirmação do usuário — deixa passar em vez de re-perguntar.
        if (fullTask && isFutureCompletion({ dueDate: fullTask.due_date })) {
          const askedRecently = await pendingIntents.wasAnchorAskedRecently(collaborator.id, fullTask.id, 20);
          if (!askedRecently) {
            const diaT = String(fullTask.due_date).slice(0, 10).split('-').reverse().slice(0, 2).join('/');
            failMessages.push(`⚠️ *${fullTask.title}* está marcado pra *${diaT}* (ainda não chegou). Confirma que já foi feito mesmo assim?`);
            try {
              await pendingIntents.openIntent(collaborator.id, 'confirmation',
                { anchor: { type: 'task', id: fullTask.id, title: fullTask.title }, action: 'complete' },
                `⚠️ ${fullTask.title} está marcado pra ${diaT} — confirma que já foi feito?`);
            } catch (_) { /* intent é best-effort */ }
            console.warn(`[Task] complete BLOQUEADO (due futura ${fullTask.due_date}) — pedindo confirmação id=${String(fullTask.id).slice(0, 8)}`);
            failCount++;
            continue;
          }
          console.log(`[Task] complete LIBERADO pós-confirmação (due futura ${fullTask.due_date}) id=${String(fullTask.id).slice(0, 8)}`);
          try { await pendingIntents.resolveAnchoredIntents(collaborator.id, fullTask.id, 'confirmed', 'guard pass-through (asked recently)'); } catch (_) { /* best-effort */ }
        }
        let error = null;
        if (t.assigned_group_id) {
          // Tarefa de GRUPO (spec 2026-06-10): membro conclui (resolveTaskByShortId já
          // validou a filiação). Anti-corrida Rose×Ana: só completa se ainda não está
          // done; 0 rows = outra pessoa fechou antes → avisa em vez de fingir sucesso.
          const rG = await supabase
            .from('tasks')
            .update({ status: 'done', completed_at: new Date().toISOString(), completed_by: collaborator.id })
            .eq('id', t.id)
            .eq('assigned_group_id', t.assigned_group_id)
            .neq('status', 'done')
            .select('id');
          error = rG.error;
          if (!error && (!rG.data || rG.data.length === 0)) {
            let quem = 'alguém do grupo';
            try {
              const { data: cur } = await supabase.from('tasks').select('completed_by').eq('id', t.id).maybeSingle();
              if (cur && cur.completed_by) {
                const { data: cb } = await supabase.from('collaborators').select('full_name').eq('id', cur.completed_by).maybeSingle();
                if (cb && cb.full_name) quem = cb.full_name.split(' ')[0];
              }
            } catch (_) { /* nome é cosmético */ }
            failMessages.push(`✋ *${t.title}* já tinha sido concluída por *${quem}* — tá fechada, não precisou de novo.`);
            console.log(`[Task][Group] complete RACE id=${a.id} — já done (by=${quem})`);
            failCount++;
            continue;
          }
        } else {
          const { updateAffected } = require('./utils/task-update-result');
          const rP = await supabase
            .from('tasks')
            .update({
              status: 'done',
              completed_at: new Date().toISOString(),
              completed_by: collaborator.id,
            })
            .eq('id', t.id)
            .eq('assigned_to', collaborator.id)
            .select('id');
          error = rP.error;
          // Balde A (audit 19/06): anti-"concluí mentiroso". 0 linhas afetadas (id não bate,
          // assigned_to divergente, drift de collaborator.id) NÃO é sucesso — antes o engine
          // dizia "concluí!" com a tarefa ainda pending (caso Fabi). Reporta honesto.
          if (!error && !updateAffected(rP)) {
            failMessages.push(`Não consegui fechar *${t.title}* — pode ter mudado de responsável ou de lugar. Me confirma qual era?`);
            console.warn(`[Task] complete NO-OP id=${a.id} by ${last4} — 0 linhas afetadas`);
            failCount++;
            continue;
          }
        }
        if (error) {
          console.error('[Task] complete err:', error.message);
          failCount++;
        } else {
          console.log(`[Task] complete ${a.id} by ${last4}`);
          // Grupo: avisa criador e demais membros do fechamento (com histórico —
          // lição RSVP-HISTORY-MISSING).
          if (t.assigned_group_id) {
            try {
              const { data: gRow } = await supabase.from('work_groups').select('name').eq('id', t.assigned_group_id).maybeSingle();
              const { data: mems } = await supabase
                .from('work_group_members')
                .select('collaborator_id, collaborator:collaborators!work_group_members_collaborator_id_fkey(full_name, phone, is_active)')
                .eq('group_id', t.assigned_group_id);
              const quemFez = (collaborator.full_name || 'alguém').split(' ')[0];
              const msgC = `✅ *${t.title}* (grupo *${gRow ? gRow.name : 'de trabalho'}*) — concluída por *${quemFez}*.`;
              const targets = new Map();
              for (const m of mems || []) {
                if (m.collaborator_id !== collaborator.id && m.collaborator && m.collaborator.phone && m.collaborator.is_active !== false) {
                  targets.set(m.collaborator_id, m.collaborator.phone);
                }
              }
              if (fullTask && fullTask.created_by && fullTask.created_by !== collaborator.id && !targets.has(fullTask.created_by)) {
                const { data: cb } = await supabase.from('collaborators').select('phone').eq('id', fullTask.created_by).maybeSingle();
                if (cb && cb.phone) targets.set(fullTask.created_by, cb.phone);
              }
              for (const [cid, ph] of targets) {
                await whatsapp.sendMessage(ph, msgC);
                await supabase.from('conversation_history').insert({
                  collaborator_id: cid, direction: 'outbound', message_type: 'text', content: msgC,
                });
              }
            } catch (eGC) { console.warn('[Task][Group] notify complete err:', eGC.message); }
          }
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
          // Volta da delegação (2026-07-02): conclusão pelo zap avisa delegador + em-cópia + devolutiva opcional (a.note).
          await taskReturn.saveReturnComment({ supabase, taskId: t.id, authorId: collaborator.id, note: a.note });
          await taskReturn.notifyTaskReturn({ supabase, whatsapp, taskId: t.id, actorId: collaborator.id, kind: 'completion', note: a.note ?? null });
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
          // Task 13 — Grupos: se era a última filha aberta, conclui a mãe (paridade com PWA).
          try {
            const tg = require('./services/task-groups');
            const cascade = await tg.maybeCompleteParentGroup(t.id);
            if (cascade.groupCompleted && cascade.groupTitle) {
              console.log(`[Task] cascade group complete → "${cascade.groupTitle}" (via complete ${a.id})`);
              groupNotices.push(`🎉 Com essa, o grupo *${cascade.groupTitle}* fechou completo!`);
            }
          } catch (e) { /* não-fatal */ }
          okCount++;
        }
      } else if (a.action === 'return') {
        // Volta da delegação (A2, 2026-07-02): devolutiva avulsa pelo zap. Executor OU
        // em-cópia manda um retorno → chega pra quem delegou + o círculo (menos o autor).
        // NÃO conclui. Espelha o botão "Deixar devolutiva" do app. O pool só tem tarefas
        // que EU executo ou acompanho → estar no pool já É a autorização (executor|watcher).
        // Anti-confab: se não achar / não for delegada, NÃO finge que mandou.
        const rnote = String(a.note || '').trim();
        if (!rnote) { failCount++; continue; }
        const { data: mineOpen } = await supabase
          .from('tasks').select('id, title, assigned_to')
          .eq('assigned_to', collaborator.id)
          .not('status', 'in', '("done","cancelled")').limit(500);
        const { data: wRows } = await supabase
          .from('task_watchers').select('task_id').eq('collaborator_id', collaborator.id);
        const rWatchedIds = (wRows || []).map((w) => w.task_id).filter(Boolean);
        let rWatchedOpen = [];
        if (rWatchedIds.length) {
          const { data: wt } = await supabase
            .from('tasks').select('id, title, assigned_to')
            .in('id', rWatchedIds)
            .not('status', 'in', '("done","cancelled")').limit(500);
          rWatchedOpen = wt || [];
        }
        const rPool = new Map();
        for (const rt of [...(mineOpen || []), ...rWatchedOpen]) rPool.set(rt.id, rt);
        let rTarget = null;
        if (a.id && SHORT_ID_RE.test(a.id)) {
          const rPref = String(a.id).replace(/-/g, '').toLowerCase();
          for (const rt of rPool.values()) {
            if (String(rt.id).replace(/-/g, '').toLowerCase().startsWith(rPref)) { rTarget = rt; break; }
          }
        }
        if (!rTarget && typeof a.title === 'string' && a.title.trim()) {
          const rQ = a.title.trim().toLowerCase().slice(0, 60);
          for (const rt of rPool.values()) {
            if (String(rt.title || '').toLowerCase().includes(rQ)) { rTarget = rt; break; }
          }
        }
        if (!rTarget) {
          failMessages.push('Não achei uma tarefa delegada (tua ou em cópia) pra deixar a devolutiva. Me diz qual é?');
          console.warn(`[Task] return: task não resolvida id=${a.id || '-'} title="${a.title || ''}" for ${last4}`);
          failCount++;
          continue;
        }
        await taskReturn.saveReturnComment({ supabase, taskId: rTarget.id, authorId: collaborator.id, note: rnote });
        const rRet = await taskReturn.notifyTaskReturn({ supabase, whatsapp, taskId: rTarget.id, actorId: collaborator.id, kind: 'return', note: rnote });
        if (rRet && rRet.sent > 0) {
          console.log(`[Task] return OK task=${String(rTarget.id).slice(0, 8)} by ${last4} sent=${rRet.sent}`);
          okCount++;
        } else {
          failMessages.push(`Não consegui repassar a devolutiva de *${rTarget.title}* — isso só vale em tarefa delegada (responsável e quem delegou diferentes).`);
          console.warn(`[Task] return NO-OP task=${String(rTarget.id).slice(0, 8)} by ${last4}`);
          failCount++;
        }
      } else if (a.action === 'cancel') {
        // Sprint 31 — handler cancel (title-lookup igual complete/reschedule)
        if (!a.id && a.title) {
          // Terceira porta do mesmo defeito. Deixar 1 dos 3 handlers sem a regra é a armadilha
          // recorrente da casa: regra presente em N leitores e ausente no N+1.
          const _SERIE_ON_X = process.env.TOM_TASK_TARGET_SERIES === '1';
          const _qX = supabase
            .from('tasks')
            .select('id, title, due_date, recurrence_rule, recurrence_parent_id, created_at')
            .eq('assigned_to', collaborator.id)
            .ilike('title', `%${String(a.title).slice(0, 60)}%`)
            .not('status', 'in', '("done","cancelled")');
          const { data: _candsX } = _SERIE_ON_X
            ? await _qX.order('due_date', { ascending: true, nullsFirst: false }).limit(100)
            : await _qX.order('created_at', { ascending: false }).limit(1);
          if (_SERIE_ON_X && _candsX && _candsX.length === 100) {
            console.warn(`[TaskTarget] cap atingido handler=cancel pedido="${String(a.title).slice(0, 60)}"`);
          }
          let byTitleCan = null;
          if (!_SERIE_ON_X) {
            byTitleCan = (_candsX && _candsX[0]) || null;
          } else {
            const _rX = resolveTaskTarget({ candidatos: _candsX || [] });
            if (_rX.modo === 'exato') {
              byTitleCan = _rX.tarefa;
              if (_rX.motivo === 'serie') console.log(`[TaskTarget] serie handler=cancel n=${(_candsX || []).length} → ${String(byTitleCan.id).slice(0, 8)} due=${byTitleCan.due_date}`);
            } else if (_rX.modo === 'ambiguo') {
              await _logAlvoAmbiguo('cancel', a.title, collaborator.id, _rX.candidatos);
              byTitleCan = _rX.candidatos.slice().sort((x, y) => (Date.parse(y.created_at) || 0) - (Date.parse(x.created_at) || 0))[0] || null;
            }
          }
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
          .from('tasks').select('id, title, created_by, assigned_to, recurrence_rule, recurrence_parent_id')
          .eq('id', tCan.id).maybeSingle();
        // Balde A (audit 19/06): encerrar a SÉRIE quando o user diz "para de me lembrar /
        // encerra isso / não preciso mais" (a skill emite scope:"series"). Fecha o molde +
        // cancela instâncias FUTURAS pendentes — comportamento normal a pedido do usuário
        // (NÃO é limpeza de backlog/Balde B). Sem scope = cancela só esta tarefa (default).
        if (a.scope === 'series' && fullTaskCan) {
          const templateId = fullTaskCan.recurrence_rule != null
            ? fullTaskCan.id
            : fullTaskCan.recurrence_parent_id;
          if (templateId) {
            const ownerId = fullTaskCan.assigned_to || collaborator.id;
            try {
              // FATIA 2: encerrar série = setar series_ended_at (o que de fato PARA a série
              // pós-flip; o guard novo ignora status) + cancelar ocorrência aberta + futuras.
              // Extraído p/ recurrence-engine.endSeries1on1 (testável + acoplado ao flip).
              const { endSeries1on1 } = require('./services/recurrence-engine');
              const rSer = await endSeries1on1({ supabase, templateId, ownerId });
              console.log(`[Task] cancel SERIES template=${String(templateId).slice(0, 8)} → ${rSer.cancelled} linha(s) + series_ended_at by ${last4}`);
            } catch (eSer) { console.warn('[Task] cancel SERIES err:', eSer.message); }
          }
        }
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
          // FATIA A: busca TODOS os candidatos (o `.limit(1)` escondia a pluralidade) e deixa a
          // decisão para o módulo puro. O `ilike` fica — o bug é o limit(1) fingindo certeza,
          // não o LIKE, que é o que dá recall para fala humana incompleta.
          const _SERIE_ON = process.env.TOM_TASK_TARGET_SERIES === '1';
          const _q = supabase
            .from('tasks')
            .select('id, title, status, due_date, assigned_to, created_by, recurrence_rule, recurrence_parent_id, created_at')
            .or(`assigned_to.eq.${collaborator.id},created_by.eq.${collaborator.id}`)
            .ilike('title', `%${String(a.title).slice(0, 60)}%`)
            .not('status', 'in', '("done","cancelled")');
          const { data: _cands } = _SERIE_ON
            ? await _q.order('due_date', { ascending: true, nullsFirst: false }).limit(100)
            : await _q.order('created_at', { ascending: false }).limit(1);
          if (_SERIE_ON && _cands && _cands.length === 100) {
            console.warn(`[TaskTarget] cap atingido handler=reschedule pedido="${String(a.title).slice(0, 60)}" — teto silencioso vira falso-verde`);
          }
          let byTitle = null;
          if (!_SERIE_ON) {
            byTitle = (_cands && _cands[0]) || null;
          } else {
            const _r = resolveTaskTarget({ candidatos: _cands || [] });
            if (_r.modo === 'exato') {
              byTitle = _r.tarefa;
              if (_r.motivo === 'serie') console.log(`[TaskTarget] serie handler=reschedule n=${(_cands || []).length} → ${String(byTitle.id).slice(0, 8)} due=${byTitle.due_date}`);
            } else if (_r.modo === 'ambiguo') {
              // Fatia A não resolve ambiguidade real: mantém o legado e registra.
              await _logAlvoAmbiguo('reschedule', a.title, collaborator.id, _r.candidatos);
              byTitle = _r.candidatos.slice().sort((x, y) => (Date.parse(y.created_at) || 0) - (Date.parse(x.created_at) || 0))[0] || null;
            }
          }
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
        // REPLAY-LAB-WEEKDAY-GUARD (06/08, cenario-piso rep 5): o LLM respondeu
        // "sábado (08/08)", mas o marker veio com new_due_date=2026-08-09. Antes o
        // executor aceitava o marker e criava confabulação: fala uma data, grava outra.
        // Se a fala real nomeia UM dia da semana sem data numérica, o executor resolve
        // determinístico em BRT e corrige o marker antes de tocar no banco.
        if (opts && opts.inboundText && a.new_due_date) {
          const resolvedWeekdayDate = resolveExplicitWeekdayDate(opts.inboundText, { baseYmd: todayYmdSP() });
          if (resolvedWeekdayDate && a.new_due_date !== resolvedWeekdayDate) {
            const originalDueDate = a.new_due_date;
            a.new_due_date = resolvedWeekdayDate;
            console.warn(`[Task] reschedule weekday override: marker=${originalDueDate} inbound=${resolvedWeekdayDate}`);
            try {
              await logMarker(collaborator.id, 'TASK_DATE_AUTO_ALIGNED', 'executed',
                `weekday_override ${originalDueDate}->${resolvedWeekdayDate}`, null);
            } catch (e) { /* não-fatal */ }
          }
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
        // Sprint 31.13 (Yuri/Kinho 30/05) — reschedule SÓ com new_due_date (sem lembrete
        // novo no marker): o remind_at antigo ficava congelado no passado. O cron disparava
        // no horário velho e marcava a task como done (one-shot). Espelha RESCHED-REMINDER
        // dos events: desloca o remind_at pelo delta de dias do due_date e re-arma o
        // reminded_at pra ele poder tocar no horário novo.
        if (update.due_date && !update.remind_at) {
          const { data: cur } = await supabase
            .from('tasks').select('due_date, remind_at').eq('id', t.id).maybeSingle();
          if (cur && cur.remind_at) {
            const shifted = shiftTaskRemindAt(cur.due_date, update.due_date, cur.remind_at);
            if (shifted) {
              update.remind_at = shifted;
              update.reminded_at = null; // re-arma o lembrete no horário deslocado
            }
          }
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
      } else if (a.action === 'snooze_reminders') {
        // SNOOZE/silêncio de lembrete POR TAREFA (item #5 audit 15/06, caso Jereh).
        // NÃO altera prazo nem conclui a tarefa — só reorganiza os lembretes.
        let t = null;
        if (!a.id && a.title) {
          const like = `%${String(a.title).slice(0, 60)}%`;
          // (a) tarefa onde o remetente é assignee ou criador (igual reschedule)
          const { data: own } = await supabase
            .from('tasks')
            .select('id, title, status, assigned_to, created_by, assigned_group_id')
            .or(`assigned_to.eq.${collaborator.id},created_by.eq.${collaborator.id}`)
            .ilike('title', like)
            .not('status', 'in', '("done","cancelled")')
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (own) {
            t = own;
          } else {
            // (b) tarefa de GRUPO do qual o remetente é membro (decisão 19/06: snooze de
            //     grupo vale pra todos — a grade é compartilhada). groupIdsOfCollaborator
            //     restringe à membership, então é a própria autorização.
            const wg = require('./services/work-groups');
            const gids = await wg.groupIdsOfCollaborator(supabase, collaborator.id);
            if (gids && gids.length) {
              const { data: grp } = await supabase
                .from('tasks')
                .select('id, title, status, assigned_to, created_by, assigned_group_id')
                .in('assigned_group_id', gids)
                .ilike('title', like)
                .not('status', 'in', '("done","cancelled")')
                .order('created_at', { ascending: false }).limit(1).maybeSingle();
              if (grp) t = grp;
            }
          }
          if (t) {
            a.id = t.id.replace(/-/g, '').slice(0, 8);
          } else {
            console.warn(`[Task] snooze title-lookup failed: "${a.title}" not found for ${last4}`);
            failMessages.push(`Não achei a tarefa _"${String(a.title).slice(0, 60)}"_ pra ajustar os lembretes. Me diz o nome certinho?`);
            failCount++;
            continue;
          }
        } else {
          t = await resolveTaskByShortId(collaborator.id, a.id);
        }
        if (!t) {
          console.warn(`[Task] snooze REJECTED id=${a.id} (not owned by ${last4} or not found)`);
          failCount++;
          continue;
        }
        // Dados frescos do one-shot da própria task + grade pendente.
        const { data: curSnz } = await supabase
          .from('tasks').select('remind_at, reminded_at').eq('id', t.id).maybeSingle();
        const { data: pendSnz } = await supabase
          .from('task_reminders').select('id, remind_at, label').eq('task_id', t.id).is('sent_at', null);
        const clearAllSnz = a.clear_all === true || a.clear_all === 'true';
        // Audit 08/07 (Matheus B): until/snooze_until como alias de not_before.
        const { snoozeNotBefore } = require('./utils/snooze-fields');
        const notBeforeSnz = snoozeNotBefore(a) || null;
        const planSnz = planReminderFloor({
          pendingRows: pendSnz || [],
          taskRemindAt: curSnz ? curSnz.remind_at : null,
          taskRemindedAt: curSnz ? curSnz.reminded_at : null,
          notBefore: notBeforeSnz,
          clearAll: clearAllSnz,
          nowMs: Date.now(),
        });
        const nowIsoSnz = new Date().toISOString();
        if (planSnz.consumeReminderIds.length) {
          await supabase.from('task_reminders').update({ sent_at: nowIsoSnz }).in('id', planSnz.consumeReminderIds);
        }
        if (planSnz.insertReminder) {
          await supabase.from('task_reminders').insert({
            task_id: t.id, remind_at: planSnz.insertReminder.remind_at, label: planSnz.insertReminder.label,
          });
        }
        if (planSnz.taskPatch) {
          // updated_by (13/08): conclusão já tinha `completed_by`; remarcar/editar/cancelar não
          // tinham autoria nenhuma. Em 09/08 quatro séries do Financeiro foram encerradas e a
          // investigação terminou em "não dá pra saber quem".
          await supabase.from('tasks').update({ ...planSnz.taskPatch, updated_by: collaborator.id }).eq('id', t.id);
        }
        console.log(`[Task] snooze_reminders task=${String(t.id).slice(0, 8)} consumed=${planSnz.consumeReminderIds.length} inserted=${planSnz.insertReminder ? 1 : 0} patch=${planSnz.taskPatch ? 'y' : 'n'} clearAll=${clearAllSnz} not_before=${notBeforeSnz || '(all)'}`);
        okCount++;
      } else if (a.action === 'mark-item') {
        // Checklist ativo (2026-06-28) — o remetente marca/desmarca um sub-item (filha via
        // parent_task_id) falando com o TOM ("já liguei pro aluno"). A mãe é resolvida como tarefa
        // DO PRÓPRIO remetente (resolveTaskByShortId restringe assigned_to + grupos dele): anti-confab
        // de posse — só mexe no checklist de tarefa que é dele. Cascade reusa notifyTaskCreatorOfAction.
        const parentMI = await resolveTaskByShortId(collaborator.id, a.parent_id);
        if (!parentMI) {
          console.warn(`[Task] mark-item REJECTED parent=${a.parent_id} (não é do ${last4} ou não achado)`);
          failCount++;
          continue;
        }
        const { data: kidsMI } = await supabase
          .from('tasks')
          .select('id, title, status, sort_position')
          .eq('parent_task_id', parentMI.id)
          .neq('status', 'cancelled')
          .order('sort_position', { ascending: true, nullsFirst: true });
        const childrenMI = kidsMI || [];
        if (!childrenMI.length) {
          console.warn(`[Task] mark-item: mãe ${String(parentMI.id).slice(0, 8)} sem filhas (checklist vazio)`);
          failCount++;
          continue;
        }
        // Resolve a filha-alvo: item_id (short-id) tem prioridade; senão por título (anti-confab).
        let targetMI = null;
        if (a.item_id) {
          const mmMI = matchRowsByShortId(childrenMI, a.item_id);
          if (mmMI.length === 1) targetMI = mmMI[0];
        }
        if (!targetMI && a.item_title) {
          const { resolveChildByTitle } = require('./services/checklist-resolve');
          targetMI = resolveChildByTitle(childrenMI, a.item_title);
        }
        if (!targetMI) {
          console.warn(`[Task] mark-item: item não resolvido (parent=${String(parentMI.id).slice(0, 8)} item_id=${a.item_id || ''} title="${String(a.item_title || '').slice(0, 40)}")`);
          failCount++;
          continue;
        }
        const markDoneMI = a.done !== false; // default true
        const nowIsoMI = new Date().toISOString();
        // Marca a filha — anti-confab: confirma rowcount via select.
        const { data: updKidMI } = await supabase
          .from('tasks')
          .update({
            status: markDoneMI ? 'done' : 'pending',
            completed_at: markDoneMI ? nowIsoMI : null,
            completed_by: markDoneMI ? collaborator.id : null,
          })
          .eq('id', targetMI.id)
          .select('id')
          .maybeSingle();
        if (!updKidMI) {
          console.warn(`[Task] mark-item: update da filha ${String(targetMI.id).slice(0, 8)} não pegou`);
          failCount++;
          continue;
        }
        console.log(`[Task] mark-item ${markDoneMI ? 'done' : 'reopen'} "${String(targetMI.title).slice(0, 40)}" parent=${String(parentMI.id).slice(0, 8)} by ${last4}`);
        // Cascade: projeta o novo estado das filhas e decide a mãe.
        const { shouldAutocompleteParent } = require('./services/checklist-render');
        const projectedMI = childrenMI.map((c) => (c.id === targetMI.id ? { ...c, status: markDoneMI ? 'done' : 'pending' } : c));
        if (markDoneMI && shouldAutocompleteParent(projectedMI)) {
          // conclui a mãe — anti-confab: só notifica se o UPDATE realmente fechou (neq done + rowcount).
          const { data: parentDoneMI } = await supabase
            .from('tasks')
            .update({ status: 'done', completed_at: nowIsoMI, completed_by: collaborator.id })
            .eq('id', parentMI.id)
            .neq('status', 'done')
            .select('id, title, created_by, assigned_to')
            .maybeSingle();
          if (parentDoneMI) {
            // avisa o delegador (guard interno created_by!==assigned_to protege checklist pessoal)
            await notifyTaskCreatorOfAction(parentDoneMI, collaborator, 'complete');
            groupNotices.push(`✅ Com esse, *${String(parentDoneMI.title || '').slice(0, 60)}* fechou completo — todos os itens.`);
            console.log(`[Task] mark-item cascade → mãe "${String(parentDoneMI.title || '').slice(0, 40)}" concluída (avisa delegador)`);
          }
        } else if (!markDoneMI) {
          // desmarcou: se a mãe estava concluída, reabre (sem notificar ninguém).
          const { data: reopenedMI } = await supabase
            .from('tasks')
            .update({ status: 'pending', completed_at: null, completed_by: null })
            .eq('id', parentMI.id)
            .eq('status', 'done')
            .select('id')
            .maybeSingle();
          if (reopenedMI) console.log(`[Task] mark-item reopen mãe ${String(parentMI.id).slice(0, 8)} (item desmarcado)`);
        }
        okCount++;
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
        // Grupos de trabalho (spec 2026-06-10) — "cria tarefa pro financeiro".
        // Nome resolvido server-side contra work_groups ativos; id NUNCA vem do LLM.
        // Grupo é dono EXCLUSIVO (CHECK exatamente-um-dono no banco).
        let assignedGroup = null;
        if (typeof a.assigned_group === 'string' && a.assigned_group.trim()) {
          try {
            const allGroups = await workGroups.loadActiveGroups(supabase);
            const rg = workGroups.resolveGroupByName(allGroups, a.assigned_group);
            if (!rg.group) {
              const nomes = (rg.candidates.length ? rg.candidates : allGroups).map((g) => g.name).join(', ');
              failMessages.push(rg.candidates.length
                ? `⚠️ Mais de um grupo combina com "${a.assigned_group}": ${nomes}. Me diz qual.`
                : `⚠️ Não achei o grupo "${a.assigned_group}". Grupos ativos: ${nomes || 'nenhum cadastrado ainda'}.`);
              failCount++;
              continue;
            }
            assignedGroup = rg.group;
          } catch (eWG) {
            console.error('[Task][Group] resolve err:', eWG.message);
            failMessages.push('⚠️ Não consegui verificar o grupo agora — tenta de novo?');
            failCount++;
            continue;
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

        // Tarefa de grupo é SEMPRE work (decisão de spec).
        const context = assignedGroup ? 'work' : (a.context === 'personal' ? 'personal' : 'work');
        const priority = VALID_PRIORITIES.includes(a.priority) ? a.priority : 'medium';
        // Sprint 12 Bloco D — action_type vem da skill priorizacao-inteligente.
        // Quando ausente/inválido fica NULL (TaskRow no PWA mostra sem badge).
        const actionType = (typeof a.action_type === 'string' && VALID_ACTION_TYPES.includes(a.action_type))
          ? a.action_type
          : null;
        const insertRow = {
          title: a.title.trim().slice(0, 200),
          // Dono é UM: pessoa OU grupo (CHECK tasks_exactly_one_owner).
          assigned_to: assignedGroup ? null : assignedTo,
          created_by: collaborator.id,
          source: 'manual',
          status: initialStatus,
          context,
          priority,
          action_type: actionType,
        };
        if (assignedGroup) insertRow.assigned_group_id = assignedGroup.id;
        // Sprint 29.4 — task com recorrência vira TEMPLATE (engine materializa próximas)
        if (typeof a.recurrence_rule === 'string' && a.recurrence_rule.trim()) {
          insertRow.recurrence_rule = a.recurrence_rule.trim().replace(/^RRULE:/i, '');
        }
        // MARKER-NO-EISENHOWER-FIELD (Alf 07/07) — quadrant opcional (1-4) no create.
        const taskQuad = Number(a.quadrant);
        if (Number.isInteger(taskQuad) && taskQuad >= 1 && taskQuad <= 4) insertRow.eisenhower_quadrant = taskQuad;
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
          // Item 2 (cadeira ADM 03/06) — sem remind_at E sem due_date: NÃO cravar hoje.
          // Cravar hoje fazia a tarefa nascer "PRA HOJE/atrasada" sem ninguém ter datado
          // (ex.: Clayton delegou sem data → virou atrasada). null = "sem prazo" (estado já
          // suportado; resolveTaskByShortId passou a incluir null pra continuar gerenciável).
          insertRow.due_date = isValidISODate(a.due_date) ? a.due_date : null;
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
            // Audit 08/07 (Ana 🔴): se o conflito é uma tarefa que o PRÓPRIO remetente
            // criou há poucos minutos (re-emit na mesma rajada/conversa), NÃO pergunta
            // "1/2/3" — pula silencioso e conta ok (como o dedupe defensivo de 60s, porém
            // semântico). Evita a cascata de perguntas que fez a Ana desistir. Janela
            // env-tunável (TOM_SELF_RECENT_CONFLICT_MS, default 5min). TRADEOFF documentado
            // em utils/self-recent-conflict.js (fuzzy pode casar distinta quase-idêntica).
            const { isSelfRecentConflict, buildSelfRecentSkipReason } = require('./utils/self-recent-conflict');
            const _selfRecentMs = Number(process.env.TOM_SELF_RECENT_CONFLICT_MS) || 5 * 60 * 1000;
            const _nowMs = Date.now();
            const _selfRecent = _taskDupResult.probable.find(p => isSelfRecentConflict(p, collaborator.id, _nowMs, _selfRecentMs));
            if (_selfRecent) {
              const _skipReason = buildSelfRecentSkipReason({
                existingId: _selfRecent.id,
                ageMs: _nowMs - new Date(_selfRecent.created_at).getTime(),
                score: _selfRecent._score,
              });
              console.warn(`[IntegrityCheck] SELF_RECENT_SKIP "${a.title.trim().slice(0,40)}" ~ ${_skipReason} (mesmo autor <${Math.round(_selfRecentMs/60000)}min) — não pergunta 1/2/3`);
              // Observabilidade (audit 08/07, catraca): persiste o skip em marker_logs pra a
              // auditoria das 7h contar reincidência e flagrar perda real do TRADEOFF fuzzy (o
              // console.warn é invisível ao auditor, que lê marker_logs). result='skipped' é
              // CHECK-válido e é o MESMO padrão do dedupe de notas (NOTE_ACTION 'skipped').
              // logMarker já tem try/catch interno E não re-lança; envolvo de novo pra o log
              // JAMAIS quebrar a criação (KI audit 24/06 — guard que morre silencioso vira regressão).
              try {
                await logMarker(collaborator.id, 'TASK_CREATE', 'skipped', _skipReason, a);
              } catch (_logErr) {
                console.error('[IntegrityCheck] SELF_RECENT_SKIP logMarker throw:', _logErr.message);
              }
              okCount++;
              continue;
            }
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
          // Sprint 31 — NÃO aborta o lote: guarda o 1º conflito e SEGUE pros
          // outros itens da descarga (antes: o return matava os demais — era o
          // bug "tudo junto perde itens" no caminho do dedup).
          if (!integrityPayload) integrityPayload = _taskIntegrityPayload;
          failCount++;
          continue;
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
          let _dq = supabase
            .from('tasks')
            .select('id, created_at, remind_at, due_date')
            .eq('title', insertRow.title)
            .gte('created_at', dedupeCutoff)
            .limit(3);
          // Dono do dedupe acompanha o dono da task (grupo ou pessoa).
          _dq = assignedGroup ? _dq.eq('assigned_group_id', assignedGroup.id) : _dq.eq('assigned_to', assignedTo);
          const { data: dupes } = await _dq;
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
        // RAIZ 1 / Fatia 4 — dedup-on-create do MOLDE recorrente 1:1 (RECUR-TEMPLATE-DUP-ON-CREATE).
        // A delegação 1:1 numa rajada criava 2 moldes idênticos ("quadruplicou" Gabi/Jereh): o dedup de
        // molde só existia no grupo (findDuplicatePackage). Aqui, ANTES do insert, se a tarefa é um molde
        // recorrente 1:1, busca os moldes ATIVOS do MESMO dono e reusa o existente em vez de criar o 2º.
        // Owner-scoped (assigned_to). Degrade-safe: qualquer falha na busca → segue e insere (nunca trava
        // a criação). Só 1:1 (grupo tem o seu caminho); não toca materialize/flip.
        if (insertRow.recurrence_rule && !assignedGroup && assignedTo) {
          try {
            const { findDuplicateRecurrenceTemplate } = require('./utils/recur-template-dedup');
            const { data: _activeTpls, error: _tplErr } = await supabase
              .from('tasks')
              .select('id, title, recurrence_rule, recurrence_parent_id, series_ended_at, status')
              .eq('assigned_to', assignedTo)
              .not('recurrence_rule', 'is', null)
              .is('recurrence_parent_id', null)
              .is('series_ended_at', null)
              .neq('status', 'cancelled');
            if (_tplErr) throw _tplErr;
            const _dupTpl = findDuplicateRecurrenceTemplate(_activeTpls || [], {
              title: insertRow.title, recurrence_rule: insertRow.recurrence_rule,
            });
            if (_dupTpl) {
              console.warn(`[Task] RECUR_TEMPLATE_DEDUP reuse=${String(_dupTpl.id).slice(0, 8)} "${insertRow.title.slice(0, 40)}" owner=${last4} (molde recorrente já ativo)`);
              // Prosa HONESTA (não confabula "criei") — espelha o padrão "já tinha sido feita, não precisou"
              // (failMessages substitui o texto otimista do LLM no caminho single).
              failMessages.push(`✋ Você já tem *${_dupTpl.title}* recorrente ativa — não criei outra igual (reusei a que já existe).`);
              failCount++;
              continue;
            }
          } catch (_rtdErr) {
            // Degrade-safe: dedup de molde NUNCA trava a criação. Loga e segue pro insert normal.
            console.warn('[Task] recur-template dedup err (non-fatal):', _rtdErr.message);
          }
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
        // FATIA 6 (#1): guarda os horários de lembrete desta tarefa criada (one-shot + múltiplos)
        // pra o caller poder surfacer "🔔 Lembro às HHh" se a fala do TOM não citar a hora.
        if (insertRow.remind_at) createdReminderTimes.push(insertRow.remind_at);
        if (reminders.length) createdReminderTimes.push(...reminders);
        // Subtarefas/checklist (2026-06-26): create com subtasks:[...] → cria as filhas (helper
        // LITE; herda context/assigned do pai). Best-effort: o pai já persistiu, falha das filhas
        // não derruba o create nem inventa "checklist criado".
        let _subCreated = 0;
        let _subTexts = (Array.isArray(a.subtasks) ? a.subtasks : []).map((s) => String(s || '').trim()).filter(Boolean);
        // Backstop determinístico anti-confab (CHECKLIST-CREATE-CONFAB, 28/06): se o LLM NÃO emitiu
        // subtasks mas o user pediu "com os itens: A, B, C", deriva da fala — senão o TOM diria
        // "criei N itens" sem criar (confab). Só com 1 create no lote (a lista é de UMA tarefa).
        if (taskId && !_subTexts.length && opts && opts.inboundText
            && actions.filter((x) => x && x.action === 'create').length === 1) {
          try {
            const { parseInlineChecklist } = require('./services/checklist-parse');
            const _derived = parseInlineChecklist(opts.inboundText);
            if (_derived.length) {
              _subTexts = _derived;
              console.log(`[Task] checklist backstop: derivei ${_derived.length} item(ns) da fala (LLM nao emitiu subtasks)`);
            }
          } catch (_pe) { /* non-fatal */ }
        }
        if (taskId && _subTexts.length) {
          try {
            const { createSubtasks } = require('./services/subtasks');
            const _sr = await createSubtasks({ supabase, parentId: taskId, texts: _subTexts, parent: insertRow, createdBy: collaborator.id });
            _subCreated = _sr.created;
            console.log(`[Task] create +${_subCreated} subtarefa(s) em ${String(taskId).slice(0, 8)}`);
          } catch (_se) { console.warn('[Task] subtasks insert err (non-fatal):', _se.message); }
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
        // Grupos de trabalho — avisa os demais membros, com registro no histórico
        // (lição RSVP-HISTORY-MISSING: send sem conversation_history deixa o LLM cego).
        if (assignedGroup && taskId) {
          const _diaG = insertRow.due_date
            ? ` — pra ${String(insertRow.due_date).slice(0, 10).split('-').reverse().slice(0, 2).join('/')}`
            : '';
          const _quem = (collaborator.full_name || 'colega').split(' ')[0];
          const msgG = `📋 Tarefa nova do grupo *${assignedGroup.name}*: *${insertRow.title}*${_diaG}\n_criada por ${_quem} — qualquer pessoa do grupo pode concluir._`;
          for (const m of (assignedGroup.members || [])) {
            if (m.collaborator_id === collaborator.id || !m.phone) continue;
            try {
              await whatsapp.sendMessage(m.phone, msgG);
              await supabase.from('conversation_history').insert({
                collaborator_id: m.collaborator_id,
                direction: 'outbound',
                message_type: 'text',
                content: msgG,
              });
            } catch (eNG) { console.warn('[Task][Group] notify member err:', eNG.message); }
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
        const candidate = matchRowsByShortId(tasksMatching, shortId)[0]; // tolerante a UUID alucinado (Sprint 31.14)
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
          // PISO DO LEMBRETE (caso Matheus, 04/08/2026) — este ramo mudava o prazo e
          // deixava o remind_at exatamente onde estava. Um lembrete já vencido sobrevive
          // à aprovação e o cron ("remind_at <= agora?") cobra na varredura seguinte:
          // a pessoa ganha prazo novo e é cobrada como se não tivesse.
          // O ajuste existia só no ramo de reagendamento por marker (~4796).
          const { data: curExt } = await supabase
            .from('tasks').select('due_date, remind_at').eq('id', candidate.id).maybeSingle();
          if (curExt && curExt.remind_at) {
            const shiftedExt = shiftTaskRemindAt(curExt.due_date, a.new_due_date, curExt.remind_at);
            if (shiftedExt) {
              update.remind_at = shiftedExt;
              update.reminded_at = null; // re-arma pra tocar no horário novo
            }
          }
          // If task was overdue, reset status to pending.
          // updated_by (13/08) — ver nota no ramo de snooze.
          await supabase.from('tasks').update({ ...update, updated_by: collaborator.id }).eq('id', candidate.id);
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
        // #em-copia (Fabi 29/06): campo opcional cc = nomes/telefones a pôr em cópia
        // (acompanham e cobram, não executam). Resolve e insere em task_watchers.
        if (Array.isArray(a.cc) && a.cc.length) {
          const ccResolved = [];
          for (const entry of a.cc) {
            let c = null;
            if (typeof entry === 'string' && /\d{8,}/.test(entry)) {
              c = await findCollaboratorByPhone(entry);
            } else {
              const _r = await resolveCollaboratorByName(String(entry), { requester: collaborator });
              c = _r.status === 'resolved' ? _r.collaborator : null;
            }
            if (c && c.is_active && c.id !== recipient.id && c.id !== collaborator.id) ccResolved.push(c.id);
          }
          if (ccResolved.length) {
            await supabase.from('task_watchers').upsert(
              [...new Set(ccResolved)].map(cid => ({ task_id: t.id, collaborator_id: cid, added_by: collaborator.id })),
              { onConflict: 'task_id,collaborator_id', ignoreDuplicates: true },
            );
          }
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
      } else if (a.action === 'add_watchers') {
        // #em-copia (Fabi 29/06): "põe o Jereh em cópia nessa tarefa". Resolve a tarefa
        // (própria) + watchers; insere em task_watchers e avisa cada um (entrada em cópia).
        const t = await resolveTaskByShortId(collaborator.id, a.id);
        if (!t) { failCount++; continue; }
        const entries = Array.isArray(a.cc) ? a.cc : (Array.isArray(a.to_names) ? a.to_names : []);
        const ccResolved = [];
        for (const entry of entries) {
          let c = null;
          if (typeof entry === 'string' && /\d{8,}/.test(entry)) c = await findCollaboratorByPhone(entry);
          else { const _r = await resolveCollaboratorByName(String(entry), { requester: collaborator }); c = _r.status === 'resolved' ? _r.collaborator : null; }
          if (c && c.is_active && c.id !== t.assigned_to && c.id !== collaborator.id) ccResolved.push(c.id);
        }
        if (!ccResolved.length) { failCount++; continue; }
        const ids = [...new Set(ccResolved)];
        await supabase.from('task_watchers').upsert(
          ids.map(cid => ({ task_id: t.id, collaborator_id: cid, added_by: collaborator.id })),
          { onConflict: 'task_id,collaborator_id', ignoreDuplicates: true },
        );
        const { data: ws } = await supabase.from('collaborators').select('id, phone, full_name, is_active').in('id', ids);
        const execColl = await supabase.from('collaborators').select('full_name').eq('id', t.assigned_to).maybeSingle();
        const execFirst = (execColl.data?.full_name || '').split(' ')[0] || 'a pessoa';
        for (const w of (ws || [])) {
          if (!w.phone || !w.is_active) continue;
          const body = `👀 Você entrou em *cópia* de *${t.title}* (de ${execFirst}). Acompanha e pode cobrar — não precisa concluir.`;
          try {
            await whatsapp.sendMessage(w.phone, body);
            await supabase.from('conversation_history').insert({ collaborator_id: w.id, direction: 'outbound', message_type: 'text', content: body });
          } catch (e) { console.error('[Task] add_watchers WA err:', e.message); }
        }
        console.log(`[Task] add_watchers ${a.id} → ${ids.length} em cópia`);
        okCount++;
      } else if (a.action === 'governance_reassign') {
        // Sub-fase 2 — Re-delegação de cobrança por voz.
        // Muda governance_owner_id (quem COBRA) sem tocar assigned_to (quem EXECUTA).
        // Autorizado para: director, dono atual da cobrança, ou gerente da unidade
        // quando a cobrança ainda não tem dono.

        // 1. Resolver tarefa por short-id SEM filtrar por assigned_to (o re-delegador
        //    é o dono da COBRANÇA, não o executor). uuid não suporta LIKE no PostgREST —
        //    busca as tarefas ativas de trabalho e filtra em JS com matchRowsByShortId
        //    (mesmo matcher tolerante usado por resolveTaskByShortId).
        if (!a.id || !SHORT_ID_RE.test(String(a.id))) {
          console.warn(`[Task] governance_reassign — short-id inválido: ${a.id}`);
          failCount++;
          continue;
        }
        const { data: tkCandidates, error: tkErr } = await supabase
          .from('tasks')
          .select('id, title, assigned_to, governance_owner_id, context, status')
          .eq('status', 'pending')
          .eq('context', 'work')
          .limit(1000);
        if (tkErr) {
          console.error('[Task] governance_reassign resolve err:', tkErr.message);
          failCount++;
          continue;
        }
        const tkData = matchRowsByShortId(tkCandidates || [], a.id);
        if (!tkData || tkData.length === 0) {
          console.warn(`[Task] governance_reassign — tarefa não encontrada: ${a.id}`);
          failCount++;
          continue;
        }
        if (tkData.length > 1) {
          console.warn(`[Task] governance_reassign — id ambíguo: ${a.id} (${tkData.length} matches)`);
          failCount++;
          continue;
        }
        const govTask = tkData[0];

        // 2. Autorização
        const isDirector = collaborator.role === 'director';
        const isCurrentOwner = govTask.governance_owner_id === collaborator.id;
        let isUnitManager = false;
        if (!isDirector && !isCurrentOwner && !govTask.governance_owner_id && collaborator.role === 'manager') {
          // Sem dono: gerente da unidade REAL do executor pode assumir. O sentinel unit='all'
          // (= sem unidade física) NÃO conta como unidade — senão um manager unit='all' (Yuri)
          // assumiria a cobrança de QUALQUER pessoa unit='all'. Caso 14/06 (vazamento governança).
          const { UNITS } = require('./services/leader-routing');
          if (govTask.assigned_to && collaborator.unit && UNITS.has(collaborator.unit)) {
            const { data: execCollab } = await supabase
              .from('collaborators')
              .select('unit')
              .eq('id', govTask.assigned_to)
              .maybeSingle();
            if (execCollab && execCollab.unit === collaborator.unit) isUnitManager = true;
          }
        }
        if (!isDirector && !isCurrentOwner && !isUnitManager) {
          console.warn(`[Task] governance_reassign REJECTED — ${last4} não tem posse da cobrança de ${govTask.id}`);
          failCount++;
          continue;
        }

        // 3. Resolver novo dono
        let newOwnerId = null;
        let newOwnerName = null;

        const nameToResolve = a.to_name || a.to_phone;
        if (a.to_phone) {
          const byPhone = await findCollaboratorByPhone(a.to_phone);
          if (byPhone && byPhone.is_active) { newOwnerId = byPhone.id; newOwnerName = byPhone.full_name; }
        } else if (a.to_name) {
          const _r = await resolveCollaboratorByName(a.to_name, { requester: collaborator });
          if (_r.status === 'ambiguous') {
            return {
              okCount,
              failCount: failCount + 1,
              integrityPayload: {
                severity: 'soft',
                type: 'ambiguous_recipient',
                candidates: _r.candidates,
                candidateTitle: govTask.title,
              },
            };
          }
          if (_r.status === 'resolved' && _r.collaborator && _r.collaborator.is_active) {
            newOwnerId = _r.collaborator.id;
            newOwnerName = _r.collaborator.full_name;
          } else {
            // Fallback: tentar resolver como departamento/group_key
            const grp = normalizeGroupKey(a.to_name);
            if (grp) {
              const { data: glData } = await supabase
                .from('governance_leaders')
                .select('leader_id, collaborators!governance_leaders_leader_id_fkey(full_name)')
                .eq('group_key', grp)
                .limit(1);
              if (glData && glData.length > 0) {
                newOwnerId = glData[0].leader_id;
                newOwnerName = glData[0].collaborators?.full_name || a.to_name;
              }
            }
          }
        }

        if (!newOwnerId) {
          console.warn(`[Task] governance_reassign — não achei "${nameToResolve}" pra repassar`);
          failCount++;
          continue;
        }

        // 4. Atualizar governance_owner_id
        const { error: updErr } = await supabase
          .from('tasks')
          .update({ governance_owner_id: newOwnerId })
          .eq('id', govTask.id);
        if (updErr) {
          console.error('[Task] governance_reassign update err:', updErr.message);
          failCount++;
          continue;
        }

        // 5. Audit trail + confirmação
        await logAgentNote(govTask.id, `Cobrança repassada de ${nameForCollab(collaborator)} para ${newOwnerName}`, collaborator.id);
        console.log(`[Task] governance_reassign ${a.id} ${last4} → ${newOwnerName}`);
        okCount++;
      } else {
        console.warn(`[Task] unknown action: ${a.action}`);
        failCount++;
      }
    } catch (err) {
      console.error('[Task] exception:', err.message);
      failCount++;
    }
  }
  return { okCount, failCount, integrityPayload, failMessages, groupNotices, createdReminderTimes };
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

// custom_days = dialeto canônico (inteiros ISO 1..7); 'custom' mantido só p/ back-compat
// (normalizeHabitFrequency já converte 'custom'→'custom_days' antes da validação).
const VALID_HABIT_FREQUENCIES = new Set(['daily', 'weekdays', 'weekly', 'custom', 'custom_days']);
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
    // Sprint 31.6 (B3) — normaliza aliases que TOM emite (consistente com tasks/events).
    // Lógica extraída pra utils/habit-field-alias.js (puro, TDD) no audit 08/07:
    // HABIT-FIELD-ALIAS-HABIT (Ana Paula 21:09) — o LLM emitiu log com o campo `habit`
    // ("Ir para academia"/"Usar bombinha Asma Alice") → schema_invalid; o alias novo
    // entra na MESMA família (habit_slug/title, B3 Ana 22/06). Comportamento idêntico.
    normalizeHabitAliases(a);
    // HABIT-CREATE-FREQ-CUSTOM-DAYS (Arthur 15/07): canoniza frequency/dias ANTES de
    // validar/persistir. weekly+dias-string e "weekends" → custom_days + inteiros ISO,
    // que é o que o dispatcher (checkHabitReminders) e o PWA já falam. Sem isso, hábito
    // de dias-específicos criado pelo TOM gravava strings → map(Number)=NaN → nunca disparava.
    normalizeHabitFrequency(a);
    const why = validateHabitAction(a);
    if (why) { dropped.push(`action[${i}]:${why}`); continue; }
    valid.push(a);
  }
  if (dropped.length) logSchemaErr('HABIT_ACTION', dropped, parsed);
  // `motivos` sobe junto (HABIT-EDIT-SEM-CAMINHO): quem trata o malformed precisa distinguir
  // "schema torto numa ação que existe" (vale pedir de novo) de "ação que não existe" (pedir de
  // novo nunca vai funcionar — o caminho é o app). Sem isso os dois casos viram a mesma fala.
  if (!valid.length) return { malformed: true, cleanText, motivos: dropped };
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
  const matches = matchRowsByShortId(data, shortId); // tolerante a UUID alucinado (Sprint 31.14)
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
  // Trava A (defense-in-depth, revisor 26/06): clampa a 24h NO SINK, independente do caller
  // (parseDndMarker, rota do PREFS, ou futuro caller). "pausado até julho" vira estruturalmente
  // impossível — não depende de todo caller lembrar de validar.
  let _until = parsed.until;
  if (!parsed.clear && typeof _until === 'string') {
    const ms = Date.parse(_until);
    if (!Number.isNaN(ms) && ms - Date.now() > DND_MAX_MS) _until = new Date(Date.now() + DND_MAX_MS).toISOString();
  }
  const update = parsed.clear
    ? { do_not_disturb_until: null, do_not_disturb_reason: null }
    : { do_not_disturb_until: _until, do_not_disturb_reason: parsed.reason };
  const { error } = await supabase
    .from('user_preferences')
    .update(update)
    .eq('collaborator_id', collaborator.id);
  if (error) {
    console.error('[DND] persist err:', error.message);
    return false;
  }
  if (parsed.clear) console.log(`[DND] cleared for ${String(collaborator.phone).slice(-4)}`);
  else console.log(`[DND] set ${_until} for ${String(collaborator.phone).slice(-4)}${parsed.reason ? ' (' + parsed.reason + ')' : ''}`);
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
    .not('response_summary', 'is', null)
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
      lines.push(`- Última resposta recebida (PARÁFRASE do que entendi, NÃO é a fala literal — não repasse como citação): ${_accShort(q3.id)} | de=${_accFirstName(q3.responder_name)} | "${_accTrunc(q3.response_summary, 60)}" | há ${min}min`);
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

// jaroWinkler + normalizeForSim foram extraídos p/ src/services/text-similarity.js
// (compartilhados com o dedup de NOTA — note-dedup.js). Importados no topo deste arquivo.

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
    const candDate = candidate.start_at ? brtDateOf(candidate.start_at) : null;
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
      const evDate = ev.start_at ? brtDateOf(ev.start_at) : null; // BUG-11: UTC→BRT
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
      .select('id, title, description, assigned_to, created_by, department_id, request_type_id, context, status, created_at, due_date')
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
  // DUP-QUOTE-SCAFFOLD (Juliana 23/06): resposta por reply-quote do WhatsApp chega como
  // "[O usuário está RESPONDENDO...: "<menu>"]\n<escolha>". Sem destrinchar, o texto >50ch
  // (e não-iniciado por dígito) fazia classifyDupChoice retornar null → menu re-exibido.
  // userText = a escolha real ("2"); quotedText = o menu citado (sinal de binding abaixo).
  const { userText, quotedText } = stripReplyScaffold(String(text || ''));
  const lm = (userText || '').trim();
  // Aceita dígito ("2", "2.", "2 - texto...") E linguagem natural ("são duas
  // tarefas diferentes" = 2, "é a mesma" = 1, "cancela" = 3). AUDIT-OPTIMISTIC-CONFIRM
  // caso Juliana: resposta NL não casava o regex antigo → caía no LLM → menu re-exibido.
  // Só age se houver dup pendente (gate abaixo), então NL não tratado é inócuo.
  const choice = classifyDupChoice(lm);
  if (!choice) return null;
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
      // Quote do menu de dup = binding inequívoco (casa por título, ignora idade — a resposta
      // legítima pode demorar). Sem quote, recência ≤10min: dup velha não captura resposta nova
      // (DUP-BYPASS-STALE-BIND, Arthur). DUP-QUOTE-SCAFFOLD (Juliana 23/06).
      const _dbDup = pickDupBypassIntentForReply(_dbIntents, { quotedText });
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

  // DUP-INTENT-NOT-CLOSED (Ana 28/07 22:09→22:12 BRT): só o caminho '2' fechava a intent no
  // banco. "1"/"3" limpavam o Map e deixavam a intent ABERTA — aí o fallback do banco a
  // ressuscitava num "pode criar" dirigido a OUTRA tarefa (dentro dos 10min) e criava a errada.
  const closeDupIntent = async (resolution, note) => {
    try {
      const id = pendingTk && pendingTk._intentId;
      if (id) { await pendingIntents.resolveIntent(id, resolution, note); return; }
      const open = (await pendingIntents.listOpenIntents(collab.id))
        .find(i => i.kind === 'task_creation' && i.payload?._dup_bypass);
      if (open) await pendingIntents.resolveIntent(open.id, resolution, note);
    } catch (_e) { /* non-fatal */ }
  };

  if (choice === '3') {
    if (hasEv) pendingDupEvents.delete(collab.id);
    if (hasTk) pendingDupTasks.delete(collab.id);
    await closeDupIntent('denied', 'dup_bypass choice=3');
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
    if (choice === '1') {
      await closeDupIntent('denied', 'dup_bypass choice=1');
      return { reply: `Certo! Já está anotado como _${tk.title}_. Nada mudou.` };
    }
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
    await closeDupIntent('confirmed', 'dup_bypass choice=2');
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
  'register_transaction', 'register_bill', 'pay_bill', 'delete_bill', 'set_bill_amount', 'query_fixed_bills', 'query_bills_to_pay', 'query_checkup', 'query_month_analysis', 'create_goal',
  'update_goal', 'edit_goal', 'delete_goal', 'set_budget', 'query_summary', 'query_budget', 'query_goal', 'query_accounts', 'create_account', 'edit_account',
  'simulate_interest',
  // cartão de crédito + transferência
  'create_card', 'card_purchase', 'card_refund', 'query_invoice', 'pay_invoice', 'transfer',
  'pluggy_query', // Pluggy / Open Finance — consulta realtime (saldo/fatura/investimento)
  'reconcile_resolve', // conciliação: ignorar / marcar interno um pendente do extrato real
  'edit_transaction', 'delete_transaction', 'query_transactions',
  'query_period_expenses', 'query_account_detail', 'query_statement',
  'query_daily_summary', 'query_weekly_summary', 'query_monthly_closing',
];
const { canonFinanceAction } = require('./finance/action-aliases');
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
  const act = json && canonFinanceAction(json.action, json.params, FINANCE_ACTIONS);
  if (!json || !FINANCE_ACTIONS.includes(act)) {
    logSchemaErr('FINANCE_ACTION', ['action_invalida: ' + (json && json.action)], m[1]);
    return { malformed: true, cleanText };
  }
  return { action: act, params: json.params || {}, cleanText, malformed: false };
}

// Multi-marker: o usuário pode listar VÁRIOS lançamentos numa mensagem só → o LLM emite
// vários <<FINANCE_ACTION>>. Pega TODOS (parseFinanceMarker pegava só o 1º → só o 1º item
// era registrado; caso Luciano 03/06 "Estacionamento ... / Ifood ...").
function parseFinanceMarkers(text) {
  if (!text) return { actions: [], malformed: 0, cleanText: text || '' };
  const re = /<<FINANCE_ACTION>>\s*([\s\S]*?)\s*<<END>>/gi;
  const actions = [];
  let malformed = 0;
  let mm;
  while ((mm = re.exec(text)) !== null) {
    let json;
    try { json = JSON.parse(mm[1].trim()); }
    catch (err) { logSchemaErr('FINANCE_ACTION', ['invalid_json: ' + err.message], mm[1]); malformed++; continue; }
    const act = canonFinanceAction(json && json.action, json && json.params, FINANCE_ACTIONS);
    if (!json || !FINANCE_ACTIONS.includes(act)) {
      logSchemaErr('FINANCE_ACTION', ['action_invalida: ' + (json && json.action)], mm[1]); malformed++; continue;
    }
    actions.push({ action: act, params: json.params || {} });
  }
  const cleanText = text.replace(/<<FINANCE_ACTION>>\s*[\s\S]*?\s*<<END>>/gi, '').trim();
  return { actions, malformed, cleanText };
}

// Categorias válidas vêm do módulo único (categories.data.js). safeCategory é
// type-aware: slug inválido → tenta mapCategory(desc, type) → fallback por tipo
// (outros / outras_receitas). Garante slug válido (o CHECK do banco foi removido;
// o LLM às vezes inventa "cuidados pessoais"/"beleza fora do tipo").
const { validSlugs: pfValidSlugs, fallbackSlug: pfFallbackSlug } = require('./finance/categories.data');
function safeCategory(cat, description, type, extraSlugs) {
  const c = String(cat || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (pfValidSlugs(type).has(c)) return c;
  if (extraSlugs && extraSlugs.has(c)) return c;       // categoria custom do usuário
  const mapped = mapCategory(description || '', type);
  return pfValidSlugs(type).has(mapped) ? mapped : pfFallbackSlug(type);
}

// Resolve um rótulo/slug de categoria (vindo do LLM) p/ um slug VÁLIDO: canônica (CAT_META)
// OU categoria CUSTOM do usuário (casando por slug ou por label). Usado no edit_transaction
// p/ honrar categorias salvas pelo usuário (ex: "shows") — antes o _normCat só conhecia as 43
// canônicas e descartava a custom em silêncio (bug FIN-EDIT-CUSTOMCAT, caso Matheus 07/06).
function resolveCategorySlug(raw, customCats) {
  if (!raw) return null;
  const financeFmt = require('./services/finance-format');
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const key = norm(raw).replace(/[\s-]+/g, '_');
  if (financeFmt.CAT_META[key]) return key;                              // canônica
  const cats = Array.isArray(customCats) ? customCats : [];
  const bySlug = cats.find((c) => c.slug === key);
  if (bySlug) return bySlug.slug;                                        // custom por slug
  const rawNorm = norm(raw);
  const byLabel = cats.find((c) => norm(c.label) === rawNorm || norm(c.label).replace(/[\s-]+/g, '_') === key);
  return byLabel ? byLabel.slug : null;                                  // custom por label
}

// Compra no cartão (fonte única, usada pelo case card_purchase E pelo roteamento de register_transaction).
// Fase C — nota inline de "gasto fora do padrão". preHistory = gastos do mesmo merchant buscados
// ANTES de inserir (pra não contar a transação atual). Nunca quebra o registro (try/catch). (Alf 14/06)
function anomalyNoteFrom(preHistory, amount) {
  try {
    if (!(Number(amount) > 0)) return '';
    const note = proactiveMsg.buildAnomalyNote(spendingAnomaly.detectAnomaly({ amount: Number(amount), history: preHistory || [] }));
    return note ? '\n\n' + note : '';
  } catch (e) { console.warn('[Anomaly] err:', e.message); return ''; }
}

// Lança uma LISTA DE ESTORNOS direto via card_refund (valor negativo abate a fatura), de forma
// determinística — sem preview de "compras" nem LLM derrotista. Regressão Rose 14/06.
async function commitRefundList(cid, invoice) {
  const itens = (invoice.itens || []).filter((it) => it && (it.descricao || it.description));
  if (!itens.length) return null;
  const cards = await financeService.findCard(cid, invoice.emissor || '');
  if (!cards || cards.length !== 1) {
    const all = await financeService.listCards(cid);
    if (!all.length) return `Pra lançar o estorno, cadastra o cartão no app primeiro — *Finanças → Cartões*.`;
    return `Em qual cartão entr${itens.length > 1 ? 'aram esses estornos' : 'ou esse estorno'}? Tenho: ${all.map((c) => c.name).join(', ')}.`;
  }
  const card = cards[0];
  // competência: deriva da DATA do estorno (a fatura onde a compra ORIGINAL caiu), POR ITEM —
  // não a fatura aberta hoje. closing 7 + estorno 14/05 → junho; currentCompetencia jogava em
  // julho (Rose 14/06: "vc lançou na fatura de julho, é junho"). refundCompetencia corrige o
  // ano-chute do Gemini e só cai na fatura corrente se a data for inutilizável.
  const _today = new Date();
  let abated = 0, n = 0;
  for (const it of itens) {
    const valor = Math.abs(Number(it.valor != null ? it.valor : it.value) || 0);
    if (!valor) continue;
    const desc = String(it.descricao || it.description || 'Estorno');
    const finalDesc = /estorn|devolu|reembol/i.test(desc) ? desc : `Estorno ${desc}`;
    const _date = invoiceImport.normInvoiceDate(it.data || it.date || null, _today.getUTCFullYear());
    let _comp = null;
    try { _comp = invoiceImport.refundCompetencia(_date, card.closing_day, _today); } catch (e) { _comp = null; }
    await financeService.insertCardPurchase(cid, card, {
      category: 'outros', amount: -valor, description: finalDesc,
      transaction_date: _date, installments: 1, competencia: _comp,
    });
    abated += valor; n++;
  }
  if (!n) return null;
  const fmt = (x) => Number(x).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `↩️ Lancei ${n} estorno${n > 1 ? 's' : ''} no *${card.name}* — abati *R$ ${fmt(abated)}* da sua fatura. 💚`;
}

// Após um lançamento, tenta casar um pendente Pluggy equivalente → nota de conciliação (ou ''). (D3b)
async function matchPluggyNote(cid, info) {
  try {
    const { tryMatchPluggyPending } = require('./services/pluggy-reconcile');
    const hit = await tryMatchPluggyPending(cid, info);
    if (hit) return `\n\n🔗 Conciliei com o movimento de R$ ${Number(hit.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} da sua conta real.`;
  } catch (e) { console.warn('[matchPluggyNote]', e.message); }
  return '';
}

async function recordCardPurchase(cid, card, { amount, description, category, installments, date, bill_id }, outcome = {}) {
  const financeFmt = require('./services/finance-format');
  const inst = parseInt(installments || 1, 10) || 1;
  const _cats = await financeService.listCategorySlugs(cid).catch(() => []);
  const _extra = new Set(_cats.filter((r) => r.collaborator_id).map((r) => r.slug));
  const cat = safeCategory(category, description, 'expense', _extra);
  const _preHist = await financeService.merchantSpendHistory(cid, description).catch(() => []);
  const rows = await financeService.insertCardPurchase(cid, card, { category: cat, amount: Number(amount), description, transaction_date: date, installments: inst, bill_id });
  outcome.persisted = true; // Fatia C: marca persistência real (compra no cartão gravada)
  outcome.ids = (rows || []).map((r) => r && r.id).filter(Boolean); // p/ desfazer determinístico (undo_launch)
  const usage = await financeService.cardUsage(cid, card);
  let reply = financeFmt.txnRegistered(card, { description, amount: Number(amount), category: cat, installments: inst, competencia: rows[0].competencia }, usage);
  const al = await financeService.checkAndMarkLimitAlert(cid, card);
  if (al) reply += '\n\n' + financeFmt.limitAlert(card, al.band, al.usage);
  reply += anomalyNoteFrom(_preHist, amount);
  reply += await matchPluggyNote(cid, { amount, direction: 'out', date, pfTxnId: rows[0] && rows[0].id });
  return reply;
}

// Escreve transação de caixa + bloco de orçamento + confirmação. Fonte garantida (account).
// assumedSource: nome da principal quando foi default silencioso (nomeia na confirmação).
async function writeCashTransaction(cid, { type, category, amount, description, date, account, assumedSource, bill_id }, outcome = {}) {
  const financeFmt = require('./services/finance-format');
  const prev = type === 'expense' ? await financeService.monthCategoryTotal(cid, category) : 0;
  const _preHist = type === 'expense' ? await financeService.merchantSpendHistory(cid, description).catch(() => []) : [];
  const _txn = await financeService.insertTransaction(cid, { type, category, amount, description, transaction_date: date, account_id: account.id, bill_id });
  outcome.persisted = true; // Fatia C: marca persistência real (transação de caixa gravada)
  outcome.ids = _txn && _txn.id ? [_txn.id] : []; // p/ desfazer determinístico (undo_launch)
  console.log(`[Finance] txn ${_txn && _txn.id ? _txn.id.slice(0,8) : '?'} registrada cid=${String(cid).slice(0,8)}`);

  let budgetBlock = null;
  if (type === 'expense') {
    const limit = await financeService.getBudget(cid, category);
    if (limit) {
      const novo = prev + Number(amount);
      const pct = Math.round((novo / limit) * 100);
      const m = financeFmt.CAT_META[category] || { label: category };
      budgetBlock = `📊 ${m.label}: ${financeFmt.money(novo)} / ${financeFmt.money(limit)} (${pct}%)`;
      const cruzou = crossedThreshold(prev, novo, limit);
      if (cruzou) budgetBlock += `\n${buildBudgetAlert(category, novo, limit, cruzou)}`;
    }
  }

  const meta = financeFmt.CAT_META[category] || { emoji: '📦', label: category };
  const newBalance = Number(account.balance) + (type === 'income' ? Number(amount) : -Number(amount));
  const footer = financeFmt.buildTxnFooter({ categoryMissing: category === 'outros', accountLinked: true, tipSeed: new Date().getUTCDate(), type });
  const _reply = financeFmt.buildTxnConfirmation({
    type, description, amount: Number(amount),
    categoryLabel: meta.label,
    account: { name: account.name, icon: account.icon },
    newBalance, budgetBlock, assumedSource, footer,
  }) + (type === 'expense' ? anomalyNoteFrom(_preHist, amount) : '');
  return _reply + await matchPluggyNote(cid, { amount, direction: type === 'income' ? 'in' : 'out', date, pfTxnId: _txn && _txn.id });
}

// SEGURANCA (spec §6.2): cid SEMPRE = collab.id (remetente resolvido server-side). NUNCA params.collaborator_id.
// Camada 2 (sempre-confirmar): resolve a fonte de CADA lançamento e devolve itens p/ a
// montagem + os {action,params} PINADOS (fonte fixada por nome exato) p/ execução
// determinística no "sim". NÃO insere nada. allClean=false → o turno cai no fluxo atual.
async function stageLaunches(cid, actions, userText) {
  const items = []; const pinned = []; let ok = true;
  // Parcela só vaza em LISTA (um "3x" colado em vários itens). Só reconcilia parcela quando há UM
  // cartão no turno; lista → confia no item-a-item do LLM. (Rose 22/06 FIN-INSTALLMENTS-LEAK-LIST)
  const _onlyOneCard = actions.filter((a) => a.action === 'card_purchase').length === 1;
  const catsFor = async () => {
    const _cats = await financeService.listCategorySlugs(cid).catch(() => []);
    return new Set(_cats.filter((r) => r.collaborator_id).map((r) => r.slug));
  };
  // Competência da FATURA pra prévia (Rose 14/07: "vai lançar em qual fatura?" — a montagem não
  // dizia). Espelha o insert: override explícito (params.competencia, só existe no card_purchase)
  // vence; senão data+fechamento em UTC, igual insertCardPurchase. Data inválida → hoje (o insert
  // quebraria de qualquer jeito; aqui a prévia não pode quebrar).
  const _previewComp = (card, dateStr, compOverride) => {
    const m = String(compOverride || '').match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-01`;
    const base = /^\d{4}-\d{2}-\d{2}/.test(String(dateStr || '')) ? new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z') : new Date();
    return financeService.competenciaFor(base, card.closing_day);
  };
  for (const a of actions) {
    const p = { ...(a.params || {}) };
    if (a.action === 'card_purchase') {
      if (_onlyOneCard) {
        const rec = reconcileInstallments(p.installments, userText);
        if (rec.corrected) p.installments = rec.installments;
      }
      const amount = Number(p.amount);
      if (!amount || amount <= 0) { ok = false; break; }
      const cards = await financeService.findCard(cid, p.card || '');
      if (cards.length !== 1) { ok = false; break; }            // ambíguo/não-achou → fluxo atual
      const card = cards[0];
      const category = safeCategory(p.category, p.description, 'expense', await catsFor());
      pinned.push({ action: 'card_purchase', params: { ...p, card: card.name, category } });
      items.push({ op: 'card_purchase', source: { kind: 'card', id: card.id, name: card.name },
        txn: { type: 'expense', amount, description: p.description, category, installments: parseInt(p.installments || 1, 10), date: p.date, competencia: _previewComp(card, p.date, p.competencia) } });
    } else { // register_transaction
      const type = p.type || 'expense';
      const amount = Number(p.amount);
      if (!amount || amount <= 0) { ok = false; break; }
      const category = safeCategory(p.category, p.description, type, await catsFor());
      const srcName = p.account_name || p.account || p.carteira || p.conta || p.card;
      const srcMethod = p.method || p.metodo || p.via || '';
      const src = srcName ? await financeService.resolveSource(cid, srcName, { type, method: srcMethod }) : { kind: 'none' };
      let source = null; const pin = { ...p, category };
      if (src.kind === 'ambiguous') { ok = false; break; }       // cartão×conta → fluxo atual (binary)
      else if (src.kind === 'card' && type === 'expense') { source = { kind: 'card', id: src.card.id, name: src.card.name }; pin.account_name = src.card.name; }
      else if (src.kind === 'account') { source = { kind: 'account', id: src.account.id, name: src.account.name }; pin.account_name = src.account.name; }
      else {
        const primary = await financeService.findPrimaryAccount(cid);
        if (!primary) { ok = false; break; }                     // 0/multi-sem-principal → fluxo atual
        source = { kind: 'account', id: primary.id, name: primary.name }; pin.account_name = primary.name;
      }
      pinned.push({ action: 'register_transaction', params: pin });
      // recordCardPurchase NÃO recebe competencia → o espelho aqui é só data+fechamento (sem override).
      items.push({ op: source.kind === 'card' ? 'card_purchase' : 'cash', source,
        txn: { type, amount, description: p.description, category, installments: parseInt(p.installments || 1, 10), date: p.date, ...(source.kind === 'card' ? { competencia: _previewComp(src.card, p.date) } : {}) } });
    }
  }
  return { items, actions: pinned, allClean: ok && items.length === actions.length };
}

// Camada 2 (pay_invoice): resolve a fatura pra CONFIRMAÇÃO determinística — espelha o
// handler pay_invoice SEM pagar, e acha a tarefa de lembrete pra fechar junto. NÃO paga.
// Retorna null → cai no fluxo atual (handler pergunta o cartão / avisa "fatura zerada").
async function stagePayInvoice(cid, params) {
  const cards = await financeService.findCard(cid, (params && params.card) || '');
  if (cards.length !== 1) return null;
  const card = cards[0];
  // RAIZ do caso Rose 14/08: sem mês explícito, usa a fatura FECHADA em aberto (a devida),
  // não o ciclo aberto — que ainda acumula lançamentos e costuma estar zerado logo após o
  // fechamento. Ver invoice-pagar-competencia.js.
  const comp = (params && params.competencia) || await financeService.defaultPayableCompetencia(cid, card);
  const inv = await financeService.cardInvoice(cid, card.id, comp);
  if (!(inv.total > 0)) return null;
  const amount = Number(params && params.amount) > 0 ? Number(params.amount) : inv.remaining;
  if (!(amount > 0)) return null;
  let fromName = null;
  if (params && params.from_account) {
    const accs = (await financeService.listAccounts(cid)).filter((a) => String(a.name).toLowerCase().includes(String(params.from_account).toLowerCase()));
    if (accs.length === 1) fromName = accs[0].name;
  }
  let close_tasks = []; let taskTitles = [];
  try {
    const tok = String(card.name || '').toLowerCase().split(/\s+/)[0];
    const { data: ts } = await supabase.from('tasks')
      .select('id, title').eq('assigned_to', cid).eq('status', 'pending').ilike('title', '%fatura%');
    const linked = (ts || []).filter((t) => tok && String(t.title || '').toLowerCase().includes(tok));
    close_tasks = linked.map((t) => t.id);
    taskTitles = linked.map((t) => t.title);
  } catch (e) { console.warn('[PayInvoiceStage] task lookup err:', e.message); }
  return {
    action: { action: 'pay_invoice', params: { card: card.name, competencia: comp, amount, from_account: fromName || (params && params.from_account) } },
    close_tasks,
    display: { cardName: card.name, amount, competencia: comp, fromName, taskTitles },
  };
}

async function handleFinanceAction(collab, action, params, outcome = {}) {
  const cid = collab.id;
  const p = normalizeParams(params || {});
  const financeFmt = require('./services/finance-format');
  // Normaliza categoria vinda do LLM → chave canônica do CAT_META, ou null se não casar.
  const _normCat = (c) => {
    if (!c) return null;
    const k = String(c).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    return financeFmt.CAT_META[k] ? k : null;
  };

  switch (action) {
    case 'pluggy_query': {
      // Consulta realtime à conta real (Pluggy) — saldo / fatura / investimento. Fetch fresh.
      const kind = String(params.kind || params.tipo || 'saldo');
      const banco = params.banco || params.bank || params.conta || params.cartao || null;
      const fmt = require('./finance/pluggy-query-format');
      // Blindagem multi-usuário: a instrução de pluggy_query mora SÓ na skill conta-real (carrega
      // apenas com Pluggy). Se ainda assim cair aqui SEM Open Finance conectado (ex.: Rose/Matheus),
      // responde com o APP — NUNCA "não achei conta conectada", que confundiria quem não usa Pluggy.
      let _temPluggy = false;
      try { _temPluggy = await financeService.hasPluggyItems(cid); } catch { _temPluggy = false; }
      if (!_temPluggy) {
        const _brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (/invest|caix|rendiment|poupan|cdb/i.test(kind)) {
          return 'Pra ver investimento/caixinha em tempo real eu preciso do seu banco conectado (Open Finance) — isso ainda não tá ligado na sua conta. 🙂';
        }
        if (/fatura|cart[aã]o|invoice/i.test(kind)) {
          const _invs = await financeService.pendingCardInvoices(cid).catch(() => []);
          if (!_invs.length) return 'Você não tem fatura de cartão em aberto no app agora. 🙂';
          return _invs.map((i) => `💳 *${i.cardName}*: R$ ${_brl(i.remaining)}${i.dueDay ? ` · vence dia ${i.dueDay}` : ''}`).join('\n');
        }
        const _accs = await financeService.listAccounts(cid).catch(() => []);
        if (!_accs.length) return 'Você ainda não cadastrou carteira no app. 🙂';
        const _tot = _accs.reduce((s, a) => s + (Number(a.balance) || 0), 0);
        let _m = '💰 *Seus saldos:*\n' + _accs.map((a) => `• ${a.name}: R$ ${_brl(a.balance)}`).join('\n');
        if (_accs.length > 1) _m += `\n\n*Total: R$ ${_brl(_tot)}*`;
        return _m;
      }
      const pq = require('./services/pluggy-query');
      try {
        if (/fatura|cart[aã]o|invoice/i.test(kind)) {
          const _todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
          return fmt.buildFaturaMsg(await pq.cardInvoices(cid, banco), _todayYmd);
        }
        if (/invest|caix|rendiment|poupan|cdb/i.test(kind)) return fmt.buildInvestMsg(await pq.investments(cid, banco));
        return fmt.buildSaldoMsg(await pq.bankBalances(cid, banco));
      } catch (e) {
        console.error('[pluggy_query]', e.message);
        return 'Não consegui consultar sua conta real agora (o banco pode estar reconectando). Tenta de novo daqui a pouco? 🙏';
      }
    }
    case 'reconcile_resolve': {
      // Conciliação: usuário mandou IGNORAR ou marcar INTERNO um pendente (não lança, tira da lista).
      const ref = params.ref || params.descricao || params.valor || params.amount || params.desc;
      const acao = params.action || params.acao || 'ignorar';
      const pr = require('./services/pluggy-reconcile');
      const hit = await pr.resolvePendingByRef(cid, { ref, action: acao });
      if (!hit) return 'Não achei esse movimento na sua lista de pendências — me diz o valor exato que eu resolvo.';
      outcome.persisted = true;
      return hit.status === 'internal'
        ? '✅ Marquei como transferência sua / interno — não lanço e tirei da lista. 👍'
        : '✅ Ignorei esse movimento e tirei da lista de pendências. 👍';
    }
    case 'register_transaction': {
      if (!p.amount || p.amount <= 0) return '❓ Qual foi o valor?';
      const type = p.type || 'expense';
      const _cats = await financeService.listCategorySlugs(cid).catch(() => []);
      const _extra = new Set(_cats.filter((r) => r.collaborator_id).map((r) => r.slug));
      const category = safeCategory(p.category, p.description, type, _extra);
      const srcName = params.account_name || params.account || params.carteira || params.conta || params.card || p.account_name;
      const srcMethod = params.method || params.metodo || params.via || p.method || '';

      // FONTE OBRIGATÓRIA (robusta): engine resolve, type-aware. Nunca grava órfã, nunca depende do LLM no turno-2.
      const src = srcName ? await financeService.resolveSource(cid, srcName, { type, method: srcMethod }) : { kind: 'none' };
      const txnPayload = { type, category, amount: Number(p.amount), description: p.description, date: p.date };

      // Colisão carteira×cartão → pendência binária (cartão ou conta?)
      if (src.kind === 'ambiguous') {
        await pendingIntents.openIntent(cid, 'finance_source', {
          form: 'binary',
          txn: txnPayload,
          account: { kind: 'account', id: src.account.id, name: src.account.name },
          card: { kind: 'card', id: src.card.id, name: src.card.name },
        }, `${src.account.name}: cartão ou conta?`);
        return `🤔 *${src.account.name}* é carteira e cartão. Foi no *cartão* ou na *conta*?\n_(dica: diz "no crédito" ou "no débito/pix" que eu já anoto direto 😉)_`;
      }

      // Cartão + despesa → fatura
      if (src.kind === 'card' && type === 'expense') {
        return await recordCardPurchase(cid, src.card, { amount: p.amount, description: p.description, category, installments: params.installments, date: p.date }, outcome);
      }

      // Fonte explícita resolvida em carteira → grava
      if (src.kind === 'account') {
        return await writeCashTransaction(cid, {
          type, category, amount: p.amount, description: p.description, date: p.date, account: src.account,
        }, outcome);
      }

      // Daqui pra baixo: sem fonte resolvível (none, ou cartão numa receita).
      // 1) Conta principal → grava silencioso MAS nomeia a principal.
      const primary = await financeService.findPrimaryAccount(cid);
      if (primary) {
        return await writeCashTransaction(cid, {
          type, category, amount: p.amount, description: p.description, date: p.date,
          account: primary, assumedSource: primary.name,
        }, outcome);
      }

      // 2) Tem contas (≥2, sem principal) → pergunta + pending-state.
      const accounts = src.accounts || await financeService.listAccounts(cid);
      const cards = src.cards || await financeService.listCards(cid);
      if (accounts.length > 0) {
        const candidates = [
          ...accounts.map((a) => ({ kind: 'account', id: a.id, name: a.name })),
          ...(type === 'expense' ? cards.map((c) => ({ kind: 'card', id: c.id, name: c.name })) : []),
          { kind: 'cash', id: null, name: 'Dinheiro' },
        ];
        const question = financeFmt.buildSourceQuestion({ type, amount: Number(p.amount), accounts, cards });
        await pendingIntents.openIntent(cid, 'finance_source', {
          form: 'list',
          txn: txnPayload,
          candidates,
        }, question);
        return question;
      }

      // 3) 0 contas cadastradas → NÃO grava → coaching pro app (TOM Coach P6).
      return `Pra eu manter seu saldo certinho, preciso saber de onde saiu/entrou 💡\n\nCadastra suas contas e cartões no app primeiro — *Finanças → Carteiras / Cartões*. Aí é só me mandar "gastei 45" que eu já sei de onde tirar. (Pra gasto em espécie, é só dizer "em dinheiro".)`;
    }
    case 'delete_transaction': {
      const { resolveTxnTarget } = require('./finance/txn-target');
      const recent = await financeService.listRecentTransactions(cid, { hours: EDIT_WINDOW_HOURS, limit: 10 });
      if (!recent.length) return 'Não achei lançamento recente pra apagar — pra coisas mais antigas, edita lá no app 🙂';
      const r = resolveTxnTarget(String(params.which || params.ref || ''), recent);
      if (r.kind === 'none') return 'Não achei qual lançamento. Diz o valor ou o nome (ex: "a do mercado").';
      if (r.kind === 'many') {
        await pendingIntents.openIntent(cid, 'finance_source', {
          form: 'txn_pick', op: 'delete',
          candidates: r.candidates.map((c) => ({ kind: 'txn', id: c.id, name: c.description || c.category, purchase_group: c.purchase_group })),
        }, 'Qual lançamento?');
        return financeFmt.txnList('Qual deles?', r.candidates);
      }
      const txn = r.txn;
      let n = 1;
      if (txn.card_id && txn.purchase_group) n = await financeService.deleteTransactionGroup(cid, txn.purchase_group);
      else await financeService.deleteTransaction(cid, txn.id);
      outcome.persisted = true; // Fatia C
      return `🗑️ Apaguei *${txn.description || txn.category}* (${financeFmt.money(Number(txn.amount))})${n > 1 ? ` — ${n} parcelas` : ''}. Saldo reajustado.`;
    }
    case 'edit_transaction': {
      const { resolveTxnTarget } = require('./finance/txn-target');
      const recent = await financeService.listRecentTransactions(cid, { hours: EDIT_WINDOW_HOURS, limit: 10 });
      if (!recent.length) return 'Não achei lançamento recente pra corrigir — pra coisas mais antigas, edita no app 🙂';
      const r = resolveTxnTarget(String(params.which || params.ref || ''), recent);
      if (r.kind !== 'one') return 'Qual lançamento? Diz o valor ou o nome (ex: "a do mercado").';
      const txn = r.txn;
      if (txn.card_id && txn.purchase_group && Number(txn.installments_total || 1) > 1 && params.amount !== undefined) {
        return 'Essa é uma compra parcelada no cartão — pra mudar o valor, melhor apagar ("exclui essa") e relançar. Posso ajustar só categoria/descrição.';
      }
      const patch = {};
      if (params.amount !== undefined) patch.amount = Number(params.amount);
      if (params.category) {
        const _cats = await financeService.listCategorySlugs(cid).catch(() => []);
        const nc = resolveCategorySlug(params.category, _cats.filter((r) => r.collaborator_id));
        if (nc) patch.category = nc;
      }
      if (params.description !== undefined) patch.description = params.description;
      if (params.account_name) {
        const src = await financeService.resolveSource(cid, params.account_name);
        if (src.kind === 'account') patch.account_id = src.account.id;
      }
      if (!Object.keys(patch).length) return 'O que você quer corrigir? (valor, categoria, descrição ou conta)';
      const updated = await financeService.updateTransaction(cid, txn.id, patch);
      outcome.persisted = true; // Fatia C
      const meta = financeFmt.CAT_META[updated.category] || { label: updated.category };
      return `✏️ Corrigido: *${updated.description || meta.label}* — ${financeFmt.money(Number(updated.amount))} · ${meta.label}. Saldo reajustado.`;
    }
    case 'query_transactions': {
      const cat = _normCat(params.category);
      const rows = await financeService.queryTransactions(cid, { category: cat, type: params.type || null, limit: params.limit || 8 });
      if (!rows.length) return cat ? `Não achei gastos em ${cat} nesse período.` : 'Não achei lançamentos.';
      return financeFmt.txnList(cat ? `Seus últimos de ${cat}:` : 'Seus últimos lançamentos:', rows);
    }
    case 'register_bill': {
      const recurrence = params.recurrence === 'once' ? 'once' : 'monthly';
      // CARD-DUE-RECURRING-GAP (Rose 11/06): guarda determinística ANTES do insert.
      // pf_bills.amount é NOT NULL; "lembrete de vencimento de cartão" não tem valor → o LLM
      // emitia register_bill sem amount e o insert estourava NOT NULL → throw "Deu ruim" 3x sem
      // criar nada. Vencimento de cartão = pf_cards.due_day (lembrado no digest financeiro da
      // manhã). Aqui: sem amount válido → roteia pro cartão (se casar) ou pede o valor — nunca crasha.
      {
        const { classifyRegisterBill, hasValidAmount } = require('./finance/register-bill-classify');
        // Resolve cartão só quando NÃO há valor (roteia "lembrete de vencimento de cartão").
        let _match = null;
        if (!hasValidAmount(params.amount)) {
          const _cardName = params.card || params.name || '';
          const _cards = _cardName ? await financeService.findCard(cid, _cardName) : [];
          _match = _cards.find((c) => c.name.toLowerCase() === String(_cardName).toLowerCase())
            || (_cards.length === 1 ? _cards[0] : null);
        }
        const _d = classifyRegisterBill(params, _match);
        if (_d.kind === 'card_confirm') {
          outcome.persisted = true;
          return `✅ Pode deixar! Já te lembro do vencimento do cartão *${_d.card.name}* (dia ${_d.dueDay}) no resumo financeiro da manhã, 2 dias antes. 👽`;
        }
        if (_d.kind === 'card_set') {
          await financeService.updateCard(cid, _d.card.id, { due_day: _d.dueDay });
          outcome.persisted = true;
          return `✅ Configurado! Vou te lembrar do vencimento do cartão *${_d.card.name}* (dia ${_d.dueDay}) no resumo financeiro da manhã, 2 dias antes. 👽`;
        }
        if (_d.kind === 'card_ask_day') {
          outcome.persisted = false; // honesto: nada persistido → marker vira 'skipped', não 'rejected'
          return `Pra te lembrar do vencimento do cartão *${_d.card.name}*, me diz só o *dia do vencimento* (ex.: "vence dia 10") que eu já configuro. 👽`;
        }
        if (_d.kind === 'ask_value') {
          // não é cartão e não tem valor → pede o valor, sem cadastrar nem crashar.
          outcome.persisted = false;
          return `Pra cadastrar a conta${params.name ? ' *' + params.name + '*' : ''} eu preciso do *valor*. Me manda quanto é (ex.: "R$ 120 todo dia 10") que eu anoto. 👽`;
        }
        if (_d.kind === 'bill_ask_day') {
          // DUE_DAY-NULL (Rose 14/06): conta fixa recorrente com valor mas SEM dia de
          // vencimento — antes ia direto pro createBill e estourava NOT NULL (due_day).
          // Pede o dia em vez de crashar (espelha card_ask_day).
          outcome.persisted = false;
          return `Pra cadastrar a conta fixa${_d.name ? ' *' + _d.name + '*' : ''} (R$${_d.amount}) eu preciso do *dia do vencimento*. Me diz o dia (ex.: "vence dia 10") que eu cadastro. 👽`;
        }
      }
      const b = await financeService.createBill(cid, {
        name: params.name, amount: params.amount,
        due_day: params.due_day,
        due_date: params.due_date || null,
        recurrence,
        category: params.category || mapCategory(params.name || ''),
        type: params.type || 'expense', remind_days_before: params.remind_days_before,
      });
      outcome.persisted = true; // Fatia C
      const quando = recurrence === 'once' ? `vence ${b.due_date}` : `todo dia ${b.due_day}`;
      // Prosa HONESTA (Raiz 3): createBill deduplica conta fixa monthly (find-or-upsert). Quando a
      // conta já existia, foi ATUALIZADA, não criada — não confabular "cadastrei" sobre um update.
      if (b.updated) return `✅ Atualizei a conta fixa *${b.name}* que já tava cadastrada (R$${b.amount}, ${quando}).`;
      return `✅ Conta cadastrada: ${b.name} (R$${b.amount}, ${quando}).`;
    }
    case 'delete_bill': {
      // Excluir conta fixa pelo chat (gap descoberto no teste do Alf 14/06: o LLM emitia
      // delete_bill, action_invalida → o engine rejeitava e o LLM narrava "removendo agora" SEM remover).
      const cands = await financeService.findBills(cid, params.bill_name || params.name || '');
      if (cands.length === 0) return 'Não achei conta fixa com esse nome pra excluir. 🤔';
      if (cands.length > 1) return 'Achei mais de uma: ' + cands.map((c, i) => `${i + 1}) ${c.name}`).join(', ') + '. Qual delas?';
      const bill = cands[0];
      await financeService.deactivateBill(cid, bill.id);
      outcome.persisted = true;
      return `🗑️ Conta fixa *${bill.name}* removida.`;
    }
    case 'set_bill_amount': {
      // Ajusta o valor PREVISTO de uma conta fixa num MÊS específico (override mensal). NÃO muda o base.
      const cands = await financeService.findBills(cid, params.bill_name || params.name || '');
      if (cands.length === 0) return 'Não achei conta fixa com esse nome pra ajustar. 🤔';
      if (cands.length > 1) return 'Achei mais de uma: ' + cands.map((c, i) => `${i + 1}) ${c.name}`).join(', ') + '. Qual delas?';
      const bill = cands[0];
      const _comp = require('./finance/bill-month').parseBillMonth(params.month || params.competencia || params.mes || params.month_year, todaySaoPaulo());
      if (!_comp) { outcome.persisted = false; return `Pra ajustar a *${bill.name}* me diz o mês (ex.: "agosto" ou "2026-08"). 👽`; }
      const _MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
      const _mesLabel = `${_MES[Number(_comp.slice(5, 7)) - 1]} de ${_comp.slice(0, 4)}`;
      const _base = Number(bill.amount);
      const _remove = params.remove === true || params.clear === true || params.reset === true || (params.amount != null && Number(params.amount) <= 0);
      if (_remove) {
        await financeService.deleteBillOverride(cid, bill.id, _comp);
        outcome.persisted = true;
        return `✅ Tirei o ajuste da *${bill.name}* em ${_mesLabel} — esse mês volta pro valor padrão (${financeFmt.money(_base)}).`;
      }
      const _amt = Number(params.amount);
      if (!Number.isFinite(_amt) || _amt <= 0) { outcome.persisted = false; return `Pra ajustar a *${bill.name}* em ${_mesLabel} me diz o novo valor (ex.: "R$ 350"). 👽`; }
      await financeService.setBillOverride(cid, bill.id, _comp, _amt);
      outcome.persisted = true;
      return `✅ Ajustei a *${bill.name}* pra ${financeFmt.money(_amt)} *só em ${_mesLabel}* — os outros meses seguem no valor padrão (${financeFmt.money(_base)}).`;
    }
    case 'pay_bill': {
      const cands = await financeService.findBills(cid, params.bill_name || params.name || '');
      if (cands.length === 0) return 'Não achei conta com esse nome.';
      if (cands.length > 1) return 'Achei mais de uma: ' + cands.map((c, i) => `${i + 1}) ${c.name}`).join(', ') + '. Qual delas?';
      const bill = cands[0];
      const date = p.date || undefined;
      // Valor previsto do MÊS CORRENTE: override (>0) > base (feature override mensal). findBills traz id.
      let _previstoMes = Number(bill.amount);
      try {
        const _comp = todaySaoPaulo().slice(0, 7) + '-01';
        const _ov = await financeService.billOverridesForMonth(cid, _comp);
        _previstoMes = require('./utils/bill-amount').resolveBillAmount(bill, _ov[bill.id]);
      } catch (_e) { /* degrade-safe: cai no valor base */ }
      const amount = (p.amount != null && Number(p.amount) > 0) ? Number(p.amount) : _previstoMes;
      const srcName = params.account_name || params.account || params.carteira || params.conta || params.card || p.account_name;
      const srcMethod = params.method || params.metodo || params.via || p.method || '';
      const src = srcName ? await financeService.resolveSource(cid, srcName, { type: bill.type, method: srcMethod }) : { kind: 'none' };

      // Colisão carteira×cartão (ex.: "Nubank" é os dois) → pendência binária carregando a conta.
      if (src.kind === 'ambiguous') {
        await pendingIntents.openIntent(cid, 'finance_source', {
          form: 'binary',
          txn: { type: bill.type, category: bill.category, amount, description: bill.name, date },
          bill: { id: bill.id, name: bill.name, recurrence: bill.recurrence, type: bill.type },
          account: { kind: 'account', id: src.account.id, name: src.account.name },
          card: { kind: 'card', id: src.card.id, name: src.card.name },
        }, `${src.account.name}: cartão ou conta?`);
        return `🤔 *${src.account.name}* é carteira e cartão. Foi no *cartão* ou na *conta*?\n_(dica: diz "no crédito" ou "no débito/pix" que eu já anoto direto 😉)_`;
      }

      let reply;
      if (src.kind === 'card' && bill.type !== 'income') {
        reply = await recordCardPurchase(cid, src.card, { amount, description: bill.name, category: bill.category, installments: 1, date, bill_id: bill.id }, outcome);
        reply = `✅ *${bill.name}* paga.\n\n` + reply;
      } else if (src.kind === 'account') {
        reply = await writeCashTransaction(cid, { type: bill.type, category: bill.category, amount, description: bill.name, date, account: src.account, bill_id: bill.id }, outcome);
        reply = `✅ *${bill.name}* paga.\n\n` + reply;
      } else {
        // none: caixa sem carteira (comportamento atual), no valor REAL.
        await financeService.insertTransaction(cid, { type: bill.type, category: bill.category, amount, description: bill.name, transaction_date: date, bill_id: bill.id });
        outcome.persisted = true;
        reply = `✅ *${bill.name}* paga (${financeFmt.money(amount)}).`;
      }
      // Quitação = HOJE, desacoplado de `date` (data do lançamento/fatura — pode mirar mês
      // passado). Senão a conta fica eternamente "atrasada". FIN-PAYBILL-DATE-COUPLING.
      await financeService.markBillPaid(cid, bill);
      if (Math.round(amount * 100) !== Math.round(_previstoMes * 100)) {
        reply += `\n_(previu ${financeFmt.money(_previstoMes)} · pagou ${financeFmt.money(amount)})_`;
      }
      return reply;
    }
    case 'create_goal': {
      const g = await financeService.createGoal(cid, {
        name: params.name, target_amount: params.target_amount,
        monthly_contribution: params.monthly_contribution, deadline: params.deadline, icon: params.icon,
      });
      outcome.persisted = true; // Fatia C
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
      const goal = cands[0];
      const add = Number(params.add_amount || 0);
      if (!(add > 0)) return 'Quanto você quer guardar?';
      await financeService.addGoalContribution(cid, goal.id, { amount: add }); // trigger atualiza
      outcome.persisted = true; // Fatia C
      const novo = Number(goal.current_amount) + add;
      const pct = Math.round((novo / goal.target_amount) * 100);
      return `✅ Guardou R$${add} em ${goal.name}. Progresso: ${pct}% (R$${novo}/R$${goal.target_amount}).`;
    }
    case 'edit_goal': {
      const cands = await financeService.findGoal(cid, params.goal_name || params.name || '');
      if (cands.length === 0) return 'Não achei essa meta.';
      const patch = {};
      for (const k of ['name', 'target_amount', 'monthly_contribution', 'deadline', 'icon']) {
        if (params[k] !== undefined) patch[k] = params[k];
      }
      const g = await financeService.updateGoal(cid, cands[0].id, patch);
      outcome.persisted = true; // Fatia C
      return `✏️ Meta atualizada: ${g.icon || '🎯'} ${g.name} (alvo R$${g.target_amount}).`;
    }
    case 'delete_goal': {
      const cands = await financeService.findGoal(cid, params.goal_name || params.name || '');
      if (cands.length === 0) return 'Não achei essa meta.';
      await financeService.deactivateGoal(cid, cands[0].id);
      outcome.persisted = true; // Fatia C
      return `🗄️ Meta "${cands[0].name}" arquivada.`;
    }
    case 'set_budget': {
      const b = await financeService.setBudget(cid, { category: params.category, monthly_limit: params.monthly_limit });
      outcome.persisted = true; // Fatia C
      return `✅ Orçamento de ${b.category}: R$${b.monthly_limit}/mês.`;
    }
    case 'create_account': {
      const slug = financeService.matchBankSlug(params.name || '');
      const color = slug ? financeService.bankColor(slug) : null;
      const a = await financeService.createAccount(cid, { name: params.name, type: params.type, icon: params.icon, goal_monthly: params.goal_monthly, bank_slug: slug, color });
      outcome.persisted = true; // Fatia C
      return `✅ Carteira criada: ${a.icon || '🏦'} ${a.name}.`;
    }
    case 'edit_account': {
      const acc = await financeService.findAccountByName(cid, params.account_name || params.name || '');
      if (!acc) return 'Não achei essa carteira.';
      const patch = {};
      for (const k of ['name','type','icon','goal_monthly']) if (params[k] !== undefined) patch[k] = params[k];
      if (params.bank !== undefined) { const s = financeService.matchBankSlug(params.bank); if (s) { patch.bank_slug = s; patch.color = financeService.bankColor(s); } }
      const a = await financeService.updateAccount(cid, acc.id, patch);
      outcome.persisted = true; // Fatia C
      return `✏️ Carteira atualizada: ${a.icon || '🏦'} ${a.name}.`;
    }
    case 'query_accounts': {
      const { buildBalances } = require('./finance/reports/balances');
      const wa = require('./finance/wa-format');
      const accounts = await financeService.listAccounts(cid);
      const cards = await financeService.listCards(cid);
      const cardsUsage = await Promise.all(
        cards.map(async (c) => ({ card: c, usage: await financeService.cardUsage(cid, c) })));
      return wa.renderBalances(buildBalances(accounts, cardsUsage));
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
          outcome.persisted = true; // Fatia C
          return `👽 O cartão *${u.name}* já existia — atualizei: limite ${financeFmt.money(u.credit_limit)}, fecha dia ${u.closing_day}, vence dia ${u.due_day}.`;
        }
        return `👽 Você já tem o cartão *${exato.name}* (limite ${financeFmt.money(exato.credit_limit)}, fecha dia ${exato.closing_day}, vence dia ${exato.due_day}). Quer mudar algum dado?`;
      }
      const c = await financeService.createCard(cid, {
        name: params.name, brand: params.brand, color: params.color,
        credit_limit: params.credit_limit, closing_day: params.closing_day, due_day: params.due_day, icon: params.icon,
      });
      outcome.persisted = true; // Fatia C
      return `👽 Cartão *${c.name}* cadastrado! Limite ${financeFmt.money(c.credit_limit)}, fecha dia ${c.closing_day}, vence dia ${c.due_day}.`;
    }
    case 'card_purchase': {
      const pendingIntents = require('./services/pending-intents');
      const amount = Number(params.amount);
      if (!amount || amount <= 0) return '❓ Qual foi o valor da compra?';
      const installments = parseInt(params.installments || 1, 10);
      const _cats = await financeService.listCategorySlugs(cid).catch(() => []);
      const _extra = new Set(_cats.filter((r) => r.collaborator_id).map((r) => r.slug));
      const category = safeCategory(params.category, params.description, 'expense', _extra);
      const cards = await financeService.findCard(cid, params.card || '');

      // Cartão não resolvido (não achou OU ambíguo) → pergunta DETERMINÍSTICA com
      // pending-state: o consumidor finance_source capta a resposta ("c6") e grava
      // sozinho, sem depender do LLM no turno seguinte. Reusa a infra de fonte.
      if (cards.length !== 1) {
        const all = cards.length > 1 ? cards : await financeService.listCards(cid);
        if (all.length === 0) {
          return `Pra eu lançar essa compra, cadastra o cartão no app primeiro — *Finanças → Cartões*. Aí é só mandar de novo.`;
        }
        const lista = all.map((c, i) => `${i + 1}. 💳 ${c.name}`).join('\n');
        const question = cards.length > 1
          ? `Tenho mais de um cartão parecido com "${params.card}". Em qual foi?\n${lista}`
          : `Não achei o cartão "${params.card}". Em qual dos seus foi?\n${lista}`;
        await pendingIntents.openIntent(cid, 'finance_source', {
          form: 'list',
          txn: { type: 'expense', category, amount, description: params.description, date: params.date, installments },
          candidates: all.map((c) => ({ kind: 'card', id: c.id, name: c.name })),
        }, question);
        return question;
      }
      const card = cards[0];
      const _preHist = await financeService.merchantSpendHistory(cid, params.description).catch(() => []);
      const rows = await financeService.insertCardPurchase(cid, card, {
        category, amount, description: params.description, transaction_date: params.date, installments,
        competencia: params.competencia, // "põe na fatura de maio" → override explícito (engine ignora se vazio/inválido)
      });
      outcome.persisted = true; // Fatia C
      outcome.ids = (rows || []).map((r) => r && r.id).filter(Boolean); // p/ desfazer determinístico (undo_launch)
      const usage = await financeService.cardUsage(cid, card);
      let reply = financeFmt.txnRegistered(card, {
        description: params.description, amount, category, installments, competencia: rows[0].competencia,
      }, usage);
      const al = await financeService.checkAndMarkLimitAlert(cid, card);
      if (al) reply += '\n\n' + financeFmt.limitAlert(card, al.band, al.usage);
      reply += anomalyNoteFrom(_preHist, amount);
      return reply;
    }
    case 'card_refund': {
      // Estorno/devolução/reembolso = CRÉDITO no cartão (valor NEGATIVO) que ABATE a fatura.
      // NÃO é compra (card_purchase rejeitava amount<=0 → loop "qual o valor?") nem apagar. (Rose 14/06)
      const amount = Math.abs(Number(params.amount) || 0);
      if (!amount) return '❓ Qual o valor do estorno?';
      const cards = await financeService.findCard(cid, params.card || '');
      if (cards.length !== 1) {
        const all = await financeService.listCards(cid);
        if (all.length === 0) return `Pra lançar o estorno, cadastra o cartão no app primeiro — *Finanças → Cartões*.`;
        const question = `Em qual cartão entrou o estorno? Tenho: ${all.map((c) => c.name).join(', ')}.`;
        // Pending-intent DETERMINÍSTICO — ver card-pick.js. Sem isto, a resposta seguinte
        // dependia do LLM reconstruir o alvo do zero a cada turno (raiz do loop 14/08).
        const { payloadCardPick } = require('./finance/card-pick');
        await pendingIntents.openIntent(cid, 'finance_source', payloadCardPick('card_refund', params, all), question);
        return question;
      }
      const card = cards[0];
      const _cats = await financeService.listCategorySlugs(cid).catch(() => []);
      const _extra = new Set(_cats.filter((r) => r.collaborator_id).map((r) => r.slug));
      const category = safeCategory(params.category, params.description, 'expense', _extra);
      const desc = params.description
        ? (/estorn|devolu|reembol/i.test(params.description) ? params.description : `Estorno ${params.description}`)
        : 'Estorno';
      const rows = await financeService.insertCardPurchase(cid, card, {
        category, amount: -amount, description: desc, transaction_date: params.date, installments: 1,
        competencia: params.competencia,
      });
      outcome.persisted = true;
      const _comp = (rows[0] && rows[0].competencia) || params.competencia || '';
      const _mes = /^\d{4}-\d{2}/.test(_comp) ? `${_comp.slice(5, 7)}/${_comp.slice(0, 4)}` : '';
      return `↩️ Estorno de *R$ ${Number(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}* lançado no *${card.name}*${_mes ? ` (fatura ${_mes})` : ''}. Abati da fatura. 👍`;
    }
    case 'query_invoice': {
      const cards = await financeService.findCard(cid, params.card || '');
      if (cards.length !== 1) {
        const all = await financeService.listCards(cid);
        const question = `Qual cartão? Tenho: ${all.map((c) => c.name).join(', ') || 'nenhum'}.`;
        if (all.length > 0) {
          const { payloadCardPick } = require('./finance/card-pick');
          await pendingIntents.openIntent(cid, 'finance_source', payloadCardPick('query_invoice', params, all), question);
        }
        return question;
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
        const question = `Qual cartão você pagou? Tenho: ${all.map((c) => c.name).join(', ') || 'nenhum'}.`;
        // CASO ROSE 14/08: ela respondeu "Cartão Nubank" (exato) e levou a MESMA pergunta de
        // novo — nada persistia o alvo entre turnos. Pending-intent determinístico: a resposta
        // seguinte é resolvida aqui (ver o consumidor 'card_pick' mais abaixo), sem depender do
        // LLM reconstruir o contexto. Mesmo padrão já validado em card_purchase.
        if (all.length > 0) {
          const { payloadCardPick } = require('./finance/card-pick');
          await pendingIntents.openIntent(cid, 'finance_source', payloadCardPick('pay_invoice', params, all), question);
        }
        return question;
      }
      const card = cards[0];
      // RAIZ do caso Rose 14/08: sem mês explícito, usa a fatura FECHADA em aberto (a devida),
      // não o ciclo aberto — que ainda acumula lançamentos e costuma estar zerado logo após o
      // fechamento (foi o que produziu "A fatura do Cartão Nubank está zerada."). Ver
      // invoice-pagar-competencia.js.
      const comp = params.competencia || await financeService.defaultPayableCompetencia(cid, card);
      const inv = await financeService.cardInvoice(cid, card.id, comp);
      if (inv.total <= 0) return `A fatura do *${card.name}* está zerada.`;
      const amount = Number(params.amount) > 0 ? Number(params.amount) : inv.remaining;
      let fromId = null;
      if (params.from_account) {
        const accs = (await financeService.listAccounts(cid)).filter((a) => a.name.toLowerCase().includes(String(params.from_account).toLowerCase()));
        if (accs.length === 1) fromId = accs[0].id;
      }
      await financeService.payCardInvoice(cid, card, { competencia: comp, amount, paid_from_account: fromId });
      outcome.persisted = true; // Fatia C
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
      outcome.persisted = true; // Fatia C
      return `🔁 Transferi *${financeFmt.money(amount)}* de *${from.name}* → *${to.name}*. Saldo total inalterado.`;
    }
    case 'query_month_analysis': {
      const { buildMonthAnalysis } = require('./finance/reports/month');
      const { buildBillsToPay } = require('./finance/reports/bills');
      const wa = require('./finance/wa-format');
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const cur = await financeService.monthCategoryBreakdown(cid, now);
      const prevRef = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prev = await financeService.monthCategoryBreakdown(cid, prevRef);
      const accounts = await financeService.listAccounts(cid);
      const saldoAtual = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
      const bills = await financeService.listActiveBills(cid);
      const toPay = buildBillsToPay(bills, [], today);
      const goalsRaw = await financeService.listGoals(cid);
      const goals = goalsRaw.map((g) => ({
        name: g.name, current: Number(g.current_amount) || 0, target: Number(g.target_amount) || 0,
        pct: Number(g.target_amount) > 0 ? Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100) : 0,
      }));
      const model = buildMonthAnalysis({
        monthLabel: financeFmt.mesDaComp(today.slice(0, 7) + '-01'),
        despesas: cur.despesas, receitas: cur.receitas, despesasPrev: prev.despesas,
        byCategory: cur.byCategory, saldoAtual, aPagar: toPay.totalPendente,
        overdueCount: toPay.vencidas.length, goals,
      });
      return wa.renderMonthAnalysis(model);
    }
    case 'query_checkup': {
      const { buildCheckup } = require('./finance/reports/checkup');
      const wa = require('./finance/wa-format');
      const today = new Date().toISOString().slice(0, 10);
      const bills = await financeService.listActiveBills(cid);
      return wa.renderCheckup(buildCheckup(bills, today));
    }
    case 'query_fixed_bills': {
      const { buildFixedBills } = require('./finance/reports/bills');
      const wa = require('./finance/wa-format');
      const today = new Date().toISOString().slice(0, 10);
      const bills = await financeService.listActiveBills(cid);
      return wa.renderFixedBills(buildFixedBills(bills, today));
    }
    case 'query_bills_to_pay': {
      const { buildBillsToPay } = require('./finance/reports/bills');
      const wa = require('./finance/wa-format');
      const today = new Date().toISOString().slice(0, 10);
      const dueDay = params.due_day != null && String(params.due_day).trim() !== '' ? parseInt(params.due_day, 10) : null;
      const bills = await financeService.listActiveBills(cid);
      const cardInvoices = await financeService.pendingCardInvoices(cid).catch(() => []);
      const model = buildBillsToPay(bills, cardInvoices, today, dueDay != null ? { dueDay } : {});
      return wa.renderBillsToPay(model);
    }
    case 'query_period_expenses': {
      const { buildPeriodExpenses } = require('./finance/reports/expenses');
      const wa = require('./finance/wa-format');
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      let from, to, label, prevReport = null;
      if (params.from && params.to) {
        from = params.from; to = params.to; label = 'Gastos do período';
      } else {
        let ref = now;
        if (params.month && /^\d{4}-\d{2}$/.test(params.month)) ref = new Date(`${params.month}-15T12:00:00Z`);
        const mb = financeService.monthBounds(ref);
        const lastDay = new Date(new Date(`${mb.end}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
        const isCurrent = ref.getUTCFullYear() === now.getUTCFullYear() && ref.getUTCMonth() === now.getUTCMonth();
        from = mb.start; to = isCurrent ? todayStr : lastDay;
        label = `Gastos de ${financeFmt.mesDaComp(mb.start)}`;
        const prevRef = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 15));
        const pmb = financeService.monthBounds(prevRef);
        const pLast = new Date(new Date(`${pmb.end}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
        prevReport = await financeService.queryPeriodReport(cid, pmb.start, pLast);
      }
      const report = await financeService.queryPeriodReport(cid, from, to);
      report.label = label;
      return wa.renderPeriodExpenses(buildPeriodExpenses(report, prevReport));
    }
    case 'query_account_detail': {
      const { buildAccountDetail } = require('./finance/reports/account');
      const wa = require('./finance/wa-format');
      const today = new Date().toISOString().slice(0, 10);
      const acc = await financeService.findAccountByName(cid, params.account || params.account_name || params.name || '');
      if (!acc) {
        const accs = await financeService.listAccounts(cid);
        return accs.length
          ? `Não achei essa carteira. Tenho: ${accs.map((a) => a.name).join(', ')}.`
          : 'Você ainda não tem carteiras. Quer criar uma? Ex: _"cria carteira Nubank"_.';
      }
      const txns = await financeService.queryTransactions(cid, { account_id: acc.id, limit: 40 });
      return wa.renderAccountDetail(buildAccountDetail(acc, txns, today));
    }
    case 'query_statement': {
      const { buildStatement } = require('./finance/reports/statement');
      const wa = require('./finance/wa-format');
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      let from, to, label;
      if (params.from && params.to) { from = params.from; to = params.to; label = 'Extrato'; }
      else {
        let ref = now;
        if (params.month && /^\d{4}-\d{2}$/.test(params.month)) ref = new Date(`${params.month}-15T12:00:00Z`);
        const mb = financeService.monthBounds(ref);
        const lastDay = new Date(new Date(`${mb.end}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
        const isCurrent = ref.getUTCFullYear() === now.getUTCFullYear() && ref.getUTCMonth() === now.getUTCMonth();
        from = mb.start; to = isCurrent ? todayStr : lastDay;
        label = `Extrato de ${financeFmt.mesDaComp(mb.start)}`;
      }
      const full = params.full === true || /completo/i.test(String(params.detail || ''));
      let acc = null;
      if (params.account || params.account_name || params.name) acc = await financeService.findAccountByName(cid, params.account || params.account_name || params.name);
      const sourceMap = {};
      if (!acc) {
        for (const a of await financeService.listAccounts(cid)) sourceMap[a.id] = a.name;
        for (const c of await financeService.listCards(cid)) sourceMap[c.id] = c.name;
      }
      const rows = await financeService.queryTransactions(cid, {
        account_id: acc ? acc.id : undefined, dateFrom: from, dateTo: to, limit: 60,
      });
      const model = buildStatement(acc, rows, { label, limit: full ? 60 : 12, sourceMap: acc ? null : sourceMap });
      return wa.renderStatement(model);
    }
    case 'query_daily_summary': {
      const { buildDailySummary } = require('./finance/reports/summaries');
      const wa = require('./finance/wa-format');
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const day = (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) ? params.date : todayStr;
      const report = await financeService.queryPeriodReport(cid, day, day);
      const accounts = await financeService.listAccounts(cid);
      const saldoTotal = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
      const label = day === todayStr ? 'Balanço de hoje' : `Balanço de ${day.slice(8, 10)}/${day.slice(5, 7)}`;
      return wa.renderDailySummary(buildDailySummary({ label, report, saldoTotal }));
    }
    case 'query_weekly_summary': {
      const { buildWeeklySummary } = require('./finance/reports/summaries');
      const { weekBounds, shiftDays } = require('./finance/report-domain');
      const wa = require('./finance/wa-format');
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const wb = weekBounds(now);
      const to = todayStr < wb.end ? todayStr : wb.end; // semana corrente até hoje
      const report = await financeService.queryPeriodReport(cid, wb.start, to);
      const prev = await financeService.queryPeriodReport(cid, shiftDays(wb.start, -7), shiftDays(wb.start, -1));
      return wa.renderWeeklySummary(buildWeeklySummary({ label: 'Resumo da semana', report, prev }));
    }
    case 'query_monthly_closing': {
      const { buildMonthlyClosing } = require('./finance/reports/summaries');
      const wa = require('./finance/wa-format');
      const now = new Date();
      let ref;
      if (params.month && /^\d{4}-\d{2}$/.test(params.month)) ref = new Date(`${params.month}-15T12:00:00Z`);
      else ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)); // default: mês anterior (fechado)
      const mb = financeService.monthBounds(ref);
      const lastDay = new Date(new Date(`${mb.end}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
      const report = await financeService.queryPeriodReport(cid, mb.start, lastDay);
      const prevRef = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 15));
      const pmb = financeService.monthBounds(prevRef);
      const pLast = new Date(new Date(`${pmb.end}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
      const prev = await financeService.queryPeriodReport(cid, pmb.start, pLast);
      const goalsRaw = await financeService.listGoals(cid);
      const goals = goalsRaw.map((g) => ({
        name: g.name, current: Number(g.current_amount) || 0, target: Number(g.target_amount) || 0,
        pct: Number(g.target_amount) > 0 ? Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100) : 0,
      }));
      const label = `Fechamento de ${financeFmt.mesDaComp(mb.start)}`;
      return wa.renderMonthlyClosing(buildMonthlyClosing({ label, report, prev, goals }));
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
    // Fatia 1 (confirmação seca → tarefa recém-lembrada): setado SÓ no sucesso/idempotência
    // real da conclusão determinística. Dobra no `nothingPersisted` do enforceNoMarkerHonesty
    // pra o guard não desmentir uma ação que FOI executada (freio #4).
    deterministic_complete_ok: false,
  };

  // Sprint 32 — Decompositor de áudio longo. Quando o transcript é grande e tem
  // múltiplas intenções, faz uma pré-passada LLM enxuta (sem ~100KB de skills)
  // só pra extrair a lista. Reescreve `text` com a lista enumerada anexada pra
  // que o LLM principal não precise extrair sozinho competindo contra o timeout.
  // Causa-raiz: caso Peterson — áudio com 6+ demandas virava ACTIONABLE_NO_MARKER
  // porque a chamada única não dava conta de transcrever+decidir+emitir tudo.
  // 🗺️ O Mapa (Fase 1) — classifica a intenção ANTES do decompositor. conversational + flag ON →
  // pula o decompositor e (em :9640) monta prompt minimal. Gated por TOM_MAPA; default = hoje byte a byte.
  const _mapa = TOM_MAPA ? classifyIntent(text, []) : { intent: 'operational', loadout: null };
  const _isConv = _mapa.intent === 'conversational';
  if (TOM_MAPA) console.log(`[Mapa] intent=${_mapa.intent} phone=${_phoneTail}`);
  const _decompose = _isConv
    ? { decomposed: false, reason: 'conversational_skip' }
    : await audioDecompose.decomposeIfLarge(text);
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
  // Fatia 3 do router — id da mensagem RECEBIDA. Até aqui `inbound_com_id` era ZERO no
  // banco inteiro: sem o id não existe como saber "essa mensagem eu já processei", que é
  // o que impede o replay de restart de responder duas vezes.
  // Não muda leitura nenhuma: o reply-quote (engine ~9800) filtra `ref_id not null` e
  // inbound nasce sem ref_id — varri os leitores antes de gravar.
  // Quando o webhook agrupa mensagens seguidas (buffer flush), `raw` é a ÚLTIMA do lote:
  // o id gravado identifica o lote pela última fala, não por todas.
  let _inboundWaId = null;
  try { _inboundWaId = whatsapp.extractMessageId(raw); } catch (_) { _inboundWaId = null; }
  await logConversation(collab.id, 'inbound', text, _inboundWaId);

  // ---- Pending intents: lê UMA vez por mensagem (compartilhado finance_source + Sprint 30.3) ----
  let _openIntents = [];
  try { _openIntents = await pendingIntents.listOpenIntents(collab.id, { limit: 3 }); }
  catch (e) { console.warn('[PendingIntents] list err:', e.message); }

  // ---- DESFAZER determinístico do último lançamento ("apaga tudo"/"desfaz") ----
  // Rose 11/07 23:44: "Apaga tudo" caiu no LLM e morreu sob timeout/fallback → ela apagou manual.
  // Aqui o engine apaga EXATAMENTE os ids do lote recém-lançado (intent undo_launch), sem LLM.
  try {
    const _undoOpen = _openIntents.find((i) => i.kind === 'finance_source' && i.payload && i.payload.form === 'undo_launch' && withinConfirmWindow(i.asked_at, 15));
    if (_undoOpen && launchConfirm.detectUndoLaunch(String(text || ''))) {
      const _ids = Array.isArray(_undoOpen.payload.txn_ids) ? _undoOpen.payload.txn_ids : [];
      let _n = 0;
      for (const _id of _ids) { try { await financeService.deleteTransaction(collab.id, _id); _n++; } catch (e) { console.warn('[UndoLaunch] del err:', e.message); } }
      await pendingIntents.resolveIntent(_undoOpen.id, 'confirmed', `undo_launch:${_n}`);
      const _out = _n ? `🗑️ Desfiz o lançamento — apaguei ${_n === 1 ? 'o item' : `os ${_n} itens`}. Saldo reajustado.` : 'Não achei o lançamento pra desfazer (já pode ter saído).';
      try { await whatsapp.sendMessage(phone, _out); await logConversation(collab.id, 'outbound', _out); await logMarker(collab.id, 'FINANCE_ACTION', 'executed', `undo_launch:${_n}`, null); } catch (e) { console.warn('[UndoLaunch] post err:', e.message); }
      console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (undo_launch_resolved)`);
      return;
    }
  } catch (e) { console.warn('[UndoLaunch] consumer err:', e.message); }

  // ---- RESUME staged reschedule ("isso" → aplica o payload já-resolvido, sem LLM) ----
  // TASK-RESCHEDULE-CONFIRM-NOOP (Matheus 15/07): a proposta estagiou um pending_intent
  // reschedule_confirm (ver ~10307). Aqui o "isso"/"sim" aplica as actions guardadas via
  // applyTaskActions e resolve a intent — determinístico, sobrevive a timeout/fallback.
  // detectUserConfirmation retorna 'yes'|'no'|null e é seguro contra negação (NO_RE pega
  // "não" primeiro; F5 barra frase-conteúdo). Sem allowDone (pergunta yes/no simples, não
  // complete-âncora). TTL 15min (paridade com finance launch_confirm).
  try {
    const _rsOpen = _openIntents.find((i) => i.kind === 'reschedule_confirm' && withinConfirmWindow(i.asked_at, 15));
    if (_rsOpen) {
      const _yn = pendingIntents.detectUserConfirmation(String(text || ''));
      if (_yn === 'yes') {
        const _acts = (_rsOpen.payload && Array.isArray(_rsOpen.payload.actions)) ? _rsOpen.payload.actions : [];
        const _res = _acts.length ? await applyTaskActions(collab, _acts, { inboundText: text }) : { okCount: 0, failCount: 0 };
        await pendingIntents.resolveIntent(_rsOpen.id, 'confirmed', `resumed_reschedule:${_acts.length}`);
        let _out;
        if (_res.okCount > 0 && !_res.failCount) _out = `✅ Reagendei ${_res.okCount === 1 ? 'a tarefa' : `as ${_res.okCount} tarefas`}.`;
        else if (_res.okCount > 0) _out = `Reagendei ${_res.okCount}, mas ${_res.failCount} não ${_res.failCount === 1 ? 'foi' : 'foram'}. Me passa de novo ${_res.failCount === 1 ? 'a que faltou' : 'as que faltaram'}?`;
        else _out = '_Não consegui reagendar agora. Me passa de novo?_';
        try {
          await whatsapp.sendMessage(phone, _out);
          await logConversation(collab.id, 'outbound', _out);
          await logMarker(collab.id, 'TASK_UPDATE', _res.okCount ? 'executed' : 'rejected', `resumed_reschedule ok=${_res.okCount} fail=${_res.failCount}`, null);
        } catch (e) { console.warn('[RescheduleResume] post err:', e.message); }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (reschedule_confirm_resolved)`);
        return;
      }
      if (_yn === 'no') {
        await pendingIntents.resolveIntent(_rsOpen.id, 'denied', 'reschedule_confirm denied');
        // NÃO return: deixa o LLM tratar a emenda ("não, quarta") re-propondo (re-estagia).
      }
      // _yn === null → não age (conteúdo/ambíguo); intent segue aberta até TTL/expire.
    }
  } catch (e) { console.warn('[RescheduleResume] consumer err:', e.message); }

  // ---- RESUME staged EVENT_CREATE ("isso" → cria o compromisso guardado, sem LLM) ----
  // EVENT-CREATE-CONFIRM-NOOP (Alf 16/07): a proposta estagiou a ação em event_create_confirm
  // (ver ~10715). Aqui o "isso"/"sim" cria via applyEventActions — determinístico, sobrevive a
  // timeout/fallback do LLM. detectUserConfirmation é 'yes'|'no'|null e trava negação.
  // TTL 15min (paridade com finance/reschedule).
  try {
    const _ecOpen = _openIntents.find((i) => i.kind === 'event_create_confirm' && withinConfirmWindow(i.asked_at, 15));
    if (_ecOpen) {
      const _yn = pendingIntents.detectUserConfirmation(String(text || ''));
      if (_yn === 'yes') {
        const _evs = (_ecOpen.payload && Array.isArray(_ecOpen.payload.events)) ? _ecOpen.payload.events : [];
        const _res = _evs.length ? await applyEventActions(collab, _evs) : { okCount: 0, failCount: 0 };
        await pendingIntents.resolveIntent(_ecOpen.id, 'confirmed', `resumed_event_create:${_evs.length}`);
        let _out;
        if (_res.okCount > 0 && !_res.failCount) _out = _res.okCount === 1 ? '✅ Marquei o compromisso.' : `✅ Marquei os ${_res.okCount} compromissos.`;
        else if (_res.okCount > 0) _out = `Marquei ${_res.okCount}, mas ${_res.failCount} não ${_res.failCount === 1 ? 'entrou' : 'entraram'}. Me manda de novo ${_res.failCount === 1 ? 'o que faltou' : 'os que faltaram'}?`;
        else if (_res.integrityPayload) _out = '_Parece que já existe um compromisso parecido na agenda — dá uma conferida?_';
        else _out = '_Não consegui marcar agora. Me manda de novo?_';
        try {
          await whatsapp.sendMessage(phone, _out);
          await logConversation(collab.id, 'outbound', _out);
          await logMarker(collab.id, 'EVENT_CREATE', _res.okCount ? 'executed' : 'rejected',
            `resumed_event_create ok=${_res.okCount} fail=${_res.failCount}`, null);
        } catch (e) { console.warn('[EventCreateResume] post err:', e.message); }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (event_create_confirm_resolved)`);
        return;
      }
      if (_yn === 'no') {
        await pendingIntents.resolveIntent(_ecOpen.id, 'denied', 'event_create_confirm denied');
        // NÃO return: o LLM trata a emenda ("não, quinta") e re-propõe (re-estagia).
      }
      // _yn === null → não age; intent segue aberta até TTL/expire.
    }
  } catch (e) { console.warn('[EventCreateResume] consumer err:', e.message); }

  // ---- Fonte obrigatória: resolução determinística do pending finance_source ----
  // Se TOM perguntou "saiu de qual conta?" (intent finance_source aberta) e o user
  // respondeu uma fonte ("2"/"nubank"/"dinheiro"/"cartão"), o ENGINE grava a
  // transação pendente sem passar pelo LLM (não fabrica, não perde no fallback).
  try {
    const { matchSourceReply } = require('./finance/source-match');
    // Prefere a intent ACIONÁVEL (launch_confirm/txn_pick/fonte) sobre a janela de undo_launch,
    // pra um "sim" a um novo lançamento não ser sombreado pelo undo do lançamento anterior.
    const _finCands = _openIntents.filter((i) => i.kind === 'finance_source' && withinConfirmWindow(i.asked_at, 15));
    const finOpen = _finCands.find((i) => !(i.payload && i.payload.form === 'undo_launch')) || _finCands[0];
    if (finOpen) {
      // Camada 2: lançamento aguardando confirmação ("sim" → executa os handlers ATUAIS,
      // determinístico, sem LLM). Dormante até o dispatch abrir intents form:launch_confirm.
      // Cede a vez quando há um invoice_import MAIS RECENTE esperando confirmação: "lançar"
      // casa nos dois parsers e este consumidor roda antes (Rose 14/08 10:50). Ver
      // confirm-precedence.js.
      if (finOpen.payload && finOpen.payload.form === 'launch_confirm'
          && !confirmPrecedence.launchConfirmYields(_openIntents, finOpen)) {
        const conf = pendingIntents.detectUserConfirmation(String(text || ''));
        // Confirmação GENEROSA (aceita "confirmado"/"pode lançar" — FIN-CONFIRM-WORD-NARROW, Alf 22/06)
        // MAS trava NEGAÇÃO: "Não lança" casava só o verbo "lança" e lançava contra o "não" (Rose
        // 11/07 23:40 → 11 itens gravados sem OK). detectLaunchConfirm resolve yes/no/null com guarda
        // de negação (TDD). Regra de ouro: na dúvida entre lançar e não, NÃO lança.
        const _launchDecision = launchConfirm.detectLaunchConfirm(String(text || ''), conf);
        if (_launchDecision === 'yes') {
          const acts = Array.isArray(finOpen.payload.actions) ? finOpen.payload.actions : [];
          const replies = [];
          const _launchedIds = []; // ids gravados neste lote → habilitam o "apaga tudo/desfaz" determinístico
          for (const a of acts) {
            try {
              const _o = { persisted: false };
              const r = await handleFinanceAction(collab, a.action, a.params, _o); // handler ATUAL insere
              if (Array.isArray(_o.ids)) _launchedIds.push(..._o.ids);
              if (r && r.trim()) replies.push(r.trim());
            } catch (e) {
              console.error('[LaunchConfirm] exec err:', e.message);
              replies.push('⚠️ Um item não entrou — me manda de novo só ele?');
            }
          }
          // Camada 2 (pay_invoice): fecha as tarefas de lembrete pinadas no staging
          // (determinístico, escopo do dono — nunca fecha tarefa de outro). FIN-PAYINVOICE-CONFAB-NOOP.
          const _closeIds = Array.isArray(finOpen.payload.close_tasks) ? finOpen.payload.close_tasks : [];
          let _closedN = 0;
          for (const _tid of _closeIds) {
            try {
              const { error: _ce } = await supabase.from('tasks')
                .update({ status: 'done', completed_at: new Date().toISOString(), completed_by: collab.id })
                .eq('id', _tid).eq('assigned_to', collab.id).eq('status', 'pending');
              if (!_ce) _closedN++;
            } catch (e) { console.warn('[LaunchConfirm] close task err:', e.message); }
          }
          await pendingIntents.resolveIntent(finOpen.id, 'confirmed', `launch_confirm:${acts.length}`);
          // Abre a janela de DESFAZER: guarda os ids do lote pra um "apaga tudo/desfaz" determinístico
          // (sobrevive a timeout/fallback — Rose 11/07 "Apaga tudo" morreu no LLM).
          if (_launchedIds.length) {
            try { await pendingIntents.openIntent(collab.id, 'finance_source', { form: 'undo_launch', txn_ids: _launchedIds }, '(lançamento recém-feito — "apaga tudo" desfaz)'); }
            catch (e) { console.warn('[UndoLaunch] open err:', e.message); }
          }
          let out = replies.length ? replies.join('\n\n') : '✅ Lançado!';
          if (_closedN > 0) out += `\n📌 ${_closedN === 1 ? 'Tarefa de lembrete fechada' : `${_closedN} tarefas de lembrete fechadas`}.`;
          try {
            await whatsapp.sendMessage(phone, out);
            await logConversation(collab.id, 'outbound', out);
            await logMarker(collab.id, 'FINANCE_ACTION', 'executed', `launch_confirm:${acts.length}`, null);
          } catch (e) { console.warn('[LaunchConfirm] post err:', e.message); }
          console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (launch_confirm_resolved)`);
          return;
        }
        if (_launchDecision === 'no') {
          await pendingIntents.resolveIntent(finOpen.id, 'denied', 'launch_confirm denied');
          const out = 'Beleza, não lancei nada. Quando quiser é só mandar de novo 👍';
          try { await whatsapp.sendMessage(phone, out); await logConversation(collab.id, 'outbound', out); } catch (e) { console.warn('[LaunchConfirm] deny post err:', e.message); }
          console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (launch_confirm_denied)`);
          return;
        }
        // _launchDecision === null → não é sim/não claro (correção/conteúdo) → cai no LLM (re-propõe).
      }
      if (finOpen.payload && finOpen.payload.form === 'txn_pick') {
        const pick = matchSourceReply(String(text || ''), { form: 'list', candidates: finOpen.payload.candidates });
        if (pick) {
          let reply;
          if (finOpen.payload.op === 'delete') {
            if (pick.purchase_group) { const n = await financeService.deleteTransactionGroup(collab.id, pick.purchase_group); reply = `🗑️ Apaguei *${pick.name}* — ${n} parcelas. Saldo reajustado.`; }
            else { await financeService.deleteTransaction(collab.id, pick.id); reply = `🗑️ Apaguei *${pick.name}*. Saldo reajustado.`; }
          }
          if (reply) {
            try { await pendingIntents.resolveIntent(finOpen.id, 'confirmed', 'txn_pick'); await whatsapp.sendMessage(phone, reply); await logConversation(collab.id, 'outbound', reply); } catch (e) { console.warn('[TxnPick] post err:', e.message); }
            console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (txn_pick_resolved)`);
            return;
          }
        }
      }
      // CONSUMIDOR de card_pick — ver card-pick.js. Resolve a resposta ("Cartão Nubank"/"2")
      // determinístico e RETOMA a ação original (pay_invoice/query_invoice/card_refund) com o
      // cartão resolvido, sem passar pelo LLM. Raiz do caso Rose 14/08: "Cartão Nubank" exato
      // levava à MESMA pergunta de novo porque nada persistia o alvo entre turnos.
      if (finOpen.payload && finOpen.payload.form === 'card_pick') {
        const pick = matchSourceReply(String(text || ''), { form: 'list', candidates: finOpen.payload.candidates });
        if (pick && pick.kind === 'card') {
          const card = (await financeService.listCards(collab.id)).find((c) => c.id === pick.id);
          if (card) {
            const _o = { persisted: false };
            let reply;
            try {
              reply = await handleFinanceAction(collab, finOpen.payload.action, { ...finOpen.payload.params, card: card.name }, _o);
            } catch (e) {
              console.error('[CardPick] exec err:', e.message);
              try { await whatsapp.sendMessage(phone, '⚠️ Não consegui continuar agora. Tenta de novo daqui a pouco?'); } catch (_) { /* best-effort */ }
              console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (card_pick_error)`);
              return;
            }
            try {
              await pendingIntents.resolveIntent(finOpen.id, 'confirmed', `card_pick:${finOpen.payload.action}`);
              await whatsapp.sendMessage(phone, reply || '👍');
              await logConversation(collab.id, 'outbound', reply || '👍');
            } catch (postErr) { console.warn('[CardPick] post err:', postErr.message); }
            console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (card_pick_resolved)`);
            return;
          }
        }
        // Sem match (resposta não bate com nenhum cartão) → intent segue aberta; cai no LLM,
        // que pode pedir esclarecimento — igual ao comportamento de txn_pick acima.
      }
      const hit = matchSourceReply(String(text || ''), finOpen.payload);
      if (hit) {
        const txn = finOpen.payload.txn || {};
        // Resolve a fonte escolhida em conta/cartão concretos.
        let account = null;
        let card = null;
        if (hit.kind === 'cash') account = await financeService.ensureDinheiro(collab.id);
        else if (hit.kind === 'account') account = (await financeService.listAccounts(collab.id)).find((a) => a.id === hit.id);
        else if (hit.kind === 'card') card = (await financeService.listCards(collab.id)).find((c) => c.id === hit.id);

        // Fonte sumiu entre turnos (conta/cartão deletado) → não casa; segue fluxo normal.
        if (account || card) {
          // A partir daqui ASSUMIMOS o turno: grava e SEMPRE retorna (nunca cai no LLM,
          // senão a transação seria gravada de novo). Falha na gravação → avisa e mantém a intent.
          let reply;
          try {
            // Receita nunca grava em cartão (defesa em profundidade): se o pendente for income, força conta.
            const useCard = !!card && txn.type !== 'income';
            reply = useCard
              ? await recordCardPurchase(collab.id, card, { amount: txn.amount, description: txn.description, category: txn.category, installments: txn.installments, date: txn.date, bill_id: finOpen.payload.bill?.id })
              : await writeCashTransaction(collab.id, { type: txn.type, category: txn.category, amount: txn.amount, description: txn.description, date: txn.date, account, bill_id: finOpen.payload.bill?.id });
            // pay_bill via pendência: marca a conta paga + headline (o lançamento já foi gravado acima).
            if (finOpen.payload.bill) {
              try {
                await financeService.markBillPaid(collab.id, finOpen.payload.bill); // quitação=hoje, não a data da fatura (FIN-PAYBILL-DATE-COUPLING)
                reply = `✅ *${finOpen.payload.bill.name}* paga.\n\n` + reply;
              } catch (markErr) {
                console.warn('[PayBill] mark err:', markErr.message);
              }
            }
          } catch (writeErr) {
            console.error('[FinanceSource] write err:', writeErr.message);
            await whatsapp.sendMessage(phone, '⚠️ Não consegui registrar agora. Tenta de novo daqui a pouco?');
            return; // intent segue aberta pra retry; NÃO cai no LLM
          }
          // Transação JÁ persistida: consome o turno de qualquer forma (resolve/envia/loga),
          // engolindo falhas pós-gravação pra não reprocessar no LLM.
          try {
            await pendingIntents.resolveIntent(finOpen.id, 'confirmed', `finance_source matched ${hit.kind}`);
            await whatsapp.sendMessage(phone, reply);
            await logConversation(collab.id, 'outbound', reply);
          } catch (postErr) {
            console.warn('[FinanceSource] post-write err (txn já gravada):', postErr.message);
          }
          console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (finance_source_resolved)`);
          return;
        }
      }
      // não casou → deixa a intent aberta (expira sozinha); segue fluxo normal.
    }
  } catch (e) {
    console.warn('[FinanceSource] consumer err:', e.message);
  }

  // ---- FECHAMENTO-ITEM-NO-ANCHOR (caso Yuri 09/06): resposta numerada do fechamento ----
  // O fechamento abriu UMA intent ancorada com os itens numerados (payload.closing.items).
  // Aqui o ENGINE resolve a resposta ("1", "1 e 2", "1 - em andamento", "fiz tudo") contra
  // ESSES ids — sem o LLM chutar contra a intent concorrente mais fresca. Espelha o
  // ALVO-FUTURO-RESPOSTA-CURTA, no caminho do fechamento. Short-circuit: o estado fica
  // determinístico e a mensagem é montada pelo engine (com a barrinha Bloco C).
  try {
    // CLOSING-INTERCEPTOR-OVERCAPTURE (audit 15/06): o gate puro decide se o atalho pode
    // disparar (fechamento de HOJE + não é reply-quote a outra coisa + sem intent mais
    // fresca). Fail-safe: !fire → não short-circuita, segue o fluxo normal (comportamento atual).
    const { shouldClosingInterceptorFire, futureDoneItems } = require('./utils/closing-reply');
    const closingCandidate = _openIntents.find((i) =>
      i.kind === 'confirmation' && i.payload && i.payload.closing &&
      Array.isArray(i.payload.closing.items) && i.payload.closing.items.length);
    const _replyParsed = stripReplyScaffold(String(text || ''));
    // CLOSING-FRESHER-OUTBOUND-BIND (Quintela 08/07): última outbound do TOM pro gate —
    // se o TOM mandou OUTRA mensagem depois da pergunta do fechamento (ex.: balanço de
    // aderência 19:19), a resposta numerada pode ser pra ELA → o gate solta pro LLM.
    // Query 1-row SÓ quando há fechamento aberto (raro); falha → null (comportamento atual).
    let _lastOutboundAt = null;
    if (closingCandidate) {
      try {
        const { data: _lo } = await supabase.from('conversation_history')
          .select('created_at').eq('collaborator_id', collab.id).eq('direction', 'outbound')
          .order('created_at', { ascending: false }).limit(1);
        _lastOutboundAt = _lo && _lo[0] ? _lo[0].created_at : null;
      } catch (_loErr) { console.warn('[Closing] last outbound lookup err:', _loErr.message); }
    }
    const _closingGate = closingCandidate
      ? shouldClosingInterceptorFire({ closingIntent: closingCandidate, openIntents: _openIntents, replyParsed: _replyParsed, now: new Date(), lastOutboundAt: _lastOutboundAt })
      : { fire: false, reason: 'no_candidate' };
    if (closingCandidate && !_closingGate.fire) {
      console.log(`[Closing] gate skip (${_closingGate.reason}) phone=${_phoneTail}`);
    }
    if (closingCandidate && _closingGate.fire) {
      const closingIntent = closingCandidate;
      const items = closingIntent.payload.closing.items;
      const _closingReplyText = _replyParsed.userText;
      const parsed = parseClosingReply(_closingReplyText, items.length);
      if (parsed.matched) {
        const completed = [];
        const progressItems = [];
        const noneItems = [];
        const cancelledItems = []; // CLOSING-CANCEL-IGNORED (Yuri 01/07): "3 pode cancelar" cancela de verdade
        const futureItems = []; // (b) due futura → NÃO fecha no fechamento de hoje (caso Quintela)
        // Busca due_date das tasks ancoradas p/ a guarda de futura — defense-in-depth do filtro
        // do builder (rede de segurança: o interceptor nunca fecha tarefa de amanhã).
        const _closingTaskIds = items.filter((it) => it.type === 'task').map((it) => it.id);
        const _dueById = {};
        if (_closingTaskIds.length) {
          try {
            const { data: _dueRows } = await supabase.from('tasks').select('id, due_date').in('id', _closingTaskIds);
            for (const _r of (_dueRows || [])) _dueById[_r.id] = _r.due_date;
          } catch (_dErr) { console.warn('[Closing] due lookup err:', _dErr.message); }
        }
        const _futureSet = new Set(futureDoneItems(items, parsed.statuses, _dueById, todaySaoPaulo()).map((it) => it.id));
        for (let k = 0; k < items.length; k++) {
          const it = items[k];
          const st = parsed.statuses[k];
          if (st === 'done') {
            // (b) tarefa de due futura NÃO é fechada hoje — mantém aberta e avisa (caso Quintela).
            if (it.type === 'task' && _futureSet.has(it.id)) { futureItems.push(it); continue; }
            let ok = false;
            try {
              if (it.type === 'event') {
                const { error } = await supabase.from('events').update({ status: 'done' }).eq('id', it.id);
                ok = !error;
              } else {
                const { error } = await supabase.from('tasks')
                  .update({ status: 'done', completed_at: new Date().toISOString(), completed_by: collab.id })
                  .eq('id', it.id);
                ok = !error;
              }
            } catch (cEx) { console.warn('[Closing] complete err:', cEx.message); }
            if (ok) completed.push(it); else noneItems.push(it); // falhou a escrita → não mente "feito"
          } else if (st === 'cancel') {
            // CLOSING-CANCEL-IGNORED (Yuri 01/07): pedido explícito de cancelar no fechamento.
            // Antes caía em 'progress' e o cancel era dropado em silêncio (tarefa seguia pending).
            let okC = false;
            try {
              if (it.type === 'task') {
                // updated_by (13/08): cancelar é o que mais apaga trabalho da frente das
                // pessoas — é o primeiro lugar onde a autoria precisa existir.
                const { error } = await supabase.from('tasks')
                  .update({ status: 'cancelled', updated_by: collab.id }).eq('id', it.id);
                okC = !error;
              } else {
                const { error } = await supabase.from('events').update({ status: 'cancelled' }).eq('id', it.id);
                okC = !error;
              }
            } catch (cEx) { console.warn('[Closing] cancel err:', cEx.message); }
            if (okC) cancelledItems.push(it); else noneItems.push(it); // falhou → não mente "cancelei"
          } else if (st === 'progress') {
            progressItems.push(it);
          } else {
            noneItems.push(it);
          }
        }
        await pendingIntents.resolveIntent(closingIntent.id, 'confirmed', `closing reply: ${completed.length}/${items.length} done`);

        const nick = collab.nickname || String(collab.full_name || '').split(' ')[0] || 'você';
        const mkBar = (done, total) => {
          const pct = total ? Math.round((done / total) * 100) : 0;
          const fill = Math.round((pct / 100) * 10);
          return `${'▓'.repeat(fill)}${'░'.repeat(10 - fill)} ${pct}% (${done}/${total})`;
        };
        const parts = [`Fechamento, ${nick} 👽`, ''];
        if (completed.length) parts.push(`✅ Fechei: ${completed.map((c) => `*${c.title}*`).join(', ')}`);
        if (cancelledItems.length) parts.push(`❌ Cancelei: ${cancelledItems.map((c) => `*${c.title}*`).join(', ')}`);
        if (progressItems.length) parts.push(`⏳ Em andamento: ${progressItems.map((c) => `*${c.title}*`).join(', ')}`);
        if (noneItems.length) parts.push(`⭕ Faltou: ${noneItems.map((c) => `*${c.title}*`).join(', ')}`);
        if (futureItems.length) parts.push(`📅 É de amanhã, deixei aberta: ${futureItems.map((c) => `*${c.title}*`).join(', ')}`);
        // futuras E canceladas fora do denominador (cancelada não é "faltou" nem "feita")
        const _dayTotal = items.length - futureItems.length - cancelledItems.length;
        parts.push('');
        if (_dayTotal > 0) {
          parts.push(mkBar(completed.length, _dayTotal));
          if (completed.length === _dayTotal) parts.push('\nDia fechado, mandou bem! 💪');
          else if (!completed.length) parts.push('\nMe diz: o que travou hoje?');
          else parts.push('\nBora fechar o resto amanhã.');
        } else {
          parts.push('Essas são de amanhã — nada pra fechar hoje. 👍');
        }
        const reply = parts.join('\n');

        try {
          await whatsapp.sendMessage(phone, reply);
          await logConversation(collab.id, 'outbound', reply);
        } catch (postErr) { console.warn('[Closing] post-send err:', postErr.message); }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now() - _t0}ms (closing_anchored:${completed.length}/${items.length})`);
        return;
      }
    }
  } catch (e) {
    console.warn('[Closing] interceptor err:', e.message);
  }

  // ---- RSVP determinístico (pré-LLM): "sim/não/talvez" cru → resolve o CONVITE pendente ----
  // Causa-raiz RSVP-WRONG-EVENT-BARE (Luciano 09/06): um "Sim" solto, com vários eventos no
  // contexto, fazia o LLM confabular o evento ERRADO e NÃO emitir o marker rsvp → presença nunca
  // gravava. Aqui o ENGINE resolve direto: msg é RSVP cru (detectBareRsvpReply) E existe convite
  // pendente futuro (applyRsvp(…, null, …) → resolvePendingInviteEventId) → aplica e confirma
  // NOMEANDO o evento (mata a confusão). Guardas: (1) sem convite pendente, applyRsvp dá ok:false
  // e cai no LLM (um "sim" a outra pergunta segue normal); (2) se há pergunta FRESCA do TOM
  // (pending_intent < 20min), o "sim" responde ELA, não o convite — deixa o fluxo de intents tratar.
  try {
    const { detectBareRsvpReply } = require('./events/detect-rsvp-reply');
    const rsvp = detectBareRsvpReply(text);
    // approval_pending não bloqueia RSVP: aprovação nunca consome "sim" (funil próprio).
    const hasFreshQuestion = _openIntents.some((i) => i.kind !== 'approval_pending' && withinConfirmWindow(i.asked_at, 20));
    // BUG-JORDAN (11/06): intent confirmation aberta (mesmo fora dos 20min) bloqueia RSVP-bare.
    // Caso: Jordan respondeu "Sim" 97min após TOM perguntar sobre lembrete → hasFreshQuestion=false
    // → "Sim" confirmou RSVP de reunião não relacionada. Intent de confirmation dura 24h no máximo.
    const hasOpenConfirmation = _openIntents.some((i) => i.kind === 'confirmation');
    if (rsvp && !hasFreshQuestion && !hasOpenConfirmation) {
      const r = await applyRsvp(collab, null, rsvp.status);
      if (r && r.ok) {
        let quando = '';
        let titulo = 'o compromisso';
        try {
          const { data: ev } = await supabase.from('events')
            .select('title, start_at').eq('id', r.eventId).maybeSingle();
          if (ev) {
            titulo = ev.title || titulo;
            if (ev.start_at) quando = new Date(ev.start_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          }
        } catch (_) { /* confirmação genérica se o fetch do evento falhar */ }
        const verbo = rsvp.status === 'confirmed' ? '✅ Presença confirmada'
          : rsvp.status === 'declined' ? '❌ Presença recusada'
          : '🤔 Anotado como *talvez*';
        const reply = `${verbo} em _"${titulo}"_${quando ? `\n🗓️ ${quando}` : ''}`;
        try {
          await whatsapp.sendMessage(phone, reply);
          await logConversation(collab.id, 'outbound', reply);
        } catch (postErr) {
          console.warn('[RSVP-bare] post-write err (RSVP já aplicado):', postErr.message);
        }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (rsvp_bare_${rsvp.status})`);
        return;
      }
      // applyRsvp ok:false → sem convite pendente → o "sim/não" é de outra coisa; segue pro LLM.
    }
  } catch (e) {
    console.warn('[RSVP-bare] consumer err:', e.message);
  }

  // ---- Aprovação determinística (pré-LLM): "Aprovado/Aprovar/APROVA X" → funil de aprovação ----
  // Fase F2 (APROVACAO-SEM-FUNIL, auditoria 09/06): o vocabulário de aprovação tem dono.
  // Caso real: "Aprovado" (resposta ao card do projeto) caía no LLM, que casava com a
  // pendência errada visível (completou EVENTO). Aqui: detector PURO + estado (intents
  // approval_pending da F1) decidem o alvo — LLM só pega o caso genuinamente ambíguo.
  try {
    const scaffold = stripReplyScaffold(String(text || ''));
    const apr = detectApprovalReply(scaffold.userText);
    if (apr && hasCoordLevel(collab)) {
      const openApprovals = await approvalsService.listOpenApprovals(supabase, collab.id);
      // reply-quote no card identifica o ref mesmo sem token digitado
      let target = null;
      if (scaffold.quotedText) {
        target = openApprovals.find((i) =>
          (i.payload.token && scaffold.quotedText.includes(`APROVA ${i.payload.token}`))
          || (i.payload.short_id && scaffold.quotedText.includes(i.payload.short_id))
          || (i.payload.domain === 'announcement' && /Comunicado pendente de aprova/i.test(scaffold.quotedText)));
      }
      if (!target && apr.token) target = openApprovals.find((i) => (i.payload.token || '').toUpperCase() === apr.token);
      const candidates = target ? [target]
        : apr.domainHint ? openApprovals.filter((i) => i.payload.domain === apr.domainHint)
        : openApprovals;
      let aprReply = null;
      if (apr.token && !target) {
        // Token digitado sem intent correspondente (projeto pré-F1) → caminho global legado.
        const body = { token: apr.token, reason: apr.reason || 'sem motivo informado' };
        const r = apr.decision === 'approve' ? await applyProjectApprove(collab, body) : await applyProjectReject(collab, body);
        aprReply = r.ok
          ? (apr.decision === 'approve' ? `✅ *${r.project.name}* aprovado. Avisei quem criou.` : `❌ *${r.project.name}* rejeitado. Avisei quem criou.`)
          : (r.userMsg || '_não consegui processar a aprovação agora_');
      } else if (candidates.length === 1) {
        const it = candidates[0];
        if (it.payload.domain === 'project') {
          const body = { token: it.payload.token, reason: apr.reason || 'sem motivo informado' };
          const r = apr.decision === 'approve' ? await applyProjectApprove(collab, body) : await applyProjectReject(collab, body);
          aprReply = r.ok
            ? (apr.decision === 'approve' ? `✅ *${r.project.name}* aprovado. Avisei quem criou.` : `❌ *${r.project.name}* rejeitado. Avisei quem criou.`)
            : (r.userMsg || '_não consegui processar agora_');
        } else if (it.payload.domain === 'maintenance') {
          // BUG-8 (11/06): executa registrarManutencao ao aprovar; notifica rejeição ao solicitante.
          try {
            const mp = it.payload;
            if (apr.decision === 'approve') {
              await inventarioService.registrarManutencao({
                item_id: mp.item_id, tipo: mp.tipo, descricao: mp.descricao,
                custo: mp.custo, fornecedor_servico: mp.fornecedor_servico,
                responsavel: mp.requester_name || null,  // MANUT-APPROVAL-NO-REQUESTER-NAME: persiste o solicitante no registro
              }, `solicitado por ${mp.requester_name || 'desconhecido'}, aprovado por ${collab.full_name}`);
              await approvalsService.resolveApprovalByRef(supabase, mp.ref_id, 'confirmed', `aprovado por ${collab.full_name}`);
              if (mp.requester_phone) {
                try { await whatsapp.sendMessage(mp.requester_phone, `✅ Sua solicitação de manutenção em *${mp.item_nome || 'item'}* foi aprovada por ${collab.full_name}.`); } catch (_) {}
              }
              aprReply = `✅ Manutenção em *${mp.item_nome || 'item'}* registrada (pedido de *${mp.requester_name || 'quem solicitou'}*). ${mp.requester_phone ? `Avisei o *${mp.requester_name || 'solicitante'}*.` : 'Solicitante sem WhatsApp pra avisar.'}`;
            } else {
              await approvalsService.resolveApprovalByRef(supabase, mp.ref_id, 'denied', `rejeitado por ${collab.full_name}: ${apr.reason || ''}`);
              if (mp.requester_phone) {
                try { await whatsapp.sendMessage(mp.requester_phone, `❌ Solicitação de manutenção em *${mp.item_nome || 'item'}* rejeitada por ${collab.full_name}${apr.reason ? `: ${apr.reason}` : ''}.`); } catch (_) {}
              }
              aprReply = `❌ Manutenção *${mp.item_nome || 'item'}* rejeitada (pedido de *${mp.requester_name || 'quem solicitou'}*). ${mp.requester_phone ? `Avisei o *${mp.requester_name || 'solicitante'}*.` : ''}`.trim();
            }
          } catch (_maintErr) {
            console.error('[Maintenance] approval execution err:', _maintErr.message);
            aprReply = `_Erro ao processar manutenção: ${_maintErr.message}_`;
          }
        } else {
          const r = await applyAnnouncementApproval(collab, { action: apr.decision === 'approve' ? 'approve' : 'reject', announcement_id: it.payload.ref_id, reason: apr.reason });
          aprReply = r.ok
            ? (apr.decision === 'approve'
              ? `✅ Comunicado \`${it.payload.short_id || String(it.payload.ref_id).slice(0, 4)}\` aprovado. Mensagens na fila de envio.`
              : `❌ Comunicado \`${it.payload.short_id || String(it.payload.ref_id).slice(0, 4)}\` rejeitado. Avisei quem criou.`)
            : (r.reason || '_não consegui processar agora_');
        }
      } else if (candidates.length > 1) {
        // Ambiguidade REAL → lista numerada com os comandos exatos (nunca chuta).
        const lines = candidates.map((i, idx) => {
          const cmd = i.payload.domain === 'project'
            ? `*APROVA ${i.payload.token}*`
            : i.payload.domain === 'maintenance'
            ? `*APROVA ${i.payload.short_id}*`
            : `*APROVAR ${i.payload.short_id || String(i.payload.ref_id).slice(0, 4)}*`;
          return `${idx + 1}) ${i.question_text || i.payload.domain} → ${cmd}`;
        });
        aprReply = `Você tem ${candidates.length} aprovações pendentes — qual delas?\n${lines.join('\n')}`;
      }
      if (aprReply) {
        try {
          await whatsapp.sendMessage(phone, aprReply);
          await logConversation(collab.id, 'outbound', aprReply);
        } catch (postErr) {
          console.warn('[Approval-bare] post err (ação possivelmente aplicada):', postErr.message);
        }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (approval_${apr.decision})`);
        return;
      }
      // bare + 0 pendências → NÃO consome o turno; hint negativo anti-Incidente-A:
      // sem isso o LLM trataria "aprovado" como confirmação de outra pendência visível.
      if (apr.bare && openApprovals.length === 0) {
        text = String(text || '') + `\n\n[CONTEXTO INTERNO — não verbalize ao usuário]\nO usuário disse "${scaffold.userText.slice(0, 40)}", que parece APROVAÇÃO, mas NÃO há nenhuma aprovação pendente para ele. NÃO trate como confirmação de outra pendência (tarefa/evento/pergunta antiga). Pergunte a que ele se refere.`;
        console.log('[Approval-bare] sem pendência — hint negativo injetado');
      }
    }
  } catch (e) {
    console.warn('[Approval-bare] consumer err:', e.message);
  }

  // ---- Fechar/cancelar PROJETO por chat (determinístico, pré-LLM) ----
  // 02/07 — ADD/REMOVE PARTICIPANTE: confirm-first + executor determinístico (família
  // FIN-CONFIRM-CONFAB-NOOP). O "sim" aplica no event_participants; o LLM NÃO re-emite marker.
  // Keia em payload.participant_edit (sem anchor → não colide com nenhum outro consumer).
  try {
    const _peIntent = _openIntents.find((i) =>
      i.kind === 'confirmation' && i.payload && i.payload.participant_edit
      && withinConfirmWindow(i.asked_at, 60));
    if (_peIntent) {
      const _yn = pendingIntents.detectUserConfirmation(stripReplyScaffold(String(text || '')).userText);
      if (_yn === 'no') {
        await pendingIntents.resolveIntent(_peIntent.id, 'denied', 'participant_edit denied');
        const out = 'Beleza, deixei a lista como tá. 👍';
        try { await whatsapp.sendMessage(phone, out); await logConversation(collab.id, 'outbound', out); } catch (e) { console.warn('[ParticipantEdit] deny post err:', e.message); }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (participant_edit_denied)`);
        return;
      }
      if (_yn === 'yes') {
        const pe = _peIntent.payload.participant_edit;
        const evId = pe.event_id;
        let okN = 0, failN = 0;
        try {
          if (pe.op === 'add') {
            const { enqueueOutbound } = require('./lib/outbound-queue');
            const { data: evRow } = await supabase.from('events')
              .select('id, title, start_at, location_text').eq('id', evId).single();
            const senderName = (collab.preferred_name || collab.full_name || '').split(' ')[0];
            const inviteRows = [];
            for (const cid of pe.ids) {
              const { error: insErr } = await supabase.from('event_participants').insert({
                event_id: evId, collaborator_id: cid, status: 'invited',
                invited_by: collab.id, invited_at: new Date().toISOString(),
              });
              if (insErr) { console.warn(`[ParticipantEdit] insert err ${String(cid).slice(0, 8)}: ${insErr.message}`); failN++; continue; }
              okN++;
              const { data: c } = await supabase.from('collaborators').select('phone, is_active').eq('id', cid).single();
              if (c && c.phone && c.is_active !== false && evRow) {
                const whenStr = (() => { try { const d = safeDate(evRow.start_at); return d ? d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : evRow.start_at; } catch { return evRow.start_at; } })();
                const locPart = evRow.location_text ? `\n📍 ${String(evRow.location_text).slice(0, 80)}` : '';
                const body = `📅 *${senderName}* te convidou pra um compromisso:\n\n*${evRow.title}*\n🗓️ ${whenStr}${locPart}\n\nConfirma presença? Responde *"vou"* ou *"não posso"*.`;
                inviteRows.push({ phone: c.phone, body, meta: { collaborator_id: cid, kind: 'event_invite', event_id: evId, sender_name: senderName } });
                await logConversation(cid, 'outbound', `[convite de ${senderName}: ${evRow.title}]`);
              }
            }
            if (inviteRows.length) await enqueueOutbound(supabase, inviteRows, {});
          } else { // remove — silencioso (o convidado só some da agenda dele)
            const { error: delErr } = await supabase.from('event_participants')
              .delete().eq('event_id', evId).in('collaborator_id', pe.ids);
            if (delErr) { console.warn('[ParticipantEdit] delete err:', delErr.message); failN = pe.ids.length; }
            else okN = pe.ids.length;
          }
        } catch (exErr) {
          console.error('[ParticipantEdit] executor err:', exErr.message);
        }
        await pendingIntents.resolveIntent(_peIntent.id, 'confirmed', `participant_edit ${pe.op} ok=${okN} fail=${failN}`);
        const nomes = (pe.names || []).join(', ');
        let out;
        if (okN > 0 && failN === 0) {
          out = pe.op === 'add'
            ? `✅ Adicionei *${nomes}* à reunião — ${okN === 1 ? 'convite na fila' : 'convites na fila'}.`
            : `✅ Removi *${nomes}* da reunião.`;
        } else if (okN > 0) {
          out = `Consegui ${pe.op === 'add' ? 'adicionar' : 'remover'} ${okN}, mas ${failN} deu erro. Quer tentar de novo os que faltaram?`;
        } else {
          out = `_Não consegui ${pe.op === 'add' ? 'adicionar' : 'remover'} agora — tenta de novo daqui a pouco?_`;
        }
        try {
          await whatsapp.sendMessage(phone, out);
          await logConversation(collab.id, 'outbound', out);
          await logMarker(collab.id, 'EVENT_UPDATE', okN > 0 ? 'executed' : 'rejected', `participant_${pe.op} ok=${okN} fail=${failN}`, null);
        } catch (e) { console.warn('[ParticipantEdit] confirm post err:', e.message); }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (participant_edit_${pe.op}_ok${okN})`);
        return;
      }
      // _yn === null → não é sim/não claro → segue (não consome o turno)
    }
  } catch (e) { console.warn('[ParticipantEdit] consumer err:', e.message); }

  // KRISSYA-PROJECT-CLOSE-NO-HANDLER (auditoria 30/06). Confirm-first + executor determinístico
  // (família FIN-CONFIRM-CONFAB-NOOP): o "sim" dispara applyProjectStatusChange, o LLM NÃO
  // re-emite marker. (a) resolve confirmação de projeto JÁ aberta; (b) detecta nova intenção.
  // Tudo gated por anchor.type==='project' / token "projeto" — não toca task/event nem PROJECT_*.
  try {
    // (a) "sim"/"não" de uma confirmação de projeto já aberta (posse da intent = autoridade)
    const _projIntent = _openIntents.find((i) =>
      i.kind === 'confirmation' && i.payload && i.payload.anchor
      && i.payload.anchor.type === 'project' && withinConfirmWindow(i.asked_at, 60));
    if (_projIntent) {
      const _yn = pendingIntents.detectUserConfirmation(stripReplyScaffold(String(text || '')).userText);
      if (_yn === 'no') {
        await pendingIntents.resolveIntent(_projIntent.id, 'denied', 'project status change denied');
        const out = 'Beleza, deixei como tá. 👍';
        try { await whatsapp.sendMessage(phone, out); await logConversation(collab.id, 'outbound', out); } catch (e) { console.warn('[ProjStatus] deny post err:', e.message); }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (project_status_denied)`);
        return;
      }
      if (_yn === 'yes') {
        const _a = _projIntent.payload.anchor;
        const _newStatus = projectStatusLib.STATUS_BY_ACTION[_projIntent.payload.action];
        const r = await applyProjectStatusChange(collab, { projectId: _a.id, newStatus: _newStatus });
        await pendingIntents.resolveAnchoredIntents(collab.id, _a.id, 'confirmed', 'project status change');
        let out;
        if (r.ok) {
          const _summary = { total: _projIntent.payload.open_total || 0, byPerson: [] };
          out = projectStatusLib.buildStatusResult({ name: _a.title }, _projIntent.payload.action, _summary);
          await logMarker(collab.id, 'PROJECT_STATUS', 'executed', `name:${_a.title} status:${_newStatus}`, null);
        } else if (r.reason === 'already_closed') {
          out = `O projeto *${_a.title}* já tava ${_projIntent.payload.action === 'cancel' ? 'cancelado' : 'fechado'}. 👍`;
        } else {
          out = '_Tentei mudar o status do projeto mas deu ruim — tenta de novo daqui a pouco?_';
          await logMarker(collab.id, 'PROJECT_STATUS', 'rejected', r.reason || 'unknown', null);
        }
        try { await whatsapp.sendMessage(phone, out); await logConversation(collab.id, 'outbound', out); } catch (e) { console.warn('[ProjStatus] confirm post err:', e.message); }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (project_status_${r.ok ? 'applied' : 'failed'})`);
        return;
      }
      // _yn === null → não é sim/não claro → segue (não consome o turno)
    }

    // (b) nova intenção "fecha/cancela o projeto X"
    const _psIntent = detectProjectStatusIntent(String(text || ''));
    if (_psIntent) {
      let _aliveQ = supabase.from('projects')
        .select('id, name, status, created_by')
        .in('status', [...projectStatusLib.ALIVE_STATUSES]);
      // não-coord só resolve os PRÓPRIOS projetos (autoridade = criador). Coord resolve qualquer.
      if (!hasCoordLevel(collab)) _aliveQ = _aliveQ.eq('created_by', collab.id);
      const { data: _aliveRaw } = await _aliveQ;
      const _res = projectStatusLib.resolveProjectByName(_aliveRaw || [], _psIntent.nameHint, _psIntent.quotedText);

      let out = null;
      if (_res.status === 'none') {
        // via reply-bare (sem token "projeto") que não casou projeto → NÃO consome o turno
        // (ex.: "fecha isso" respondendo a uma tarefa). Cai no LLM.
        if (_psIntent.viaProjectToken) {
          out = 'Não achei um projeto com esse nome aberto pra você. Qual é o nome certinho?';
        }
      } else if (_res.status === 'ambiguous') {
        const _names = _res.candidates.map((c) => `*${c.name}*`).join(' ou ');
        out = `Tenho mais de um: ${_names}. Qual deles?`;
      } else {
        const _project = _res.project;
        const _authorized = projectStatusLib.canChangeStatus(collab, _project, []) || hasCoordLevel(collab);
        if (!_authorized) {
          out = 'Esse projeto não é seu pra fechar — só quem criou ou lidera pode. Quer que eu avise alguém?';
        } else {
          // Busca TODAS as tarefas do projeto; summarizeOpenWork filtra done/cancelled
          // (evita depender da sintaxe do .not(in) — falha dela daria sub-contagem silenciosa).
          const { data: _openRaw } = await supabase.from('tasks')
            .select('status, assignee:collaborators!tasks_assigned_to_fkey(full_name)')
            .eq('project_id', _project.id);
          const _openTasks = (_openRaw || []).map((t) => ({
            status: t.status,
            assignee_name: t.assignee && t.assignee.full_name ? t.assignee.full_name.split(' ')[0] : 'sem responsável',
          }));
          const _summary = projectStatusLib.summarizeOpenWork(_openTasks);
          out = projectStatusLib.buildStatusConfirm(_project, _psIntent.action, _summary);
          await pendingIntents.openIntent(collab.id, 'confirmation', {
            anchor: { type: 'project', id: _project.id, title: _project.name },
            action: _psIntent.action,
            open_total: _summary.total,
          }, out);
        }
      }
      if (out) {
        try { await whatsapp.sendMessage(phone, out); await logConversation(collab.id, 'outbound', out); } catch (e) { console.warn('[ProjStatus] detect post err:', e.message); }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (project_status_${_res.status})`);
        return;
      }
    }
  } catch (e) {
    console.warn('[ProjStatus] consumer err:', e.message);
  }

  // ---- Correção/exclusão determinística (pré-LLM): "era 25" / "muda a categoria pra lazer" / "apaga a de 30" ----
  // O LLM às vezes fabrica "corrigido" ou nega a capacidade. Quando o padrão é claro E há
  // transação recente, o ENGINE executa direto via handleFinanceAction — sem depender do LLM.
  try {
    const { detectCorrection, detectFinanceEditIntent } = require('./finance/detect-correction');
    // FINEDIT-QUOTE-SCAFFOLD-MISROUTE (27/06) — roda os detectores só na FALA REAL da pessoa,
    // NÃO no scaffold do reply-quote. Caso Rafinha: "Coloca o prazo até final de julho" (prazo de
    // TAREFA) respondendo a um card com "Compra..." → "compra" da CITAÇÃO casava RE_TXN_NOUN_LOOSE
    // → finance-edit redirect curto-circuitava o handler de tarefa. Família DUP-QUOTE-SCAFFOLD.
    // NÃO muta `text` (o contexto do LLM lá embaixo ainda pode querer a citação).
    const _uTxt = stripReplyScaffold(String(text || '')).userText;
    const corr = detectCorrection(_uTxt);
    // Gate do REDIRECT = intent LOOSE (não precisa do alvo); EXECUTE = corr COMPLETO.
    const editIntent = corr ? { op: corr.op } : detectFinanceEditIntent(_uTxt);
    if (editIntent) {
      const action = editIntent.op === 'delete' ? 'delete_transaction' : 'edit_transaction';
      const recent = await financeService.listRecentTransactions(collab.id, { hours: EDIT_WINDOW_HOURS, limit: 10 });
      if (!recent.length) {
        // CAMINHO 2 / FATIA 1 (F1.3a): fora da janela → o ENGINE escreve a linha honesta (Modelo α),
        // NÃO cai no LLM. Vale pro corr completo E pro intent loose ("altera o valor de ontem",
        // "corrige a cat da semana passada") — não precisa do alvo pra dizer "tá fora, edita no app".
        const verdict = resolveFinanceCapability({ action, params: {} }, { candidates: [] });
        const honest = buildHonestRedirect(verdict);
        try {
          await whatsapp.sendMessage(phone, honest);
          await logConversation(collab.id, 'outbound', honest);
        } catch (postErr) {
          console.warn(`[Correction] honest-redirect post err (${action}):`, postErr.message);
        }
        // Velocímetro UNIFICADO (review 24/06): TODA linha da curva mora em marker_type='CHOKEPOINT'
        // (sentido no reason) — senão `where marker_type='CHOKEPOINT'` perde a maioria das linhas.
        await logMarker(collab.id, 'CHOKEPOINT', 'redirected', `redirect:finance:${editIntent.op}`, '');
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (correction_redirect_${editIntent.op})`);
        return;
      }
      // recent.length>0 + extração COMPLETA → o handler resolve (one/many/none) como hoje.
      if (corr) {
        const params = corr.op === 'delete'
          ? { which: corr.ref }
          : { which: '', amount: corr.amount, category: corr.category };
        // A ESCRITA fica isolada: se ela lançar, nada foi mutado (op atômica + trigger);
        // mandamos desculpa e retornamos — NÃO caímos no LLM (que é justo quem fabrica/nega).
        let reply;
        try {
          reply = await handleFinanceAction(collab, action, params);
        } catch (writeErr) {
          console.error(`[Correction] action err (${corr.op}):`, writeErr.message);
          await whatsapp.sendMessage(phone, '⚠️ Não consegui ajustar agora. Tenta de novo daqui a pouco?');
          return;
        }
        if (reply) {
          // Ação JÁ aplicada no banco: consome o turno de qualquer forma (envia/loga),
          // engolindo falhas pós-escrita pra NÃO reprocessar no LLM (evita double-apply).
          try {
            await whatsapp.sendMessage(phone, reply);
            await logConversation(collab.id, 'outbound', reply);
          } catch (postErr) {
            console.warn(`[Correction] post-write err (ação já aplicada, ${corr.op}):`, postErr.message);
          }
          console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (correction_${corr.op})`);
          return;
        }
      }
      // intent loose SEM extração completa, DENTRO da janela → precisa do alvo/valor → cai no LLM (clarifica).
    }
  } catch (e) {
    console.warn('[Correction] consumer err:', e.message);
  }

  // ---- Roteador determinístico de RELATÓRIO financeiro (pré-LLM) ----
  // Frases curtas/estereotipadas ("saldo do nubank", "fechamento de maio", "gastos da semana")
  // o LLM erra ao escolher entre 11 query_* parecidas (FIN-REPORT-ACTION-ALIAS fase 2: caiu em
  // checkup/extrato/query_transactions). Roteamos DIRETO via handleFinanceAction, sem depender
  // do LLM. Conservador: só alta-confiança; null → segue fluxo normal pro LLM.
  try {
    const { detectReportIntent } = require('./finance/detect-report-intent');
    const _intent = detectReportIntent(String(text || ''), new Date().toISOString().slice(0, 10));
    if (_intent && _intent.action) {
      // Relatório de UMA conta: só roteia determinístico se a conta EXISTIR. Senão ("saldo do
      // jogo/treino", "saldo do nubank deleta") a conta não resolve → deixa o LLM tratar. Mata a
      // classe inteira de noun-desconhecido sem precisar de denylist infinita.
      let _route = true;
      if ((_intent.action === 'query_account_detail' || _intent.action === 'query_statement') && _intent.params && _intent.params.account) {
        const _acc = await financeService.findAccountByName(collab.id, _intent.params.account).catch(() => null);
        _route = !!_acc;
      }
      let reply = null;
      if (_route) {
        try {
          reply = await handleFinanceAction(collab, _intent.action, _intent.params || {});
        } catch (rptErr) {
          console.error(`[ReportRouter] action err (${_intent.action}):`, rptErr.message);
          reply = null; // falha → cai no LLM
        }
      }
      if (reply) {
        try {
          await whatsapp.sendMessage(phone, reply);
          await logConversation(collab.id, 'outbound', reply);
        } catch (postErr) {
          console.warn('[ReportRouter] post-send err:', postErr.message);
        }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now() - _t0}ms (report_router:${_intent.action})`);
        return;
      }
    }
  } catch (e) {
    console.warn('[ReportRouter] err:', e.message);
  }

  // ---- TASK-QUERY-NO-FULL-LIST (caso Alf 12/06): consulta de tarefas pré-LLM ----
  // A barrinha/scorecard varrem o banco inteiro e dão o número exato, mas o contexto do
  // LLM só recebe um RECORTE das tarefas (workTasks cortado em max_daily_tasks + due<=+7d).
  // Quando o user tem 15 abertas e pergunta "minhas atrasadas / o que tenho esse mês / lista
  // minhas pendentes", o LLM via parcial e mandava "abre o app". Aqui interceptamos ANTES do
  // LLM: detector determinístico → query da lista COMPLETA → render com contagem exata.
  // Conservador (message-anchored): só dispara quando a mensagem É a consulta; senão null.
  // Roda DEPOIS do roteador de finanças (finanças vence "o que tenho pra pagar esse mês").
  try {
    const { detectTaskQuery, filterTasksByScope, renderTaskQueryReply } = require('./utils/task-query');
    const _tq = detectTaskQuery(String(text || ''));
    if (_tq && _tq.scope) {
      const { data: _openRows, error: _tqErr } = await supabase.from('tasks')
        .select('id, title, due_date, status, is_group, recurrence_rule, parent_task_id, context')
        .eq('assigned_to', collab.id)
        .eq('data_classification', 'real')
        .not('status', 'in', '(done,cancelled)');
      if (_tqErr) throw _tqErr;
      // Exclui containers de grupo recorrente (templates), igual ao filtro do openTasksNoDue
      // em system.js. Os demais (inclusive instâncias materializadas) são tarefas reais.
      const _allOpen = (_openRows || []).filter((t) => !(t.is_group && t.recurrence_rule != null));
      const _scoped = filterTasksByScope(_allOpen, _tq.scope, todaySaoPaulo());
      const _firstName = (collab.preferred_name || collab.full_name || '').split(' ')[0];
      const reply = renderTaskQueryReply(_scoped, _tq.scope, { today: todaySaoPaulo(), firstName: _firstName });
      if (reply) {
        try {
          await whatsapp.sendMessage(phone, reply);
          await logConversation(collab.id, 'outbound', reply);
        } catch (postErr) {
          console.warn('[TaskQuery] post-send err:', postErr.message);
        }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now() - _t0}ms (task_query:${_tq.scope} n=${_scoped.length})`);
        return;
      }
    }
  } catch (e) {
    console.warn('[TaskQuery] err:', e.message);
  }

  // Ano de referência (SP) p/ corrigir o ano-chute do Gemini nas datas da fatura (compras/estorno/
  // vencimento). Sem isso "19/05" sem ano virava 2024 e o lançamento sumia da fatura do ano corrente
  // (Rose 15/06: "lança na fatura de JULHO" caiu em julho/2024). Ver invoice-import.normInvoiceDate.
  const _refYear = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 4)) || undefined;

  // === Intercept comprovante: COMPROVANTE de PAGAMENTO de fatura (imagem) → motor pay_invoice ===
  // FIN-RECEIPT-CONFIRM-NOOP (Alf 22/06): o comprovante de fatura virava PERGUNTA passiva do LLM
  // ("fecho a tarefa e marco como paga?") → intent confirmation SEM actions → o "Sim" auto-resolvia
  // 'confirmed' mas NÃO executava (tarefa seguia pending, fatura não baixava). Aqui o engine
  // reconhece o comprovante DETERMINISTICAMENTE e monta a confirmação do pay_invoice (MESMA máquina
  // do marker: stagePayInvoice → buildPayInvoicePreview → intent), sem depender do LLM re-emitir.
  // O "Sim" cai no consumidor pay_invoice existente (paga + fecha a tarefa). O detector exclui
  // [FATURA_JSON] (import de compras), Pix e gasto comum — só comprovante de fatura de CARTÃO.
  try {
    const _rcpt = invoiceReceipt.detectInvoicePaymentReceipt(text);
    if (_rcpt) {
      const _stg = await stagePayInvoice(collab.id, { card: _rcpt.cardHint, amount: _rcpt.amount });
      if (_stg) {
        const _pv = launchConfirm.buildPayInvoicePreview(_stg.display);
        const _pid = _pv ? await pendingIntents.openIntent(collab.id, 'finance_source', { form: 'launch_confirm', actions: [_stg.action], close_tasks: _stg.close_tasks }, _pv) : null;
        if (_pid) {
          await logMarker(collab.id, 'FINANCE_ACTION', 'skipped', 'staged_pay_invoice:receipt', null);
          await whatsapp.sendMessage(phone, _pv);
          await logConversation(collab.id, 'outbound', _pv);
          console.log(`[Engine] comprovante de fatura: cartão="${_rcpt.cardHint}" valor=${_rcpt.amount} → pay_invoice staged (intent ${String(_pid).slice(0,8)})`);
          return;
        }
      }
      // Detectou o comprovante mas NÃO estagiou (cartão não casou / sem fatura aberta) → deixa o LLM
      // pedir o cartão (não retorna). Registra o miss pra observabilidade.
      console.warn(`[Engine] comprovante detectado, stage falhou: cartão="${_rcpt.cardHint}" valor=${_rcpt.amount}`);
    }
  } catch (e) {
    console.warn('[Fatura] intercept comprovante err:', e.message);
  }

  // === Intercept BOLETO: PDF de boleto (texto tem [BOLETO_JSON]) → conta a pagar (pf_bills) ===
  // Alf 17/07: boleto caía no fluxo de fatura de cartão (webhook chamava analyzeInvoice em todo
  // PDF). Aqui vira pf_bills com a linha digitável VALIDADA. NUNCA promete o código sem o dígito
  // verificador bater (pagamento errado). Abre intent bill_from_boleto; a resposta (recorrência +
  // conta) confirma e chama createBill.
  try {
    const _bMatch = text.match(/\[BOLETO_JSON\]([\s\S]*?)\[\/BOLETO_JSON\]/);
    if (_bMatch) {
      const boletoParse = require('./finance/boleto-parse');
      const { buildBoletoPreview } = require('./finance/boleto-preview');
      const _b = JSON.parse(_bMatch[1]);
      const _linha = boletoParse.extractLinhaDigitavel(_b.linha_digitavel || '') || boletoParse.extractLinhaDigitavel(text);
      const _val = _linha ? boletoParse.validateLinhaDigitavel(_linha) : { valid: false };
      const _barcodeOk = !!(_linha && _val.valid);
      const _intentId = await pendingIntents.openIntent(collab.id, 'bill_from_boleto',
        { stage: 'awaiting_confirm', beneficiario: _b.beneficiario, valor: _b.valor, vencimento: _b.vencimento,
          barcode: _barcodeOk ? _linha : null, descricao: _b.descricao || _b.beneficiario,
          veiculo: _b.veiculo || null }, 'criar conta do boleto?');
      if (!_intentId) {
        console.error('[Boleto] openIntent retornou null — confirmação não vai funcionar.');
        await whatsapp.sendMessage(phone, `🧾 Li o boleto (R$ ${Number(_b.valor || 0).toFixed(2)}), mas tive um problema técnico pra abrir a confirmação. Tenta de novo ou cadastra em Finanças → Contas.`);
        return;
      }
      console.log(`[Boleto] intent aberta: ${_b.beneficiario || '?'} R$ ${_b.valor} barcode_ok=${_barcodeOk}`);
      await whatsapp.sendMessage(phone, buildBoletoPreview({
        beneficiario: _b.beneficiario, valor: _b.valor, vencimento: _b.vencimento, barcodeOk: _barcodeOk,
      }));
      return;
    }
  } catch (e) { console.warn('[Boleto] intercept err:', e.message); }

  // === Intercept A0: fatura colada como TEXTO (não PDF) → estrutura via Gemini e injeta [FATURA_JSON] ===
  // Rose 14/06: mandou a fatura como texto; sem isso caía no LLM-puro, que narrava "lancei/missão
  // cumprida" SEM emitir markers (nada lançava), lia "dos 40" como R$40 e largava itens (24 de 40).
  // Aqui a fatura-texto entra no MESMO fluxo determinístico do PDF (Intercept A logo abaixo).
  try {
    if (!invoiceImport.parseInvoiceBlock(text).found && invoiceImport.looksLikeInvoiceText(text)) {
      const _struct = await gemini.analyzeInvoiceText(text);
      if (_struct && _struct.ok && _struct.isInvoice && _struct.invoice && (_struct.invoice.itens || []).length > 0) {
        // Corrige o ano-chute do Gemini ANTES de rotear: o estorno-lista (commitRefundList) consome
        // estas datas direto, sem passar pelo parseInvoiceBlock do Intercept A.
        _struct.invoice.vencimento = invoiceImport.normInvoiceDate(_struct.invoice.vencimento, _refYear);
        _struct.invoice.itens = _struct.invoice.itens.map((it) => ({ ...it, data: invoiceImport.normInvoiceDate(it.data || it.date || null, _refYear) }));
        // Lista 100% estornos → card_refund determinístico (não import-compras, não LLM). Regressão Rose 14/06.
        if (invoiceImport.allItemsRefund(_struct.invoice.itens)) {
          const _refundReply = await commitRefundList(collab.id, _struct.invoice);
          if (_refundReply) {
            await whatsapp.sendMessage(phone, _refundReply);
            await logConversation(collab.id, 'outbound', _refundReply);
            console.log(`[Engine] estorno-lista: ${_struct.invoice.itens.length} itens → card_refund determinístico`);
            return;
          }
        }
        const _resumo = `Fatura ${_struct.invoice.emissor || ''} · ${_struct.invoice.itens.length} compras`;
        text = `[FATURA_JSON]${JSON.stringify(_struct.invoice)}[/FATURA_JSON]\n${_resumo}`;
        console.log(`[Engine] fatura-texto detectada: ${_struct.invoice.itens.length} itens, emissor=${_struct.invoice.emissor || '?'}`);
      }
    }
  } catch (e) {
    console.warn('[Fatura] intercept A0 (texto) err:', e.message);
  }

  // === Intercept A: proposta de import de fatura (texto tem [FATURA_JSON]) ===
  try {
    const _invParsed = invoiceImport.parseInvoiceBlock(text, _refYear);
    if (_invParsed.found && _invParsed.invoice && _invParsed.invoice.itens.length > 0) {
      const _inv = _invParsed.invoice;
      // NUNCA chutar o cartão na ABERTURA da intent. Aqui era findCard(emissor)[0]: "Itaú" casa
      // 3 cartões da Rose e o [0] gravou "Itaú Matheus" no payload como se fosse fato. 3 min
      // depois ela corrigiu ("é o LATAM PASS"), mas o chute já estava na intent e o "sim" lançou
      // 58 itens no cartão errado (16/07 01:57). O pickInvoiceCard do commit (Intercept B) não
      // salvou porque ele CONFIA no card_id da intent — logo, chute não pode entrar no payload:
      // ou resolve de verdade, ou fica null e pergunta.
      const { pickInvoiceCard: _pickCardA } = require('./finance/pick-invoice-card');
      const _allCardsA = await financeService.listCards(collab.id);
      const _pickA = _pickCardA({ emissor: _inv.emissor, userText: text, cards: _allCardsA });
      const _card = _pickA.status === 'resolved' ? _pickA.card : null;
      const _fmtTot = Number(_inv.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
      if (!_card && !(_allCardsA || []).length) {
        const _outA0 = `📄 Li ${_inv.itens.length} compras (total R$ ${_fmtTot}), mas não identifiquei o cartão "${_inv.emissor}" nos seus cadastrados. Me diz de qual cartão é essa fatura (ou cadastra ele) que aí eu lanço.`;
        await whatsapp.sendMessage(phone, _outA0);
        await logConversation(collab.id, 'outbound', _outA0);
        return;
      }
      // safeCategory real = (cat, description, type, extraSlugs); carrega slugs custom do user (paridade c/ recordCardPurchase).
      const _catRows = await financeService.listCategorySlugs(collab.id).catch(() => []);
      const _extraSlugs = new Set((_catRows || []).filter((r) => r.collaborator_id).map((r) => r.slug));
      // Cascata de categoria (Rose 16-17/07 — 30% caía em "outros"): learned (memória do user) >
      // rules (merchant-category) > gemini (it.categoria do PDF) > outros. Lê a memória UMA vez;
      // se a query falhar, learned vazio → comportamento de hoje (nunca pior).
      const { resolveItemCategory, groupUnknowns } = require('./finance/categorize-invoice');
      const _validSlugs = new Set([...pfValidSlugs('expense'), ..._extraSlugs]);
      const _learned = new Map();
      try {
        const { data: _mem } = await supabase.from('pf_category_memory')
          .select('merchant_key, category').eq('collaborator_id', collab.id);
        (_mem || []).forEach((r) => _learned.set(r.merchant_key, r.category));
      } catch (e) { console.warn('[Fatura] pf_category_memory read err:', e.message); }
      const _itensCat = _inv.itens.map((it) => {
        const _res = resolveItemCategory({ descricao: it.descricao, tipo: 'expense', geminiHint: it.categoria, learned: _learned, validSlugs: _validSlugs });
        return { ...it, categoria: _res.slug, _catSource: _res.source };
      });
      const _unknowns = groupUnknowns(_itensCat);
      const _invIntentId = await pendingIntents.openIntent(collab.id, 'invoice_import',
        { stage: 'awaiting_confirm', card_id: _card ? _card.id : null, card_name: _card ? _card.name : null,
          emissor: _inv.emissor, vencimento: _inv.vencimento, total: _inv.total, itens: _itensCat, _unknowns },
        _card ? 'lançar fatura?' : 'de qual cartão é a fatura?');
      // Defense-in-depth: se o intent NÃO persistiu (ex.: constraint/erro de insert), o "lançar"
      // do próximo turno não terá nada pra casar (Intercept B) e cai no LLM derrotista. Falha
      // silenciosa escondeu esse bug por semanas (Alf/Rose 14/06). Loga ALTO e não promete confirmar.
      if (!_invIntentId) {
        console.error('[Fatura] CRÍTICO: openIntent invoice_import retornou null — confirmação NÃO vai funcionar. Checar pending_intents_kind_check / erro de insert.');
        const _outA1 = `📄 Li ${_inv.itens.length} compras da fatura ${_card ? `*${_card.name}* ` : ''}(total R$ ${_fmtTot}), mas tive um problema técnico pra abrir a confirmação aqui. Já avisei o time — tenta de novo daqui a pouco ou lança pelo app em Finanças → Cartões.`;
        await whatsapp.sendMessage(phone, _outA1);
        await logConversation(collab.id, 'outbound', _outA1);
        return;
      }
      if (!_card) {
        // Cartão ambíguo/não-achado: a fatura NÃO se perde — a intent fica aberta SEM card_id e o
        // Intercept B resolve pela fala ("lança no Latam PASS") no próximo turno. Lista TODOS os
        // cartões: filtrar pelos que casam o emissor esconderia a resposta certa (o Latam PASS é
        // Itaú mas não tem "Itaú" no nome — foi exatamente o cartão que a Rose queria).
        const _nomesA = (_allCardsA || []).map((c) => c.name);
        console.log(`[Fatura] cartão não resolvido na abertura (${_pickA.status}, emissor="${_inv.emissor}") → perguntando, intent sem card_id`);
        // Emissor pode vir vazio OU literalmente "desconhecido" do Gemini — nos dois casos o
        // nome sai da frase (Rose 16/07 21:26 leu "fatura *desconhecido*", parece defeito).
        const _emiA = (_inv.emissor && !/desconhecid|indefinid|^n\/?a$/i.test(_inv.emissor)) ? ` *${_inv.emissor}*` : '';
        const _outA2 = `📄 Li ${_inv.itens.length} compras da fatura${_emiA} (total R$ ${_fmtTot}) — mas não sei de qual cartão ela é, então não vou chutar.\n\nTenho: *${_nomesA.join('*, *')}*.\nResponde tipo *lança no ${_nomesA[0]}* que eu te mando a prévia pra conferir.`;
        await whatsapp.sendMessage(phone, _outA2);
        await logConversation(collab.id, 'outbound', _outA2);
        return;
      }
      const _preview = invoiceImport.buildInvoicePreview({
        emissor: _inv.emissor, vencimento: _inv.vencimento, total: _inv.total,
        cardName: _card.name, itens: _itensCat, dupWarning: null, unknowns: _unknowns,
      });
      await whatsapp.sendMessage(phone, _preview);
      await logConversation(collab.id, 'outbound', _preview);
      return;
    }
  } catch (e) {
    console.warn('[Fatura] intercept A err:', e.message);
  }

  // === Resposta ao preview de BOLETO (intent bill_from_boleto aberta) → createBill ===
  // Alf 17/07. A resposta define recorrência ("repete" = mensal; senão única) e confirma. NÃO
  // move dinheiro — só cria a conta a pagar. O lembrete de vencimento (bill-due) já cobre single+
  // atrasada e inclui a linha digitável quando bill.barcode (ritual-messages).
  try {
    const _boletoIntent = (_openIntents || []).find((i) => i.kind === 'bill_from_boleto' && i.payload && i.payload.stage === 'awaiting_confirm');
    if (_boletoIntent) {
      const _p = _boletoIntent.payload;
      const _low = text.toLowerCase();
      if (/\b(cancela|deixa|esquece|n[ãa]o precisa|nao precisa)\b/.test(_low)) {
        await pendingIntents.resolveIntent(_boletoIntent.id, 'denied', 'user cancelou boleto');
        await whatsapp.sendMessage(phone, 'Beleza, não criei a conta. 👍');
        return;
      }
      const _repete = /\b(repete|todo\s*m[êe]s|mensal|recorrente|fixa|fixo)\b/.test(_low);
      const _recurrence = _repete ? 'monthly' : 'once';
      const _vencOk = /^\d{4}-\d{2}-\d{2}/.test(_p.vencimento || '');
      await pendingIntents.resolveIntent(_boletoIntent.id, 'confirmed', `boleto→conta (${_recurrence})`);
      // Categoriza pelo beneficiário + descrição (HDI SEGUROS / "seguro do carro" → seguros).
      // safeCategory casa as keywords do categories.data.js; fallback 'outros' (não chuta 'moradia').
      const _boletoCat = safeCategory(null, `${_p.beneficiario || ''} ${_p.descricao || ''}`.trim(), 'expense');
      // Nome LIMPO: "Seguro <carro>" quando o veículo veio impresso no boleto; seguro sem
      // veículo → "Seguro do carro"/"Seguro <segurador>"; nunca o número da apólice (guard).
      const { buildBoletoName } = require('./finance/boleto-name');
      const _boletoNome = buildBoletoName({ beneficiario: _p.beneficiario, descricao: _p.descricao, veiculo: _p.veiculo });
      try {
        await financeService.createBill(collab.id, {
          name: _boletoNome, amount: _p.valor,
          category: _boletoCat || 'outros', type: 'expense',
          recurrence: _recurrence,
          due_date: _recurrence === 'once' && _vencOk ? _p.vencimento : null,
          due_day: _recurrence === 'monthly' && _vencOk ? Number(_p.vencimento.slice(8, 10)) : undefined,
          barcode: _p.barcode || null,
          payment_method: 'boleto',
        });
      } catch (be) {
        console.error('[Boleto] createBill err:', be.message);
        await whatsapp.sendMessage(phone, `Entendi, mas tive um problema técnico pra criar a conta (${be.code || be.message}). Tenta cadastrar em Finanças → Contas.`);
        return;
      }
      const _dm = _vencOk ? `${_p.vencimento.slice(8, 10)}/${_p.vencimento.slice(5, 7)}` : '?';
      const _quando = _recurrence === 'once' ? `dia ${_dm}` : `todo dia ${_vencOk ? _p.vencimento.slice(8, 10) : '?'}`;
      console.log(`[Boleto] conta criada: ${_boletoNome} ${_recurrence} venc=${_dm} barcode=${!!_p.barcode} veiculo=${_p.veiculo || '-'}`);
      await whatsapp.sendMessage(phone, `✅ Criei a conta *${_boletoNome}* (R$ ${Number(_p.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}), ${_recurrence === 'once' ? 'única' : 'mensal'}, vencendo ${_quando}. Te lembro no dia${_p.barcode ? ' com o código pra copiar' : ''}. 👍`);
      return;
    }
  } catch (e) { console.warn('[Boleto] resposta err:', e.message); }

  // === Intercept PIX: "copia e cola" colado OU "a chave pix da conta X é Y" → grava forma pix ===
  // Alf 17/07. Completa uma conta a pagar com a chave PIX. Copia-e-cola (BR Code) é VALIDADO por
  // CRC16 — adulterado reprova (não grava chave errada). Chave crua (email/CPF) não valida → grava
  // como veio. Alvo: a conta nomeada ("da HDI") OU a mais recente ainda sem forma (o boleto que o
  // Alf acabou de criar e completa com o PIX). NÃO move dinheiro.
  try {
    const pixParse = require('./finance/pix-parse');
    const _cola = pixParse.extractPixCopiaECola(text);
    const _chave = _cola || pixParse.extractPixKeyFromText(text);
    if (_chave) {
      if (_cola && !pixParse.validatePixBRCode(_cola).valid) {
        await whatsapp.sendMessage(phone, '⚠️ Esse PIX copia-e-cola não conferiu (o código de verificação não bateu — pode ter vindo cortado). Manda de novo, por favor?');
        return;
      }
      // nome da conta na fala: "da HDI", "conta HDI", "do seguro" — pega a palavra após "conta"/"da"/"do"
      const _hint = (text.match(/\b(?:conta|d[aeo])\s+(?:conta\s+)?([A-Za-zÀ-ú][\wÀ-ú .-]{2,40})/i) || [])[1] || null;
      const _upd = await financeService.setBillPaymentMethod(collab.id, {
        billNameHint: _hint ? _hint.trim().replace(/\s+(é|e|pra|para|no|na)\b.*$/i, '').trim() : null,
        payment_method: 'pix', pix_key: _chave,
      });
      if (_upd) {
        console.log(`[PIX] chave gravada na conta "${_upd.name}": ${_cola ? 'copia-e-cola(CRC ok)' : 'chave crua'}`);
        await whatsapp.sendMessage(phone, `✅ Guardei a chave PIX na conta *${_upd.name}*. No dia do vencimento eu te mando ela pra copiar. 👍`);
        return;
      }
      // não achou conta-alvo → não inventa; deixa o LLM seguir (pode ser papo solto sobre pix)
      console.log('[PIX] chave detectada mas nenhuma conta-alvo — seguindo pro LLM');
    }
  } catch (e) { console.warn('[PIX] intercept err:', e.message); }

  // === Intercept B: resposta ao preview de fatura (intent invoice_import aberta) ===
  try {
    const _invIntent = (_openIntents || []).find((i) => i.kind === 'invoice_import' && i.payload && i.payload.stage === 'awaiting_confirm');
    if (_invIntent) {
      const _decision = invoiceImport.detectInvoiceReply(text);
      // === A fala nomeia um cartão → DESAMBIGUA e manda a prévia (nunca commita direto) ===
      // NINGUÉM CONFIRMA UMA PRÉVIA QUE NÃO VIU. Dois casos reais, ambos da Rose em 16/07:
      //  01:54 — "Tom, é o cartão LATAM PASS. É para lançar somente o que falta. Lembra?" → o
      //    detector devolve null (tem "?", e pergunta nunca commita: certo), e a correção não
      //    tinha para onde ir: virou prosa do LLM enquanto a intent errada seguia viva, e o
      //    "sim" seguinte caiu nela.
      //  21:27 — "lança no Cartão MP Matheus" → o detector lê 'commit_financeiro' e lançava
      //    DIRETO, sem prévia. Mas a mensagem de desambiguação promete, com estas palavras,
      //    "Responde tipo *lança no X* que eu te mando a prévia pra conferir": ela digitou
      //    exatamente o que o TOM mandou digitar e levou o lançamento na cara. O TOM mentiu na
      //    própria instrução que deu.
      // Por isso o gate é o CARTÃO, não a decisão: nomear cartão != alvo atual (inclusive
      // quando não há alvo) é DESAMBIGUAR. shouldRestageCard decide; cancel/anotações mandam.
      {
        const { pickInvoiceCard: _pickCardC, shouldRestageCard } = require('./finance/pick-invoice-card');
        const _allCardsC = await financeService.listCards(collab.id);
        const _namedC = _pickCardC({ userText: text, cards: _allCardsC });
        if (shouldRestageCard({ decision: _decision, pick: _namedC, currentCardId: _invIntent.payload.card_id })) {
          const _payC = _invIntent.payload;
          await pendingIntents.resolveIntent(_invIntent.id, 'superseded', `usuário nomeou o cartão → ${_namedC.card.name}`);
          const _newIntentId = await pendingIntents.openIntent(collab.id, 'invoice_import',
            { ..._payC, stage: 'awaiting_confirm', card_id: _namedC.card.id, card_name: _namedC.card.name }, 'lançar fatura?');
          if (!_newIntentId) {
            console.error('[Fatura] CRÍTICO: openIntent (desambiguação de cartão) retornou null — a intent antiga já foi superseded.');
            const _outB0 = `Entendi que é o *${_namedC.card.name}*, mas tive um problema técnico pra reabrir a confirmação. Me manda a fatura de novo, por favor.`;
            await whatsapp.sendMessage(phone, _outB0);
            await logConversation(collab.id, 'outbound', _outB0);
            return;
          }
          console.log(`[Fatura] cartão definido pela fala: ${_payC.card_name || '(sem cartão)'} → ${_namedC.card.name} (decision=${_decision || 'null'}) → prévia, sem commit`);
          const _prevB0 = invoiceImport.buildInvoicePreview({
            emissor: _payC.emissor, vencimento: _payC.vencimento, total: _payC.total,
            cardName: _namedC.card.name, itens: _payC.itens, dupWarning: null, unknowns: _payC._unknowns,
          });
          await whatsapp.sendMessage(phone, _prevB0);
          await logConversation(collab.id, 'outbound', _prevB0);
          return;
        }
      }
      // === Correção de CATEGORIA ("1 é pedágio", "ConectCar é transporte") ===
      // Aprende (upsert pf_category_memory por pessoa) → re-resolve o lote com a memória nova →
      // RE-MANDA A PRÉVIA (nunca commita: ninguém confirma prévia que não viu). Só age em correção
      // EXPLÍCITA; senão null e o fluxo segue pro commit/cancel. Aprende SÓ aqui, nunca no "sim".
      {
        const { detectCategoryCorrections } = require('./finance/categorize-invoice');
        const _pay = _invIntent.payload;
        const _validSlugsB = new Set(pfValidSlugs('expense'));
        const _fixes = detectCategoryCorrections(text, _pay._unknowns, _pay.itens, _validSlugsB);
        if (_fixes && _fixes.length) {
          const { merchantKey, resolveItemCategory, groupUnknowns } = require('./finance/categorize-invoice');
          // aprende cada correção
          for (const _f of _fixes) {
            try {
              await supabase.from('pf_category_memory').upsert(
                { collaborator_id: collab.id, merchant_key: _f.merchantKey, category: _f.slug, updated_at: new Date().toISOString() },
                { onConflict: 'collaborator_id,merchant_key' });
              console.log(`[Fatura] aprendeu: ${_f.merchantKey} → ${_f.slug}`);
            } catch (e) { console.error('[Fatura] upsert memória err:', e.message); }
          }
          // re-resolve o lote inteiro com a memória nova (a correção pega TODOS os itens da loja)
          const _learnedB = new Map(_fixes.map((f) => [f.merchantKey, f.slug]));
          const _itensRe = _pay.itens.map((it) => {
            const _res = resolveItemCategory({ descricao: it.descricao, tipo: 'expense', geminiHint: it.categoria, learned: _learnedB, validSlugs: _validSlugsB });
            return { ...it, categoria: _res.slug, _catSource: _res.source };
          });
          const _unknownsRe = groupUnknowns(_itensRe);
          await pendingIntents.resolveIntent(_invIntent.id, 'superseded', `correção de categoria: ${_fixes.map((f) => f.merchantKey + '→' + f.slug).join(', ')}`);
          const _reId = await pendingIntents.openIntent(collab.id, 'invoice_import',
            { ..._pay, stage: 'awaiting_confirm', itens: _itensRe, _unknowns: _unknownsRe }, 'lançar fatura?');
          if (!_reId) {
            console.error('[Fatura] CRÍTICO: openIntent (correção de categoria) retornou null — intent antiga já superseded.');
            const _outB1 = 'Anotei a categoria, mas tive um problema técnico pra reabrir a confirmação. Me manda a fatura de novo, por favor.';
            await whatsapp.sendMessage(phone, _outB1);
            await logConversation(collab.id, 'outbound', _outB1);
            return;
          }
          const _prevB1 = invoiceImport.buildInvoicePreview({
            emissor: _pay.emissor, vencimento: _pay.vencimento, total: _pay.total,
            cardName: _pay.card_name || _pay.emissor, itens: _itensRe, dupWarning: null, unknowns: _unknownsRe,
          });
          await whatsapp.sendMessage(phone, _prevB1);
          await logConversation(collab.id, 'outbound', _prevB1);
          return;
        }
      }
      if (_decision) {
        const _pay = _invIntent.payload;
        if (_decision === 'cancel') {
          await pendingIntents.resolveIntent(_invIntent.id, 'denied', 'user cancelou');
          const _outB2 = 'Beleza, cancelei — não lancei nada. 👍';
          await whatsapp.sendMessage(phone, _outB2);
          await logConversation(collab.id, 'outbound', _outB2);
          return;
        }
        if (_decision === 'commit_anotacoes') {
          const _body = invoiceImport.buildInvoicePreview({ ..._pay, cardName: _pay.card_name || _pay.emissor });
          await notesService.createNote(supabase, collab.id, { title: `Fatura ${_pay.emissor || ''} ${_pay.vencimento || ''}`.trim(), body: _body, source: 'tom', sharedWith: [] });
          await pendingIntents.resolveIntent(_invIntent.id, 'confirmed', 'salvou em anotacoes');
          const _outB3 = `📝 Salvei a fatura nas suas anotações (${_pay.itens.length} compras). Não lancei no financeiro.`;
          await whatsapp.sendMessage(phone, _outB3);
          await logConversation(collab.id, 'outbound', _outB3);
          return;
        }
        if (_decision === 'commit_financeiro') {
          // NUNCA chutar o cartão (Rose 14/07: emissor "Itaú" casava 3 cartões → lançou 59 no
          // Itaú Matheus em vez do Latam PASS). pickInvoiceCard resolve por card_id confirmado >
          // fala do usuário > emissor; se ambíguo/não-achado, PERGUNTA em vez de adivinhar.
          const { pickInvoiceCard } = require('./finance/pick-invoice-card');
          const _allCards = await financeService.listCards(collab.id);
          const _pick = pickInvoiceCard({ emissor: _pay.emissor, userText: text, cards: _allCards, cardIdHint: _pay.card_id });
          if (_pick.status !== 'resolved') {
            const _cand = (_pick.candidates && _pick.candidates.length ? _pick.candidates : _allCards).map((c) => c.name);
            // Orienta a responder JÁ com o cartão ("lança no X") — aí o commit + o pick resolvem
            // no mesmo turno (pickInvoiceCard lê o nome da fala), sem depender de estado entre turnos.
            const _outB4 = `Antes de lançar — de qual cartão é essa fatura? Responde tipo *lança no ${_cand[0]}* que eu mando no certo. Tenho: *${_cand.join('*, *')}*.`;
            await whatsapp.sendMessage(phone, _outB4);
            await logConversation(collab.id, 'outbound', _outB4);
            return; // intent segue aberta
          }
          const _card = _pick.card;
          // Fatura importada = UMA competência (a do vencimento do PDF). Sem isso, cada item
          // era recolocado por data de compra (closing_day do cadastro) e a fatura se partia em
          // 2 meses (caso Alf 14/06: 6 compras foram pra julho). O vencimento do PDF manda.
          const _faturaComp = (_pay.vencimento && /^\d{4}-\d{2}/.test(_pay.vencimento))
            ? _pay.vencimento.slice(0, 7) + '-01' : undefined;
          // Dedup idempotente: chave por item (FITID no OFX; hash data+valor+desc+ocorrência no resto).
          // Reimportar a MESMA fatura não duplica (Alf/Rose 14/06 apagaram lançamento na mão 2×).
          const _impKeys = statementParse.buildImportKeys(_pay.itens, { cardId: _card.id, competencia: _faturaComp || '' });
          const _existing = new Set();
          try {
            const _ks = _impKeys.filter(Boolean);
            if (_ks.length) {
              const { data: _ex } = await supabase.from('pf_transactions')
                .select('import_key').eq('collaborator_id', collab.id).in('import_key', _ks);
              (_ex || []).forEach((r) => _existing.add(r.import_key));
            }
          } catch (e) { console.warn('[Fatura] dedup check err:', e.message); }
          let _okN = 0, _dupN = 0;
          for (let _i = 0; _i < _pay.itens.length; _i++) {
            const it = _pay.itens[_i];
            const _ik = _impKeys[_i];
            if (_ik && _existing.has(_ik)) { _dupN++; continue; }
            try {
              const _r = await financeService.insertCardPurchase(collab.id, _card, {
                category: it.categoria, amount: it.valor,
                description: it.parcela_total > 1 ? `${it.descricao} (${it.parcela_atual}/${it.parcela_total})` : it.descricao,
                transaction_date: it.data || _pay.vencimento || undefined,
                installments: 1,
                competencia: _faturaComp,
                import_key: _ik,
              });
              if (Array.isArray(_r) && _r.length === 0) _dupN++; else _okN++;
            } catch (e) { console.error('[Fatura] item falhou:', it.descricao, e.message); }
          }
          await pendingIntents.resolveIntent(_invIntent.id, 'confirmed', `lancou ${_okN} itens${_dupN ? ', ' + _dupN + ' dup' : ''}`);
          const _dupMsg = _dupN ? ` (${_dupN} já estava${_dupN > 1 ? 'm' : ''} lançada${_dupN > 1 ? 's' : ''}, ignorei pra não duplicar)` : '';
          const _outB5 = `✅ Lancei ${_okN} de ${_pay.itens.length} compras no *${_card.name}*${_dupMsg}. Confere na tela de Cartões!`;
          await whatsapp.sendMessage(phone, _outB5);
          await logConversation(collab.id, 'outbound', _outB5);
          return;
        }
      }
      // sem decisão clara → não short-circuita; deixa o fluxo normal (LLM) responder
    }
  } catch (e) {
    console.warn('[Fatura] intercept B err:', e.message);
  }

  // ---- LOTE D (REPLY-QUOTE-PROATIVO): reply-quote a um lembrete → ancora o alvo por id ----
  // O proativo gravou whatsapp_message_id + ref em conversation_history (proactive-link).
  // Se a msg cita (reply-quote) um proativo conhecido, resolvemos a tarefa/evento por
  // stanzaID EXATO e injetamos contexto ANCORADO pro LLM emitir o <<TASK_UPDATE>> no id
  // certo (sem chutar alvo). Não escreve datas (recorrência intocada). Fail-safe: erro ou
  // alvo não-resolvido → segue o fluxo normal (scaffold textual + LLM), comportamento atual.
  try {
    const { resolveReplyTarget, buildReplyRefCtxHint } = require('./services/reply-ref');
    const _q = whatsapp.extractQuotedMessage(raw);
    const _quotedId = _q && _q.id ? _q.id : null;
    if (_quotedId) {
      const { data: _linkRow } = await supabase.from('conversation_history')
        .select('ref_type, ref_id')
        .eq('whatsapp_message_id', _quotedId)
        .not('ref_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (_linkRow && _linkRow.ref_id) {
        const _table = _linkRow.ref_type === 'event' ? 'events' : 'tasks';
        const { data: _obj } = await supabase.from(_table)
          .select('id, status, title')
          .eq('id', _linkRow.ref_id)
          .maybeSingle();
        const _target = resolveReplyTarget({ quotedId: _quotedId, row: _linkRow, object: _obj });
        if (_target) {
          // TASKDONE-QUOTE-REMINDER-NOOP (27/06) — reply-quote a lembrete de TAREFA + "feito" →
          // conclui DETERMINÍSTICO (não depende do LLM, que falhou sob fallback Codex; a tarefa do
          // Arthur ficou pending). Owner-scoped (assigned_to=collab.id) + status vivo → idempotente;
          // não-dono / já mudou → rowcount 0 → segue o fluxo normal (ctx-hint + LLM). Loga
          // TASK_UPDATE executed (seta marker_emitted → chokepoint não rebaixa).
          const _td = decideTaskDoneFromQuote({ rawText: text, target: _target });
          if (_td) {
            const { data: _doneRow } = await supabase.from('tasks')
              .update({ status: 'done', completed_at: new Date().toISOString(), completed_by: collab.id })
              .eq('id', _td.refId).eq('assigned_to', collab.id).in('status', ['pending', 'in_progress'])
              .select('id, title').maybeSingle();
            if (_doneRow) {
              const _doneReply = `✅ Concluí: ${_doneRow.title || _td.title}`;
              try { await logMarker(collab.id, 'TASK_UPDATE', 'executed', `taskdone_quote:${String(_td.refId).slice(0, 8)}`, null); } catch (_) {}
              await whatsapp.sendMessage(phone, _doneReply);
              await logConversation(collab.id, 'outbound', _doneReply);
              console.log(`[ReplyRef] TASKDONE deterministico ${String(_td.refId).slice(0, 8)} phone=${_phoneTail}`);
              return;
            }
          }
          text = String(text || '') + buildReplyRefCtxHint(_target);
          console.log(`[ReplyRef] alvo ancorado ${_target.refType}=${String(_target.refId).slice(0, 8)} phone=${_phoneTail}`);
        } else {
          console.log(`[ReplyRef] quote casou linha mas alvo nao-ancoravel (morto/sumiu) phone=${_phoneTail}`);
        }
      }
    }
  } catch (e) {
    console.warn('[ReplyRef] interceptor err:', e.message);
  }

  // ---- Sprint 30.3 — Pending Intents: auto-resolve quando user confirma ----
  // Se TOM perguntou "Crio?" turnos atrás (intent aberta) e o user agora
  // respondeu "sim/ok/pode/cria", injeta contexto extra no `text` pra forçar
  // o LLM a emitir o marker. A intent é resolvida ao final do turno.
  let _pendingIntentToResolve = null;
  try {
    const openIntents = _openIntents;
    if (openIntents.length > 0) {
      // approval_pending NUNCA resolve por sim/não genérico — aprovação tem funil
      // próprio (detect-approval-reply, acima). Pega a mais recente não-aprovação.
      const target = openIntents.find((i) => i.kind !== 'approval_pending');
      // GUARD-CONFIRM-LOOP (Matheus 10/06): reply-quote chegava CRU no detector —
      // o scaffold "[O usuário está RESPONDENDO...]" estourava o limite de resposta
      // curta e "Já conclui!" nunca casava. Strip primeiro (paridade c/ Approval-bare).
      const _confirmText = stripReplyScaffold(String(text || '')).userText;
      // Vocabulário de conclusão ("já fiz", "feito") SÓ vale quando o alvo é intent
      // ANCORADA de complete — a pergunta foi "confirma que já foi feito?".
      const _anchoredComplete = !!(target && target.payload && target.payload.anchor
        && target.payload.anchor.id && target.payload.action === 'complete');
      // BATCH-CONFIRM-IMPERATIVE-NUM (Rose/2088 28/06): intent de fechamento em LOTE também
      // é contexto de complete — "Conclui as 3" / "1 e 2 já foram feitas" devem confirmar
      // (sem isso só "Sim" pelado disparava o executeBatchComplete; a Rose loopou e o 2088 dropou).
      const _batchComplete = !!(target && Array.isArray(target.payload?.batch_complete) && target.payload.batch_complete.length);
      const userConfirm = pendingIntents.detectUserConfirmation(_confirmText, { allowDone: _anchoredComplete || _batchComplete });
      // Janela de confirmação: um "sim/não" cru só resolve a intent se ela foi
      // perguntada há pouco (~20min). Fora disso NÃO resolve e NÃO apaga — a intent
      // segue aberta pro fluxo natural/expiração. (Bug: "sim" pra criar meta
      // confirmava intent stale de horas atrás, ex. "cobrar o Rafinha".)
      const fresh = target ? withinConfirmWindow(target.asked_at, 20) : false;
      if (!target) {
        // só aprovações abertas — o funil próprio (Approval-bare, acima) cuida delas
      } else if (userConfirm && !fresh) {
        console.log(`[PendingIntents] skip auto-resolve (stale >20min) — intent=${target.id.slice(0,8)} kind=${target.kind} asked=${target.asked_at}`);
      } else if (userConfirm === 'yes' && target.payload && target.payload.anchor && target.payload.anchor.id) {
        // F5 (ALVO-FUTURO): intent ANCORADA (a guarda temporal abriu com o id certo) —
        // o ENGINE aplica o complete direto no item ancorado, sem LLM (sem chute de alvo).
        const anc = target.payload.anchor;
        // CONFIRM-ANCHOR-WRONGBIND (Ana 10/07): frase-longa que NÃO menciona o anchor
        // (título/número/tudo) não amarra — "Bombonha Alice - feito" não é sobre "Falar com a
        // Fefê". Fail-safe: na dúvida cai no LLM (que trata o log de hábito). Curto confirma.
        const { confirmationBindOk } = require('./utils/confirm-bind');
        const _bindOk = confirmationBindOk(_confirmText, anc.title);
        if (!_bindOk) {
          console.log(`[PendingIntents] anchor bind SKIP "${String(anc.title || '').slice(0, 30)}" — msg não cita o anchor (frase-longa) phone=${_phoneTail}`);
        }
        let okAnc = false;
        if (_bindOk) {
          try {
            if (anc.type === 'task') {
              const { error: ancErr } = await supabase.from('tasks')
                .update({ status: 'done', completed_at: new Date().toISOString(), completed_by: collab.id })
                .eq('id', anc.id);
              okAnc = !ancErr;
            } else if (anc.type === 'event') {
              const { error: ancErr } = await supabase.from('events').update({ status: 'done' }).eq('id', anc.id);
              okAnc = !ancErr;
            }
          } catch (ancEx) { console.warn('[PendingIntents] anchored complete err:', ancEx.message); }
        }
        if (okAnc) {
          await pendingIntents.resolveIntent(target.id, 'confirmed', 'anchored complete (engine)');
          const msgAnc = `✅ *${anc.title || 'Item'}* concluído.`;
          try { await whatsapp.sendMessage(phone, msgAnc); await logConversation(collab.id, 'outbound', msgAnc); } catch (_) { /* já persistiu */ }
          console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (anchored_complete_${anc.type})`);
          return;
        }
        // bind-skip OU escrita falhou → segue fluxo normal (LLM vê a intent e tenta pelo marker)
      } else if (userConfirm === 'yes' && Array.isArray(target.payload?.batch_complete) && target.payload.batch_complete.length) {
        // BATCH-COMPLETE-CONFIRM-NOOP (Fabi 20/06): confirmação de fechamento em LOTE.
        // A intent {batch_complete:[short_ids]} (aberta em applyTaskActions A2) era
        // resolvida 'confirmed' mas NUNCA executava — payload sem `anchor` pula o
        // executor de 1 tarefa (acima) e `batch_complete` não está no hasConcrete (o
        // branch do LLM abaixo proíbe marker). Espelha o executor ancorado: conclui
        // DIRETO, sem LLM (robusto sob fallback). Retorna cedo → NÃO toca hasConcrete
        // → RECUR-TEMPLATE-DUP intacto. resolveTaskByShortId escopa por colaborador.
        const { executeBatchComplete } = require('./utils/batch-complete');
        const { okCount, okTitles, total } = await executeBatchComplete({
          supabase, resolveTaskByShortId, collaboratorId: collab.id,
          ids: target.payload.batch_complete, now: new Date().toISOString(),
        });
        if (okCount > 0) {
          await pendingIntents.resolveIntent(target.id, 'confirmed', `batch complete (engine) ${okCount}/${total}`);
          const lista = okTitles.length ? okTitles.map((t) => `*${t}*`).join(', ') : `${okCount} tarefa${okCount > 1 ? 's' : ''}`;
          const msgBc = okCount === total ? `✅ Concluí: ${lista}.` : `✅ Concluí ${okCount} de ${total}: ${lista}.`;
          try { await whatsapp.sendMessage(phone, msgBc); await logConversation(collab.id, 'outbound', msgBc); } catch (_) { /* já persistiu */ }
          console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (batch_complete_${okCount}/${total})`);
          return;
        }
        // nenhuma concluída (ids stale) → segue fluxo normal (LLM vê a intent)
      } else if (userConfirm === 'yes' && Array.isArray(target.payload?.coordination?.items) && target.payload.coordination.items.length) {
        // COORD-CONFIRM-NOOP (Fabi 10/07): confirmação de recado/aviso. Executa determinístico
        // (applyCoordinationRequestAction), sem depender do LLM re-emitir. Espelha o executor
        // ancorado/batch. Retorna cedo → o LLM NÃO é chamado no 2º turno (sem re-estágio/loop).
        const _items = target.payload.coordination.items;
        let _okC = 0; const _fail = [];
        for (const _it of _items) {
          try {
            const _r = await applyCoordinationRequestAction(collab, _it);
            await logMarker(collab.id, 'COORDINATION_REQUEST', _r.ok ? 'executed' : 'rejected', `${_it.recipient_name}:${_r.reason}`, null);
            if (_r.ok) _okC++; else _fail.push(_r.replyText || `${_it.recipient_name} (${_r.reason})`);
          } catch (e) { console.warn('[CoordConfirm] exec err:', e.message); _fail.push(`${_it.recipient_name} (erro)`); }
        }
        await pendingIntents.resolveIntent(target.id, 'confirmed', `coord confirm (engine) ${_okC}/${_items.length}`);
        let _outC;
        if (_okC === _items.length) _outC = _okC === 1 ? '📨 Recado enviado!' : `📨 ${_okC} recados enviados!`;
        else if (_okC > 0) _outC = `📨 Enviei ${_okC} de ${_items.length}. Não consegui: ${_fail.join('; ')}.`;
        else _outC = _fail.length === 1 ? _fail[0] : `Não consegui enviar: ${_fail.join('; ')}.`;
        try { await whatsapp.sendMessage(phone, _outC); await logConversation(collab.id, 'outbound', _outC); } catch (_) { /* já persistiu */ }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (coord_confirm_${_okC}/${_items.length})`);
        return;
      } else if (userConfirm === 'yes' && target.payload?.delegation
                 && target.payload.delegation.task_id && target.payload.delegation.to_name) {
        // FATIA 5 (confirmação parse-on-open, delegação): confirmação de "Delego pra X — '…'?".
        // Executa determinístico reusando o handler `delegate` (applyTaskActions @5835 — resolve
        // dono via resolveTaskByShortId, destinatário via resolveCollaboratorByName, fail-closa em
        // ambíguo/não-achado, notifica o destinatário). Retorna cedo → o LLM NÃO re-estágia/loopa.
        const _d = target.payload.delegation;
        let _rd;
        try {
          _rd = await applyTaskActions(collab, [{ action: 'delegate', id: _d.task_id, to_name: _d.to_name }], { inboundText: _confirmText });
        } catch (e) { console.warn('[DelegateConfirm] exec err:', e.message); _rd = { okCount: 0, failCount: 1, failMessages: [] }; }
        await pendingIntents.resolveIntent(target.id, 'confirmed', `delegate confirm (engine) ${_rd.okCount || 0}/1`);
        let _outD;
        if (_rd.integrityPayload && _rd.integrityPayload.type === 'ambiguous_recipient') {
          _outD = collabResolver.buildAmbiguityQuestion(_rd.integrityPayload.candidates);
        } else if ((_rd.okCount || 0) >= 1) {
          _outD = `📋 Delegado pra *${_d.to_name}*.`;
        } else {
          _outD = (_rd.failMessages && _rd.failMessages[0]) || `Não consegui delegar "${_d.to_name}" — confere o nome pra mim?`;
        }
        try { await whatsapp.sendMessage(phone, _outD); await logConversation(collab.id, 'outbound', _outD); } catch (_) { /* já persistiu */ }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (delegate_confirm_${_rd.okCount || 0})`);
        return;
      } else if (userConfirm === 'yes') {
        _pendingIntentToResolve = { intent: target, resolution: 'confirmed' };
        // Injeta contexto inline pra LLM saber o que confirmar.
        const payloadStr = JSON.stringify(target.payload || {}).slice(0, 800);
        // Caso Conciliação 10/06: o hint mandava "emita o marker AGORA" mesmo quando o
        // payload não tinha NENHUM item concreto — o LLM escolhia alvos sozinho e
        // reagendou 2 tasks que a Rose nunca pediu. Marker só com item concreto no
        // payload, e SÓ sobre esses itens.
        const _p = target.payload || {};
        const hasConcrete = !!(_p.draft || _p.drafts || _p.anchor || _p.task_id || _p.event_id || _p.items);
        // AUDIT 16/07 (confab-noop sweep, caso Alf/HR-V): o ramo !hasConcrete mandava
        // "apenas confirme em texto e feche o assunto" — que é a RECEITA DA CONFABULAÇÃO:
        // proíbe agir E manda confirmar, então o LLM obedece e responde "✅ Criado!" sem
        // nada ter sido gravado (foi exatamente isso no HR-V, e explica as 34 CHOKEPOINT
        // confab:unknown em 30 dias). A proibição de emitir marker é MANTIDA (sem ela o LLM
        // inventa alvos — caso Conciliação/Rose 10/06, motivo original deste ramo); o que
        // muda é proibir também a AFIRMAÇÃO falsa e dar a saída honesta.
        // F3 de TASK-CONFIRM-DONE-NOOP (medida 08/08): a intent genérica de fim de turno
        // nasce com {last_user_text, last_tom_reply} — campos que hasConcrete NÃO reconhece.
        // Resultado: TODA intent genérica caía no ramo proibitivo, mesmo quando o TOM tinha
        // acabado de descrever o item na própria pergunta ("Entendi: lembrete amanhã às 11h —
        // mandar mensagem pro Rômulo. Certo?") e o usuário confirmou de forma inequívoca
        // (15 casos, 8 pessoas, "Isso"/"Sim"/"Pode fechar" em 100% deles).
        // O perigo que motivou a proibição é o LLM CHUTAR QUAL ITEM EXISTENTE tocar (caso
        // Conciliação/Rose 10/06: reagendou 2 tarefas que ninguém pediu). Em proposta de
        // CRIAÇÃO esse perigo não existe — não há alvo a chutar. O gate é puro e fail-closed
        // (utils/confirm-create-gate.js, fixtures = as 15 perguntas reais).
        // Flag de rollback: TOM_CONFIRM_CREATE_GATE=0 volta ao comportamento antigo sem
        // deploy. Também é o que permite rodar o cenário de prova nos DOIS modos e mostrar
        // a reversão (scripts/prova-confirm-create-gate.js).
        const { podeLiberarCriacao } = require('./utils/confirm-create-gate');
        const _gateOn = process.env.TOM_CONFIRM_CREATE_GATE !== '0';
        const _liberaCriacao = _gateOn && !hasConcrete && podeLiberarCriacao(target.question_text);
        // FATIA 8: análogo do create-gate para RECADO implícito. Se a pergunta é proposta de recado
        // e o usuário confirmou, instrui o LLM a compor+emitir COORDINATION_REQUEST — e o handler
        // despacha DIRETO (preConfirmed, sem re-estagiar/loopar). Flag de rollback
        // TOM_CONFIRM_RECADO_GATE=0. Só quando NÃO é criação (create-gate tem precedência).
        const { podeLiberarRecado } = require('./coordination/confirm-coord-gate');
        const _liberaRecado = process.env.TOM_CONFIRM_RECADO_GATE !== '0' && !hasConcrete
          && !_liberaCriacao && podeLiberarRecado(target.question_text);
        if (_liberaRecado) _metrics.recado_preconfirmed = true;
        let markerRule = hasConcrete
          ? 'Emita o marker apropriado APENAS para os itens do payload acima (ex: <<TASK_UPDATE>> com action=create para cada draft). NÃO crie, edite ou reagende NENHUM item que não esteja no payload.'
          : (_liberaCriacao
            ? 'O payload não tem ids, MAS a pergunta acima é uma proposta de CRIAÇÃO que VOCÊ mesmo formulou e o usuário aprovou. Emita o marker de criação (action=create) reproduzindo EXATAMENTE os dados que você propôs ali — mesmo título, mesma data, mesma hora, mesma pessoa. NÃO invente nenhum dado que não esteja na sua proposta. E NÃO edite, reagende, conclua, delegue nem apague NENHUM item já existente.'
            : (_liberaRecado
              ? 'O payload não tem ids, MAS a pergunta acima é um RECADO/aviso que VOCÊ mesmo propôs e o usuário aprovou. Emita <<COORDINATION_REQUEST>> para o destinatário que você citou ali, compondo a mensagem FIEL à intenção que você propôs — mesmo destinatário, mesmo teor. NÃO invente destinatário nem mude o assunto. NÃO edite, reagende, conclua, delegue nem apague NENHUM item existente.'
              : 'O payload NÃO tem item concreto (sem draft/ids): você NÃO consegue executar isso agora. NÃO emita marker nenhum e NÃO toque em tasks/eventos existentes. E NÃO afirme que fez — nada foi gravado, então dizer "criei/registrei/marquei/deleguei/avisei/despachei" seria MENTIRA. Em UMA linha curta e natural, assuma que não conseguiu registrar e peça pra pessoa repetir o pedido com os detalhes.'));

        // TASK-HONESTY-NEGA-BAIXA-FEITA (Kailane 12/08 19:21) — irmão do COORD-HONESTY nas TAREFAS.
        // A instrução acima afirma o ABSOLUTO "você NÃO consegue executar isso agora", mas sua
        // evidência é só "não há payload NESTE turno". Quando o TOM acabou de dar baixa — 25s
        // antes, no caso da Kailane — ela manda negar um trabalho que ele mesmo fez, e a pessoa
        // repete o pedido achando que nada aconteceu. Mesma forma do fix do recado (10/08): um
        // FATO DO BANCO entra no gate. Lá era coordination_requests.status=sent; aqui é
        // tasks.completed_at. A proibição de emitir marker NÃO é afrouxada — o perigo do LLM
        // chutar alvo (Rose 10/06) continua barrado; o que muda é não poder negar o que existe.
        // Consulta só neste ramo (raro) e falha-aberta: sem a leitura, vale a regra original.
        if (!hasConcrete && !_liberaCriacao) {
          try {
            const { concluidasRecentes, regraComConclusaoRecente, JANELA_PADRAO_MIN } = require('./lib/task-done-recente');
            const _desde = new Date(Date.now() - JANELA_PADRAO_MIN * 60_000).toISOString();
            const { data: _doneRows } = await supabase.from('tasks')
              .select('title, completed_at').eq('assigned_to', collab.id).eq('status', 'done')
              .gte('completed_at', _desde).order('completed_at', { ascending: false }).limit(6);
            const _titulos = concluidasRecentes(_doneRows || [], new Date());
            if (_titulos.length) {
              markerRule = regraComConclusaoRecente(markerRule, _titulos);
              console.log(`[TaskHonesty] ${_titulos.length} baixa(s) recente(s) — regra ajustada p/ não negar`);
              await logMarker(collab.id, 'TASK_DONE_RECENTE', 'redirected', `titulos=${_titulos.length}`, null);
            }
          } catch (e) { console.warn('[TaskHonesty] lookup err (non-fatal):', e.message); }
        }
        // VELOCÍMETRO do confab-noop (audit 16/07). Sem isto a decisão de estagiar (ou não)
        // cada superfície seria por TEORIA: quando a Camada 1 funciona, o TOM avisa honesto
        // SEM o chokepoint disparar — ou seja, o caso não aparece em NENHUM log e some da
        // medição. Este marker conta as confirmações que chegaram SEM payload executável e
        // guarda a pergunta (que identifica a superfície), pra priorizar o staging por dado.
        // Cruzamento: CONFIRM_NOEXEC alto + CHOKEPOINT confab:unknown baixo = Camada 1 pegou
        // (dano virou fricção); ambos altos = o LLM ainda mente e o staging é urgente.
        if (!hasConcrete) {
          try {
            // CONFIRM_NOEXEC segue contando SÓ o que continua bloqueado, pra série histórica
            // (15 casos de 16/07 a 07/08) permanecer comparável e CAIR quando o gate pegar.
            // O que o gate libera vai num tipo próprio — os dois somados reproduzem a série
            // antiga, então dá pra ver a migração de um balde pro outro em vez de um sumiço.
            await logMarker(collab.id,
              _liberaCriacao ? 'CONFIRM_CREATE_ALLOWED' : 'CONFIRM_NOEXEC',
              _liberaCriacao ? 'redirected' : 'skipped',
              `kind=${target.kind}`,
              String(target.question_text || '').slice(0, 200));
          } catch (_) { /* telemetria nunca quebra o turno */ }
        }
        const ctxHint = `\n\n[CONTEXTO INTERNO — não verbalize ao usuário]\nVocê tinha aberto uma intent (${target.kind}) com a pergunta: "${(target.question_text || '').slice(0, 200)}".\nPayload pendente: ${payloadStr}\nO usuário CONFIRMOU. ${markerRule}`;
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
  // GUARD: não rodar em texto vindo de ANÁLISE DE IMAGEM (foto de comprovante).
  // O endereço do cupom (ex: "...CAMPO GRANDE...") fazia o bypass achar que era
  // query de estoque da unidade Campo Grande. Foto não é query de lojinha digitada.
  const _isImageAnalysis = typeof text === 'string'
    && /ACABOU DE ENVIAR uma imagem|COMPROVANTE FINANCEIRO/i.test(text);
  if (typeof text === 'string' && !_isImageAnalysis) {
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
  // F6 (G7): confirmação de leitura de comunicado avalia o texto ORIGINAL do usuário
  // (sem o ctxHint do auto-resolve e sem scaffold de reply) — o hint anexado ao `text`
  // quebrava o matcher do "ok" e o confirmed_at nunca gravava.
  const confirmed = await tryHandleAnnouncementConfirmation(collab, stripReplyScaffold(String(inboundVerbatimText || '')).userText);
  if (confirmed) {
    console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (announcement_confirmed)`);
    return;
  }

  // Sprint 16 — COORD_HINT: verifica recados abertos onde collab é recipient.
  // Janela 2h (era 24h). Bug 25/05: REQ órfã de ontem 20:25 foi casada com
  // resposta de hoje 07:47 porque o LLM viu a request fantasma de 11h atrás.
  // 2h cobre o uso real (resposta no mesmo turno de conversa) sem expor o
  // LLM a requests velhas que devem ser tratadas pelo auto-close cron.
  // COORD-RESPONSE-STATE-STUCK (12/06) — ver src/coordination/detect-relay-request.js.
  // Se a msg atual é um relay explícito ("avisa o X que Y"), NÃO injeta a pressão de
  // RESPONSE do COORD_HINT: ela faz o LLM malformar um <<COORDINATION_RESPONSE>> e
  // PERDER o recado embutido; pior, a request fica 'sent' e o hint re-injeta na
  // próxima msg → loop de "problema técnico" (casos Daiana/Fefê 11/06). Aqui força
  // a interpretação como REQUEST — "do zero", sem passar pela pressão do RESPONSE.
  const { detectExplicitRelayRequest } = require('./coordination/detect-relay-request');
  const relayIntent = detectExplicitRelayRequest(
    stripReplyScaffold(String(inboundVerbatimText || '')).userText
  );

  let coordHint = null;
  if (relayIntent) {
    coordHint = `[RELAY_OVERRIDE] A mensagem atual é um PEDIDO para você (TOM) repassar um recado a OUTRA pessoa (relay), NÃO uma resposta a um recado pendente. Emita <<COORDINATION_REQUEST>> (recipient_name + message_body). NUNCA emita <<COORDINATION_RESPONSE>> neste turn.`;
    console.log(`[COORD] relay explícito (hint=${relayIntent.recipientHint}) — COORD_HINT suprimido, forçando REQUEST`);
  } else {
    const cutoff2h = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: openRequests } = await supabase
      .from('coordination_requests')
      .select('id, requester_id, message_body, created_at')
      .eq('recipient_id', collab.id)
      .eq('status', 'sent')
      .gte('created_at', cutoff2h)
      .order('created_at', { ascending: false })
      .limit(3);

    // COORD-RESPONSE-WRONG-BIND (Alf 22/06): recency gate. Se o TOM falou algo com o user
    // DEPOIS de entregar o recado mais recente (ex.: um fechamento), a resposta do user
    // provavelmente é pra ESSA msg mais nova, não pro recado velho — NÃO pressiona
    // COORDINATION_RESPONSE (espelha shouldClosingInterceptorFire "não há intent mais fresca").
    let _coordFresherPrompt = false;
    if (openRequests && openRequests.length > 0) {
      try {
        const { hasFresherOutboundAfterRequest } = require('./coordination/coord-recency');
        const { data: _laterOut } = await supabase
          .from('conversation_history')
          .select('created_at')
          .eq('collaborator_id', collab.id)
          .eq('direction', 'outbound')
          .gt('created_at', openRequests[0].created_at)
          .order('created_at', { ascending: false })
          .limit(5);
        _coordFresherPrompt = hasFresherOutboundAfterRequest(openRequests[0].created_at, (_laterOut || []).map(r => r.created_at));
        if (_coordFresherPrompt) console.log('[COORD] recado aberto, mas ha outbound mais novo (ex: fechamento) -> COORD_HINT suprimido (COORD-RESPONSE-WRONG-BIND)');
      } catch (e) { console.warn('[COORD] recency gate err (segue sem suprimir):', e.message); }
    }

    if (openRequests && openRequests.length > 0 && !_coordFresherPrompt) {
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
  // Horário-padrão de lembrete: janela ativa aprendida do uso (cold-start 09h). Degrada gracioso — nunca lança.
  const _activeWin = await getActiveWindow(supabase, collab.id, new Date());
  const _promptOpts = { lastUserMessage: text, coordHint, coordContext, reminderDefaultHour: _activeWin.hour };
  // 🗺️ O Mapa (Fase 1) — seta o loadout no PRÓPRIO _promptOpts (não spread: buildSystemPrompt
  // grava opts.activeSkill como out-param, lido em :9641 — cópia perderia a telemetria da skill).
  // null (flag off/operational) → buildSystemPrompt ignora e faz o de hoje byte a byte.
  _promptOpts.loadout = _mapa.loadout;
  // FATIA 1 (não-consegui-registrar 1a): confirmação seca amarra na tarefa que o TOM lembrou
  // nas últimas 24h (sendAndLink gravou ref_type='task' em conversation_history). Resolve/executa
  // DETERMINÍSTICO por id exato ANTES do LLM; o LLM só escreve a confirmação na voz (voz sagrada).
  // NÃO dá return — segue pro LLM. Roda antes do buildSystemPrompt de propósito: a tarefa concluída
  // já sai da lista de pendentes que o prompt injeta, reduzindo o risco de o LLM re-emitir marker.
  let _remCompleteHint = null;
  try {
    const _agoraCfr = Date.now();
    const _desdeCfr = new Date(_agoraCfr - 24 * 3600 * 1000).toISOString();
    const { data: _remRows } = await buildReminderRefsQuery(supabase, collab.id, _desdeCfr);
    const _cfr = resolverConclusaoDeLembrete({ reply: text, refsRecentes: mapRefRows(_remRows), agoraMs: _agoraCfr });

    if (_cfr.modo === 'exato') {
      const { data: _tkCfr } = await supabase.from('tasks')
        .select('id, title, status').eq('id', _cfr.taskId).maybeSingle();
      if (_tkCfr && _tkCfr.status === 'done') {
        // Idempotência real: já estava concluída → sucesso (freio #4 permite suprimir o guard).
        _metrics.deterministic_complete_ok = true;
        _remCompleteHint = `### ✅ AÇÃO JÁ REGISTRADA\nA tarefa *${_tkCfr.title}* JÁ estava concluída. O usuário confirmou de novo — responda breve e leve, na sua voz. NÃO emita marker de conclusão pra ela (já está feita), NÃO diga que não conseguiu, NÃO peça pra mandar de novo.`;
      } else if (_tkCfr) {
        const _idCurto = String(_tkCfr.id).replace(/-/g, '').slice(0, 8);
        const _rCfr = await applyTaskActions(collab, [{ action: 'complete', id: _idCurto }], { inboundText: text });
        if (_rCfr && _rCfr.okCount >= 1) {
          // Sucesso REAL → pode suprimir o guard (freio #4).
          _metrics.deterministic_complete_ok = true;
          _remCompleteHint = `### ✅ AÇÃO JÁ REGISTRADA\nVocê acabou de concluir *${_tkCfr.title}* (o usuário confirmou o lembrete). JÁ está registrada no sistema. Confirme calorosamente na sua voz. NÃO emita marker de conclusão pra essa tarefa (já está feita), NÃO diga que não conseguiu, NÃO peça pra mandar de novo.`;
        }
        // Falhou (okCount 0) → NÃO seta flag, NÃO injeta hint: o fluxo honesto atual vale (freio #4).
      }
    } else if (_cfr.modo === 'ambiguo') {
      const _idsCfr = _cfr.candidatos.map((c) => c.taskId);
      const { data: _tksCfr } = await supabase.from('tasks').select('id, title').in('id', _idsCfr);
      const _listaCfr = (_tksCfr || []).map((t) => `- *${t.title}*`).join('\n');
      // NÃO completa nada (freio #2). Pede desambiguação; a pergunta sai na voz do LLM.
      _remCompleteHint = `### ❓ QUAL TAREFA?\nO usuário confirmou uma conclusão, mas ele foi lembrado de MAIS DE UMA tarefa nas últimas horas:\n${_listaCfr}\nPergunte QUAL delas ele concluiu. NÃO conclua nenhuma até ele dizer.`;
    }
  } catch (e) {
    // Freio #5: qualquer erro aqui degrada pro fluxo atual, nunca quebra o turno.
    console.warn('[CompletionFromReminder] non-fatal:', e.message);
  }

  let { systemPrompt, ctx } = await buildSystemPrompt(collab, _promptOpts);
  _metrics.skill_active = _promptOpts.activeSkill || 'none'; // Fatia J: telemetria da skill ativa (era coluna morta)
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

  // Recuperação de senha/credencial pessoal (anotações) — injeta no turno SÓ na intenção
  // ("qual minha senha do X?"). Escopo = o próprio remetente (collab.id, nunca do LLM);
  // decifra via service_role (gn_decrypt). Degrada gracioso.
  try {
    const credBlock = await require('./services/notes').credentialLookupContext({ supabase, collaboratorId: collab.id, text });
    if (credBlock) systemPrompt += '\n\n' + credBlock;
  } catch (err) { console.warn('[NOTE_CRED_LOOKUP] failed:', err.message); }

  // Fatia 1: dica de voz da conclusão/desambiguação resolvida acima (mesmo padrão do relayHint).
  if (_remCompleteHint) systemPrompt += '\n\n' + _remCompleteHint;

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

  // TWO-PASS <<PEDIR_CREDENCIAIS>> (07/08) — o modelo decide semanticamente que precisa
  // dos links de sistemas e emite o marker; buscamos e re-perguntamos com a lista.
  // É tool-calling dentro do protocolo de markers: --tools/MCP seguem desligados
  // (hardening do Sprint 7, incidente 28/04). Roda ANTES dos parsers pra que a
  // resposta final passe por todo o pipeline normal (strip, anti-leak, envio).
  // Anti-loop: a 2ª chamada não recebe a instrução do marker, e não há laço —
  // se o modelo reemitir mesmo assim, UNKNOWN_MARKER_STRIPPED limpa o texto.
  try {
    const { hasPedirCredenciaisMarker, formatCredenciaisBlock } = require('./lib/pedir-credenciais');
    if (hasPedirCredenciaisMarker(reply)) {
      const { getCredenciaisPublicas } = require('./services/credenciais-publicas');
      const links = await getCredenciaisPublicas();
      const bloco = formatCredenciaisBlock(links);
      console.log(`[PedirCredenciais] marker detectado — ${links.length} link(s) disponivel(is)`);
      await logMarker(collab.id, 'PEDIR_CREDENCIAIS', links.length ? 'executed' : 'rejected',
        `links:${links.length}`, null);
      if (!bloco) {
        reply = 'Não tenho nenhum sistema cadastrado com link por aqui ainda.';
      } else {
        reply = bloco;
        const credSys = `${bloco}\n\nO colaborador perguntou sobre acesso a algum desses sistemas. `
          + `Responda em português, de forma curta e natural, APENAS o link que ele pediu. `
          + `Só liste todos se ele tiver pedido explicitamente a lista completa. `
          + `Não mencione banco de dados, tabela ou qualquer detalhe técnico interno. `
          + `Não emita nenhum marker nesta resposta.`;
        const segunda = await ai.chat(credSys, msgs);
        const textoSegundo = String(segunda?.text || '').trim();
        reply = textoSegundo || bloco;
      }
    }
  } catch (e) {
    // Nunca derruba a mensagem: se o two-pass falhar, segue com o reply original
    // (o marker sobrando será removido pelo UNKNOWN_MARKER_STRIPPED adiante).
    console.warn('[PedirCredenciais] two-pass falhou:', e.message);
  }

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
      // Não vaza o texto "aprovado" alucinado — substitui por erro claro, com o(s)
      // comando(s) CONCRETO(s) das pendências reais (fim do placeholder <NOME-DO-PROJETO>).
      let cmdHintAp = '*APROVA <NOME-DO-PROJETO>*';
      try {
        const openAp = await approvalsService.listOpenApprovals(supabase, collab.id);
        const prj = openAp.filter((i) => i.payload.domain === 'project' && i.payload.token);
        if (prj.length) cmdHintAp = prj.map((i) => `*APROVA ${i.payload.token}*`).join(' ou ');
      } catch (_) { /* mantém genérico */ }
      reply = `_tive um problema técnico processando a aprovação. Manda de novo:_ ${cmdHintAp}`;
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
      // Não vaza o texto "rejeitado" alucinado — substitui por erro claro com comando concreto.
      let cmdHintRj = '*REJEITA <NOME-DO-PROJETO> motivo*';
      try {
        const openRj = await approvalsService.listOpenApprovals(supabase, collab.id);
        const prjR = openRj.filter((i) => i.payload.domain === 'project' && i.payload.token);
        if (prjR.length) cmdHintRj = prjR.map((i) => `*REJEITA ${i.payload.token} motivo*`).join(' ou ');
      } catch (_) { /* mantém genérico */ }
      reply = `_tive um problema técnico processando a rejeição. Manda de novo:_ ${cmdHintRj}`;
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
      if (optimisticPattern.test(base) || hasOptimisticConfirm(base)) {
        // AUDIT-OPTIMISTIC-CONFIRM: rebaixa a confirmação otimista ANTES do aviso
        // (antes só anexava o aviso e a frase "✅ Criado!" continuava acima dele).
        base = sanitizeOptimisticConfirm(base, 'failed');
        base += (base ? '\n\n' : '') + '_⚠️ Tive um problema técnico ao gravar isso. Não confirmei nada no banco — me passa de novo o que você quer registrar?_';
      }
      reply = base;
    } else if (parsedTask && Array.isArray(parsedTask.actions) && parsedTask.actions.length > 0
        && parsedTask.actions.every((a) => a.action === 'reschedule' && a.confirm === true)) {
      // (i) STAGED RESCHEDULE — TASK-RESCHEDULE-CONFIRM-NOOP (Matheus 15/07): o LLM propôs e
      // perguntou ("Confirma?") mas o reschedule NÃO tinha staging determinístico → dependia
      // do LLM re-emitir o marker no "isso" (não reemitia) → NOOP silencioso. Aqui, quando
      // TODAS as actions são reschedule com confirm:true (F1: flag PER-action, não há envelope
      // batch), o engine resolve as datas AGORA, abre um pending_intent reschedule_confirm com o
      // payload já-resolvido + preview inline, e NÃO executa. O "isso" retoma (região ~8543).
      // Espelha staged_launch (finance). confirm:true de menos = comportamento atual (executa);
      // de mais = fricção (pede "isso") — Rede 1 é o teto de dano se o LLM não emitir a flag.
      try {
        const { partitionResolved, buildReschedulePreview } = require('./tasks/reschedule-stage');
        const { resolved, ambiguous } = partitionResolved(parsedTask.actions, { todayYmd: todayYmdSP() });
        const _ids = [...resolved, ...ambiguous].map((a) => a.id).filter(Boolean);
        let _titleById = {};
        if (_ids.length) {
          const { data: _trows } = await supabase.from('tasks').select('id,title').in('id', _ids);
          _titleById = Object.fromEntries((_trows || []).map((r) => [r.id, r.title]));
        }
        const _preview = buildReschedulePreview(resolved, ambiguous, _titleById);
        await pendingIntents.openIntent(collab.id, 'reschedule_confirm', { actions: resolved, ambiguous }, _preview);
        await logMarker(collab.id, 'TASK_UPDATE', 'skipped', `staged_reschedule:${resolved.length}`, null);
        reply = _preview;                       // NÃO executa o apply; sem return → cai no send normal
        _metrics.awaiting_user_confirm = true;  // turno = pergunta → ACTIONABLE_NO_MARKER não acusa (idem 10396)
      } catch (e) {
        // FAIL-SAFE: se o staging falhar (ex.: openIntent lançou), EXECUTA direto — nunca
        // deixa virar NOOP. Este ramo já interceptou o `else if (parsedTask)` que faria o
        // apply, então só mostrar cleanText perderia o reagendamento em silêncio — pior que
        // o bug que este staging conserta (foi o que o kind fora do VALID_KINDS quase causou,
        // 16/07). Degradar = comportamento ANTIGO (executa na hora), não sumiço.
        console.error('[StagedReschedule] err — executando direto (fail-safe):', e.message);
        const { okCount, failCount } = await applyTaskActions(collab, parsedTask.actions, { inboundText: text });
        await logMarker(collab.id, 'TASK_UPDATE', okCount > 0 ? 'executed' : 'rejected',
          `stage_failed_fallback ok=${okCount} fail=${failCount}`, null);
        reply = parsedTask.cleanText || reply;
      }
    } else if (parsedTask) {
      // Sprint 10.1 hotfix: alignment de datas. A âncora temporal no system
      // prompt não basta — Claude erra "amanhã" em frases complexas
      // ("Amanhã preciso pagar X pode me lembrar 8h30?" → gravou 30/04
      // em vez de 29/04). Engine valida texto do user e força a data certa
      // antes de persistir. Defesa de modelo.
      try {
        // \b final após "ã" (não-ASCII) falha sem flag unicode → "amanhã" nunca
        // casava. Quando o user dizia "hoje" (de passagem) + "amanhã" (intenção),
        // só "hoje" pegava e o auto-align forçava a data errada pra hoje. Caso
        // Union Suites 02/06: Claude emitiu 03/06 certo, align jogou pra 02/06.
        // AUTO-ALIGN-QUOTE-CONTAMINATION (Ana 30/06): a detecção lê a FALA REAL
        // (stripReplyScaffold), nunca o scaffold de reply-quote — senão o "hoje"
        // da cobrança citada ("Resolve hoje ou reagenda?") clobbera um reschedule
        // explícito pra 05/07 de volta pra hoje (confab pós-marker).
        const { wantsTomorrow, wantsToday } = detectExplicitDayIntent(text);
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
          // AMANHA-POS-MEIA-NOITE (caso Rose 10/06 00:57): na madrugada (00–04h59 BRT),
          // "amanhã" da pessoa = o dia civil EM CURSO (a manhã que vai amanhecer), não D+1.
          const hourBRT = parseInt(new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23',
          }).format(new Date()), 10) % 24;
          const targetDay = wantsTomorrow ? (hourBRT < 5 ? todayBRT : tomorrowBRT) : todayBRT;
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
      const { okCount, failCount, integrityPayload, failMessages, groupNotices, createdReminderTimes } = await applyTaskActions(collab, parsedTask.actions, { inboundText: text });
      console.log(`[Task] batch done: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      if (integrityPayload) {
        const iType = integrityPayload.type;
        const logReason = `integrity_${iType}:candidate="${String(integrityPayload.candidateTitle).slice(0,40)}"`;
        await logMarker(collab.id, 'TASK_UPDATE', 'rejected', logReason, null);
        console.warn(`[IntegrityCheck] TASK_UPDATE blocked by ${iType} — "${String(integrityPayload.candidateTitle).slice(0,40)}"`);
        // Sprint 31 — NÃO engole a resposta inteira da descarga: preserva o que o
        // TOM resolveu/perguntou nos OUTROS itens (cleanText) e ANEXA o aviso de
        // duplicata no fim. Antes, sobrescrever apagava todos os demais itens do turno.
        // PETERSON-INTEGRITY-HIDES-OKCOUNT (auditoria 30/06): o soft-dup é acumulado SEM
        // abortar o lote — as OUTRAS okCount tarefas persistiram. Antes o ramo assumia
        // "nada persistiu" (sanitize 'failed' + só o menu de dedup), escondendo as criadas
        // do usuário E do marker_log (Peterson: 5 criadas sumiram). Agora loga as criadas
        // e o reply reflete okCount via buildIntegrityReply.
        if (okCount > 0) {
          await logMarker(collab.id, 'TASK_UPDATE', 'executed', `ok=${okCount} fail=${failCount} (held_dup)`, null);
        }
        {
          const _dupQ = _buildIntegrityConfirmText(integrityPayload);
          // AUDIT-OPTIMISTIC-CONFIRM (caso Juliana, okCount=0): rebaixa o "✅ <título>"
          // otimista. PETERSON (okCount>0): preserva o legítimo + footer determinístico.
          reply = buildIntegrityReply(parsedTask.cleanText, _dupQ, okCount);
          // Sprint 31.10 — ESTE turno terminou pedindo confirmação de duplicata
          // (1/2/3). O detector ACTIONABLE_NO_MARKER lê esse flag e NÃO acusa:
          // pedir confirmação ≠ deixar de persistir (era falso positivo de C1).
          _metrics.awaiting_user_confirm = true;
        }
      } else {
        const result = okCount > 0 ? 'executed' : 'rejected';
        const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
        // TASKUPDATE-REJECTED-RAW-NULL (Leo 08/07): all_failed:2 sem raw + log esparso =
        // auditoria cega ao payload (impossível saber QUAIS alvos falharam e por quê).
        // Nas rejeições grava as actions no raw (logMarker trunca em 500) + failMessages.
        await logMarker(collab.id, 'TASK_UPDATE', result, reason,
          result === 'rejected'
            ? { actions: parsedTask.actions, fails: (failMessages || []).slice(0, 3) }
            : null);
        let base = parsedTask.cleanText || '';
        if (failCount > 0 && okCount === 0) {
          // Sprint 31.6 (E2) — se há msg específica (ex: tarefa de outro dono), usa ela
          // e SUBSTITUI o texto otimista do LLM (evita "✅ Reagendado" + "não consegui").
          // O genérico antigo dizia "te aviso depois" — falsa promessa; trocado por honesto.
          if (failMessages && failMessages.length) {
            base = failMessages.join('\n');
          } else {
            // AUDIT-OPTIMISTIC-CONFIRM (caso Fefê): remove "✅ Criado!" antes do honesto.
            base = sanitizeOptimisticConfirm(base, 'failed');
            // TASK-COMPLETE-ALVO-NAO-ACHADO — RAIZ (14/08). O engine tem 101 `failCount++` e
            // só UM empurra `failMessages`; os outros 100 desembocavam aqui, no genérico que
            // não diz O QUE falhou. A pessoa reenvia a mesma coisa e leva a mesma resposta:
            // beco. A Mayra provou repetindo "Feito" → "Feito tom"; o Quintela levou o mesmo
            // beco em 12/08 e 13/08.
            //
            // O fix de 13/08 deu fala honesta ao handler `complete` — cobriu 1 de 101 e
            // reincidiu 2×. Este é o PONTO ÚNICO DE SAÍDA, onde os 101 convergem: nomear o
            // alvo aqui vale para toda ação que procura tarefa, sem tocar em 101 lugares.
            // Guard por caminho de código vira queijo suíço (antipadrão 13.1 do manual).
            const { falaDoQueTentou } = require('./lib/falha-diz-alvo');
            base = (base ? base + '\n\n' : '') + falaDoQueTentou(parsedTask.actions);
          }
        } else if (failCount > 0 && okCount > 0) {
          // Sprint 21.5 — confirmação parcial honesta. Engine não pode deixar TOM dizer
          // "tudo certo" quando parte falhou. Princípio: fala = persistência.
          // AUDIT-OPTIMISTIC-CONFIRM (caso Anne): rebaixa "fechei todas" → "a maioria".
          base = sanitizeOptimisticConfirm(base, 'partial');
          // #2D2-b (Fabi 30/06): "As 3 fechadas" + ok=2 escapava do sanitize (dígito não
          // é totalizador, particípio fora do início). Rebaixa INLINE pra razão honesta
          // ("2 de 3 fechadas") com nota própria — senão o título contradiz o rodapé.
          const { enforceTaskCountHonesty } = require('./lib/count-honesty');
          const _tc = enforceTaskCountHonesty(base, { okCount, meta: true });
          if (_tc.fired) {
            base = _tc.reply;
            await logMarker(collab.id, 'COUNT_HONESTY', 'redirected', `task claimed=${_tc.claimed} persisted=${okCount}`, null);
          } else {
            base = (base ? base + '\n\n' : '') + `_⚠️ Registrei ${okCount} de ${okCount + failCount}. Algumas falharam — me chama se algo ficar faltando._`;
          }
        }
        // CONFAB-WRITE-DATE-NO-RELLABEL (Anne 05/08, alta): o prompt pré-computa o
        // dia-relativo do lado da LEITURA, mas na ESCRITA a data nasce no marker no
        // mesmo sopro da fala — sem rótulo pronto, o LLM narra de cabeça. Gravou
        // 07/08 CERTO e disse "pra amanhã" numa quarta; a Anne leu "manhã", achou que
        // ele tinha errado o que estava certo e gastou 3 turnos corrigindo.
        // Este é o ESPELHO do auto-align logo acima: lá o dado é corrigido pela fala do
        // usuário, aqui a fala é corrigida pelo dado gravado. Só age quando a
        // correspondência é inequívoca — turno sem falha e UMA data só; o resto o
        // helper barra sozinho (dois rótulos, data já colada) e nada muda.
        if (okCount > 0 && failCount === 0 && base) {
          try {
            const { datasGravadasDasActions, corrigeRotuloDeEscrita } = require('./utils/write-date-label');
            const _datas = datasGravadasDasActions(parsedTask.actions);
            if (_datas.length === 1) {
              const _rot = corrigeRotuloDeEscrita(base, _datas[0], todayYmdSP());
              if (_rot.corrigiu) {
                console.warn(`[Task] WRITE_DATE_RELABEL — disse "${_rot.de}", gravou ${_datas[0]} → "${_rot.para}"`);
                await logMarker(collab.id, 'WRITE_DATE_RELABEL', 'redirected',
                  `disse=${_rot.de} gravado=${_datas[0]} virou=${_rot.para}`, String(base).slice(0, 300));
                base = _rot.texto;
              }
            }
          } catch (e) {
            console.error('[Task] write-date-label err (non-fatal):', e.message);
          }
        }
        // Cascata de grupo — só no caminho de sucesso (okCount > 0).
        if (groupNotices && groupNotices.length > 0 && okCount > 0) {
          base = (base ? base + '\n\n' : '') + groupNotices.join('\n');
        }
        // FATIA 6 (#1): a tarefa nasce com remind_at CERTO (o lembrete dispara), mas a fala do TOM
        // às vezes omite a hora ("Anotado — até 12/08") e a pessoa acha que sumiu. Anexa
        // "🔔 Lembro às HHh" quando a resposta NÃO cita a hora (dedup na fala). Só no sucesso;
        // determinístico (voz aprovada pelo Alf). Ver utils/reminder-notice.js.
        if (okCount > 0 && Array.isArray(createdReminderTimes) && createdReminderTimes.length) {
          try {
            const { buildReminderNotice } = require('./utils/reminder-notice');
            const _alvoTxt = base || reply || '';
            const _rn = buildReminderNotice(createdReminderTimes, _alvoTxt);
            if (_rn) base = (_alvoTxt ? _alvoTxt + '\n\n' : '') + _rn;
          } catch (e) { console.warn('[ReminderNotice] non-fatal:', e.message); }
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
      // PREFS-NULL-FEITO-FALSO: nunca deixar o "Feito!" do LLM sair quando o engine
      // rejeitou o bloco — a Rose ouviu "Tirei o briefing" e o briefing disparou no
      // dia seguinte. Anexa aviso honesto, espelhando o branch all_failed abaixo.
      {
        const baseM = (parsedPrefs.cleanText || '').trim();
        reply = (baseM ? baseM + '\n\n' : '') + '_⚠️ não consegui aplicar essa configuração agora — me diz de novo o que você quer mudar?_';
      }
    } else if (parsedPrefs) {
      // PREFS-DND-ROUTE: aplica o DND roteado (com cap, via applyDnd) ANTES do resto.
      let dndOk = false;
      if (parsedPrefs.dnd) {
        dndOk = await applyDnd(collab, parsedPrefs.dnd);
        await logMarker(collab.id, 'DND_SET', dndOk ? 'executed' : 'rejected',
          dndOk ? `until=${parsedPrefs.dnd.until} (via PREFS)` : 'persist_error', null);
      }
      const hasPrefsFields = Object.keys(parsedPrefs.update || {}).length > 0;
      let okCount = 0, failCount = 0;
      if (hasPrefsFields) {
        ({ okCount, failCount } = await applyPrefsUpdate(collab, parsedPrefs.update));
        const result = okCount > 0 ? 'executed' : 'rejected';
        const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
        await logMarker(collab.id, 'PREFS_UPDATE', result, reason, null);
      }
      // Trava B (revisor 26/06): quando SÓ tinha DND (update vazio), NÃO loga
      // PREFS_UPDATE rejected all_failed:0 — isso recriaria o sinal schema_invalid/all_failed
      // que o auditor caça e o caso voltaria como falso-positivo recorrente. O sucesso já
      // foi logado em DND_SET acima.
      let base = parsedPrefs.cleanText || '';
      if (hasPrefsFields && failCount > 0 && okCount === 0 && !dndOk) {
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
      // HABIT-EDIT-SEM-CAMINHO (10/08, decisão do Alf): editar hábito por conversa NÃO existe
      // (create/log/query_progress/delete). Quando o LLM inventa `action:update`, o aviso
      // genérico de falha ("me manda de novo") manda a pessoa repetir um pedido impossível.
      // Aqui o TOM diz o que não faz e aponta a aba do app. Não é fala nova: é a mesma família
      // dos avisos honestos, com saída em vez de beco.
      const { pediuEdicaoDeHabito, respostaSemEdicaoDeHabito } = require('./lib/habit-sem-edicao');
      if (pediuEdicaoDeHabito(parsedHab.motivos)) {
        await logMarker(collab.id, 'HABIT_ACTION', 'redirected', 'sem_capacidade:edicao', null);
        reply = respostaSemEdicaoDeHabito(parsedHab.cleanText || '');
      } else {
        reply = parsedHab.cleanText || reply;
      }
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

  // 2.61) <<TASK_TO_HABIT>> — tarefa recorrente vira LEMBRETE recorrente (hábito).
  //
  // Arthur (02/08): "para de ser tarefa e vira lembrete, senão ele esquece". Tarefa é a
  // entidade que COBRA — num dia ele levou briefing + 5 cobranças de atraso + lembrete T-1
  // + fechamento do dia + balanço de aderência sobre 2 rotinas que ele já fazia. Hábito
  // (habits + habit_reminders) só lembra: dispara no horário, respeita DND/quiet hours e
  // não tem nenhuma superfície de cobrança. As duas entidades já existiam — faltava a ponte.
  // Sem ponte o LLM improvisava: negava a capacidade, ou criava o hábito e deixava a tarefa
  // viva cobrando em paralelo (o estado REAL em que o Arthur estava).
  //
  // Divisão de trabalho: o LLM INTERPRETA ("não quero ser cobrado disso, só lembrado") e diz
  // QUAL rotina. Achar o molde, traduzir a RRULE pro calendário do hábito, o horário e o
  // encerramento da série são determinísticos no serviço — mesmo desenho do executor do
  // financeiro (1,3% de falha vs 14% do resto). Falhou em qualquer decisão → não mexe em nada.
  {
    const reT2H = /<<TASK_TO_HABIT>>\s*([\s\S]*?)\s*<<END>>/i;
    const mT2H = reply.match(reT2H);
    if (mT2H) {
      const cleanT2H = reply.replace(reT2H, '').trim();
      const last4T2H = String(collab.phone || '').slice(-4);
      let parsedT2H = null;
      try {
        parsedT2H = JSON.parse(mT2H[1].trim());
      } catch (err) {
        await logMarker(collab.id, 'TASK_TO_HABIT', 'rejected', 'invalid_json: ' + err.message, mT2H[1]);
        parsedT2H = null;
      }
      if (!parsedT2H) {
        // Nada persistiu → o texto não pode afirmar que virou lembrete.
        reply = (sanitizeOptimisticConfirm(cleanT2H, 'failed') || '').trim()
          || '_não consegui fazer essa conversão agora — me repete qual rotina?_';
      } else {
        const { convertTaskToHabit, renderConversionResult } = require('./services/task-to-habit');
        const itemsT2H = (Array.isArray(parsedT2H) ? parsedT2H : [parsedT2H]).slice(0, 5);
        const footersT2H = [];
        let okT2H = 0;
        for (const it of itemsT2H) {
          if (!it || typeof it !== 'object') continue;
          let r;
          try {
            r = await convertTaskToHabit({
              supabase,
              collaboratorId: collab.id,
              taskTitle: typeof it.task_title === 'string' ? it.task_title : null,
              taskId: typeof it.task_id === 'string' ? it.task_id : null,
              reminderTime: typeof it.reminder_time === 'string' ? it.reminder_time : null,
              // A3/rodada 2 (Alfredo): quando já existe lembrete de mesmo nome com OUTRO
              // calendário, o serviço devolve a pergunta em vez de escolher sozinho. A
              // resposta da pessoa volta aqui como on_conflict — é o que faz a pergunta
              // ter execução. Sem isso a conversa entra em loop honesto: pergunta que
              // nunca resolve. Valor fora do enum é ignorado (volta a perguntar).
              onConflict: (it.on_conflict === 'keep_habit' || it.on_conflict === 'adjust_habit')
                ? it.on_conflict : null,
            });
          } catch (err) {
            console.error('[TaskToHabit] throw:', err.message);
            r = { ok: false, reason: 'db_error', detail: err.message };
          }
          if (r && r.ok) okT2H++;
          footersT2H.push(renderConversionResult(r));
          console.log(`[TaskToHabit] ${r && r.ok ? 'ok' : 'fail:' + (r && r.reason)} "${String(it.task_title || it.task_id || '').slice(0, 40)}" by ${last4T2H}`);
        }
        await logMarker(collab.id, 'TASK_TO_HABIT', okT2H > 0 ? 'executed' : 'rejected',
          okT2H > 0 ? `ok=${okT2H}/${itemsT2H.length}` : `all_failed:${itemsT2H.length}`, null);
        const baseT2H = okT2H > 0 ? cleanT2H : (sanitizeOptimisticConfirm(cleanT2H, 'failed') || '');
        const footT2H = footersT2H.filter(Boolean).join('\n');
        reply = [String(baseT2H).trim(), footT2H].filter(Boolean).join('\n\n') || reply;
      }
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
        const { okCount, failCount } = await applyPersonalListActions(collab, actions);
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
      if (optimisticEvPattern.test(baseEv) || hasOptimisticConfirm(baseEv)) {
        baseEv = sanitizeOptimisticConfirm(baseEv, 'failed');
        baseEv += (baseEv ? '\n\n' : '') + '_⚠️ Tive um problema técnico ao gravar o(s) compromisso(s). Não confirmei nada no banco — me passa de novo?_';
      }
      reply = baseEv;
    } else if (parsedEv && Array.isArray(parsedEv.events) && parsedEv.events.length > 0
        && parsedEv.events.every((e) => e && e.confirm === true)) {
      // (i) STAGED EVENT_CREATE — EVENT-CREATE-CONFIRM-NOOP (Alf 16/07): o TOM propôs o
      // compromisso ("Entendi: ... Certo?"), o "Isso" chegou, e o LLM NÃO re-emitiu o marker
      // → nada persistiu (o chokepoint pegou a mentira "✅ Criado!"). O intent `confirmation`
      // genérico guarda só TEXTO (last_tom_reply/last_user_text) — não há AÇÃO pra executar,
      // só dá pra pedir ao LLM que re-emita. Aqui, quando TODOS os itens vêm com confirm:true,
      // o engine guarda a ação ESTRUTURADA num intent event_create_confirm e NÃO cria; o
      // "isso" retoma determinístico (~8544). Espelha staged_launch/reschedule_confirm.
      // NÃO sobrescreve a prosa do TOM: ele responde em áudio (audio_reciprocity) e a narração
      // dele já traz título/data/hora — preview do engine por cima quebraria a voz.
      try {
        const _evs = parsedEv.events.map((e) => { const o = { ...e }; delete o.confirm; return o; });
        await pendingIntents.openIntent(collab.id, 'event_create_confirm', { events: _evs },
          String(parsedEv.cleanText || reply).slice(0, 500));
        await logMarker(collab.id, 'EVENT_CREATE', 'skipped', `staged_event_create:${_evs.length}`, null);
        reply = parsedEv.cleanText || reply;   // prosa do TOM (já pergunta "Certo?"); sem return
        _metrics.awaiting_user_confirm = true; // turno = pergunta → ACTIONABLE_NO_MARKER não acusa
      } catch (e) {
        // FAIL-SAFE: staging quebrou → cria AGORA (comportamento antigo). Nunca vira NOOP.
        console.error('[StagedEventCreate] err — criando direto (fail-safe):', e.message);
        const { okCount, failCount } = await applyEventActions(collab, parsedEv.events);
        await logMarker(collab.id, 'EVENT_CREATE', okCount > 0 ? 'executed' : 'rejected',
          `stage_failed_fallback ok=${okCount} fail=${failCount}`, null);
        reply = parsedEv.cleanText || reply;
      }
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
        // Sprint 31 — NÃO engole a resposta inteira: preserva o que o TOM já
        // resolveu/perguntou (parsedEv.cleanText) e ANEXA o aviso de duplicata.
        // PETERSON-INTEGRITY-HIDES-OKCOUNT (gêmeo de evento, preventivo — sem incidente
        // observado, mas mesmo padrão do caminho TASK): se o lote criou eventos e segurou
        // um dup, as criadas não podem sumir. Loga as criadas e reflete okCount no reply.
        if (okCount > 0) {
          await logMarker(collab.id, 'EVENT_CREATE', 'executed', `ok=${okCount} fail=${failCount} (held_dup)`, null);
        }
        {
          const _dupQ = _buildIntegrityConfirmText(integrityPayload);
          // AUDIT-OPTIMISTIC-CONFIRM (okCount=0): rebaixa o ✅. okCount>0: preserva + footer.
          reply = buildIntegrityReply(parsedEv.cleanText, _dupQ, okCount,
            { sing: 'evento já registrado', plur: 'eventos já registrados' });
          // Sprint 31.10 — mesmo flag do caminho TASK: turno pediu confirmação de
          // duplicata, não é ACTIONABLE_NO_MARKER.
          _metrics.awaiting_user_confirm = true;
        }
      } else {
        const result = okCount > 0 ? 'executed' : 'rejected';
        const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
        await logMarker(collab.id, 'EVENT_CREATE', result, reason, null);
        let base = parsedEv.cleanText || '';
        if (failCount > 0 && okCount === 0) {
          // AUDIT-OPTIMISTIC-CONFIRM: remove "✅ Agendado!" antes do honesto.
          base = sanitizeOptimisticConfirm(base, 'failed');
          base = (base ? base + '\n\n' : '') + '_não consegui salvar o compromisso, te aviso depois_';
        } else if (failCount > 0 && okCount > 0) {
          // Sprint 21.5.1 — confirmação parcial honesta também em EVENT_CREATE.
          // AUDIT-OPTIMISTIC-CONFIRM: rebaixa "agendei todos" → "a maioria".
          base = sanitizeOptimisticConfirm(base, 'partial');
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
      if (optimisticEUPattern.test(baseEU) || hasOptimisticConfirm(baseEU)) {
        baseEU = sanitizeOptimisticConfirm(baseEU, 'failed');
        baseEU += (baseEU ? '\n\n' : '') + '_⚠️ Tive um problema técnico ao alterar o compromisso. Nada mudou no banco — me confirma o que você quer?_';
      }
      reply = baseEU;
    } else if (parsedEU) {
      const { okCount, failCount, failMessages: evFailMessages, awaitingConfirm: evAwaitingConfirm } = await applyEventUpdates(collab, parsedEU.actions);
      // participant-edit (add/remove) abriu pergunta de confirmação / relatou noop → não é
      // ACTIONABLE_NO_MARKER (senão o guard rebaixaria a pergunta pra "não foi executada").
      if (evAwaitingConfirm) _metrics.awaiting_user_confirm = true;
      console.log(`[Event] update batch: ${okCount} ok, ${failCount} fail (collab ${String(collab.phone).slice(-4)})`);
      const result = okCount > 0 ? 'executed' : 'rejected';
      const reason = okCount > 0 ? `ok=${okCount} fail=${failCount}` : `all_failed:${failCount}`;
      await logMarker(collab.id, 'EVENT_UPDATE', result, reason, null);
      let base = parsedEU.cleanText || '';
      if (failCount > 0 && okCount === 0) {
        // F5: se a "falha" foi a guarda temporal, ela é uma PERGUNTA de confirmação —
        // mostra ELA e descarta o cleanText otimista do LLM ("Fechado!" sem ter fechado).
        // AUDIT-OPTIMISTIC-CONFIRM: descarta "✅ Fechado!" otimista quando nada mudou.
        base = (evFailMessages && evFailMessages.length)
          ? evFailMessages.join('\n')
          : (() => { const b = sanitizeOptimisticConfirm(base, 'failed'); return (b ? b + '\n\n' : '') + '_não consegui atualizar o compromisso, me confirma o que você quer?_'; })();
      } else if (okCount > 0) {
        // #2D2 (CONFAB-COUNT, caso Leo 28/06) — a prosa do LLM pode exagerar a contagem
        // ("nos dois eventos") enquanto só N persistiram (ok=N). O chokepoint é BINÁRIO
        // (algo persistiu → não dispara); este guard PURO rebaixa o número inline + nota
        // honesta. Conservador: só numeral explícito + verbo de ação + claimed>persisted.
        const { enforceCountHonesty } = require('./lib/count-honesty');
        const _ch = enforceCountHonesty(base, { domain: 'event', persistedCount: okCount, meta: true });
        if (_ch.fired) {
          base = _ch.reply;
          try { await logMarker(collab.id, 'COUNT_HONESTY', 'redirected', `event:claimed=${_ch.claimed} ok=${okCount}`, String(base).slice(0, 160)); } catch (_) {}
        }
        // 02/07 — LOTE MISTO (ok + pergunta pendente): failMessages carrega a PERGUNTA de
        // confirmação (participant-edit / guarda temporal). O branch acima só mostrava as
        // failMessages com okCount===0, então "corrige modalidade + adiciona Matheus" aplicava
        // a modalidade e ENGOLIA a pergunta (intent ficava aberta e o user nem sabia do "sim").
        // Pergunta com intent aberta NUNCA pode sumir — anexa ao final da prosa.
        if (evFailMessages && evFailMessages.length) {
          base = (base ? base + '\n\n' : '') + evFailMessages.join('\n');
        }
      }
      reply = base || reply;
    }
  }

  // <<NOTE_ACTION>> — anotações do usuário (spec 2026-06-10). collaborator_id = REMETENTE,
  // nunca do marker; share_with chega como NOMES e é resolvido contra o banco.
  {
    const parsedNote = noteMarker.parseNoteActionMarker(reply);
    if (parsedNote && parsedNote.malformed) {
      console.warn('[Note] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'NOTE_ACTION', 'rejected', 'schema_invalid', reply);
      // fala = persistência: nunca deixar o "Anotado!" sair com o bloco rejeitado.
      const baseN = sanitizeOptimisticConfirm((parsedNote.cleanText || '').trim(), 'failed'); // NOTE-ACTION-CONFAB-NOPROSE: tira "Anotado!" otimista quando nada persistiu
      reply = (baseN ? baseN + '\n\n' : '') + '_⚠️ não consegui salvar a anotação — me manda de novo?_';
    } else if (parsedNote) {
      const a = parsedNote.action;
      let dupBlocked = false;

      // NOTE-DEDUP trava (provider-agnóstica): não duplicar nota que já existe.
      if (a.action === 'create') {
        let dup = null;
        try { dup = await findDuplicateNote(supabase, collab.id, { title: a.title, body: a.body }); }
        catch (eDup) { console.warn('[NoteDedup] non-fatal:', eDup.message); }
        const dupKey = `${collab.id}|${normalizeForSim(a.title)}`;
        const fresh = recentNoteDupBlocks.get(dupKey);
        const nowMs = Date.now();
        if (dup && !(fresh && nowMs - fresh < NOTE_DEDUP_BYPASS_MS)) {
          dupBlocked = true;
          recentNoteDupBlocks.set(dupKey, nowMs); // arma o bypass p/ re-tentativa
          await logMarker(collab.id, 'NOTE_ACTION', 'skipped', `dup:${String(dup.note.id).slice(0, 8)} t=${dup.titleSim.toFixed(2)} b=${dup.bodyOverlap.toFixed(2)}`, null);
          const baseN = sanitizeOptimisticConfirm((parsedNote.cleanText || '').trim(), 'failed'); // NOTE-ACTION-CONFAB-NOPROSE: tira "Anotado!" otimista quando nada persistiu
          const corpo = String(dup.note.body || '').slice(0, 500);
          reply = (baseN ? baseN + '\n\n' : '') +
            `📋 Essa anotação já existe: *${dup.note.title}*\n\n${corpo}\n\nQuer que eu *adicione* os itens novos nela? Responde "anexa" que eu coloco lá.`;
        } else if (dup && fresh) {
          recentNoteDupBlocks.delete(dupKey); // re-tentativa confirmada → segue e cria
        }
      }

      if (!dupBlocked) {
        let res;
        let shareNotice = '';
        try {
          if (a.action === 'create' || a.action === 'share') {
            const { ids, unresolved } = await notesService.resolveShareNames(supabase, a.share_with || []);
            if (unresolved.length) {
              shareNotice = `\n\n_⚠️ não achei "${unresolved.join('", "')}" pra compartilhar — confere o nome?_`;
            }
            if (a.action === 'create') {
              // VERBATIM (2026-06-26, NOTE-SAVE-VERBATIM): se o usuário mandou guardar conteúdo
              // que JÁ EXISTE (colado na msg ou referenciado), reconcilia o body pro TEXTO-FONTE
              // ORIGINAL inteiro — o LLM trunca texto longo ao "copiar" (caso fechamento Alf 24/06).
              // Determinístico: acha a fonte na conversa e usa verbatim. Fallback pro body do LLM.
              let bodyToSave = a.body;
              if (a.verbatim) {
                const candidates = [inboundVerbatimText];
                try {
                  const { data: _hist } = await supabase.from('conversation_history')
                    .select('content').eq('collaborator_id', collab.id)
                    .order('created_at', { ascending: false }).limit(8);
                  for (const h of (_hist || [])) if (h && h.content) candidates.push(h.content);
                } catch (eH) { console.warn('[Note verbatim] hist err:', eH.message); }
                const src = verbatimNote.pickVerbatimSource(a.body, candidates);
                if (src) {
                  const stripped = verbatimNote.stripSaveCommand(src.text);
                  if (stripped && stripped.length >= 20) {
                    const srcLabel = src.index === 0 ? 'current' : 'history';
                    console.log(`[Note] verbatim src=${srcLabel} idx${src.index} score=${src.score.toFixed(2)} len ${String(a.body || '').length}->${stripped.length}`);
                    bodyToSave = stripped;
                  }
                }
              }
              res = await notesService.createNote(supabase, collab.id, { title: a.title, body: bodyToSave, source: 'tom', sharedWith: ids });
            } else {
              res = await notesService.shareNote(supabase, collab.id, a.note, ids);
            }
          } else {
            res = await notesService.appendToNote(supabase, collab.id, a.note, a.body);
          }
        } catch (eNote) {
          res = { ok: false, error: eNote.message };
        }
        await logMarker(collab.id, 'NOTE_ACTION', res.ok ? 'executed' : 'rejected', `${a.action}:${res.ok ? 'ok' : String(res.error).slice(0, 120)}`, null);
        let baseN = parsedNote.cleanText || '';
        if (!res.ok) {
          baseN = sanitizeOptimisticConfirm(baseN, 'failed'); // NOTE-ACTION-CONFAB-NOPROSE (ramo 3 — res.ok=false)
          baseN = (baseN ? baseN + '\n\n' : '') + (res.error === 'note_not_found'
            ? '_não achei essa anotação. Me diz o título que eu procuro._'
            : '_⚠️ não consegui salvar a anotação agora — tenta de novo?_');
        }
        reply = (baseN || reply) + shareNotice;
      }
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
  // BUG-7 (11/06): antes só o 1º marker era processado (.match não-global); o 2º
  // sumia → falso-sucesso (ex: Rodrigo CT-X3000+PX-160: 2º item nunca inserido).
  {
    const _allInvMatches = [...reply.matchAll(/<<INVENTORY_ACTION>>([\s\S]*?)<<END>>/gi)];
    let _invLeadText = '';
    if (_allInvMatches.length > 0) {
      // Engine = fonte da verdade (ANTI-MENTIRA): captura prosa LLM antes de processar.
      _invLeadText = reply.replace(/<<INVENTORY_ACTION>>[\s\S]*?<<END>>/gi, '').replace(/`{3,}/g, '').trim();
      const _invReplies = [];
      let _hasSalaPending = false;
      // INVENTORY-CONFAB-INVERSO-NOMARKER (27/06) — conta ações que PERSISTIRAM de fato (não
      // dup / pergunta de sala / aprovação-pendente). Se >0, loga UM INVENTORY_ACTION executed no
      // fim (espelha SHOP_ACTION) → auditor enxerga o inventário + marker_emitted via query 11355
      // → o chokepoint não rebaixa cadastro real (inverse-confab, primo do #1).
      let _invPersisted = 0;
      for (const _invMatch of _allInvMatches) {
        reply = '';
        let payload;
        try { payload = JSON.parse(_invMatch[1].trim()); }
        catch (e) {
          console.warn('[InventoryAction] JSON inválido:', e.message);
          _invReplies.push('Não consegui interpretar o pedido. Pode reformular?');
          continue;
        }
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
            room: 'sala_nome', sala: 'sala_nome', room_name: 'sala_nome', roomname: 'sala_nome', location: 'sala_nome', local: 'sala_nome',
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
          // INVENTORY-RAW-ERROR-LEAK (27/06) — mensagem amigável em vez de jargão do validador
          // ("action_invalida: upsert_room"). + loga marker da rejeição (antes o inventário
          // não logava NADA → cego pro auditor). Caso Dai 26/06.
          _invReplies.push(friendlyInventoryError(baseCheck.errors));
          await logMarker(collab.id, 'INVENTORY_ACTION', 'rejected', `${payload.action}:${baseCheck.errors.join(',')}`.slice(0, 90), null);
          continue;
        }
        {
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
              if (!vc.ok) { reply = (reply ? reply + '\n\n' : '') + friendlyInventoryError(vc.errors); await logMarker(collab.id, 'INVENTORY_ACTION', 'rejected', `${payload.action}:${vc.errors.join(',')}`.slice(0, 90), null); }
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
                    // TRAVA DE SALA (determinística): não cadastra na sala herdada
                    // do histórico (bug Sala 13). Confirmada = sessão travada OU sala
                    // dita no turno atual. Senão, pergunta (engine = fonte da verdade).
                    if (!salaConfirmada({
                      markerSalaNome: p.sala_nome,
                      markerSalaId: p.sala_id || salaId,
                      persisted: ctx && ctx.invSalaContext,
                      inboundText: inboundVerbatimText,
                    })) {
                      reply = `Em qual *unidade* e *sala* você quer cadastrar a *${String(p.nome || itemPayload.nome || 'item').trim()}*? (ex: Sala 13 — Campo Grande)`;
                    } else {
                    // Pré-check de duplicata nome+sala — defesa em profundidade com o índice
                    // inventario_nome_sala_ativo_uq. Resposta amigável em vez de vazar erro 23505.
                    // Raiz do INVENTORY-DUP-DISAMBIG-LOOP: id 134 foi recriação do PX-160 na mesma sala.
                    const { laReportClient: _lrcDup } = require('./services/la-report-client');
                    const _nomeKeyDup = String(itemPayload.nome).trim().toLowerCase();
                    const { data: _possiveisDup } = await _lrcDup
                      .from('inventario').select('id, nome, condicao')
                      .eq('sala_id', salaId).eq('ativo', true)
                      .ilike('nome', itemPayload.nome).limit(5);
                    const _dupItem = (_possiveisDup || []).find(r => String(r.nome).trim().toLowerCase() === _nomeKeyDup);
                    if (_dupItem) {
                      reply = (reply ? reply + '\n\n' : '') + `⚠️ Já existe *${_dupItem.nome}* nessa sala (id ${_dupItem.id}, condição ${_dupItem.condicao || '?'}). Não dupliquei. Quer *atualizar* esse (condição/quantidade) ou é outro aparelho? Se for outro, me passa o nº de série ou patrimônio pra distinguir.`;
                    } else {
                    const item = await inventarioService.inserirItem(itemPayload, userName);
                    // Anexa a foto que a pessoa mandou por WhatsApp (capturada no
                    // webhook, pode ter vindo turnos antes). Upload server-side →
                    // sem o cap de ~4.5MB da serverless. Só quando o item não veio
                    // com foto_url e há foto pendente pro telefone.
                    let _fotoMsg = '';
                    if (!itemPayload.foto_url) {
                      try {
                        const _pend = pendingInventoryPhoto.get(phone);
                        if (_pend && item?.id) {
                          const _buf = Buffer.from(_pend.base64, 'base64');
                          await inventarioService.uploadFotoItem(item.id, _buf, _pend.contentType);
                          pendingInventoryPhoto.clear(phone);
                          _fotoMsg = ' 📷 foto anexada';
                        }
                      } catch (e) {
                        console.error('[Inventory] anexo de foto falhou:', e.message);
                      }
                    }
                    reply = (reply ? reply + '\n\n' : '') + `✅ Item adicionado: ${item.nome}${item.codigo_patrimonio ? ` (${item.codigo_patrimonio})` : ''}${_fotoMsg}`;
                    _invPersisted++;
                    }
                    }
                  }
                }
              }
            } else if (payload.action === 'shop_movement') {
              const vc = inventarioValidators.validateShopMovement(p);
              if (!vc.ok) { reply = (reply ? reply + '\n\n' : '') + friendlyInventoryError(vc.errors); await logMarker(collab.id, 'INVENTORY_ACTION', 'rejected', `${payload.action}:${vc.errors.join(',')}`.slice(0, 90), null); }
              else {
                const unidadeId = await resolverUnidadeId(p.unidade_nome);
                if (!unidadeId) { reply = (reply ? reply + '\n\n' : '') + `Unidade "${p.unidade_nome}" não encontrada.`; }
                else {
                  let produtoId = p.produto_id;
                  if (!produtoId) {
                    const prods = await inventarioService.buscarProdutoPorNome(p.produto_nome);
                    if (prods.length === 0) { reply = (reply ? reply + '\n\n' : '') + `Produto "${p.produto_nome}" não cadastrado na lojinha.`; produtoId = null; }
                    else if (prods.length > 1) { reply = (reply ? reply + '\n\n' : '') + `Mais de um produto bate "${p.produto_nome}". Qual?\n${prods.map(x => `• ${x.nome}${x.sku ? ` — SKU ${x.sku}` : ''} (id ${x.id})`).join('\n')}`; produtoId = null; }
                    else produtoId = prods[0].id;
                  }
                  if (produtoId) {
                    const qty = p.tipo === 'entrada' ? Math.abs(p.quantidade) : -Math.abs(p.quantidade);
                    const res = await inventarioService.ajustarEstoqueLoja({
                      produto_id: produtoId, unidade_id: unidadeId, quantidade: qty, tipo: p.tipo,
                      nota_fiscal: p.nota_fiscal, motivo: p.motivo,
                    }, userName);
                    reply = (reply ? reply + '\n\n' : '') + `✅ Estoque atualizado. Saldo agora: ${res.saldo_apos} un.`;
                    _invPersisted++;
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
              if (!vc.ok) { reply = (reply ? reply + '\n\n' : '') + friendlyInventoryError(vc.errors); await logMarker(collab.id, 'INVENTORY_ACTION', 'rejected', `${payload.action}:${vc.errors.join(',')}`.slice(0, 90), null); }
              else {
                let itemId = p.item_id;
                if (!itemId && p.item_nome) {
                  const { laReportClient } = require('./services/la-report-client');
                  let q = laReportClient.from('inventario').select('id, nome, sala_id, codigo_patrimonio, salas(nome, unidades(nome))').ilike('nome', `%${p.item_nome}%`).eq('ativo', true);
                  // Se a origem foi dita, filtra por ela pra desambiguar
                  if (p.sala_origem_nome) {
                    const ro = await inventarioService.buscarSalaPorNome(p.sala_origem_nome);
                    if (ro.length === 1) q = q.eq('sala_id', ro[0].id);
                  }
                  const { data } = await q.limit(5);
                  if (!data || data.length === 0) { reply = (reply ? reply + '\n\n' : '') + `Item "${p.item_nome}" não encontrado.`; itemId = null; }
                  else if (data.length > 1) { reply = (reply ? reply + '\n\n' : '') + `Mais de um item bate "${p.item_nome}". Qual?\n${rotularItensAmbiguos(data)}\n\n(responde a sala ou o id)`; itemId = null; }
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
                    _invPersisted++;
                  }
                }
              }
            } else if (payload.action === 'maintenance') {
              const vc = inventarioValidators.validateMaintenance(p);
              if (!vc.ok) { reply = (reply ? reply + '\n\n' : '') + friendlyInventoryError(vc.errors); await logMarker(collab.id, 'INVENTORY_ACTION', 'rejected', `${payload.action}:${vc.errors.join(',')}`.slice(0, 90), null); }
              else {
                let itemId = p.item_id;
                let _maintItemNome = p.item_nome || null;
                if (!itemId && p.item_nome) {
                  const { laReportClient } = require('./services/la-report-client');
                  const { data } = await laReportClient.from('inventario').select('id, nome, codigo_patrimonio, salas(nome, unidades(nome))').ilike('nome', `%${p.item_nome}%`).eq('ativo', true).limit(5);
                  if (!data || data.length === 0) { reply = (reply ? reply + '\n\n' : '') + `Item "${p.item_nome}" não encontrado.`; itemId = null; }
                  else if (data.length > 1) { reply = (reply ? reply + '\n\n' : '') + `Mais de um item bate "${p.item_nome}". Qual?\n${rotularItensAmbiguos(data)}\n\n(responde a sala ou o id)`; itemId = null; }
                  else { itemId = data[0].id; _maintItemNome = data[0].nome; }
                }
                if (itemId) {
                  // BUG-8 (11/06): directors registram direto; demais passam pelo fluxo de aprovação.
                  const _canDirectMaint = collab && collab.role === 'director';
                  if (_canDirectMaint) {
                    await inventarioService.registrarManutencao({
                      item_id: itemId, tipo: p.tipo, descricao: p.descricao, custo: p.custo,
                      fornecedor_servico: p.fornecedor_servico,
                    }, userName);
                    reply = (reply ? reply + '\n\n' : '') + `🔧 Manutenção registrada.`;
                    _invPersisted++;
                  } else {
                    const _maintApprover = await approvalsService.resolveApproverFor(supabase, collab.id);
                    if (!_maintApprover) {
                      // Sem aprovador na matriz → registra direto (fail-open)
                      await inventarioService.registrarManutencao({
                        item_id: itemId, tipo: p.tipo, descricao: p.descricao, custo: p.custo,
                        fornecedor_servico: p.fornecedor_servico,
                      }, userName);
                      reply = (reply ? reply + '\n\n' : '') + `🔧 Manutenção registrada.`;
                      _invPersisted++;
                    } else {
                      const _maintToken = `MANUT-${require('crypto').randomBytes(2).toString('hex').toUpperCase()}`;
                      await approvalsService.openMaintenanceApproval(supabase, {
                        approverId: _maintApprover.id, shortId: _maintToken,
                        requesterName: userName, requesterPhone: phone,
                        itemId, itemNome: _maintItemNome,
                        tipo: p.tipo || 'corretiva', descricao: p.descricao,
                        custo: p.custo ?? null, fornecedor_servico: p.fornecedor_servico,
                      });
                      const _custoStr = p.custo ? ` — R$${p.custo}` : '';
                      const _maintNotif = `🔧 *${userName}* quer registrar manutenção em *${_maintItemNome || 'item'}*${_custoStr}: ${p.descricao || p.tipo || 'sem descrição'}.\n\n*APROVA ${_maintToken}* ou *REJEITA ${_maintToken}*`;
                      try { await whatsapp.sendMessage(_maintApprover.phone, _maintNotif); } catch (_) {}
                      reply = (reply ? reply + '\n\n' : '') + `🔧 Pedido enviado para *${_maintApprover.full_name}* aprovar. Você será avisado.`;
                    }
                  }
                }
              }
            } else if (payload.action === 'edit_item') {
              const { laReportClient } = require('./services/la-report-client');
              // Resolve item por id ou nome (+ sala opcional)
              let itemId = p.item_id;
              if (!itemId && p.nome) {
                let q = laReportClient.from('inventario').select('id, nome, sala_id, unidade_id, codigo_patrimonio, salas(nome, unidades(nome))').ilike('nome', `%${p.nome}%`).eq('ativo', true);
                if (p.sala_nome) {
                  const r = await inventarioService.buscarSalaPorNome(p.sala_nome);
                  if (r.length === 1) q = q.eq('sala_id', r[0].id);
                }
                const { data } = await q.limit(5);
                if (!data || data.length === 0) { reply = (reply ? reply + '\n\n' : '') + `Item "${p.nome}" não encontrado${p.sala_nome ? ` na sala ${p.sala_nome}` : ''}.`; itemId = null; }
                else if (data.length > 1) { reply = (reply ? reply + '\n\n' : '') + `Mais de um item bate "${p.nome}". Qual?\n${rotularItensAmbiguos(data)}\n\n(responde a sala ou o id)`; itemId = null; }
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
                  else { reply = (reply ? reply + '\n\n' : '') + `✏️ Atualizado: ${upd.nome} → qtd ${upd.quantidade}, cond ${upd.condicao}, status ${upd.status}`; _invPersisted++; }
                }
              }
            } else if (payload.action === 'delete_item') {
              const { laReportClient } = require('./services/la-report-client');
              let itemId = p.item_id;
              if (!itemId && p.nome) {
                let q = laReportClient.from('inventario').select('id, nome, codigo_patrimonio, salas(nome, unidades(nome))').ilike('nome', `%${p.nome}%`).eq('ativo', true);
                if (p.sala_nome) {
                  const r = await inventarioService.buscarSalaPorNome(p.sala_nome);
                  if (r.length === 1) q = q.eq('sala_id', r[0].id);
                }
                const { data } = await q.limit(5);
                if (!data || data.length === 0) { reply = (reply ? reply + '\n\n' : '') + `Item "${p.nome}" não encontrado.`; itemId = null; }
                else if (data.length > 1) { reply = (reply ? reply + '\n\n' : '') + `Mais de um item bate "${p.nome}". Qual?\n${rotularItensAmbiguos(data)}\n\n(responde a sala ou o id)`; itemId = null; }
                else itemId = data[0].id;
              }
              if (itemId) {
                const obs = `Baixa via TOM por ${userName}${p.motivo ? ' — ' + p.motivo : ''}`;
                const { data: del, error } = await laReportClient.from('inventario')
                  .update({ status: 'baixa', ativo: false, observacoes: obs, updated_at: new Date().toISOString() })
                  .eq('id', itemId).select('id, nome').single();
                if (error) reply = (reply ? reply + '\n\n' : '') + `Erro na baixa: ${error.message}`;
                else { reply = (reply ? reply + '\n\n' : '') + `🗑️ Baixado: ${del.nome}`; _invPersisted++; }
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
            } else if (payload.action === 'query_room') {
              // LISTA os itens de uma sala. Era no-op (dependia do snapshot do prompt,
              // que só tem NOMES de sala, não os itens) → o TOM desviava pro app
              // ("não tenho no contexto") ou tratava o nome da sala como item via 'ver'
              // ("Nenhum item com 'Sala 8 Teclas'"). Bug Rafinha 2026-06-12. Agora o
              // engine resolve a sala e lista de verdade (fonte da verdade = engine).
              try {
                const salaNome = p.sala_nome || p.nome || null;
                let salaId = p.sala_id || null;
                if (!salaId) {
                  if (!salaNome) {
                    reply = (reply ? reply + '\n\n' : '') + 'Qual sala você quer ver? (ex: "Sala 8 Teclas, Campo Grande")';
                  } else {
                    const unidadeId = await resolverUnidadeId(p.unidade_nome);
                    const salas = await inventarioService.buscarSalaPorNome(salaNome, unidadeId);
                    if (!salas.length) { reply = (reply ? reply + '\n\n' : '') + `Sala "${salaNome}" não encontrada${p.unidade_nome ? ` em ${p.unidade_nome}` : ''}.`; }
                    else if (salas.length > 1) { reply = (reply ? reply + '\n\n' : '') + `Mais de uma sala bate "${salaNome}". Qual?\n${salas.map(s => `• ${s.nome}${s.unidades && s.unidades.nome ? ' · ' + s.unidades.nome : ''} (id ${s.id})`).join('\n')}`; }
                    else salaId = salas[0].id;
                  }
                }
                if (salaId) {
                  const det = await inventarioService.detalheSala(salaId, collab);
                  const s = det.sala; const itens = det.itens || [];
                  const uNome = (s.unidades && s.unidades.nome) || '';
                  const head = `📋 *${s.nome}*${uNome ? ` — ${uNome}` : ''}${s.tipo_sala ? ` · ${s.tipo_sala}` : ''}`;
                  if (!itens.length) { reply = (reply ? reply + '\n\n' : '') + `${head}\n\n_Nenhum item ativo cadastrado nessa sala._`; }
                  else {
                    const linhas = itens.map(it => {
                      const cond = it.condicao && it.condicao !== 'bom' ? ` — ${it.condicao}` : '';
                      const qtd = it.quantidade && it.quantidade > 1 ? ` (x${it.quantidade})` : '';
                      const st = it.status && it.status !== 'ativo' ? ` [${it.status}]` : '';
                      return `• ${it.nome}${qtd}${cond}${st}`;
                    }).join('\n');
                    reply = (reply ? reply + '\n\n' : '') + `${head} · ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}\n${linhas}`;
                  }
                }
              } catch (e) {
                if (e.code === 'ACCESS_DENIED') reply = (reply ? reply + '\n\n' : '') + e.message;
                else throw e;
              }
            } else if (payload.action === 'query_rooms') {
              // LISTA as salas de uma unidade (com contagem de itens). Era no-op.
              try {
                const unidadeId = await resolverUnidadeId(p.unidade_nome);
                if (!unidadeId) { reply = (reply ? reply + '\n\n' : '') + 'De qual unidade? (Barra / Recreio / Campo Grande)'; }
                else {
                  const salas = await inventarioService.listarSalasPorUnidade(unidadeId);
                  if (!salas.length) { reply = (reply ? reply + '\n\n' : '') + 'Nenhuma sala cadastrada nessa unidade.'; }
                  else reply = (reply ? reply + '\n\n' : '') + `🏫 Salas:\n${salas.map(s => `• ${s.nome}${s.itens_count != null ? ` — ${s.itens_count} ${s.itens_count === 1 ? 'item' : 'itens'}` : ''}`).join('\n')}`;
                }
              } catch (e) {
                if (e.code === 'ACCESS_DENIED') reply = (reply ? reply + '\n\n' : '') + e.message;
                else throw e;
              }
            } else if (payload.action === 'query_shop') {
              // Lojinha — ainda via snapshot do system prompt (reply já setado pelo LLM)
            } else {
              reply = (reply ? reply + '\n\n' : '') + `Ação ${payload.action} ainda não suportada.`;
            }
          } catch (e) {
            console.error('[engine] INVENTORY_ACTION execução:', e);
            reply = `Erro ao executar: ${e.message}`;
          }
        }  // close bloco de ação
        // BUG-7: coletar resultado; detectar pergunta de sala para suprimir falso-sucesso
        if (reply && reply.includes('qual *unidade* e *sala*')) _hasSalaPending = true;
        _invReplies.push(reply);
      }  // close for loop de markers
      // INVENTORY-CONFAB-INVERSO-NOMARKER (27/06) — loga UM marker honesto se ALGO persistiu no
      // turno (espelha SHOP_ACTION 10629). NÃO seta _metrics.marker_emitted à mão (a query 11355
      // sobrescreve) — só o log no banco, ANTES da query, conta. Falhas já viram rejected (#3-A).
      if (_invPersisted > 0) {
        try { await logMarker(collab.id, 'INVENTORY_ACTION', 'executed', `persisted:${_invPersisted}`, null); } catch (_) {}
      }
      // Combinar: pergunta de sala suprime qualquer mensagem de sucesso anterior
      if (_hasSalaPending) {
        reply = _invReplies.filter(r => r && r.includes('qual *unidade* e *sala*')).join('\n\n');
      } else {
        reply = _invReplies.filter(Boolean).join('\n\n');
      }
      // Fallback anti-mentira: se engine não produziu texto, usa prosa limpa do LLM.
      if (!reply || !reply.trim()) reply = _invLeadText;
    }
  }

  // Sprint Fase B — <<SHOP_ACTION>> — venda, entrada, ajuste e consulta da lojinha.
  // Fatia C — markers honestos: SHOP_ACTION agora SEMPRE registra em marker_logs (antes: ZERO
  // observabilidade — ação da lojinha era invisível ao health-check/auditoria). WRITE que não
  // persistiu (pergunta/"não achei") → 'skipped'; ação desconhecida (handler retorna null) →
  // 'rejected' + aviso (antes vazava o marker cru ou sumia em silêncio).
  {
    const _shopStrip = /<<SHOP_ACTION>>[\s\S]*?<<(?:\/?SHOP_ACTION|END)>>/g;
    const SHOP_WRITE = new Set(['shop_sale', 'shop_entry', 'shop_adjust', 'shop_estorno', 'shop_reserve', 'shop_pendencia']);
    const shop = parseShopAction(reply);
    if (shop) {
      const _userName = (collab && collab.full_name) ? collab.full_name : 'usuário';
      try {
        const _shopOutcome = { persisted: false };
        const shopResult = await handleShopAction(shop, collab, _userName, _shopOutcome);
        if (shopResult) {
          reply = (reply.replace(_shopStrip, '') + '\n\n' + shopResult).trim();
          const _r = (SHOP_WRITE.has(shop.action) && !_shopOutcome.persisted) ? 'skipped' : 'executed';
          await logMarker(collab.id, 'SHOP_ACTION', _r, _r === 'skipped' ? `no_persist:${shop.action}` : shop.action, null);
        } else {
          // handler retornou null → ação não reconhecida: nunca vaza o marker cru nem some calado.
          reply = (reply.replace(_shopStrip, '') + '\n\n⚠️ Não entendi essa ação da lojinha — pode reformular?').trim();
          await logMarker(collab.id, 'SHOP_ACTION', 'rejected', `unknown_action:${shop.action}`, reply);
        }
      } catch (e) {
        console.error('[ShopAction] handler err:', e.message);
        reply = (reply.replace(_shopStrip, '') + '\n\n⚠️ Não consegui registrar: ' + e.message).trim();
        await logMarker(collab.id, 'SHOP_ACTION', 'rejected', `error:${e.message}`, null);
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

  // COORD-RESPONSE-STATE-STUCK (12/06): rastreia se um relay foi efetivamente enviado
  // neste turn — usado abaixo pra NÃO sobrescrever a confirmação com "problema técnico"
  // quando o mesmo turn também trouxe um <<COORDINATION_RESPONSE>> malformado (msg mista).
  let coordRequestHandledThisTurn = false;
  // Sprint 16 → revisão 26/05 — <<COORDINATION_REQUEST>>: processa TODOS os
  // markers (antes só o primeiro). Caso real: broadcast pra 4 pessoas em 1 turn.
  {
    const { stripOptimisticSendLines, claimsSent, enforceSendHonesty } = require('./lib/coord-send-honesty');
    const parsedCoord = parseCoordinationRequestMarker(reply);
    if (parsedCoord && parsedCoord.malformed) {
      console.warn('[CoordinationRequest] WARN: all markers malformed, dropping block', parsedCoord.reasons);
      await logMarker(collab.id, 'COORDINATION_REQUEST', 'rejected', 'schema_invalid', null);
      // Fatia B — anti-mentira (espelha o guard de TASK_UPDATE/EVENT_CREATE): marker
      // rejeitado por schema_invalid NÃO entregou recado nenhum. Se o texto limpo do
      // LLM afirma envio ("avisei/mandei/repassei..."), troca por aviso honesto —
      // o recipient NUNCA recebeu. Caso Daiana 05/06 ("📨 Avisei a Anne" + rejeição).
      let baseCoord = parsedCoord.cleanText || reply;
      // COORD-SEND-CONFAB-STRIP (Ana 30/06): antes só ANEXAVA o aviso honesto, mas
      // deixava a prosa otimista ("📨 Avisado! Mandando pro grupo agora") → contradição
      // intra-mensagem. Agora REMOVE as linhas de falso-envio (espelha sanitizeOptimisticConfirm
      // dos ramos TASK/EVENT) e SÓ então anexa o honesto. claimsSent é o gate. (require hoistado no topo do bloco)
      if (claimsSent(baseCoord)) {
        const stripped = stripOptimisticSendLines(baseCoord);
        const DISCLAIMER = '_⚠️ Tive um problema técnico e não consegui enviar o recado — ninguém foi avisado ainda. Me passa de novo pra quem e o quê você quer mandar?_';
        baseCoord = stripped ? `${stripped}\n\n${DISCLAIMER}` : DISCLAIMER;
      }
      reply = baseCoord;
    } else if (parsedCoord && parsedCoord.items) {
      // Audit 10/07 (Fabi) — COORD-CONFIRM-NOOP: rede determinística de confirmação.
      // Em vez de enviar direto, ESTAGIA o payload e pergunta; o "sim" (handler pré-LLM
      // ~9548) despacha via applyCoordinationRequestAction. Fail-safe: shouldStageCoordination
      // default=true → NUNCA envia sem confirmar. A pergunta é a prosa do LLM (voz intacta),
      // fallback = buildCoordinationConfirmPreview. Espelha o staging do financeiro.
      const { shouldStageCoordination, buildCoordinationConfirmPreview, resolveStageConfirmPrompt } = require('./coordination/coord-confirm');
      // FATIA 8: se o recado JÁ foi confirmado no turno anterior (proposta "Mando pro X?" + "sim"),
      // o gate marcou _metrics.recado_preconfirmed → despacha direto (else abaixo), sem re-estagiar.
      if (shouldStageCoordination(parsedCoord.items, { preConfirmed: !!_metrics.recado_preconfirmed })) {
        // COORD-CONFIRM-STAGE-PROSE-CONFAB (Fabi 11/07): a prosa de estágio é GARANTIDA pergunta.
        // Se o LLM afirmou envio ("Mandando agora ✅") em vez de perguntar, o user achava que já
        // foi e nunca dava "sim" → recado estagiado, nunca enviado. resolveStageConfirmPrompt troca
        // afirmação-de-envio pela pergunta determinística; preserva a prosa do LLM quando é pergunta.
        const _preview = resolveStageConfirmPrompt(parsedCoord.cleanText, parsedCoord.items);
        const _cid = await pendingIntents.openIntent(
          collab.id, 'confirmation', { coordination: { items: parsedCoord.items } }, _preview);
        if (!_cid) {
          await logMarker(collab.id, 'COORDINATION_REQUEST', 'rejected', 'coord_confirm_intent_null', null);
          reply = 'Opa, não consegui preparar o envio do recado — me manda de novo, por favor 🙏';
        } else {
          _metrics.awaiting_user_confirm = true;
          await logMarker(collab.id, 'COORDINATION_REQUEST', 'skipped', `staged_coord:${parsedCoord.items.length}`, null);
          reply = _preview;
        }
      } else {
        // Fail-safe: envio-direto só existiria numa exceção FUTURA de shouldStageCoordination
        // (default é sempre estagiar). Mantém o comportamento antigo (loop de envio).
        let okCount = 0, failCount = 0;
        const failedRecipients = [];
        const failedResults = [];
        for (const item of parsedCoord.items) {
          const result = await applyCoordinationRequestAction(collab, item);
          await logMarker(collab.id, 'COORDINATION_REQUEST', result.ok ? 'executed' : 'rejected', `${item.recipient_name}:${result.reason}`, null);
          if (result.ok) okCount++;
          else { failCount++; failedRecipients.push(`${item.recipient_name} (${result.reason})`); failedResults.push(result); }
        }
        if (okCount > 0) coordRequestHandledThisTurn = true;
        reply = parsedCoord.cleanText || reply;
        if (failCount > 0) {
          if (parsedCoord.items.length === 1 && okCount === 0 && failedResults[0]?.replyText) reply = failedResults[0].replyText;
          else reply = (reply || '') + `\n\n⚠️ Não consegui enviar pra: ${failedRecipients.join(', ')}.`;
        }
      }
    } else if (claimsSent(reply)) {
      // SEND-CLAIM-NOMARKER (audit 01/07, Reunião Time Gestão): NENHUM <<COORDINATION_REQUEST>>
      // foi emitido, mas a fala afirma ter avisado/convidado pessoas ("mandando o convite pra
      // cada um dos 8") → confab (nada despachado). O strip de coord-send-honesty vivia SÓ nos
      // ramos acima; o chokepoint Camada 1 é BINÁRIO (o EVENT_CREATE que persistiu faz
      // nothingPersisted=false, então ele não rebaixa). Aqui: tira a linha de falso-envio + aviso honesto.
      // COORD-HONESTY-NEGA-ENVIO-FEITO (Leo 05/08 14:59): "sem marker neste turn" ≠ "nada foi
      // enviado". O Leo teve 2 recados despachados (Rafinha 14:07:59, Krissya 14:19:19) e, ao
      // reclamar do lembrete às 14:58, ouviu "NÃO avisei ninguém — nenhuma mensagem chegou a ser
      // enviada". Antes de negar, confere o registro de envio na mesma janela de 2h já usada pelo
      // COORD_HINT. Se algo saiu de verdade, a afirmação do LLM não é confab.
      let _recentlySent = false;
      try {
        const _cutoffSend = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const { data: _sentRows } = await supabase
          .from('coordination_requests')
          .select('id')
          .eq('requester_id', collab.id)
          .eq('status', 'sent')
          .gte('sent_at', _cutoffSend)
          .limit(1);
        _recentlySent = !!(_sentRows && _sentRows.length);
      } catch (e) { console.warn('[SendHonesty] recent-send check err:', e.message); }
      const _sh = enforceSendHonesty(reply, { isQuestion: hasTrailingQuestion(reply) || isInfoGatheringReply(reply), recentlySent: _recentlySent });
      if (_sh.fired) {
        // CHOKEPOINT-APAGA-A-PROPRIA-EVIDENCIA (19/08): o raw_excerpt guardava `reply` DEPOIS
        // do rebaixamento — ou seja, a nota honesta, não a afirmação falsa que o guard pegou.
        // Sem o original, o maior cluster do acervo (23 achados de "não consegui registrar")
        // é irrefutável por construção: nem o marker_logs nem o conversation_history (que só
        // guarda o entregue) preservam o que foi interceptado. Loga o ORIGINAL; os dois juntos
        // dão a prova inteira — aqui o que ele IA dizer, lá o que ele DISSE.
        const _origSh = String(reply).slice(0, 200);
        reply = _sh.reply;
        console.log(`[SendHonesty] SEND-CLAIM-NOMARKER phone=${_phoneTail} → rebaixado (afirmou envio sem coord marker)`);
        try { await logMarker(collab.id, 'CHOKEPOINT', 'redirected', 'confab:coordination:nosend', _origSh); } catch (_) {}
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
      if (coordRequestHandledThisTurn) {
        // COORD-RESPONSE-STATE-STUCK (12/06): um <<COORDINATION_REQUEST>> JÁ foi enviado
        // neste mesmo turn (mensagem mista). NÃO sobrescrever a confirmação do relay com
        // "problema técnico" — o recado FOI entregue. Só remove o marker RESPONSE malformado.
        reply = parsedCoordResp.cleanText || reply;
      } else {
        // BUG-4 (11/06): anti-confab — cleanText pode conter prosa otimista como "Transmiti sua
        // resposta ao João!" quando a ação NÃO foi executada (marker malformado). Trocar por
        // mensagem neutra evita que o remetente acredite que a resposta chegou ao destinatário.
        reply = 'Recebi sua resposta, mas encontrei um problema técnico ao processá-la. Pode tentar novamente?';
      }
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
  let _finActionRan = false;
  // Fatia C — markers honestos: só ações de ESCRITA podem virar 'skipped' quando o handler
  // não persistiu (pediu fonte / "não achei" / coaching). query_* sempre 'executed'.
  const FIN_WRITE = new Set([
    'register_transaction', 'card_purchase', 'card_refund', 'delete_transaction', 'edit_transaction',
    'register_bill', 'delete_bill', 'set_bill_amount', 'pay_bill', 'create_goal', 'update_goal', 'edit_goal', 'delete_goal',
    'set_budget', 'create_account', 'edit_account', 'create_card', 'pay_invoice', 'transfer',
    'reconcile_resolve',
  ]);
  {
    const finParsed = parseFinanceMarkers(reply);
    if (finParsed.actions.length > 0) {
      _finActionRan = true;
      // Camada 2 — pay_invoice (pagar fatura SEMPRE confirmado, FIN-PAYINVOICE-CONFAB-NOOP):
      // um pay_invoice sozinho → monta a confirmação e abre intent; o "Sim" paga + fecha a tarefa.
      const _payActs = finParsed.actions.filter((a) => a.action === 'pay_invoice');
      let _payStaged = null;
      if (_payActs.length === 1 && finParsed.actions.length === 1) {
        try { _payStaged = await stagePayInvoice(collab.id, _payActs[0].params || {}); }
        catch (e) { console.warn('[PayInvoiceStage] err:', e.message); _payStaged = null; }
      }
      if (_payStaged) {
        const _pv = launchConfirm.buildPayInvoicePreview(_payStaged.display);
        const _pid = _pv ? await pendingIntents.openIntent(collab.id, 'finance_source', { form: 'launch_confirm', actions: [_payStaged.action], close_tasks: _payStaged.close_tasks }, _pv) : null;
        if (!_pid) {
          await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', 'pay_invoice_intent_null', null);
          reply = 'Opa, não consegui preparar a confirmação do pagamento — me manda de novo, por favor 🙏';
        } else {
          _metrics.awaiting_user_confirm = true; // Camada 1 não rebaixa a montagem (é pergunta)
          await logMarker(collab.id, 'FINANCE_ACTION', 'skipped', 'staged_pay_invoice', null);
          reply = _pv;
        }
      } else {
      // Camada 2 (sempre-confirmar, FIN-CONFIRM-CONFAB-NOOP): tenta estagiar os lançamentos
      // (register_transaction/card_purchase) numa ÚNICA montagem de confirmação. Só estagia se
      // TODOS resolverem a fonte limpo; senão cai no fluxo ATUAL (insere/pergunta como antes).
      const _LAUNCH = new Set(['register_transaction', 'card_purchase']);
      let _staged = null;
      if (finParsed.actions.some((a) => _LAUNCH.has(a.action))) {
        try { _staged = await stageLaunches(collab.id, finParsed.actions.filter((a) => _LAUNCH.has(a.action)), text); }
        catch (e) { console.warn('[LaunchStage] err:', e.message); _staged = null; }
      }
      if (_staged && _staged.allClean && _staged.items.length) {
        // Só os lançamentos viram montagem; NÃO-lançamentos (query/budget/etc.) rodam normal.
        const _otherReplies = [];
        for (const a of finParsed.actions.filter((x) => !_LAUNCH.has(x.action))) {
          try {
            const _o = { persisted: false };
            const _r = await handleFinanceAction(collab, a.action, a.params, _o);
            const _res = (FIN_WRITE.has(a.action) && !_o.persisted) ? 'skipped' : 'executed';
            await logMarker(collab.id, 'FINANCE_ACTION', _res, a.action, null);
            if (_r && _r.trim()) _otherReplies.push(_r.trim());
          } catch (err) {
            await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', `error:${err.message}`, null);
            _otherReplies.push('Deu ruim num item — tenta de novo?');
          }
        }
        const _preview = launchConfirm.buildLaunchPreview(_staged.items);
        const _intentId = await pendingIntents.openIntent(collab.id, 'finance_source', { form: 'launch_confirm', actions: _staged.actions }, _preview);
        if (!_intentId) {
          // openIntent falhou (ex.: drift de CHECK) → honesto, NUNCA finge que estagiou.
          await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', 'launch_confirm_intent_null', null);
          reply = 'Opa, não consegui preparar a confirmação aqui — me manda de novo, por favor 🙏';
        } else {
          _metrics.awaiting_user_confirm = true; // Camada 1 não rebaixa a montagem (é pergunta)
          await logMarker(collab.id, 'FINANCE_ACTION', 'skipped', `staged_launch:${_staged.items.length}`, null);
          reply = [..._otherReplies, _preview].filter(Boolean).join('\n\n');
        }
      } else {
      // Despacha CADA marker (lista de gastos numa msg só) e concatena as confirmações.
      const finReplies = [];
      for (const a of finParsed.actions) {
        try {
          // REDE DE SEGURANÇA (parcela): o LLM às vezes lança "comprei em Nx" como 1x à vista.
          // Se o texto do usuário indica parcelas e o marker veio sem (ou com 1), corrige aqui —
          // determinístico, pega o caso mesmo quando o LLM erra a extração. (Rose 13/06)
          if (a.action === 'card_purchase' && finParsed.actions.filter((x) => x.action === 'card_purchase').length === 1) {
            const _rec = reconcileInstallments(a.params && a.params.installments, text);
            if (_rec.corrected) {
              a.params = { ...(a.params || {}), installments: _rec.installments };
              console.log(`[Finance] installments rede-de-seguranca: LLM<=1 -> "${String(text).slice(0, 60)}" -> ${_rec.installments}`);
            }
          }
          const _outcome = { persisted: false };
          const finReply = await handleFinanceAction(collab, a.action, a.params, _outcome);
          // Fatia C: WRITE sem persistência (pergunta/não-achei) → 'skipped', não 'executed'.
          const _result = (FIN_WRITE.has(a.action) && !_outcome.persisted) ? 'skipped' : 'executed';
          const _reason = (_result === 'skipped') ? `no_persist:${a.action}` : a.action;
          await logMarker(collab.id, 'FINANCE_ACTION', _result, _reason, null);
          // Bug 3: o engine é a fonte da confirmação (descarta narração do LLM que duplicaria).
          if (finReply && finReply.trim()) finReplies.push(finReply.trim());
        } catch (err) {
          console.error('[Finance] erro:', err.message);
          await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', `error:${err.message}`, null);
          finReplies.push('Deu ruim ao registrar um dos itens — tenta de novo?');
        }
      }
      // Defesa: se houve markers válidos E malformados na MESMA resposta (ex: lista
      // onde um item veio embolado), NUNCA engula o que falhou em silêncio — loga e avisa.
      if (finParsed.malformed > 0) {
        console.warn(`[Finance] WARN: ${finParsed.malformed} malformed marker(s) junto de ${finParsed.actions.length} válido(s)`);
        await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', `schema_invalid_partial:${finParsed.malformed}`, reply);
        finReplies.push(finParsed.malformed === 1
          ? '⚠️ Registrei o que deu, mas um item veio embolado e não entrou. Me manda de novo só esse?'
          : `⚠️ Registrei o que deu, mas ${finParsed.malformed} itens vieram embolados e não entraram. Me manda de novo só esses?`);
      }
      reply = finReplies.length ? finReplies.join('\n\n') : (finParsed.cleanText || reply);
      }
      }
    } else if (finParsed.malformed > 0) {
      console.warn('[Finance] WARN: malformed marker');
      await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', 'schema_invalid', reply);
      reply = finParsed.cleanText || reply;
    }
  }

  // 2.95) GUARDA ANTI-FABRICAÇÃO de finança (caso Matheus 07/06 — FIN-FAKE-CONFIRM).
  // O LLM às vezes NARRA "💰 Entrada registrada! ... Saldo R$ X" como texto livre SEM emitir
  // <<FINANCE_ACTION>>: nada persiste, o saldo mostrado é mentira e a correção seguinte "não
  // acha lançamento". Se NENHUM marker de finança rodou E o texto tem assinatura de confirmação,
  // NÃO mandamos a mentira: registramos de verdade (pipeline real) a partir da msg original,
  // ou pedimos pra repetir. Determinístico, sem 2ª chamada ao LLM.
  if (!_finActionRan && typeof reply === 'string') {
    try {
      const { detectRegisterIntent, looksLikeFinanceConfirmation } = require('./finance/detect-register-intent');
      const { detectDefeatism } = require('./finance/derrotismo-detect');
      const { detectCorrection } = require('./finance/detect-correction');
      const _isConfab = looksLikeFinanceConfirmation(reply);
      // CAMINHO 2 / FATIA 1 (F1.3b): intercepta também a RECUSA do LLM (derrotismo), não só o
      // fake-sucesso (confab). Gate de finança = skill ativa (skill_active setado no 9124;
      // _metrics.actionable_intent só existe no 11073, DEPOIS daqui). A recusa NUNCA vai ao user.
      const _defPhrase = detectDefeatism(reply, {}).phrase;
      const _defeatFinance = !!_defPhrase && _metrics.skill_active === 'financeiro-pessoal';
      if (_isConfab || _defeatFinance) {
        const _origMsg = String(inboundVerbatimText || text || '');
        const _det = detectRegisterIntent(_origMsg, { typeHint: reply });
        if (_isConfab) console.warn(`[Finance] ANTI-FABRICAÇÃO: confirmação sem marker (det=${_det ? _det.type + '/' + _det.amount : 'null'}) phone=${_phoneTail}`);
        else console.warn(`[Finance] DERROTISMO interceptado (skill=finance, det=${_det ? 'create' : 'null'}) phone=${_phoneTail}`);
        await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', _isConfab ? 'fabricated_no_marker' : 'defeatism_intercepted', String(reply).slice(0, 200));
        // Velocímetro UNIFICADO (review 24/06): a "fire" da rede mora SEMPRE em marker_type='CHOKEPOINT'
        // (sentido no reason) — senão `where marker_type='CHOKEPOINT'` perde a maioria das linhas da curva.
        try { await logMarker(collab.id, 'CHOKEPOINT', 'redirected', (_isConfab ? 'confab' : 'defeatism') + ':finance', String(reply).slice(0, 120)); } catch (_) {}
        const _askAgain = 'Opa, deixa eu te ajudar com isso — me manda numa frase só: o que lançar/mudar, *quanto* e *de onde* (ex: _"gastei 12 no lanche, débito"_). Se forem vários, manda um de cada vez que eu vou anotando. 👍';
        if (_det && _isConfab) {
          // CONFAB (LLM narrou "sucesso" sem marker): re-registra DIRETO (anti-fabricação original — o
          // user JÁ viu "sucesso", re-registrar casa a expectativa). MUST-FIX #A segura o chokepoint.
          const _params = { type: _det.type, amount: _det.amount, description: _det.description };
          if (_det.account_name) _params.account_name = _det.account_name;
          if (_det.method) _params.method = _det.method;
          try {
            const _real = await handleFinanceAction(collab, 'register_transaction', _params);
            reply = (_real && _real.trim()) ? _real : _askAgain;
            if (_real && _real.trim()) {
              // MUST-FIX #A: re-registro REAL sem marker → sinalizar persistência, senão o chokepoint
              // (nothingPersisted=!marker_emitted) rebaixa o "registrada!" REAL pra "não consegui" = confab INVERSO.
              _metrics.marker_emitted = 'FINANCE_ACTION(anti_fabric)';
              await logMarker(collab.id, 'FINANCE_ACTION', 'executed', `register_transaction(anti_fabric:${_det.type})`, null);
              console.log(`[Finance] re-registrado deterministicamente (${_det.type} ${_det.amount}) phone=${_phoneTail}`);
            }
          } catch (_e) {
            console.error('[Finance] re-registro err:', _e.message);
            reply = _askAgain;
          }
        } else if (_det) {
          // CLOSURE 2 (review 24/06): DERROTISMO (LLM recusou) → NÃO grava direto (bypassaria "sempre
          // confirmar"). ESTAGIA pelo launch_confirm → "Vou lançar... Confirma?". Mata o confab-inverso
          // por CONSTRUÇÃO (montagem é pergunta → awaiting_confirm → chokepoint não dispara) + protege
          // misparse (o user confere o que a extração entendeu antes de gravar).
          const _params = { type: _det.type, amount: _det.amount, description: _det.description };
          if (_det.account_name) _params.account_name = _det.account_name;
          if (_det.method) _params.method = _det.method;
          let _staged = null;
          try { _staged = await stageLaunches(collab.id, [{ action: 'register_transaction', params: _params }], _origMsg); }
          catch (_e) { console.warn('[F1.3b stage] err:', _e.message); }
          if (_staged && _staged.allClean && _staged.items.length) {
            const _preview = launchConfirm.buildLaunchPreview(_staged.items);
            const _iid = await pendingIntents.openIntent(collab.id, 'finance_source', { form: 'launch_confirm', actions: _staged.actions }, _preview);
            if (_iid) {
              _metrics.awaiting_user_confirm = true; // montagem é pergunta → chokepoint não rebaixa
              await logMarker(collab.id, 'FINANCE_ACTION', 'skipped', 'staged_launch:1(derrotismo)', null);
              reply = _preview;
            } else {
              reply = _askAgain; // openIntent falhou → honesto, nunca finge
            }
          } else {
            reply = _askAgain; // fonte não resolveu limpo → pede honesto (não grava direto, não mente)
          }
        } else if (_defeatFinance) {
          // Recusou num turno de finança e não dá pra extrair create → correção honesta (edit/delete)
          // ou pedido honesto. NUNCA a mentira "não existe comando".
          const _corr = detectCorrection(_origMsg);
          if (_corr) {
            const _act = _corr.op === 'delete' ? 'delete_transaction' : 'edit_transaction';
            const _recent = await financeService.listRecentTransactions(collab.id, { hours: EDIT_WINDOW_HOURS, limit: 10 });
            const _v = resolveFinanceCapability({ action: _act, params: { which: _corr.ref || '' } }, { candidates: _recent });
            if (_v.reachable) {
              const _p2 = _corr.op === 'delete' ? { which: _corr.ref } : { which: _corr.ref || '', amount: _corr.amount, category: _corr.category };
              const _r2 = await handleFinanceAction(collab, _act, _p2);
              if (_r2 && _r2.trim()) {
                reply = _r2;
                _metrics.marker_emitted = 'FINANCE_ACTION(derrotismo_corr)'; // MUST-FIX #A
                await logMarker(collab.id, 'FINANCE_ACTION', 'executed', `derrotismo_corr:${_act}`, null);
              } else {
                reply = _askAgain;
              }
            } else {
              reply = buildHonestRedirect(_v);
              await logMarker(collab.id, 'FINANCE_ACTION', 'redirected', `derrotismo_redirect:${_v.reason}`, null);
            }
          } else {
            reply = _askAgain;
            await logMarker(collab.id, 'FINANCE_ACTION', 'redirected', 'derrotismo_askhonest', null);
          }
        } else {
          reply = _askAgain;
        }
      }
    } catch (_e) {
      console.warn('[Finance] ANTI-FABRICAÇÃO/derrotismo guard err (silent):', _e.message);
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
        // UNKNOWN-MARKER-STRIPPED-SILENT-PARTIAL (Fefê 01/07): se o que foi removido era
        // marker CONHECIDO (ex: TASK_UPDATE malformado sem <<END>>), trabalho real foi
        // perdido — a prosa do LLM ("Reagendando as 3 ✅") vira mentira parcial que o
        // chokepoint não pega (algo persistiu). Anexa aviso honesto pedindo pra repetir.
        // Alucinação pura (TASK_CREATE etc.) segue stripada em silêncio.
        try {
          const { detectKnownMarkerLoss, PARTIAL_LOSS_DISCLAIMER } = require('./lib/known-marker-partial');
          const _loss = detectKnownMarkerLoss(matchNames);
          if (_loss.lost && reply) {
            reply = `${reply}\n\n${PARTIAL_LOSS_DISCLAIMER}`;
            console.warn(`[Engine] KNOWN_MARKER_LOSS — ${_loss.known.join(',')} malformado(s) removido(s), aviso honesto anexado`);
          }
        } catch (_) { /* aviso é best-effort, nunca quebra o fluxo */ }
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
      // 2b) MECHANISM-LEAK (regra 16) — vocabulário interno em PROSA ("o marker vai de verdade",
      // "com bypass_integrity", <<EVENT_CREATE>>, to_name...) que o STACK_LEAK_RE não cobre. Rede
      // SEPARADA (não crescer aquele regex), line-level: tira só a linha do mecanismo, preserva o
      // card. Se esvaziar tudo, o fallback (3) abaixo cobre. Caso Reunião Time Gestão 01/07.
      try {
        const { stripMechanismLeak } = require('./lib/mechanism-leak');
        const _ml = stripMechanismLeak(reply);
        if (_ml.fired) {
          console.warn(`[Engine] MECHANISM_LEAK stripped — reply="${reply.slice(0, 120)}"`);
          try { await logMarker(collab.id, 'LEAK_BLOCKED', 'rejected', 'mechanism_word', reply.slice(0, 500)); } catch (_) {}
          reply = _ml.reply;
        }
      } catch (mlErr) { console.warn('[Engine] mechanism-leak guard err (non-fatal):', mlErr.message); }
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
    const ACTIONABLE_RE = /\b(anota|me\s+lembra|lembra\s+(?:de|do|da)\b|lembrete|me\s+chama|preciso|surgiu|p[oó]e\s+na\s+lista|adiciona|paguei|fiz|terminei|fechei|completei|delega|marca\s+(?:reuni|m[eé]dico|consulta|ensaio|encontro|aula)|compr(?:a|ar|e)\s|consert(?:a|ar)|trocar?|reparar?|montar?|instalar?|limpar?|vai\s+criando|vai\s+anotando|vou\s+te\s+mandar|t[eô]\s+(?:te\s+)?mandando\s+as?\s+(?:pend|demanda|tarefa)|tem\s+(?:que|pra)\s+(?:fazer|comprar|consertar|trocar))/i;
    // Detector de promessa EXPLÍCITA na reply do TOM (gatilhos conservadores).
    // Cobre casos onde TOM verbaliza intenção de persistir sem emitir o marker:
    // - "lembrete às X" / "te aviso às X" → cron/remind
    // - "reagendei pra X" / "marquei pra X" → reschedule
    // - "registrar/registrei/anotando/criando/adicionando/crio as/juntando/no pacote/na lista" → create operacional
    // PROMISE-NOMARKER-DOWNGRADE (01/07): a RE mudou pra src/lib/promise-honesty.js (fonte única —
    // o MESMO vocabulário que dispara o retry decide o rebaixamento quando o retry não persiste).
    const { REPLY_PROMISE_RE, downgradeEmptyPromise } = require('./lib/promise-honesty');
    const inputActionable = ACTIONABLE_RE.test(String(text || ''));
    let replyHasPromise = REPLY_PROMISE_RE.test(String(reply || ''));
    // Bug 01/06 (Esfera/Grava?): pergunta de confirmação é SEMPRE info-gathering,
    // mesmo com *negrito*. Antes exigia "sem bold", mas confirmação cita a entidade
    // em negrito ("...com a *Esfera*... Certo?", "🧾 *Sabor do Mar*... Grava?") e
    // escapava do filtro, inflando a métrica e disparando auto-retry em pergunta.
    // Se o TOM está PERGUNTANDO, ele não prometeu nada — não há ação a persistir.
    // Sprint 31.10 — pergunta robusta a pontuação/emoji após "?" ("Que horas?
    // (14h, 15h?)") + reply que pede insumo ao user ("me manda", "vai listando")
    // = info-gathering. Lógica em services/reply-classify.js (testada) — tira o
    // falso positivo reincidente de C1 sem empilhar mais um exclude inline.
    const _replyIsInfoGathering = hasTrailingQuestion(reply) || isInfoGatheringReply(reply);
    // Bug 01/06: RECUSA não é promessa. "não consigo registrar", "não tem como
    // criar", "não dá pra anotar por aqui" casavam REPLY_PROMISE_RE pelo verbo e
    // disparavam auto-retry numa negação. Se o TOM recusou, zera a flag de promessa.
    const _replyIsDecline = /\bn[ãa]o\s+(?:consigo|d[áa]|tem\s+como|rola|posso|consegue)\b[^.!?]{0,60}\b(?:registr|anot|cri|adicion|salv|marc|guard|lembr)/i.test(String(reply || ''));
    if (_replyIsDecline) replyHasPromise = false;
    // Sprint 31.6 (C1) — reduz falso-positivo da métrica ACTIONABLE_NO_MARKER.
    // O `inputActionable` pegava (a) PERGUNTAS do user ("E o evento que criei?")
    // e (b) AUTO-RELATO do próprio user ("estou verificando", "eu já criei") —
    // nenhum é ação pendente PRO TOM. `replyHasPromise` (TOM se comprometeu) sempre
    // conta. `inputActionable` só conta se NÃO for pergunta nem auto-relato.
    const _inputIsQuestion = /\?\s*$/.test(String(text || '').trim());
    const _inputSelfReport = /\b(est(?:ou|á)|t[oô]u?|tava)\s+[a-zà-ú]+ndo\b|\b(?:eu\s+)?j[aá]\s+(?:fiz|criei|terminei|fechei|completei|resolvi|mandei|enviei|verifiquei)\b/i.test(String(text || ''));
    const _flagActionable = replyHasPromise || (inputActionable && !_inputIsQuestion && !_inputSelfReport);
    // F6 (auditoria 09/06) — métrica HONESTA: marker_emitted é computado SEMPRE.
    // Antes só era setado dentro do branch actionable; reply terminando em pergunta
    // (_replyIsInfoGathering) pulava o bloco e `noMarkerEmitted` mentia mesmo com
    // EVENT_UPDATE executado (Incidente A: abriu intent nova por cima da ação real,
    // supersedendo a pergunta legítima).
    const sinceIso = new Date(_t0 - 1000).toISOString();
    const { data: recentMarkers } = await supabase
      .from('marker_logs')
      .select('marker_type, result')
      .eq('collaborator_id', collab.id)
      .in('result', ['executed', 'rejected'])
      .gte('created_at', sinceIso);
    // Tipos META (não são ação de domínio): fora da conta de "marker tentado".
    const _NON_DOMAIN_MARKERS = ['LEAK_BLOCKED','UNKNOWN_MARKER_STRIPPED','TOOL_CALL_STRIPPED','PROVIDER','ACTIONABLE_NO_MARKER','CHOKEPOINT'];
    const _isDomainMarker = (t) => t && !_NON_DOMAIN_MARKERS.includes(t);
    const fired = (recentMarkers || []).filter(r => r.result === 'executed' && _isDomainMarker(r.marker_type)).map(r => r.marker_type);
    // FATIA 2 (falso-fire composição): houve marker de DOMÍNIO tentado — executado OU rejeitado —
    // neste turno? Se sim, o turno carrega AÇÃO NA MESA e o veto de composição do chokepoint NÃO
    // pode desarmar (marker rejeitado = tentou e falhou = o rodapé honesto vale). É eixo SEPARADO
    // do nothingPersisted (que só olha executed): rejeitado deixa nothingPersisted=true mas
    // markerAttempted=true → guard dispara. Ver optimistic-confirm.js (enforceNoMarkerHonesty).
    _metrics.marker_attempted = (recentMarkers || []).some(r => _isDomainMarker(r.marker_type));
    if (fired.length > 0) {
      _metrics.marker_emitted = fired.join(',').slice(0, 100);
      _metrics.marker_result = 'executed';
    }
    if (!_metrics.awaiting_user_confirm && !_replyIsInfoGathering && _flagActionable) {
      _metrics.actionable_intent = true;
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
            // ANTI-ENVENENAMENTO DO RETRY (caso Alf, 05/08 22:13)
            // Este mini-prompt é um conversor texto→marker: a fala do TOM é a fonte de verdade
            // dele. Quando essa fala traz data ERRADA, o retry a persiste — foi assim que
            // "reagendei pra amanhã (sex 07/08)" numa QUARTA gravou due_date=07/08 na tarefa,
            // com o contexto abaixo dizendo, corretamente, que amanhã era 06/08. O texto
            // explícito ganhou da âncora.
            // Só age quando o detector acusa divergência real: com a data certa, nada muda —
            // e "amanhã" sozinho o LLM resolve pela âncora que já está aqui.
            const _datasErradas = detectaDataAfirmadaErrada(reply, todayBrt);
            const _replyParaRetry = _datasErradas.length
              ? neutralizaDataAfirmada(String(reply || ''))
              : String(reply || '');
            if (_datasErradas.length) {
              const _det = _datasErradas.map((d) => `${d.rotulo}=${d.disse}(era ${d.esperado})`).join(', ');
              console.warn(`[Engine] AUTO_RETRY_DATE_POISON — neutralizei antes do retry: ${_det}`);
              await logMarker(collab.id, 'AUTO_RETRY_DATE_POISON', 'rejected', _det, String(reply || '').slice(0, 300));
            }

            const miniSys = `Você é um conversor mecânico texto→marker. Sua única saída é UM marker JSON, sem nenhum texto fora dele.

Contexto:
- Data hoje (BRT): ${todayBrt}
- Data amanhã (BRT): ${tomorrowBrt}
- Colaborador: ${collab.full_name || '?'} (role=${collab.role || '?'})
- User disse: "${String(text || '').slice(0, 500)}"
- TOM respondeu verbalizando promessa: "${_replyParaRetry.slice(0, 900)}"

TOM verbalizou um LEMBRETE COM HORÁRIO mas esqueceu de emitir o marker. Sua tarefa: emitir o marker SÓ se houver um horário/data explícito na promessa.

ESCOPO RESTRITO — este retry só cobre lembretes e reagendamentos com tempo explícito:

1) **Lembrete/aviso COM HORA** ("lembrete às 15h", "te aviso amanhã às 9h", "te cobro segunda às X") → action="reschedule" (se task existe) ou "create" com remind_at ISO BRT "YYYY-MM-DDTHH:mm:ss-03:00". SÓ emita se houver hora/dia concretos.

2) **Reagendamento COM DATA** ("marquei pra amanhã", "reagendei pra segunda", "coloquei pra 05/06") → action="reschedule" com new_due_date (e new_remind_at se mencionou hora).

PROIBIDO NESTE CONTEXTO — retorne NO_MARKER se a promessa for qualquer um destes:
- Criar tarefa nova sem horário (action="create" sem remind_at/data concreta). Bug 01/06: o retry transformava PERGUNTA do TOM ("grava o quê?"), AULA de uso do app ("vá em Finanças → cadastrar") e CONVERSA TÉCNICA ("vou olhar o código") em tarefas-fantasma. Criação de tarefa só acontece no fluxo principal, nunca aqui.
- action="complete" / action="cancel" — concluir ou cancelar exige confirmação explícita do usuário.
- Demanda operacional genérica sem horário (compras, reparos) — vai pelo fluxo principal.
- Qualquer dúvida sobre se o user realmente PEDIU a ação → NO_MARKER.

IMPORTANTE:
- Use title (não id) pra referenciar a task — o engine resolve por título
- Se NÃO houver horário/data explícito na promessa, retorne literalmente: NO_MARKER
- Na dúvida, sempre NO_MARKER. É melhor não persistir do que criar lixo.

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
                  // Defesa em profundidade — o auto-retry só pode persistir o que é
                  // seguro e verificável, mesmo que o mini LLM ignore o prompt:
                  // - Bug 30/05 (Yuri): complete/cancel proibido (exige confirmação).
                  // - Bug 01/06 (Jhonatan/Alf): create SEM remind_at proibido — o retry
                  //   transformava pergunta/aula/conversa-técnica em tarefa-fantasma.
                  //   Só passa create se tiver lembrete com hora (intenção inequívoca) ou
                  //   reschedule (task já existe, o user só mudou data/hora).
                  const safeActions = parsedRetry.actions.filter(a => {
                    if (!a || typeof a.action !== 'string') return false;
                    if (a.action === 'complete' || a.action === 'cancel') {
                      console.warn(`[Engine] AUTO_RETRY_BLOCKED_ACTION — action=${a.action} title="${a.title || a.id}" (complete/cancel proibido em auto-retry)`);
                      return false;
                    }
                    if (a.action === 'create' && !a.remind_at) {
                      console.warn(`[Engine] AUTO_RETRY_BLOCKED_CREATE — create sem remind_at title="${a.title || ''}" (criação de tarefa nova não passa por auto-retry)`);
                      return false;
                    }
                    return true;
                  });
                  if (safeActions.length === 0) {
                    console.warn('[Engine] AUTO_RETRY_ALL_BLOCKED — nenhuma action segura (create sem hora / complete / cancel), ignorando');
                    await logMarker(collab.id, 'TASK_UPDATE_AUTO_RETRY', 'rejected',
                      'all_blocked:unsafe_actions', retryText.slice(0, 500));
                  } else {
                  // Sprint 31.2 — telemetria honesta: olha okCount/failCount em vez de
                  // assumir sucesso. Bug observado 28/05/2026 (Yuri): AUTO_RETRY com 4
                  // títulos alucinados logava "executed actions:4" mesmo quando todas
                  // falharam — escondia o problema do health-check.
                  const retryResult = await applyTaskActions(collab, safeActions) || { okCount: 0, failCount: safeActions.length };
                  // CONFAB-INVERSO-AUTORETRY-DUP (27/06) — classifica o resultado. Se o
                  // `create` do retry falha porque é dup (a tarefa JÁ EXISTE), isso PROVA
                  // que o estado desejado está presente → conta como persistido, senão o
                  // chokepoint rebaixa uma verdade ("tá fechado" → "não consegui"). Caso Ana.
                  // Só dup prova existência; outras falhas seguem rejeitando (lib testada).
                  const _cls = classifyAutoRetry(retryResult);
                  await logMarker(collab.id, 'TASK_UPDATE_AUTO_RETRY', _cls.status, _cls.reason, retryText.slice(0, 500));
                  if (_cls.persisted) _metrics.auto_retry_succeeded = true;
                  if (_cls.status === 'rejected') console.warn(`[Engine] AUTO_RETRY_ALL_FAILED — ${_cls.reason}`);
                  else if (_cls.status === 'skipped') console.log(`[Engine] AUTO_RETRY_DUP_EXISTS — ${_cls.reason}`);
                  else console.log(`[Engine] AUTO_RETRY_OK — marker=TASK_UPDATE ${_cls.reason}`);
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
          // PROMISE-NOMARKER-DOWNGRADE (audit 01/07, Reunião Time Gestão): chegamos aqui com
          // (a) intenção acionável, (b) ZERO markers executados no turno, (c) reply PROMETENDO
          // ação (replyHasPromise) e (d) auto-retry NÃO persistiu → promessa comprovadamente
          // vazia (caso Codex pós-timeout: "Vou criar na agenda e disparar pros 8"). Rebaixa:
          // tira a linha da promessa + aviso honesto (lição Ana 30/06: anexar sem remover =
          // contradição). AUTO_RETRY_DUP_EXISTS seta auto_retry_succeeded (estado desejado já
          // existe) → NÃO rebaixa (lição 27/06, confab inverso).
          if (!_metrics.auto_retry_succeeded) {
            const _pd = downgradeEmptyPromise(reply);
            if (_pd.fired) {
              // CHOKEPOINT-APAGA-A-PROPRIA-EVIDENCIA (19/08): guarda a PROMESSA original —
              // é ela que prova o achado. O texto entregue já vive no conversation_history.
              const _origPd = String(reply).slice(0, 200);
              reply = _pd.reply;
              console.log(`[PromiseHonesty] PROMISE-NOMARKER phone=${_phoneTail} → rebaixado (promessa sem persistência)`);
              try { await logMarker(collab.id, 'CHOKEPOINT', 'redirected', 'confab:promise_nomarker', _origPd); } catch (_) {}
            }
          }
        }
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
        // GUARD-CONFIRM-LOOP (Matheus 10/06): se a guarda temporal abriu intent
        // ANCORADA neste turno (complete bloqueado vira pergunta "Confirma...?"),
        // NÃO abre genérica por cima — openIntent supersede same-kind e matava a
        // âncora 0,4s depois de criada (o "sim" seguinte ficava sem id pra completar
        // e o LLM re-emitia o complete → a guarda re-perguntava → loop infinito).
        // INTENT-CLOBBER-BATCH-COMPLETE (Fabi 30/06): idem pro fechamento em LOTE do
        // A2 ({batch_complete:[ids]}). Essa intent NÃO tem `anchor`, então o guard só
        // de âncora não a via → a genérica a atropelava → "Sim" caía no LLM →
        // chokepoint "não consegui" sobre tarefa JÁ feita. hasFreshDeterministicIntent
        // cobre `anchor` E `batch_complete`.
        const anchoredFresh = await pendingIntents.hasFreshDeterministicIntent(collab.id, 2);
        if (anchoredFresh) {
          console.log('[PendingIntents] skip generic open — deterministic-executor intent fresh (guard turn)');
        } else {
          // Payload mínimo: salva o user_text e a reply pra recuperação no próximo turno.
          // O LLM lê isso no hook inicial e gera o marker certo.
          const payload = {
            last_user_text: String(text || '').slice(0, 600),
            last_tom_reply: reply.slice(0, 900),
          };
          // FATIA 3 (confirmação parse-on-open, coordenação): se a pergunta do TOM é um recado
          // ("Aviso o X? Segue o texto: '…'. Confirma?") com destinatário E texto explícitos,
          // estagia coordination.items ESTRUTURADO — aí o "sim" despacha determinístico (executor
          // @10221) em vez de o LLM re-emitir e confabular "perdi o fio". FAIL-CLOSED: sem extração
          // fiel, payload segue só-texto (comportamento de hoje). Parse na fala do TOM, nunca no
          // texto do usuário. Ver coordination/coord-question-parse.js.
          try {
            const { parseCoordinationConfirmQuestion } = require('./coordination/coord-question-parse');
            const _coord = parseCoordinationConfirmQuestion(reply);
            if (_coord) {
              payload.coordination = { items: [{
                recipient_name: _coord.recipient_name,
                message_body: _coord.message_body,
                mode: 'relay_assisted',
              }] };
              _metrics.confirm_parse_coord = 1;
            }
          } catch (e) { console.warn('[PendingIntents] coord parse-on-open err (non-fatal):', e.message); }
          // FATIA 4 (confirmação parse-on-open, complete/fechamento): se a pergunta é um fechamento
          // ("Confirma o fechamento destas 2 tarefas: *X*, *Y*?"), resolve título→short-id
          // (fail-closed via resolveTaskTarget) e estagia batch_complete — o "sim" fecha
          // determinístico (executor @10199, executeBatchComplete re-checa o dono). FAIL-CLOSED:
          // só estagia se TODOS os títulos resolverem 'exato'; qualquer ambíguo/não-achado → payload
          // segue só-texto. Fechar a tarefa errada é o risco (dor #1 TASK_UPDATE). Skip se a
          // coordenação já estagiou (uma pergunta não é as duas coisas).
          if (!payload.coordination) {
            try {
              const { parseCompleteConfirmQuestion } = require('./utils/complete-question-parse');
              const _comp = parseCompleteConfirmQuestion(reply);
              if (_comp) {
                const { resolveTitlesToBatchComplete } = require('./utils/complete-titles-resolve');
                const { resolveTaskTarget } = require('./lib/task-target');
                const _qCand = async (title) => {
                  const { data } = await supabase.from('tasks')
                    .select('id, title, due_date, recurrence_rule, recurrence_parent_id, created_at')
                    .eq('assigned_to', collab.id)
                    .ilike('title', `%${String(title).slice(0, 60)}%`)
                    .not('status', 'in', '("done","cancelled")')
                    .order('due_date', { ascending: true, nullsFirst: false })
                    .limit(100);
                  return data || [];
                };
                const _res = await resolveTitlesToBatchComplete({ queryCandidatos: _qCand, resolveTaskTarget, titles: _comp.titles });
                if (_res && _res.ids.length) {
                  payload.batch_complete = _res.ids;
                  _metrics.confirm_parse_complete = _res.ids.length;
                }
              }
            } catch (e) { console.warn('[PendingIntents] complete parse-on-open err (non-fatal):', e.message); }
          }
          // FATIA 5 (confirmação parse-on-open, delegação): "Delego pra X — '…'. Confirma?" — extrai
          // {task_title, to_name}, resolve o título→short-id (fail-closed, reuso), e estagia
          // payload.delegation. O "sim" delega determinístico (branch nova, reusa o handler delegate
          // via applyTaskActions, que resolve dono + destinatário e fail-closa em ambíguo). Skip se
          // coord/complete já estagiaram (uma pergunta não é duas coisas). FAIL-CLOSED total.
          if (!payload.coordination && !payload.batch_complete) {
            try {
              const { parseDelegateConfirmQuestion } = require('./utils/delegate-question-parse');
              const _deleg = parseDelegateConfirmQuestion(reply);
              if (_deleg) {
                const { resolveTitlesToBatchComplete } = require('./utils/complete-titles-resolve');
                const { resolveTaskTarget } = require('./lib/task-target');
                const _qCandD = async (title) => {
                  const { data } = await supabase.from('tasks')
                    .select('id, title, due_date, recurrence_rule, recurrence_parent_id, created_at')
                    .eq('assigned_to', collab.id)
                    .ilike('title', `%${String(title).slice(0, 60)}%`)
                    .not('status', 'in', '("done","cancelled")')
                    .order('due_date', { ascending: true, nullsFirst: false })
                    .limit(100);
                  return data || [];
                };
                const _resD = await resolveTitlesToBatchComplete({ queryCandidatos: _qCandD, resolveTaskTarget, titles: [_deleg.task_title] });
                if (_resD && _resD.ids.length === 1) {
                  payload.delegation = { task_id: _resD.ids[0], to_name: _deleg.to_name };
                  _metrics.confirm_parse_deleg = 1;
                }
              }
            } catch (e) { console.warn('[PendingIntents] delegate parse-on-open err (non-fatal):', e.message); }
          }
          await pendingIntents.openIntent(collab.id, detected.kind, payload, reply.slice(0, 500));
          _metrics.pending_intent_opened = detected.kind;
        }
      }
    }
  } catch (e) {
    console.warn('[PendingIntents] hook err:', e.message);
  }

  // CONFAB-NOMARKER-CHOKEPOINT (Camada 1) — trava universal de honestidade.
  // Se a fala afirma conclusão (✅+verbo / verbo no início) mas NADA persistiu neste
  // turno (nem o auto-retry), rebaixa pra honesta. Único lugar; cobre os ~14 handlers.
  // Roda antes da voz E do texto. Não toca ✅ decorativo (gate verbo-baseado).
  //
  // CAMINHO 2 / FATIA 0 — o chokepoint vira VELOCÍMETRO: mede o disparo (linha confab) e o
  // catch ALERTA (não engole), pra a trava nunca mais morrer calada (CONFAB-CHOKEPOINT-SCOPE,
  // ReferenceError de escopo, 106x silencioso). Métrica cabe no schema real de marker_logs:
  // result∈CHECK('executed','rejected','skipped','redirected','fallback') → 'redirected' (a
  // trava redirecionou a fala falsa pra honesta); marker_type='CHOKEPOINT'; reason='confab:<dom>'.
  const _domainOf = (m) => {
    const em = String((m && m.marker_emitted) || '');
    if (/FINANCE/i.test(em)) return 'finance';
    if (/INVENTORY|SHOP/i.test(em)) return 'inventory';
    if (/TASK|CHECKLIST/i.test(em)) return 'task';
    if (/EVENT/i.test(em)) return 'event';
    if (/HABIT/i.test(em)) return 'habit';
    if (/COORDINATION|RSVP/i.test(em)) return 'coordination';
    return 'unknown';
  };
  // REDE 1 §7 (audit 15/07, caso Matheus) — recência de ação pendente p/ a camada FRACA do
  // chokepoint. Boundary por _t0 (mesma janela-de-turno provada em _sinceTurn abaixo): busca a
  // ÚLTIMA virada outbound ANTES deste turno — nunca o "Fechou" atual — e pergunta se foi uma
  // confirm-question de ação. Só paga o fetch quando há claim FRACO sem persistência (evita I/O).
  // NÃO gated por actionable_intent (falso no turno "Isso"→"Fechou" + circular — anti-padrão Task 4).
  let _pendingActionRecent = false;
  try {
    const _np = !_metrics.marker_emitted && !_metrics.auto_retry_succeeded;
    if (_np && hasWeakCompletionClaim(reply) && !hasCompletionClaim(reply)) {
      const _turnStartIso = new Date(_t0 - 1000).toISOString();
      const { data: _lt } = await supabase.from('conversation_history')
        .select('content').eq('collaborator_id', collab.id).eq('direction', 'outbound')
        .lt('created_at', _turnStartIso)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      _pendingActionRecent = isActionConfirmQuestion(_lt && _lt.content);
    }
  } catch (_) {}
  // CHOKEPOINT-NEGA-ESCRITA-RECENTE (Dudu 18/08 21:07) — o chokepoint só enxerga a janela do
  // turno, então negava a afirmação VERDADEIRA sobre o que o próprio TOM gravou 22s antes
  // ("✅ Tá registrado" → "não consegui registrar", e no turno seguinte "tá registrado sim":
  // a contradição virou achado). Lê os títulos escritos na janela curta e deixa o módulo puro
  // decidir se a fala REAFIRMA um deles. Só paga o I/O quando há claim sem persistência e
  // NENHUM marker foi tentado (tentado-e-rejeitado é falha real — ali o guard tem que valer).
  let _restatesRecentWrite = false;
  try {
    const _npW = !_metrics.marker_emitted && !_metrics.auto_retry_succeeded && !_metrics.deterministic_complete_ok;
    if (_npW && !_metrics.marker_attempted && (hasCompletionClaim(reply) || hasWeakCompletionClaim(reply))) {
      const _sinceIso = new Date(_t0 - 180_000).toISOString();
      const { data: _rw } = await supabase.from('tasks')
        .select('title').eq('assigned_to', collab.id)
        .gte('updated_at', _sinceIso)
        .order('updated_at', { ascending: false }).limit(5);
      _restatesRecentWrite = restatesRecentWrite(reply, (_rw || []).map((r) => r.title));
    }
  } catch (_) {}
  try {
    const _hon = enforceNoMarkerHonesty(reply, {
      // deterministic_complete_ok: a Fatia 1 concluiu por id exato ANTES do LLM (ou idempotência
      // real). Só é setado no SUCESSO — falha não seta, e aí o caminho honesto continua valendo (freio #4).
      nothingPersisted: !_metrics.marker_emitted && !_metrics.auto_retry_succeeded && !_metrics.deterministic_complete_ok,
      pendingActionRecent: _pendingActionRecent,
      // CONFAB-CHOKEPOINT-SCOPE (24/06): recomputa local (não ler _replyIsInfoGathering — `const`
      // de outro try, fora de escopo → ReferenceError). Mesmas funções de módulo (reply-classify).
      infoGathering: hasTrailingQuestion(reply) || isInfoGatheringReply(reply),
      // FATIA 2 (falso-fire composição, Rose ADM 14/08): content-solicitation ("Pode mandar o
      // próximo") + nenhum marker de domínio tentado ⇒ TOM está compondo/coletando, não afirmando
      // ação feita → veta SÓ a camada forte. Confirm-seeking (Bianca) não casa contentSolicitation.
      contentSolicitation: isContentSolicitationReply(reply),
      markerAttempted: !!_metrics.marker_attempted,
      awaitingConfirm: !!_metrics.awaiting_user_confirm,
      // CHOKEPOINT-PROGRESS-FALSEFIRE (01/08, caso Alf): "To fazendo, Tom" respondendo à
      // cobrança é STATUS, não confirmação de ação — não há o que persistir, então a camada
      // FRACA não pode ler a cordialidade do TOM como mentira. stripReplyScaffold é obrigatório:
      // a resposta vem com a citação da própria cobrança ("Resolve hoje ou reagenda?") embutida,
      // e sem limpar o regex leria o texto do TOM em vez da fala da pessoa.
      userProgressStatus: isProgressStatusReply(stripReplyScaffold(String(text || '')).userText),
      restatesRecentWrite: _restatesRecentWrite,
    }, { meta: true });
    // CHOKEPOINT-APAGA-A-PROPRIA-EVIDENCIA (19/08) — este é O ponto que cega o maior cluster do
    // acervo. O raw_excerpt guardava o texto JÁ rebaixado ("_não consegui registrar isso agora_"),
    // que é sempre a MESMA string: o log provava que o guard disparou, nunca POR QUÊ. Guardar a
    // afirmação original é o que torna os 23 achados de "não consegui registrar" auditáveis —
    // dá pra separar guard certo (o TOM ia mentir) de guard errado (falso-positivo do próprio
    // guard, como foi o CHOKEPOINT-NEGA-ESCRITA-RECENTE do Dudu).
    const _origHon = String(reply).slice(0, 300);
    reply = _hon.reply;
    if (_hon.fired) {
      try { await logMarker(collab.id, 'CHOKEPOINT', 'redirected', `confab:${_domainOf(_metrics)}`, _origHon); } catch (_) {}
    }
  } catch (e) {
    // Liveness (Fatia 0): NUNCA engolir. Trava quebrada (ex.: ReferenceError) vira métrica
    // guard_error + erro no log — não silêncio. É o que faltou no CONFAB-CHOKEPOINT-SCOPE.
    console.error('[ConfabGuard] FALHOU (trava pode estar morta):', e.message, e.stack);
    try { await logMarker(collab.id, 'CHOKEPOINT', 'rejected', `guard_error:${String(e.message).slice(0, 80)}`, null); } catch (_) {}
  }

  // CAMINHO 2 / FATIA 0 — velocímetro do DERROTISMO (linha SEPARADA do confab; provisório,
  // vira preciso na Fatia 1 com o resolver). Só MEDE aqui (não altera o reply). result='skipped'
  // (detectou, não agiu nesta fatia); reason='derrotismo_suspect:<dom>'.
  try {
    if (reply && typeof reply === 'string') {
      const { detectDefeatism } = require('./finance/derrotismo-detect');
      const _def = detectDefeatism(reply, { actionableIntent: !!_metrics.actionable_intent, markerEmitted: !!_metrics.marker_emitted });
      if (_def.suspect) {
        try { await logMarker(collab.id, 'CHOKEPOINT', 'skipped', `derrotismo_suspect:${_domainOf(_metrics)}`, String(_def.phrase || '').slice(0, 120)); } catch (_) {}
      }
    }
  } catch (e) { console.warn('[DerrotismoWatch] non-fatal:', e.message); }

  // CONFAB-PARTIAL-LEAK (Fase 0) — instrumento OBSERVE-ONLY REMOVIDO em 16/07, gate fechado.
  // Rodou 26/06→16/07 (20 dias) e observou 6 coexistências rejeitado×executado:
  //   5 FALSOS POSITIVOS (reply pedia dado / perguntava / já trazia disclaimer honesto /
  //   descrevia o marker EXECUTADO) → precisão ~17%, puro ruído.
  //   1 VAZAMENTO GENUÍNO (Yuri 14/07 01:40: "John vai receber o lembrete de dar check" —
  //   TASK_UPDATE executou e o John recebeu SÓ a notificação da tarefa; o recado era o
  //   COORDINATION_REQUEST, rejected schema_invalid). MAS a causa disso era o
  //   COORD-REQUEST-TONAME-ALIAS (parser não lia to_name), corrigido 12h depois, em
  //   14/07 14:06 — e desde o fix: ZERO observações. Ou seja, o único vazamento tinha
  //   causa conhecida e já eliminada; a Fase 1 (léxico por domínio) seria especulativa,
  //   contra precision-first. Decisão: fechar "observada, desnecessária" (OK do Alf 16/07).
  // A tabela confab_partial_observations foi MANTIDA (6 linhas, custo zero) como evidência
  // da decisão — dropar é irreversível e não ganha nada. Se a falha parcial voltar a vazar
  // (rejeitado + executado no mesmo turno, com o reply afirmando o rejeitado), o caminho é
  // reabrir a Fase 1 com alvo estreito, não ressuscitar este observador de 17% de precisão.

  // SYNC-EXCUSE-CONFAB — rede determinística: remove "delay de sincronização"/desculpa
  // técnica inventada pra justificar atrasada (banco é ao vivo; só fatura sincroniza).
  // Roda junto da Camada 1 (antes da voz E do texto). Caso Matheus 22/06.
  try {
    const _beforeSync = reply;
    reply = enforceNoSyncExcuse(reply);
    if (reply !== _beforeSync) console.log('[SYNC_EXCUSE_STRIPPED] removeu desculpa de sincronização do reply');
  } catch (e) { console.warn('[SyncExcuseGuard] non-fatal:', e.message); }

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
            // Histórico fiel: o áudio inteiro (shouldSendVoice já capa reply em 600 chars).
            // O slice(0,200) antigo perdia o final e o auditor lia como "áudio cortado".
            await logConversation(collab.id, 'outbound', `[áudio TOM: ${ttsText}]`);
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
    const _sent = await whatsapp.sendMessage(phone, reply);

    // ===================== FRONTEIRA DE ENTREGA =====================
    // Daqui pra baixo a mensagem JÁ ESTÁ no WhatsApp do colaborador. Nada nesta seção
    // pode lançar, reenviar ou pedir retry: registro faltando é problema de
    // contabilidade; mensagem duplicada é dano visível pra pessoa. Toda falha após a
    // entrega vira telemetria e o turno segue.
    let _waId = null;
    try { _waId = extractSentMessageId(_sent); } catch (_) { _waId = null; }

    try {
      await logConversation(collab.id, 'outbound', reply, _waId);
    } catch (e) {
      console.error('[Outbound] histórico falhou APÓS entrega (NÃO reenvia):', e.message);
    }

    // O registro no ledger saiu daqui: agora acontece dentro do whatsapp.sendMessage,
    // que é o ponto por onde passam TODAS as saídas — inclusive os early-returns de ramo
    // e os avisos a terceiros, que este bloco (só o reply final) nunca alcançaria.
    // Fonte única: ver services/turn-claim.js.
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

async function sendRitual(collaboratorId, ritualType, opts = {}) {
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
  let { systemPrompt, ctx } = await buildSystemPrompt(collab);
  console.log(`[Engine] ritual=${ritualType} system prompt size: ${systemPrompt.length} chars`);

  // FECHAMENTO-ITEM-NO-ANCHOR (caso Yuri 09/06): ancora as "3 coisas" do fechamento por
  // ITEM. Computa a lista numerada determinística (engine), injeta no prompt pra o LLM
  // usar EXATAMENTE essa numeração, e abre a intent ancorada (payload.closing.items) logo
  // após o envio — assim a resposta "1" mapeia pro id certo, sem o LLM chutar alvo.
  let _closingItems = [];
  if (ritualKey === 'fechamento') {
    try {
      // Balde A (audit 19/06): o fechamento é do DIA — não cobra tarefa de amanhã (caso
      // Quintela). Mantém atrasadas (due < hoje) + hoje; corta futuras (due > hoje). Sem
      // due_date entra (tarefa sem prazo pode ser fechada). O dedup por série já veio do ctx.
      const _todayYmd = todaySaoPaulo();
      const _closingPool = (ctx && Array.isArray(ctx.workTasks) ? ctx.workTasks : [])
        .filter((t) => isVisibleForDay(t, _todayYmd)); // BRIEFING-FUTURE-TASK-AS-TODAY: predicado único (cutoff=hoje no fechamento)
      _closingItems = buildClosingItems(_closingPool, { today: _todayYmd });
    } catch (e) { console.warn('[Closing] buildClosingItems err:', e.message); }
    if (_closingItems.length) {
      const lista = _closingItems.map((it) => `${it.index}. ${it.title}`).join('\n');
      systemPrompt += `\n\n---\n\n### 🔢 ITENS DO FECHAMENTO (USE EXATAMENTE esta numeração e títulos)\n${lista}\n\nAo perguntar "fez?", liste estas ${_closingItems.length} tarefa(s) com EXATAMENTE estes números e títulos. Não reordene, não renumere, não invente outras. Eventos (🗓️) seguem as regras de ✅/rolou à parte, FORA desta numeração.`;
    }
  }

  const directive = ritualToDirective(ritualType);
  const response = await ai.chat(systemPrompt, [{ role: 'user', content: directive }]);

  // Contas NÃO entram mais no briefing — saem no digest financeiro consolidado, enviado
  // logo depois pelo dispatcher (sendFinanceDigest). Spec: docs/superpowers/specs/2026-06-08-digest-financeiro-matinal-design.md
  let finalText = response.text;

  await whatsapp.sendMessage(collab.phone, finalText);
  await logConversation(collab.id, 'outbound', finalText);

  // FECHAMENTO-ITEM-NO-ANCHOR: abre UMA intent ancorada com os itens numerados. A
  // resposta numérica do usuário ("1", "1 e 2", "1 - em andamento") é resolvida pelo
  // engine contra estes ids (parseClosingReply), sem o LLM chutar alvo concorrente.
  if (ritualKey === 'fechamento' && _closingItems.length) {
    try {
      await pendingIntents.openIntent(
        collab.id,
        'confirmation',
        { action: 'complete', closing: { ref_date: todaySaoPaulo(), items: _closingItems } },
        finalText.slice(0, 500)
      );
    } catch (e) { console.warn('[Closing] openIntent err:', e.message); }
  }

  const today = todaySaoPaulo();
  // Fatia G (RITUAL-NO-RETRY): quando chamado pelo dispatcher.fireRitual, o claim
  // atômico (índice ritual_logs_sent_daily_uq) JÁ gravou a linha 'sent' ANTES do
  // envio — opts.skipLog evita a 2ª escrita (que colidiria 23505 no índice e
  // duplicaria a linha). Chamadores diretos (rituais mensais) NÃO passam skipLog e
  // continuam gravando aqui. Erro do insert agora é logado (antes era descartado).
  if (!opts.skipLog) {
    const { error: logErr } = await supabase.from('ritual_logs').insert({
      collaborator_id: collaboratorId,
      ritual_type: ritualType,
      reference_date: today,
      status: 'sent',
      sent_at: new Date().toISOString(),
    });
    if (logErr) console.error(`[Ritual] ritual_logs insert err (${ritualType}):`, logErr.message);
  }
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

// BUG-11 (11/06): start_at no DB é UTC — slice(0,10) dá a data UTC, que pode ser 1 dia à
// frente após 21h BRT. Usar brtDateOf() para extrair o dia em horário de Brasília.
function brtDateOf(isoStr) {
  if (!isoStr) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date(isoStr));
}

// waMessageId (opcional): id real da mensagem no WhatsApp. Nos outbounds ele é o que
// torna a resposta CITÁVEL — o reply-quote procura o outbound por esse id exato
// (engine.js ~9800). Parâmetro opcional de propósito: os 100+ call sites que não passam
// continuam idênticos ao que eram.
async function logConversation(collaboratorId, direction, content, waMessageId = null) {
  const row = {
    collaborator_id: collaboratorId,
    direction,
    message_type: 'text',
    content,
  };
  if (waMessageId) row.whatsapp_message_id = waMessageId;
  // MEDIA-IMG-CONTEXT-LOST (Rose 11/06): a análise de imagem/vídeo/PDF é injetada no
  // `content` da inbound pelo webhook, mas `media_extracted_text` ficava NULL — então a
  // análise sumia quando a msg saía da janela de 5 do contexto reconstruído. Persiste a
  // análise no campo dedicado pra que o system prompt possa repiná-la (renderRecentMediaBlock).
  if (direction === 'inbound') {
    try {
      const media = extractMediaAnalysis(content);
      if (media) {
        row.media_type = media.media_type;
        row.media_extracted_text = media.media_extracted_text;
      }
    } catch (_) { /* nunca quebra o log */ }
  }
  await supabase.from('conversation_history').insert(row);
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

async function handleShopAction(shop, collab, userName, outcome = {}) {
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
    outcome.persisted = true; // Fatia C: venda gravada via RPC

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
    outcome.persisted = true; // Fatia C: entrada de estoque gravada
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
    outcome.persisted = true; // Fatia C: ajuste de estoque gravado
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
    outcome.persisted = true; // Fatia C: estorno gravado
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
    outcome.persisted = true; // Fatia C: reserva gravada
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
    outcome.persisted = true; // Fatia C: pendência de inventário gravada

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

module.exports = { processMessage, sendRitual, sendCoordinatorReport, buildTeamSummary, buildWeeklyRetrospective, parseOnboardingMarker, persistOnboarding, parseMemoryMarker, parseProjectMarker, parseTaskUpdateMarker, parseEventUpdateMarker, parseWeeklyPlanMarker, parseHabitMarker, parseDndMarker, parsePrefsMarker, parseDataClassifyMarker, applyDataClassify, persistMemoryRows, persistProject, applyTaskActions, applyWeeklyPlan, applyHabitActions, applyDnd, getDndState, consolidateMemoryFor, decayExpiredMemories, generateWeeklySummaryFor, updateCollaboratorProfile, looksLikeMemory, resolveTaskByShortId, applyEventUpdates, applyRsvp, applyPersonalListActions, applyAnnouncementAction, parseAnnouncementApprovalMarker, applyAnnouncementApproval, applyCoordinationRequestAction, parseCoordinationResponseMarker, applyCoordinationResponseAction, computeProgress, getRitualIntroDecision, countRecentRelaysToRecipient, buildRelayLimitHint, parseMonthlyPlanMarker, applyMonthlyPlan, handleFinanceAction, parseFinanceMarkers,
  // Fase 3 chat de grupo — parsers/appliers de trabalho reusados no chat (auditados send-free;
  // applyEventActions gateia o único send via opts.suppressNotify). WhatsApp inalterado.
  parseEventCreateMarker, applyEventActions, parseCheckpointBatchMarker, applyCheckpointBatch,
  parseChecklistActionMarker, applyChecklistAction,
  tryDupBypass };
