// src/services/group-chat-engine.js
// Chat de grupo Fase 2 — núcleo: monta prompt do grupo, chama IA, aplica markers de
// tarefa no pool, grava a resposta do TOM (role='tom'). Reusa o parser exportado do engine.
const ai = require('../ai/provider');
const { buildGroupChatPrompt, loadGroupChatSoul } = require('./group-chat-prompt');
const { applyGroupChatTaskActions } = require('./group-chat-tasks');

const HISTORY_LIMIT = 20;
const POOL_LIMIT = 30;

function displayName(c) {
  return (c?.preferred_name || c?.full_name || '').split(' ')[0] || 'alguém';
}

async function loadContext(supabase, groupId, senderCollabId) {
  const [{ data: group }, { data: memberRows }, { data: poolRows }, { data: histRows }, { data: sender }] = await Promise.all([
    supabase.from('work_groups').select('id, name, tom_chat_engaged_at').eq('id', groupId).maybeSingle(),
    supabase.from('work_group_members').select('collaborators(full_name, preferred_name)').eq('group_id', groupId),
    supabase.from('tasks').select('title, status, due_date').eq('assigned_group_id', groupId).order('created_at', { ascending: false }).limit(POOL_LIMIT),
    supabase.from('group_chat_messages').select('role, content, media_extracted_text, sender_id, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)').eq('group_id', groupId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
    supabase.from('collaborators').select('full_name, preferred_name').eq('id', senderCollabId).maybeSingle(),
  ]);

  const members = (memberRows || []).map((m) => ({ name: displayName(m.collaborators) }));
  const pool = poolRows || [];
  const history = (histRows || []).reverse().map((m) => ({
    who: m.role === 'tom' ? 'TOM' : displayName(m.sender),
    role: m.role,
    content: m.media_extracted_text ? `${m.content || ''} [mídia: ${m.media_extracted_text}]`.trim() : (m.content || ''),
  }));

  return { group, members, pool, history, senderName: displayName(sender) };
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
  });

  let response;
  try {
    response = await ai.chat(systemPrompt, [{ role: 'user', content: text }]);
  } catch (err) {
    console.error(`[GroupChat] IA falhou grupo=${groupId}: ${err.message?.slice(0, 200)}`);
    return null; // não grava nada; silêncio é melhor que erro vazado no chat
  }

  let reply = response.text || '';

  // Parser de marker reusado do engine (exportado). LAZY para evitar ciclo de require na carga.
  const { parseTaskUpdateMarker } = require('../engine');
  const parsed = parseTaskUpdateMarker(reply);
  if (parsed && !parsed.malformed && Array.isArray(parsed.actions) && parsed.actions.length) {
    const { created, completed, failed } = await applyGroupChatTaskActions({
      supabase, groupId, senderCollabId, actions: parsed.actions,
    });
    reply = (parsed.cleanText || '').trim();
    const lines = [];
    if (created.length) lines.push(`✅ Criei no pool: ${created.map((t) => t.title).join(', ')}`);
    if (completed.length) lines.push(`✔️ Concluí: ${completed.map((t) => t.title).join(', ')}`);
    if (failed.length && !created.length && !completed.length) {
      lines.push('_não consegui registrar agora — me confirma de novo?_');
    }
    if (lines.length) reply = (reply ? reply + '\n\n' : '') + lines.join('\n');
    console.log(`[GroupChat] task actions grupo=${groupId}: created=${created.length} completed=${completed.length} failed=${failed.length}`);
  } else if (parsed && parsed.malformed) {
    // Marker malformado: limpa o bloco, não vaza JSON cru, não confirma sucesso falso.
    reply = (parsed.cleanText || reply).replace(/<<TASK_UPDATE>>[\s\S]*?<<END>>/i, '').trim();
  }

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
