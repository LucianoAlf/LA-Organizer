// src/services/data-classifier.js — Sprint 29.1
//
// Por que existe: sem classificação, a lista de governança matinal vira ruído.
// Itens de teste, prototipagem e demos vão pro mesmo bolo de "time enrolando".
// Aqui Alf pode dizer "Tom, isso é teste" e:
//   1. A task fica marcada como `data_classification='test'`.
//   2. TOM aprende um padrão (ex: title começa com "demo_") e auto-classifica
//      próximas inserções com mesmo padrão.
//
// Os padrões só viram automáticos após `hits >= 2` pra evitar over-fitting de
// 1 caso pontual.

const supabase = require('../supabase/client');

/**
 * Aplica classificação em 1 task ou event.
 * @param {Object} opts
 * @param {string} opts.collaboratorId — quem está classificando (pra aprender padrão personalizado)
 * @param {'tasks'|'events'} opts.targetType
 * @param {string} opts.targetId
 * @param {'real'|'test'|'archived'} opts.classification
 * @param {boolean} [opts.learnPattern=false] — se true E classification='test', tenta aprender padrão
 * @returns {Promise<{ok:boolean, reason?:string, error?:string, patternLearned?:{type,value,hits}}>}
 */
async function applyClassification({ collaboratorId, targetType, targetId, classification, learnPattern = false }) {
  if (!['tasks', 'events'].includes(targetType)) {
    return { ok: false, reason: 'bad_targetType' };
  }
  if (!['real', 'test', 'archived'].includes(classification)) {
    return { ok: false, reason: 'bad_classification' };
  }

  const { data: row, error: readErr } = await supabase
    .from(targetType)
    .select('id, title, created_at, created_by')
    .eq('id', targetId)
    .maybeSingle();
  if (readErr) return { ok: false, reason: 'read_failed', error: readErr.message };
  if (!row) return { ok: false, reason: 'target_not_found' };

  const { error: upErr } = await supabase
    .from(targetType)
    .update({ data_classification: classification })
    .eq('id', targetId);
  if (upErr) return { ok: false, reason: 'update_failed', error: upErr.message };

  let patternLearned = null;
  if (learnPattern && classification === 'test' && row.title && collaboratorId) {
    patternLearned = await _learnPatternFromTitle(collaboratorId, row.title);
  }
  return { ok: true, patternLearned };
}

/**
 * Aprende padrão de title_contains a partir do título. Conservador:
 *   - precisa título com 4+ chars
 *   - usa primeiros 20 chars como substring distintiva
 *   - reusa padrão existente (incrementa hits) ou cria novo com confidence=0.5
 */
async function _learnPatternFromTitle(collaboratorId, title) {
  const distinctive = title.length >= 4
    ? title.slice(0, Math.min(20, title.length)).toLowerCase().trim()
    : null;
  if (!distinctive) return null;

  const { data: existing } = await supabase
    .from('task_classifications')
    .select('id, hits')
    .eq('collaborator_id', collaboratorId)
    .eq('pattern_type', 'title_contains')
    .eq('pattern_value', distinctive)
    .eq('classification', 'test')
    .maybeSingle();

  if (existing) {
    const nextHits = (existing.hits || 0) + 1;
    await supabase
      .from('task_classifications')
      .update({ hits: nextHits, last_applied_at: new Date().toISOString() })
      .eq('id', existing.id);
    return { type: 'title_contains', value: distinctive, hits: nextHits };
  }

  await supabase.from('task_classifications').insert({
    collaborator_id: collaboratorId,
    pattern_type: 'title_contains',
    pattern_value: distinctive,
    classification: 'test',
    source: 'manual',
    confidence: 0.5,
    hits: 1,
  });
  return { type: 'title_contains', value: distinctive, hits: 1 };
}

/**
 * Tenta auto-classificar uma task recém-criada baseada em padrões aprendidos
 * GLOBAIS (hits >= 2, qualquer collaborator_id). Chamado opcionalmente após
 * applyTaskActions/insert de task pra triagem precoce.
 * @param {Object} opts
 * @param {string} opts.taskId
 * @param {string} opts.title
 * @returns {Promise<{applied:boolean, pattern?:Object}>}
 */
async function autoClassifyNewTask({ taskId, title }) {
  if (!title || !taskId) return { applied: false };
  const lowered = title.toLowerCase();

  const { data: patterns } = await supabase
    .from('task_classifications')
    .select('id, pattern_type, pattern_value, classification, hits')
    .eq('classification', 'test')
    .gte('hits', 2)
    .order('hits', { ascending: false })
    .limit(50);

  if (!patterns || patterns.length === 0) return { applied: false };

  for (const p of patterns) {
    let match = false;
    if (p.pattern_type === 'title_contains') match = lowered.includes(p.pattern_value);
    else if (p.pattern_type === 'title_starts_with') match = lowered.startsWith(p.pattern_value);
    if (match) {
      await supabase.from('tasks').update({ data_classification: p.classification }).eq('id', taskId);
      await supabase
        .from('task_classifications')
        .update({ hits: (p.hits || 0) + 1, last_applied_at: new Date().toISOString() })
        .eq('id', p.id);
      console.log(`[data-classifier] auto-classified task ${taskId} as ${p.classification} via pattern "${p.pattern_value}"`);
      return { applied: true, pattern: p };
    }
  }
  return { applied: false };
}

module.exports = { applyClassification, autoClassifyNewTask };
