// src/services/pending-intents.js — Sprint 30.3
//
// Camada fina sobre a tabela `pending_intents`. Persiste perguntas em aberto
// do TOM (ex: "Crio as duas?") pra que respostas via áudio ou em turno-seguinte
// possam ser fechadas mesmo após troca de skill.
//
// Convenções de payload por kind:
//   - task_creation:   { drafts: [{ title, category?, action_type?, priority?, remind_at?, ... }] }
//   - event_creation:  { draft:  { title, start_at, end_at?, ... } }
//   - approval_pending:{ project_id, token }
//   - confirmation:    { action_summary, details? }

const supabase = require('../supabase/client');

const VALID_KINDS = new Set(['task_creation','event_creation','approval_pending','confirmation','finance_source']);
const VALID_RESOLUTIONS = new Set(['confirmed','denied','expired','superseded']);
const DEFAULT_EXPIRY_HOURS = 24;

/**
 * Abre uma intent nova. Se já existir intent aberta do mesmo kind pro mesmo
 * colaborador, marca a anterior como 'superseded' antes de inserir a nova.
 * Evita acúmulo de intents-zumbi quando TOM repergunta.
 */
async function openIntent(collaboratorId, kind, payload = {}, questionText = null) {
  if (!collaboratorId) throw new Error('collaboratorId required');
  if (!VALID_KINDS.has(kind)) throw new Error(`invalid kind: ${kind}`);

  // Supersede intents abertas do mesmo kind
  try {
    await supabase
      .from('pending_intents')
      .update({
        resolved_at: new Date().toISOString(),
        resolution: 'superseded',
        resolution_note: 'new intent of same kind opened',
      })
      .eq('collaborator_id', collaboratorId)
      .eq('kind', kind)
      .is('resolved_at', null);
  } catch (err) {
    console.warn('[PendingIntents] supersede err:', err.message);
  }

  const { data, error } = await supabase
    .from('pending_intents')
    .insert({
      collaborator_id: collaboratorId,
      kind,
      payload: payload || {},
      question_text: questionText ? String(questionText).slice(0, 1000) : null,
    })
    .select('id')
    .single();
  if (error) {
    console.error('[PendingIntents] openIntent err:', error.message);
    return null;
  }
  console.log(`[PendingIntents] opened ${kind} for ${String(collaboratorId).slice(0,8)} (${data.id.slice(0,8)})`);
  return data.id;
}

/**
 * Resolve uma intent. resolution ∈ {confirmed, denied, expired, superseded}.
 */
async function resolveIntent(intentId, resolution, note = null) {
  if (!intentId) return false;
  if (!VALID_RESOLUTIONS.has(resolution)) throw new Error(`invalid resolution: ${resolution}`);
  const { error } = await supabase
    .from('pending_intents')
    .update({
      resolved_at: new Date().toISOString(),
      resolution,
      resolution_note: note ? String(note).slice(0, 500) : null,
    })
    .eq('id', intentId)
    .is('resolved_at', null);
  if (error) {
    console.warn('[PendingIntents] resolveIntent err:', error.message);
    return false;
  }
  return true;
}

/**
 * Lista intents abertas (não resolvidas, não expiradas) deste colaborador,
 * ordenadas por mais recente primeiro. Limita a 5 pra não inchar prompt.
 */
