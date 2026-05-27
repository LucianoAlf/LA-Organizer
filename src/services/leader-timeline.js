// src/services/leader-timeline.js — Sprint 29.2
//
// Camada de acesso APPEND-ONLY à tabela leader_timeline.
// Captura eventos de governança por líder pra alimentar briefings pré-1:1
// e scorecards semanais (Sprint 3).
//
// Filosofia: nunca deleta nem edita — só acumula. Erros antigos podem virar
// commitment_broken depois (nova row); o original fica como audit.

const supabase = require('../supabase/client');

const VALID_EVENT_TYPES = new Set([
  '1on1_scheduled', '1on1_held', '1on1_skipped',
  'commitment_made', 'commitment_fulfilled', 'commitment_broken',
  'bottleneck_detected', 'decision_made', 'milestone_reached',
  'escalation_recommended', 'task_closed', 'task_overdue',
]);

/**
 * Insere evento na timeline. Falha silenciosa pra nunca quebrar pipeline.
 * @param {Object} opts
 * @param {string} opts.leaderId — collaborator_id do líder
 * @param {string} opts.eventType — um dos VALID_EVENT_TYPES
 * @param {Object} [opts.eventData] — jsonb com detalhes do evento
 * @param {'auto'|'manual'|'llm'} [opts.source='auto']
 * @param {string} [opts.relatedEventId]
 * @param {string} [opts.relatedTaskId]
 * @param {string} [opts.occurredAt] — ISO, default now()
 * @returns {Promise<string|null>} id da row inserida ou null se falha
 */
async function append({ leaderId, eventType, eventData = {}, source = 'auto', relatedEventId = null, relatedTaskId = null, occurredAt = null }) {
  if (!leaderId || !eventType) {
    console.warn('[leader-timeline] append: leaderId+eventType required');
    return null;
  }
  if (!VALID_EVENT_TYPES.has(eventType)) {
    console.warn(`[leader-timeline] append: invalid event_type=${eventType}`);
    return null;
  }
  const row = {
    leader_id: leaderId,
    event_type: eventType,
    event_data: eventData || {},
    source,
  };
  if (relatedEventId) row.related_event_id = relatedEventId;
  if (relatedTaskId) row.related_task_id = relatedTaskId;
  if (occurredAt) row.occurred_at = occurredAt;

  try {
    const { data, error } = await supabase
      .from('leader_timeline')
      .insert(row)
      .select('id')
      .single();
    if (error) {
      console.warn(`[leader-timeline] insert err type=${eventType}:`, error.message);
      return null;
    }
    return data?.id || null;
  } catch (e) {
    console.warn(`[leader-timeline] insert throw type=${eventType}:`, e.message);
    return null;
  }
}

/**
 * Eventos recentes do líder (qualquer tipo). Ordem: mais novo primeiro.
 */
async function getRecent(leaderId, { limit = 30, sinceDays = 60 } = {}) {
  if (!leaderId) return [];
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const { data, error } = await supabase
    .from('leader_timeline')
    .select('id, event_type, event_data, occurred_at, related_event_id, related_task_id, source')
    .eq('leader_id', leaderId)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn(`[leader-timeline] getRecent err leader=${leaderId}:`, error.message);
    return [];
  }
  return data || [];
}

/**
 * Última 1:1 realizada (event_type='1on1_held'). Null se nunca rolou.
 */
async function getLast1on1(leaderId) {
  if (!leaderId) return null;
  const { data } = await supabase
    .from('leader_timeline')
    .select('id, event_data, occurred_at, related_event_id')
    .eq('leader_id', leaderId)
    .eq('event_type', '1on1_held')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

/**
 * Compromissos abertos: feitos via commitment_made e que ainda não foram
 * fechados (commitment_fulfilled/broken). Dedupe por event_data.key.
 */
async function getOpenCommitments(leaderId) {
  if (!leaderId) return [];
  const [{ data: made }, { data: closed }] = await Promise.all([
    supabase.from('leader_timeline')
      .select('id, event_data, occurred_at')
      .eq('leader_id', leaderId)
      .eq('event_type', 'commitment_made')
      .order('occurred_at', { ascending: false })
      .limit(50),
    supabase.from('leader_timeline')
      .select('event_data')
      .eq('leader_id', leaderId)
      .in('event_type', ['commitment_fulfilled', 'commitment_broken'])
      .order('occurred_at', { ascending: false })
      .limit(100),
  ]);
  const closedKeys = new Set(
    (closed || []).map(c => c.event_data?.key).filter(Boolean)
  );
  return (made || []).filter(m => {
    const key = m.event_data?.key;
    return key && !closedKeys.has(key);
  });
}

/**
 * Conta eventos por tipo num período. Útil pra scorecard.
 */
async function countByType(leaderId, { sinceDays = 30 } = {}) {
  if (!leaderId) return {};
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const { data } = await supabase
    .from('leader_timeline')
    .select('event_type')
    .eq('leader_id', leaderId)
    .gte('occurred_at', since);
  const counts = {};
  for (const row of data || []) {
    counts[row.event_type] = (counts[row.event_type] || 0) + 1;
  }
  return counts;
}

module.exports = {
  append,
  getRecent,
  getLast1on1,
  getOpenCommitments,
  countByType,
  VALID_EVENT_TYPES,
};
