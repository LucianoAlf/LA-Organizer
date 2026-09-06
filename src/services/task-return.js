// src/services/task-return.js
// Chokepoint único da "volta" da delegação: conclusão + devolutiva → círculo da tarefa.
// Círculo = delegador (governance_owner_id → created_by) + executor (assigned_to) + watchers.
// Toda devolutiva vai pro círculo MENOS o autor (dedup). O delegador sempre recebe.
// Anti-confab: kind='completion' só notifica se o banco confirma status='done'.

function resolveCircleRecipients({ delegatorId, executorId, watcherIds = [], authorId }) {
  const set = new Set();
  if (delegatorId) set.add(delegatorId);
  if (executorId) set.add(executorId);
  for (const w of watcherIds) if (w) set.add(w);
  if (authorId) set.delete(authorId);
  return [...set];
}

function firstName(c) {
  return (c?.preferred_name || (c?.full_name || '').split(' ')[0] || '').trim();
}

function buildReturnMessage({ kind, recipientRole, recipientName, actorName, title, note }) {
  const t = String(title || '').slice(0, 80);
  const noteLine = note ? `\n💬 Devolutiva: _"${String(note).slice(0, 400)}"_` : '';
  if (kind === 'completion') {
    const frame = recipientRole === 'delegator' ? 'que você pediu' : 'que você acompanha';
    return `✅ ${recipientName}, o ${actorName} concluiu a tarefa ${frame}:\n_"${t}"_${noteLine}`;
  }
  // kind === 'return' (devolutiva avulsa) — sempre tem nota
  return `💬 ${recipientName}, o ${actorName} deixou um retorno em _"${t}"_:\n_"${String(note || '').slice(0, 400)}"_`;
}

// COORD-HONESTY-CEGO-A-DEVOLUTIVA (Rafinha 04/09): notifyTaskReturn entrega por
// whatsapp.sendMessage + conversation_history e NÃO escreve em coordination_requests, então o
// veto de enforceSendHonesty ficava cego a este canal e o TOM negava entrega feita. Como o
// template de buildReturnMessage é determinístico, o próprio outbound serve de recibo: as
// assinaturas abaixo casam o texto entregue com o ATOR (quem mandou), nunca com o destinatário.
function returnBroadcastSignatures(actorName) {
  const a = String(actorName || '').trim();
  if (!a) return [];
  return [`, o ${a} deixou um retorno em `, `, o ${a} concluiu a tarefa `];
}

function isTaskReturnBroadcast(text, actorName) {
  const s = String(text || '');
  const sigs = returnBroadcastSignatures(actorName);
  return sigs.some((sig) => s.includes(sig));
}

// Grava a devolutiva no histórico da tarefa (task_comments). No-op se não houver nota.
async function saveReturnComment({ supabase, taskId, authorId, note }) {
  if (!note || !String(note).trim()) return;
  // LER O `error` NAO E OPCIONAL (06/09). O insert do PostgREST nao lanca: devolve {error}. Com
  // so o try/catch, o banco recusou 'return' no CHECK de comment_type desde que esta funcao
  // existe — 1.236 linhas na tabela, TODAS 'agent_note', ZERO devolutiva na historia inteira — e
  // ninguem soube, porque o catch nunca foi acionado. A devolutiva chegava no WhatsApp e nao
  // ficava registrada na tarefa. A constraint foi corrigida por migration
  // (task_comments_aceita_return); isto aqui e o sensor que impede a proxima recusa de ser muda.
  try {
    const { error } = await supabase.from('task_comments').insert({
      task_id: taskId,
      content: String(note).trim().slice(0, 2000),
      comment_type: 'return',
      created_by: authorId || null,
    });
    if (error) console.warn('[task-return] saveComment recusado pelo banco (nao-fatal):', error.message);
  } catch (e) {
    console.warn('[task-return] saveComment err (non-fatal):', e.message);
  }
}

// Broadcast da volta pro círculo (menos o autor). Retorna { sent }.
async function notifyTaskReturn({ supabase, whatsapp, taskId, actorId, kind, note = null }) {
  const { data: task } = await supabase.from('tasks')
    .select('id, title, status, created_by, assigned_to, governance_owner_id')
    .eq('id', taskId).maybeSingle();
  if (!task) return { sent: 0 };
  if (kind === 'completion' && task.status !== 'done') return { sent: 0 }; // anti-confab
  const delegatorId = task.governance_owner_id || task.created_by;
  const executorId = task.assigned_to;
  if (!delegatorId || !executorId || delegatorId === executorId) return { sent: 0 }; // não delegada

  const { data: ws } = await supabase.from('task_watchers').select('collaborator_id').eq('task_id', taskId);
  const watcherIds = (ws || []).map(w => w.collaborator_id);
  const recipients = resolveCircleRecipients({ delegatorId, executorId, watcherIds, authorId: actorId });
  if (!recipients.length) return { sent: 0 };

  const ids = [...new Set([actorId, ...recipients])].filter(Boolean);
  const { data: people } = await supabase.from('collaborators')
    .select('id, full_name, preferred_name, phone, is_active').in('id', ids);
  const byId = new Map((people || []).map(p => [p.id, p]));
  const actorName = firstName(byId.get(actorId)) || 'alguém';

  let sent = 0;
  for (const rid of recipients) {
    const c = byId.get(rid);
    if (!c || !c.is_active || !c.phone) continue;
    const recipientRole = rid === delegatorId ? 'delegator' : (rid === executorId ? 'executor' : 'watcher');
    const msg = buildReturnMessage({ kind, recipientRole, recipientName: firstName(c), actorName, title: task.title, note });
    try {
      // quiet-exempt: devolutiva/conclusão é notificação REATIVA a uma ação explícita do
      // usuário numa delegação ativa (não é envio proativo agendado tipo ritual); o status
      // também fica visível no app. Gating por quiet-hours do destinatário = follow-up.
      await whatsapp.sendMessage(c.phone, msg);
      await supabase.from('conversation_history').insert({
        collaborator_id: c.id, direction: 'outbound', message_type: 'text', content: msg,
      });
      sent++;
    } catch (e) {
      console.warn('[task-return] send err (non-fatal):', e.message);
    }
  }
  console.log(`[task-return] ${kind} task=${String(taskId).slice(0, 8)} author=${String(actorId || '').slice(0, 8)} sent=${sent}`);
  return { sent };
}

module.exports = { resolveCircleRecipients, buildReturnMessage, returnBroadcastSignatures, isTaskReturnBroadcast, saveReturnComment, notifyTaskReturn };
