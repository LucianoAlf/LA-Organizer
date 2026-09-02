"use strict";
// group-task-reminder.js — para onde vai o lembrete de HORA MARCADA de uma tarefa de GRUPO.
//
// GROUP-REMINDAT-IGNORADO (Clayton, Recreio 02/09): ele pediu 5 lembretes de assinatura em
// horários exatos, o TOM respondeu "criei os lembretes" e as 5 tarefas nasceram certas — mas
// NENHUM caminho dispararia na hora: `remindPendingTasks` exclui tarefa de grupo por
// construção, `remindGroupTasks` só roda 1x/dia e olha "vence amanhã", e o fan-out de
// `task_reminders` morria num `if (!ids.length) return` quando a leva só tinha tarefa de
// grupo (assigned_to é NULL no pool). Promessa sem caminho.
//
// DECISÃO DO ALF (02/09): em grupo VINCULADO ao WhatsApp o lembrete é UMA mensagem no grupo —
// o bridge-out espelha, todo mundo vê, e quem pegar avisa ali mesmo. Grupo SEM vínculo mantém
// o fan-out por DM que já existia: zero regressão pra quem só usa o app.

function destinoDoLembrete(group) {
  return group && group.wa_group_jid ? 'grupo' : 'dm';
}

/**
 * Entrega o lembrete e devolve o que REALMENTE aconteceu. Nunca conta envio que falhou —
 * quem chama usa `enviados` pra decidir se houve entrega, e mentir aqui vira "lembrei"
 * sem lembrete.
 */
async function enviarLembreteDeGrupo({ supabase, task, texto, deps = {} }) {
  const { membros = [], isQuietNow, sendAndLink } = deps;
  const groupId = task && task.assigned_group_id;
  if (!groupId) return { destino: 'nenhum', enviados: 0, erro: 'sem_grupo' };

  const { data: group } = await supabase
    .from('work_groups').select('id, name, wa_group_jid').eq('id', groupId).maybeSingle();

  const destino = destinoDoLembrete(group);

  if (destino === 'grupo') {
    const { error } = await supabase.from('group_chat_messages').insert({
      group_id: groupId, sender_id: null, role: 'tom', kind: 'text',
      content: texto, channel: 'app',
    });
    if (error) return { destino, enviados: 0, erro: error.message };
    return { destino, enviados: 1 };
  }

  let enviados = 0;
  for (const m of membros) {
    try {
      if (isQuietNow) {
        const q = await isQuietNow(m.collaborator_id);
        if (q && q.quiet) continue;
      }
      await sendAndLink(supabase, {
        phone: m.phone, content: texto, collaboratorId: m.collaborator_id,
        refType: 'task', refId: task.id,
      });
      enviados++;
    } catch (e) {
      console.error('[TaskReminders] group DM err:', e.message);
    }
  }
  return { destino, enviados, membros: membros.length };
}

module.exports = { destinoDoLembrete, enviarLembreteDeGrupo };