async function listOpenIntents(collaboratorId, opts = {}) {
  if (!collaboratorId) return [];
  const limit = opts.limit || 5;
  const expiryMs = (opts.expiryHours || DEFAULT_EXPIRY_HOURS) * 3600 * 1000;
  const cutoff = new Date(Date.now() - expiryMs).toISOString();

  const { data, error } = await supabase
    .from('pending_intents')
    .select('id, kind, payload, question_text, asked_at')
    .eq('collaborator_id', collaboratorId)
    .is('resolved_at', null)
    .gte('asked_at', cutoff)
    .order('asked_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[PendingIntents] listOpenIntents err:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Marca como expired todas as intents abertas > expiryHours. Chamada por cron.
 */
async function expireOldIntents(expiryHours = DEFAULT_EXPIRY_HOURS) {
  const cutoff = new Date(Date.now() - expiryHours * 3600 * 1000).toISOString();
  // approval_pending tem janela PRÓPRIA (7 dias — F1 APROVACAO-SEM-FUNIL): aprovação
  // vive mais que 24h e o cron de 6h re-fresca. Expirar junto mataria o funil.
  const { data, error } = await supabase
    .from('pending_intents')
    .update({
      resolved_at: new Date().toISOString(),
      resolution: 'expired',
      resolution_note: `auto-expired after ${expiryHours}h`,
    })
    .is('resolved_at', null)
    .neq('kind', 'approval_pending')
    .lt('asked_at', cutoff)
    .select('id');
  if (error) {
    console.warn('[PendingIntents] expireOldIntents err:', error.message);
    return 0;
  }
  let n = (data || []).length;
  try {
    const cutoff7d = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data: dataAp } = await supabase
      .from('pending_intents')
      .update({
        resolved_at: new Date().toISOString(),
        resolution: 'expired',
        resolution_note: 'approval auto-expired after 7d',
      })
      .is('resolved_at', null)
      .eq('kind', 'approval_pending')
      .lt('asked_at', cutoff7d)
      .select('id');
    n += (dataAp || []).length;
  } catch (e) {
    console.warn('[PendingIntents] expire approvals err:', e.message);
  }
  if (n > 0) console.log(`[PendingIntents] expired ${n} intent(s)`);
  return n;
}

/**
 * Heurística leve: detecta se a REPLY do TOM contém uma pergunta de
 * confirmação que merece virar intent. Retorna { kind, drafts? } ou null.
 * Conservador — só dispara em padrões cristalinos.
 */
function detectConfirmationQuestion(reply) {
  if (typeof reply !== 'string') return null;
  const trimmed = reply.trim();
  // Padrões de "Crio?", "Posso criar?", "Crio as 2/3?", "Marco?", "Confirma?"
  const TASK_Q = /\b(crio\s+as?\s+\d|crio\s*\?|posso\s+criar|posso\s+anotar|posso\s+registrar|crio\s+pra\s+voc[eê]|deixo\s+(?:na|no)\s+(?:lista|fila|pacote)|fica\s+como\s+tarefa|adiciono\s+na\s+lista|registro\s+isso\??)\??/i;
  const EVENT_Q = /\b(marco\s*\?|marco\s+pra\s+voc[eê]|coloco\s+na\s+agenda|agendo\s+pra\s+voc[eê]|crio\s+(?:o\s+)?evento|crio\s+(?:a\s+)?reuni[ãa]o)\??/i;
  const GENERIC_CONFIRM_Q = /\b(confirma\??|posso\s+seguir\??|tudo\s+certo\??|certo\??|t[áa]\s+certo\??|fechado\??|topa\??|pode\s+ser\??|fica\s+assim\??)\b/i;

  if (TASK_Q.test(trimmed)) return { kind: 'task_creation' };
  if (EVENT_Q.test(trimmed)) return { kind: 'event_creation' };
  if (GENERIC_CONFIRM_Q.test(trimmed) && trimmed.length < 600) return { kind: 'confirmation' };
  return null;
}

/**
 * Heurística leve: detecta se a mensagem do user é uma CONFIRMAÇÃO afirmativa
 * curta ("sim", "ok", "pode", "cria", "manda ver", "fechou", "vai criando")
 * ou negativa ("não", "deixa pra lá", "esquece").
 * Retorna 'yes' | 'no' | null.
 */
function detectUserConfirmation(userText, opts = {}) {
  if (typeof userText !== 'string') return null;
  const t = userText.toLowerCase().trim();
  if (!t || t.length > 200) return null;  // só pegamos respostas curtas
  // F5 (ALVO-FUTURO, auditoria 09/06) — confirmação/negação só em resposta ESSENCIALMENTE
  // curta (≤4 palavras). "Não foi a ADM, foi a de hoje, de governança" começa com "não"
  // mas é CONTEÚDO — negava às cegas uma intent não-relacionada (caso Ana 227b8689).
  if (t.split(/\s+/).length > 4) return null;

  // Negativas primeiro (mais específicas pra evitar falso positivo)
  const NO_RE = /^(n[aã]o\b|nao\b|deixa\s+pra\s+l[aá]|esquece|cancela|n[aã]o\s+precisa|desconsidera|ainda\s+n[aã]o)/;
  if (NO_RE.test(t)) return 'no';

  // Afirmativas
  const YES_RE = /^(sim\b|s[i]m\b|ok\b|okay\b|pode\b|cria\b|cri[ae]m?\b|manda\b|manda\s+ver|fechou\b|fechado\b|beleza\b|blz\b|isso\b|isso\s+mesmo|claro\b|t[áa]\b|t[áa]\s+certo|vai\b(?!\s+dar)|vai\s+(?:criando|criar|fazendo)|bora\b|perfeito\b|exato\b|👍)/;
  if (YES_RE.test(t)) return 'yes';
  // "vai criando aí"
  if (/vai\s+criando\s+a[íi]?/i.test(userText)) return 'yes';
  // GUARD-CONFIRM-LOOP (Matheus 10/06): vocabulário de CONCLUSÃO ("já conclui",
  // "já foi feito", "feito", "fiz") — SÓ quando o chamador indica intent ancorada
  // de complete (opts.allowDone): a pergunta foi "confirma que já foi feito?" e
  // essas são as respostas literais. NUNCA entra no YES genérico — "feito" solto
  // confirmaria intent não-relacionada (família de risco do "aprovado"/APROVACAO-SEM-FUNIL).
  if (opts.allowDone) {
    const DONE_RE = /^(j[áa]\s+)?(foi\s+|t[áa]\s+|est[áa]\s+)?(conclu[ií](?:d[oa])?|fiz\b|feit[oa]\b|finalizei|finalizad[oa]|terminei|terminad[oa]|pront[oa]\b|resolvi\b|resolvid[oa]|fechei\b)/;
    if (DONE_RE.test(t)) return 'yes';
  }
  return null;
}

/* ----------------------------------------------------------------------
 * GUARD-CONFIRM-LOOP (10/06) — helpers de intent ANCORADA (payload.anchor).
 * A guarda temporal (isFutureCompletion) abre intent com {anchor:{type,id,title},
 * action:'complete'}. Estes helpers protegem o ciclo pergunta→confirmação.
 * ----------------------------------------------------------------------*/

/**
 * Há intent ABERTA com âncora criada há menos de `minutes`?
 * Usado pelo registrador genérico de fim-de-turno: se a guarda abriu âncora
 * NESTE turno, não se abre intent genérica por cima (openIntent supersede
 * same-kind e matava a âncora 0,4s depois de criada).
 */
async function hasFreshAnchoredIntent(collaboratorId, minutes = 2) {
  if (!collaboratorId) return false;
  try {
    const sinceIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('pending_intents')
      .select('id')
      .eq('collaborator_id', collaboratorId)
      .is('resolved_at', null)
      .gte('asked_at', sinceIso)
      .not('payload->anchor', 'is', null)
      .limit(1);
    if (error) { console.warn('[PendingIntents] hasFreshAnchoredIntent err:', error.message); return false; }
    return !!(data && data.length);
  } catch (e) { console.warn('[PendingIntents] hasFreshAnchoredIntent err:', e.message); return false; }
}

/**
 * A guarda JÁ perguntou sobre ESTE item (anchor.id) há menos de `minutes`?
 * Conta qualquer resolution exceto 'denied' (a âncora pode ter sido superseded —
 * o que importa é que o usuário FOI perguntado e não negou). Se sim, o complete
 * seguinte é a confirmação do usuário: a guarda deixa passar em vez de re-perguntar.
 */
async function wasAnchorAskedRecently(collaboratorId, anchorId, minutes = 20) {
  if (!collaboratorId || !anchorId) return false;
  try {
    const sinceIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('pending_intents')
      .select('id')
      .eq('collaborator_id', collaboratorId)
      .eq('kind', 'confirmation')
      .gte('asked_at', sinceIso)
      .eq('payload->anchor->>id', String(anchorId))
      .or('resolution.is.null,resolution.neq.denied')
      .limit(1);
    if (error) { console.warn('[PendingIntents] wasAnchorAskedRecently err:', error.message); return false; }
    return !!(data && data.length);
  } catch (e) { console.warn('[PendingIntents] wasAnchorAskedRecently err:', e.message); return false; }
}

/**
 * Fecha TODAS as intents abertas ancoradas neste item (pós pass-through da guarda),
 * pra não sobrar intent-zumbi depois que o complete foi aplicado.
 */
async function resolveAnchoredIntents(collaboratorId, anchorId, resolution = 'confirmed', note = null) {
  if (!collaboratorId || !anchorId) return false;
  if (!VALID_RESOLUTIONS.has(resolution)) return false;
  try {
    const { error } = await supabase
      .from('pending_intents')
      .update({
        resolved_at: new Date().toISOString(),
        resolution,
        resolution_note: note ? String(note).slice(0, 500) : null,
      })
      .eq('collaborator_id', collaboratorId)
      .eq('kind', 'confirmation')
      .is('resolved_at', null)
      .eq('payload->anchor->>id', String(anchorId));
    if (error) { console.warn('[PendingIntents] resolveAnchoredIntents err:', error.message); return false; }
    return true;
  } catch (e) { console.warn('[PendingIntents] resolveAnchoredIntents err:', e.message); return false; }
}

module.exports = {
  openIntent,
  resolveIntent,
  listOpenIntents,
  expireOldIntents,
  detectConfirmationQuestion,
  detectUserConfirmation,
  hasFreshAnchoredIntent,
  wasAnchorAskedRecently,
  resolveAnchoredIntents,
};
