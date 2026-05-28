// src/services/pending-followups.js — Sprint 31.1
//
// Por que existe: o engine cobra eventos/tasks via mensagens de followup
// (dispatcher: checkOverdueWorkEvents, remindEventTasks, etc.). Quando o user
// responde "Feito" ou "Já fiz", o TOM precisa do (id, tipo, título) EXATO pra
// emitir TASK_UPDATE/EVENT_UPDATE válido. Antes desta tabela o TOM dependia
// 100% do LLM lembrar contexto — falhava em respostas curtas e múltiplas.
//
// Padrão arquitetural: espelha pending_intents (Sprint 30.3).
// TTL default = 6h (cobre janela do dia útil).

const supabase = require('../supabase/client');

const KINDS = ['closure_check','overdue_check','staleness_check','reminder_due_today'];
const ACTIONS = ['completed','cancelled','rescheduled','dismissed','expired','superseded'];

/**
 * Cria (ou refresca se já existe um aberto pro mesmo target+kind) pending_followup.
 * Idempotente: chamadas repetidas no mesmo dispatcher tick não duplicam.
 *
 * @returns {Promise<{id:string, refreshed:boolean}|null>}
 */
async function createOrRefresh({
  collaboratorId,
  targetType,
  targetId,
  targetTitle,
  kind,
  questionText,
  ttlHours = 6,
}) {
  if (!collaboratorId || !targetType || !targetId || !targetTitle || !kind) {
    console.warn('[pending-followups] create: missing required fields', {
      collaboratorId, targetType, targetId, targetTitle, kind,
    });
    return null;
  }
  if (!['event','task'].includes(targetType)) {
    console.warn('[pending-followups] create: invalid targetType', targetType);
    return null;
  }
  if (!KINDS.includes(kind)) {
    console.warn('[pending-followups] create: invalid kind', kind);
    return null;
  }

  // Já existe um aberto pro mesmo (collab, target, kind)? Refresh sent_at+expires_at.
  const { data: existing } = await supabase
    .from('pending_followups')
    .select('id')
    .eq('collaborator_id', collaboratorId)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('followup_kind', kind)
    .is('resolved_at', null)
    .maybeSingle();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3600_000);

  if (existing) {
    const { error } = await supabase
      .from('pending_followups')
      .update({
        sent_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        question_text: (questionText || '').slice(0, 1000),
        target_title: (targetTitle || '').slice(0, 200),
      })
      .eq('id', existing.id);
    if (error) {
      console.warn('[pending-followups] refresh err:', error.message);
      return null;
    }
    return { id: existing.id, refreshed: true };
  }

  const { data: created, error } = await supabase
    .from('pending_followups')
    .insert({
      collaborator_id: collaboratorId,
      target_type: targetType,
      target_id: targetId,
      target_title: (targetTitle || '').slice(0, 200),
      followup_kind: kind,
      question_text: (questionText || '').slice(0, 1000),
      sent_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single();
  if (error) {
    console.warn('[pending-followups] insert err:', error.message);
    return null;
  }
  return { id: created.id, refreshed: false };
}

/**
 * Lista followups ativos (não resolvidos e não expirados) de um colab,
 * ordenados do mais recente. Limita a `limit` (default 8).
 *
 * @returns {Promise<Array<{id, target_type, target_id, target_title, followup_kind, question_text, sent_at}>>}
 */
async function listActive(collaboratorId, { limit = 8 } = {}) {
  if (!collaboratorId) return [];
  const { data, error } = await supabase
    .from('pending_followups')
    .select('id, target_type, target_id, target_title, followup_kind, question_text, sent_at, expires_at')
    .eq('collaborator_id', collaboratorId)
    .is('resolved_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[pending-followups] listActive err:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Resolve UM followup específico por id.
 */
async function markResolved(id, action, via) {
  if (!id || !ACTIONS.includes(action)) return false;
  const { error } = await supabase
    .from('pending_followups')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_action: action,
      resolved_via: via || null,
    })
    .eq('id', id)
    .is('resolved_at', null);
  if (error) {
    console.warn('[pending-followups] markResolved err:', error.message);
    return false;
  }
  return true;
}

/**
 * Resolve TODOS abertos para um target específico (collab + type + id).
 * Usado pelo engine quando marker TASK_UPDATE/EVENT_UPDATE completa/cancela/reagenda,
 * e pelo subscriber realtime quando fechamento vem do PWA.
 *
 * @returns {Promise<number>} quantos foram resolvidos
 */
async function resolveByTarget({ collaboratorId, targetType, targetId, action, via }) {
  if (!collaboratorId || !targetType || !targetId || !ACTIONS.includes(action)) return 0;
  const { data, error } = await supabase
    .from('pending_followups')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_action: action,
      resolved_via: via || null,
    })
    .eq('collaborator_id', collaboratorId)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .is('resolved_at', null)
    .select('id');
  if (error) {
    console.warn('[pending-followups] resolveByTarget err:', error.message);
    return 0;
  }
  return (data || []).length;
}

/**
 * Expira (status=expired) todos com expires_at passado e ainda abertos.
 * Chamar do dispatcher (15min). Mantém a tabela limpa pro listActive.
 */
async function expireOld() {
  const { data, error } = await supabase
    .from('pending_followups')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_action: 'expired',
      resolved_via: 'ttl',
    })
    .lt('expires_at', new Date().toISOString())
    .is('resolved_at', null)
    .select('id');
  if (error) {
    console.warn('[pending-followups] expireOld err:', error.message);
    return 0;
  }
  return (data || []).length;
}

module.exports = {
  createOrRefresh,
  listActive,
  markResolved,
  resolveByTarget,
  expireOld,
  KINDS,
  ACTIONS,
};
