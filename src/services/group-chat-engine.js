// src/services/group-chat-engine.js
// Chat de grupo Fase 3 — núcleo: monta prompt do grupo, chama IA, aplica markers de
// tarefa/projeto/evento/checkpoint/checklist no pool, grava a resposta do TOM (role='tom').
// Reusa os parsers/appliers exportados do engine. Lazy require para evitar ciclo de carga.
const ai = require('../ai/provider');
const { buildGroupChatPrompt, loadGroupChatSoul } = require('./group-chat-prompt');
const { applyGroupChatTaskActions } = require('./group-chat-tasks');

const HISTORY_LIMIT = 30;
const POOL_LIMIT = 30;

function displayName(c) {
  return (c?.preferred_name || c?.full_name || '').split(' ')[0] || 'alguém';
}

async function loadContext(supabase, groupId, senderCollabId) {
  const [{ data: group }, { data: memberRows }, { data: poolRows }, { data: histRows }, { data: senderRow }] = await Promise.all([
    supabase.from('work_groups').select('id, name, tom_chat_engaged_at, tom_chat_memory').eq('id', groupId).maybeSingle(),
    supabase.from('work_group_members').select('collaborators(full_name, preferred_name)').eq('group_id', groupId),
    supabase.from('tasks').select('title, status, due_date').eq('assigned_group_id', groupId).order('created_at', { ascending: false }).limit(POOL_LIMIT),
    supabase.from('group_chat_messages').select('role, content, media_extracted_text, sender_id, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)').eq('group_id', groupId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
    // Carrega objeto COMPLETO do remetente — appliers esperam o registro, não só o id
    supabase.from('collaborators').select('*').eq('id', senderCollabId).maybeSingle(),
  ]);

  const members = (memberRows || []).map((m) => ({ name: displayName(m.collaborators) }));
  const pool = poolRows || [];
  const history = (histRows || []).reverse().map((m) => ({
    who: m.role === 'tom' ? 'TOM' : displayName(m.sender),
    role: m.role,
    content: m.media_extracted_text ? `${m.content || ''} [mídia: ${m.media_extracted_text}]`.trim() : (m.content || ''),
  }));

  // collab = objeto completo do remetente (necessário para persistProject, applyEventActions, etc.)
  const collab = senderRow || null;

  return { group, members, pool, history, senderName: displayName(senderRow), collab };
}

async function processGroupChatMessage({ supabase, groupId, senderCollabId, text }) {
  const ctx = await loadContext(supabase, groupId, senderCollabId);
  if (!ctx.group) { console.warn(`[GroupChat] grupo ${groupId} não encontrado`); return null; }

  const systemPrompt = buildGroupChatPrompt({
    soulText: loadGroupChatSoul(),
    groupName: ctx.group.name,
    members: ctx.members,
    pool: ctx.pool,
    history: ctx.history,
    senderName: ctx.senderName,
    longTermMemory: ctx.group.tom_chat_memory,
  });

  let response;
  try {
    response = await ai.chat(systemPrompt, [{ role: 'user', content: text }]);
  } catch (err) {
    console.error(`[GroupChat] IA falhou grupo=${groupId}: ${err.message?.slice(0, 200)}`);
    return null; // não grava nada; silêncio é melhor que erro vazado no chat
  }

  let reply = response.text || '';

  // Acumula confirmações de markers — padrão da Fase 2
  const confirmLines = [];

  // ─── TASK_UPDATE (Fase 2, mantido) ───────────────────────────────────────
  const { parseTaskUpdateMarker } = require('../engine');
  const parsedTask = parseTaskUpdateMarker(reply);
  if (parsedTask && !parsedTask.malformed && Array.isArray(parsedTask.actions) && parsedTask.actions.length) {
    const { created, completed, failed } = await applyGroupChatTaskActions({
      supabase, groupId, senderCollabId, actions: parsedTask.actions,
    });
    reply = (parsedTask.cleanText || '').trim();
    if (created.length) confirmLines.push(`✅ Criei no pool: ${created.map((t) => t.title).join(', ')}`);
    if (completed.length) confirmLines.push(`✔️ Concluí: ${completed.map((t) => t.title).join(', ')}`);
    if (failed.length && !created.length && !completed.length) {
      confirmLines.push('_não consegui registrar agora — me confirma de novo?_');
    }
    console.log(`[GroupChat] task actions grupo=${groupId}: created=${created.length} completed=${completed.length} failed=${failed.length}`);
  } else if (parsedTask && parsedTask.malformed) {
    reply = (parsedTask.cleanText || reply).replace(/<<TASK_UPDATE>>[\s\S]*?<<END>>/i, '').trim();
  }

  // ─── PROJECT_CREATE ───────────────────────────────────────────────────────
  const { parseProjectMarker, persistProject } = require('../engine');
  const parsedProject = parseProjectMarker(reply);
  if (parsedProject && !parsedProject.malformed && parsedProject.project) {
    try {
      const collab = ctx.collab;
      if (collab) {
        const result = await persistProject(collab, parsedProject.project);
        reply = (parsedProject.cleanText || '').trim();
        const projName = parsedProject.project.name || 'projeto';
        if (result && !result.error) {
          confirmLines.push(`✅ Projeto "${projName}" criado.`);
        } else {
          // Motivo real do engine (ex.: gate de permissão) — não "tente de novo" genérico.
          const motivo = (result && result.userFacingReply) ? result.userFacingReply : 'não rolou agora.';
          confirmLines.push(`⚠️ Projeto "${projName}" não criado: ${motivo}`);
        }
      } else {
        reply = (parsedProject.cleanText || '').trim();
        confirmLines.push('⚠️ Não consegui identificar o colaborador para criar o projeto.');
      }
    } catch (err) {
      console.error(`[GroupChat] persistProject falhou grupo=${groupId}: ${err.message?.slice(0, 200)}`);
      reply = (parsedProject.cleanText || '').trim();
      confirmLines.push('⚠️ Erro ao criar o projeto — tente de novo.');
    }
  } else if (parsedProject && parsedProject.malformed) {
    reply = (parsedProject.cleanText || reply).replace(/<<PROJECT_CREATE>>[\s\S]*?<<END>>/i, '').trim();
    confirmLines.push('_marker de projeto malformado — não criei nada._');
  }

  // ─── EVENT_CREATE ─────────────────────────────────────────────────────────
  const { parseEventCreateMarker, applyEventActions } = require('../engine');
  const parsedEvent = parseEventCreateMarker(reply);
  if (parsedEvent && !parsedEvent.malformed && Array.isArray(parsedEvent.events) && parsedEvent.events.length) {
    try {
      const collab = ctx.collab;
      if (collab) {
        await applyEventActions(collab, parsedEvent.events, { suppressNotify: true });
        reply = (parsedEvent.cleanText || '').trim();
        confirmLines.push(`✅ Evento criado no calendário.`);
      } else {
        reply = (parsedEvent.cleanText || '').trim();
        confirmLines.push('⚠️ Não consegui identificar o colaborador para criar o evento.');
      }
    } catch (err) {
      console.error(`[GroupChat] applyEventActions falhou grupo=${groupId}: ${err.message?.slice(0, 200)}`);
      reply = (parsedEvent.cleanText || '').trim();
      confirmLines.push('⚠️ Erro ao criar o evento — tente de novo.');
    }
  } else if (parsedEvent && parsedEvent.malformed) {
    reply = (parsedEvent.cleanText || reply).replace(/<<EVENT_CREATE>>[\s\S]*?<<END>>/i, '').trim();
    confirmLines.push('_marker de evento malformado — não criei nada._');
  }

  // ─── CHECKPOINT_BATCH ─────────────────────────────────────────────────────
  const { parseCheckpointBatchMarker, applyCheckpointBatch } = require('../engine');
  const parsedCheckpoint = parseCheckpointBatchMarker(reply);
  if (parsedCheckpoint && !parsedCheckpoint.malformed) {
    try {
      const collab = ctx.collab;
      if (collab) {
        await applyCheckpointBatch(collab, parsedCheckpoint);
        reply = (parsedCheckpoint.cleanText || '').trim();
        const count = (parsedCheckpoint.items || []).length;
        confirmLines.push(`✅ ${count} checkpoint(s) criado(s).`);
      } else {
        reply = (parsedCheckpoint.cleanText || '').trim();
        confirmLines.push('⚠️ Não consegui identificar o colaborador para criar checkpoints.');
      }
    } catch (err) {
      console.error(`[GroupChat] applyCheckpointBatch falhou grupo=${groupId}: ${err.message?.slice(0, 200)}`);
      reply = (parsedCheckpoint.cleanText || '').trim();
      confirmLines.push('⚠️ Erro ao criar checkpoints — tente de novo.');
    }
  } else if (parsedCheckpoint && parsedCheckpoint.malformed) {
    reply = (parsedCheckpoint.cleanText || reply).replace(/<<CHECKPOINT_BATCH>>[\s\S]*?<<END>>/i, '').trim();
    confirmLines.push('_marker de checkpoint malformado — não criei nada._');
  }

  // ─── CHECKLIST_ACTION ─────────────────────────────────────────────────────
  const { parseChecklistActionMarker, applyChecklistAction } = require('../engine');
  const parsedChecklist = parseChecklistActionMarker(reply);
  if (parsedChecklist && !parsedChecklist.malformed) {
    try {
      const collab = ctx.collab;
      if (collab) {
        await applyChecklistAction(collab, parsedChecklist);
        reply = (parsedChecklist.cleanText || '').trim();
        confirmLines.push('✅ Checklist atualizado.');
      } else {
        reply = (parsedChecklist.cleanText || '').trim();
        confirmLines.push('⚠️ Não consegui identificar o colaborador para atualizar o checklist.');
      }
    } catch (err) {
      console.error(`[GroupChat] applyChecklistAction falhou grupo=${groupId}: ${err.message?.slice(0, 200)}`);
      reply = (parsedChecklist.cleanText || '').trim();
      confirmLines.push('⚠️ Erro ao atualizar checklist — tente de novo.');
    }
  } else if (parsedChecklist && parsedChecklist.malformed) {
    reply = (parsedChecklist.cleanText || reply).replace(/<<CHECKLIST_ACTION>>[\s\S]*?<<END>>/i, '').trim();
    confirmLines.push('_marker de checklist malformado — não atualizei nada._');
  }

  // Anexa confirmações ao reply — ANTI-MENTIRA (fala = persistência):
  // se HOUVE falha em alguma ação, NÃO confiar na prosa otimista do LLM (ele pode ter
  // dito "criei" pro que falhou). Nesse caso o status determinístico do engine é a verdade
  // e a prosa do LLM é descartada. Sem falha, mantém a prosa (warmth) + os ✅.
  if (confirmLines.length) {
    const hasFailure = confirmLines.some((l) =>
      /⚠️|não consegui|malformado|não criei|não atualizei/i.test(l));
    const head = hasFailure ? '' : reply.trim();
    reply = [head, confirmLines.join('\n')].filter(Boolean).join('\n\n').trim();
  }

  // ─── SILÊNCIO ─────────────────────────────────────────────────────────────
  // Se após strip de markers o reply for vazio ou apenas <<SILENCIO>>, retornar null sem inserir
  const replyStripped = reply.replace(/<<SILENCIO>>/gi, '').trim();
  if (!replyStripped) return null;

  // Remove a tag <<SILENCIO>> do reply antes de gravar (nos demais casos)
  reply = reply.replace(/<<SILENCIO>>/gi, '').trim();

  if (!reply.trim()) return null; // nada a dizer

  const { data: inserted, error } = await supabase.from('group_chat_messages').insert({
    group_id: groupId,
    sender_id: null,
    role: 'tom',
    kind: 'text',
    content: reply,
    channel: 'app',
  }).select('id').single();
  if (error) { console.error(`[GroupChat] falha ao gravar resposta TOM: ${error.message}`); return null; }

  return inserted;
}

module.exports = { processGroupChatMessage, loadContext };
