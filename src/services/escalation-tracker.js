// src/services/escalation-tracker.js — Sprint 29.1
//
// Por que existe: hoje, se Alf cobra a mesma task via TOM 10 vezes e nada
// acontece, TOM continua cobrando do mesmo jeito. Repetir não escala — escala
// mudar de tática. Aqui rastreamos o contador e sugerimos passo seguinte:
//   1-2x: cobra normal.
//   3x:   "já cobrei 3x, mudo de abordagem?" (sugere 1:1 ou ligar)
//   5x+:  "5+ cobranças sem efeito — recomendo 1:1 30min hoje. Marco?"
//
// O contador é incrementado em applyCoordinationRequestAction quando o pedido
// gera notificação real. Resetado quando task fecha (status=done) — engine
// limpa via update.

const supabase = require('../supabase/client');

/**
 * Lê estado atual de escalada da task.
 */
async function getEscalationState(taskId) {
  if (!taskId) return null;
  const { data: task } = await supabase
    .from('tasks')
    .select('coordination_request_count, status, title')
    .eq('id', taskId)
    .maybeSingle();
  if (!task) return null;
  return {
    requestCount: task.coordination_request_count || 0,
    stuck: (task.coordination_request_count || 0) >= 3 && task.status !== 'done',
    title: task.title,
  };
}

/**
 * Incrementa contador. Retorna novo valor.
 */
async function incrementRequestCount(taskId) {
  if (!taskId) return 0;
  const { data: cur } = await supabase
    .from('tasks')
    .select('coordination_request_count')
    .eq('id', taskId)
    .maybeSingle();
  const next = (cur?.coordination_request_count || 0) + 1;
  await supabase
    .from('tasks')
    .update({ coordination_request_count: next })
    .eq('id', taskId);
  return next;
}

/**
 * Gera sugestão textual de mudança de tática, ou null se não aplicável.
 * Chamado APÓS incrementRequestCount com o novo count.
 */
function suggestTacticChange({ requestCount, ownerName, taskTitle }) {
  const truncTitle = String(taskTitle || '?').slice(0, 40);
  const ownerFirst = String(ownerName || 'a pessoa').split(' ')[0];
  if (requestCount === 3) {
    return `\n\n_⚠️ Já cobrei ${ownerFirst} 3x sobre "${truncTitle}" sem retorno. Quer que eu mude de abordagem? (sugiro 1:1 ou ligar)_`;
  }
  if (requestCount >= 5) {
    return `\n\n_🚨 ${ownerFirst} ignorou 5+ cobranças de "${truncTitle}". Recomendo 1:1 hoje 30min. Marco no calendário?_`;
  }
  return null;
}

/**
 * Reseta contador quando task fecha (status → done). Chamado por engine após
 * applyTaskActions com action=complete bem-sucedida.
 */
async function resetOnComplete(taskId) {
  if (!taskId) return;
  await supabase
    .from('tasks')
    .update({ coordination_request_count: 0 })
    .eq('id', taskId);
}

module.exports = { getEscalationState, incrementRequestCount, suggestTacticChange, resetOnComplete };
