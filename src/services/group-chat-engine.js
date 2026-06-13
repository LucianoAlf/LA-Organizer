// src/services/group-chat-engine.js
// Chat de grupo Fase 3 — núcleo: monta prompt do grupo, chama IA, aplica TODOS os markers
// operacionais (tarefa/projeto/evento/checkpoint/checklist/anotação), grava a resposta do TOM.
// Reusa os parsers/appliers exportados do engine (lazy require para evitar ciclo de carga).
//
// Hierarquia de render: além da prosa (markdown), o engine emite um bloco ESTRUTURADO de ações
// `‹‹ACTIONS››[json]` no fim do content. O MessageBubble parseia e renderiza com ícones Lucide.
// Isso garante a quebra de linha/hierarquia (não depende de markdown) e dá a riqueza visual.
const ai = require('../ai/provider');
const { buildGroupChatPrompt, loadGroupChatSoul } = require('./group-chat-prompt');
const { applyGroupChatTaskActions } = require('./group-chat-tasks');
const { createTaskGroup, addSubtasksToGroup } = require('./task-groups');
const { buildGroupReport } = require('./group-report-builder');
const groupNotes = require('./group-notes');
const { buildBrtDateAnchor } = require('../utils/dates');

const HISTORY_LIMIT = 30;
const POOL_LIMIT = 30;
const ACTIONS_DELIM = '‹‹ACTIONS››'; // separador prosa ↔ ações estruturadas (parseado no front)

function displayName(c) {
  return (c?.preferred_name || c?.full_name || '').split(' ')[0] || 'alguém';
}

async function loadContext(supabase, groupId, senderCollabId) {
  const [{ data: group }, { data: memberRows }, { data: poolRows }, { data: histRows }, { data: senderRow }] = await Promise.all([
    supabase.from('work_groups').select('id, name, tom_chat_engaged_at, tom_chat_memory').eq('id', groupId).maybeSingle(),
    supabase.from('work_group_members').select('collaborators(full_name, preferred_name)').eq('group_id', groupId),
    supabase.from('tasks').select('title, status, due_date').eq('assigned_group_id', groupId).order('created_at', { ascending: false }).limit(POOL_LIMIT),
    supabase.from('group_chat_messages').select('role, content, media_extracted_text, sender_id, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)').eq('group_id', groupId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
    supabase.from('collaborators').select('*').eq('id', senderCollabId).maybeSingle(),
  ]);

  const members = (memberRows || []).map((m) => ({ name: displayName(m.collaborators) }));
  const pool = poolRows || [];
  const history = (histRows || []).reverse().map((m) => ({
    who: m.role === 'tom' ? 'TOM' : displayName(m.sender),
    role: m.role,
    content: m.media_extracted_text ? `${m.content || ''} [mídia: ${m.media_extracted_text}]`.trim() : (m.content || ''),
  }));

  return { group, members, pool, history, senderName: displayName(senderRow), collab: senderRow || null };
}

async function processGroupChatMessage({ supabase, groupId, senderCollabId, text }) {
  const ctx = await loadContext(supabase, groupId, senderCollabId);
  if (!ctx.group) { console.warn(`[GroupChat] grupo ${groupId} não encontrado`); return null; }

  let notesCtx = '';
  try { notesCtx = await groupNotes.groupNotesContext({ supabase, groupId }); } catch (_) { notesCtx = ''; }

  // Senha sob demanda: se a mensagem pede credencial, acha a ficha que casa, decifra e injeta só ela.
  let credCtx = '';
  try { credCtx = await groupNotes.credentialLookupContext({ supabase, groupId, text }); } catch (_) { credCtx = ''; }

  const systemPrompt = buildGroupChatPrompt({
    soulText: loadGroupChatSoul(),
    groupName: ctx.group.name,
    members: ctx.members,
    pool: ctx.pool,
    history: ctx.history,
    senderName: ctx.senderName,
    longTermMemory: ctx.group.tom_chat_memory,
    notesContext: notesCtx, // base de conhecimento do grupo (índice + body das fixadas)
    credentialContext: credCtx, // credenciais que casam com o pedido deste turno (secrets decifrados)
    dateAnchor: buildBrtDateAnchor(), // hoje + tabela de datas (BRT) — LLM não calcula weekday e erra
  });

  let response;
  try {
    response = await ai.chat(systemPrompt, [{ role: 'user', content: text }]);
  } catch (err) {
    console.error(`[GroupChat] IA falhou grupo=${groupId}: ${err.message?.slice(0, 200)}`);
    return null; // silêncio é melhor que erro vazado no chat
  }

  let reply = response.text || '';
  const actions = []; // { kind, status, label, detail } → render rico no MessageBubble
  const collab = ctx.collab;
  const engine = require('../engine'); // lazy: engine já carregado no processo; evita ciclo na carga

  const stripBlock = (re) => { reply = (reply || '').replace(re, '').trim(); };
  const noCollab = (kind, label) => actions.push({ kind, status: 'fail', label: label || '', detail: 'não identifiquei quem pediu' });

  // ─── TAREFA (pool do grupo) ───────────────────────────────────────────────
  try {
    const parsed = engine.parseTaskUpdateMarker(reply);
    if (parsed && !parsed.malformed && Array.isArray(parsed.actions) && parsed.actions.length) {
      reply = (parsed.cleanText || '').trim();
      const { created, updated, completed, failed } = await applyGroupChatTaskActions({ supabase, groupId, senderCollabId, actions: parsed.actions });
      // detecta recorrência pra rotular
      const recurMap = new Set(parsed.actions.filter((a) => a.recurrence_rule).map((a) => (a.title || '').toLowerCase()));
      created.forEach((t) => actions.push({ kind: 'task', status: 'ok', label: t.title, detail: recurMap.has((t.title || '').toLowerCase()) ? 'recorrente' : '' }));
      // Dedup: tarefa existente atualizada no lugar (data corrigida etc.) — não é tarefa nova.
      (updated || []).forEach((t) => actions.push({ kind: 'task', status: 'ok', label: t.title, detail: (t.changed && t.changed.due_date) ? 'data atualizada' : 'atualizada' }));
      completed.forEach((t) => actions.push({ kind: 'task', status: 'ok', label: t.title, detail: 'concluída' }));
      if (failed.length && !created.length && !(updated || []).length && !completed.length) actions.push({ kind: 'task', status: 'fail', label: 'Tarefa', detail: 'não consegui registrar' });
      console.log(`[GroupChat] task grupo=${groupId}: created=${created.length} updated=${(updated || []).length} completed=${completed.length} failed=${failed.length}`);
    } else if (parsed && parsed.malformed) {
      stripBlock(/<<TASK_UPDATE>>[\s\S]*?<<END>>/i);
    }
  } catch (e) { console.error('[GroupChat] task err:', e.message); }

  // ─── PACOTE / GRUPO DE TAREFAS (pai + subtarefas) ─────────────────────────
  // <<TASK_GROUP>>{action:create|add_subtasks,...}<<END>> → motor src/services/task-groups.js
  const tgMatch = reply.match(/<<TASK_GROUP>>([\s\S]*?)<<END>>/i);
  if (tgMatch) {
    stripBlock(/<<TASK_GROUP>>[\s\S]*?<<END>>/i);
    let payload = null;
    try { payload = JSON.parse(tgMatch[1].trim()); } catch (_) { payload = null; }
    if (!payload || (payload.action !== 'create' && payload.action !== 'add_subtasks')) {
      actions.push({ kind: 'task', status: 'fail', label: 'Pacote', detail: 'marker malformado' });
    } else {
      try {
        if (payload.action === 'create') {
          const subtasks = (payload.subtasks || []).map((s) => ({ title: s.title, day: s.day, dueDate: s.due_date, remindAt: s.remind_at }));
          const r = await createTaskGroup({
            supabase, groupId, createdBy: senderCollabId,
            input: { title: payload.title, recurrence: payload.recurrence === 'monthly' ? 'monthly' : null,
              groupDay: payload.group_day, weekendAdjust: payload.weekend_adjust, subtasks },
          });
          actions.push({ kind: 'task', status: 'ok', label: payload.title, detail: `pacote · ${r.childIds.length} ${r.childIds.length === 1 ? 'item' : 'itens'}` });
          console.log(`[GroupChat] task_group create grupo=${groupId}: "${payload.title}" filhas=${r.childIds.length}`);
        } else {
          const { data: mom } = await supabase.from('tasks')
            .select('id').eq('assigned_group_id', groupId).eq('is_group', true)
            .is('recurrence_rule', null).neq('status', 'cancelled')
            .ilike('title', payload.group).limit(1);
          const motherId = (mom || [])[0]?.id;
          if (!motherId) {
            actions.push({ kind: 'task', status: 'fail', label: payload.group || 'Pacote', detail: 'não achei esse pacote' });
          } else {
            const subtasks = (payload.subtasks || []).map((s) => ({ title: s.title, day: s.day, dueDate: s.due_date, remindAt: s.remind_at }));
            const r = await addSubtasksToGroup({ supabase, groupId: motherId, subtasks });
            actions.push({ kind: 'task', status: 'ok', label: payload.group, detail: `+${r.added.length} no pacote` });
            console.log(`[GroupChat] task_group add grupo=${groupId}: "${payload.group}" +${r.added.length}`);
          }
        }
      } catch (e) {
        console.error('[GroupChat] TASK_GROUP erro:', e.message);
        actions.push({ kind: 'task', status: 'fail', label: payload.title || payload.group || 'Pacote', detail: 'não consegui montar o pacote' });
      }
    }
  }

  // ─── ANOTAÇÃO DO GRUPO (base de conhecimento) ─────────────────────────────
  // <<GROUP_NOTE>>{action:create|append,...}<<END>> → src/services/group-notes.js
  const gnMatch = reply.match(/<<GROUP_NOTE>>([\s\S]*?)<<END>>/i);
  if (gnMatch) {
    stripBlock(/<<GROUP_NOTE>>[\s\S]*?<<END>>/i);
    let p = null; try { p = JSON.parse(gnMatch[1].trim()); } catch (_) { p = null; }
    if (!p || (p.action !== 'create' && p.action !== 'append')) {
      actions.push({ kind: 'note', status: 'fail', label: 'Anotação', detail: 'marker malformado' });
    } else {
      try {
        if (p.action === 'create') {
          await groupNotes.createGroupNote({ supabase, groupId, createdBy: senderCollabId, note: { title: p.title, type: p.type, category: p.category, tags: p.tags, fields: p.fields, body: p.body } });
          actions.push({ kind: 'note', status: 'ok', label: p.title, detail: '📒 anotação do grupo' });
          console.log(`[GroupChat] group_note create grupo=${groupId}: "${p.title}"`);
        } else {
          const r = await groupNotes.appendGroupNote({ supabase, groupId, updatedBy: senderCollabId, title: p.title, body: p.body });
          actions.push({ kind: 'note', status: r.appended ? 'ok' : 'fail', label: p.title, detail: r.appended ? '📒 atualizada' : 'não achei essa anotação' });
        }
      } catch (e) { console.error('[GroupChat] GROUP_NOTE:', e.message); actions.push({ kind: 'note', status: 'fail', label: p.title || 'Anotação', detail: 'não consegui salvar' }); }
    }
  }

  // ─── RELATÓRIO DO GRUPO (sob demanda, B1) ─────────────────────────────────
  // O LLM emite só o marker; o código monta a lista EXATA e insere um card kind='report'
  // separado (nunca trunca/inventa). Mesmo formato do card de fechamento → app + bridge-out.
  const reportMatch = reply.match(/<<GROUP_REPORT>>([\s\S]*?)<<END>>/i);
  if (reportMatch) {
    stripBlock(/<<GROUP_REPORT>>[\s\S]*?<<END>>/i);
    let scope = 'tudo', window = 'mes';
    try {
      const p = JSON.parse(reportMatch[1].trim());
      const SCOPES = ['agenda', 'tarefas', 'anotacoes', 'checklists', 'tudo'];
      const WINDOWS = ['hoje', 'semana', 'mes'];
      if (SCOPES.includes(p.scope)) scope = p.scope;
      if (WINDOWS.includes(p.window)) window = p.window;
    } catch (_) { /* default tudo/mes */ }
    try {
      const { html } = await buildGroupReport({ supabase, groupId, scope, window });
      await supabase.from('group_chat_messages').insert({
        group_id: groupId, sender_id: null, role: 'tom', kind: 'report', content: html, channel: 'app',
      });
      actions.push({ kind: 'report', status: 'ok', label: 'Relatório gerado' });
      console.log(`[GroupChat] relatório grupo=${groupId} scope=${scope} window=${window}`);
    } catch (e) {
      console.error('[GroupChat] relatório falhou:', e.message);
      actions.push({ kind: 'report', status: 'fail', label: 'Relatório', detail: 'não consegui montar' });
    }
  }

  // ─── PROJETO ──────────────────────────────────────────────────────────────
  try {
    const parsed = engine.parseProjectMarker(reply);
    if (parsed && !parsed.malformed && parsed.project) {
      reply = (parsed.cleanText || '').trim();
      const name = parsed.project.name || 'projeto';
      if (!collab) { noCollab('project', name); }
      else {
        const r = await engine.persistProject(collab, parsed.project);
        if (r && !r.error) actions.push({ kind: 'project', status: 'ok', label: name });
        else actions.push({ kind: 'project', status: 'fail', label: name, detail: (r && r.userFacingReply) ? r.userFacingReply : 'não rolou agora' });
      }
    } else if (parsed && parsed.malformed) {
      stripBlock(/<<PROJECT_CREATE>>[\s\S]*?<<END>>/i);
      actions.push({ kind: 'project', status: 'fail', label: 'Projeto', detail: 'marker malformado' });
    }
  } catch (e) { console.error('[GroupChat] project err:', e.message); }

  // ─── EVENTO / AGENDA (com recorrência) ────────────────────────────────────
  try {
    const parsed = engine.parseEventCreateMarker(reply);
    if (parsed && !parsed.malformed && Array.isArray(parsed.events) && parsed.events.length) {
      reply = (parsed.cleanText || '').trim();
      if (!collab) { noCollab('event', parsed.events[0]?.title); }
      else {
        await engine.applyEventActions(collab, parsed.events, { suppressNotify: true }); // suppressNotify: NUNCA dispara zap
        parsed.events.forEach((ev) => actions.push({ kind: 'event', status: 'ok', label: ev.title || 'compromisso', detail: ev.recurrence_rule ? 'recorrente' : '' }));
      }
    } else if (parsed && parsed.malformed) {
      stripBlock(/<<EVENT_CREATE>>[\s\S]*?<<END>>/i);
      actions.push({ kind: 'event', status: 'fail', label: 'Evento', detail: 'marker malformado' });
    }
  } catch (e) { console.error('[GroupChat] event err:', e.message); }

  // ─── CHECKPOINTS de projeto ───────────────────────────────────────────────
  try {
    const parsed = engine.parseCheckpointBatchMarker(reply);
    if (parsed && !parsed.malformed) {
      reply = (parsed.cleanText || '').trim();
      if (!collab) { noCollab('checkpoint', 'Checkpoints'); }
      else {
        await engine.applyCheckpointBatch(collab, parsed);
        actions.push({ kind: 'checkpoint', status: 'ok', label: `${(parsed.items || []).length} checkpoint(s)`, detail: parsed.project_name || '' });
      }
    } else if (parsed && parsed.malformed) {
      stripBlock(/<<CHECKPOINT_BATCH>>[\s\S]*?<<END>>/i);
      actions.push({ kind: 'checkpoint', status: 'fail', label: 'Checkpoints', detail: 'marker malformado' });
    }
  } catch (e) { console.error('[GroupChat] checkpoint err:', e.message); }

  // ─── CHECKLIST ────────────────────────────────────────────────────────────
  try {
    const parsed = engine.parseChecklistActionMarker(reply);
    if (parsed && !parsed.malformed) {
      reply = (parsed.cleanText || '').trim();
      if (!collab) { noCollab('checklist', 'Checklist'); }
      else {
        await engine.applyChecklistAction(collab, parsed);
        actions.push({ kind: 'checklist', status: 'ok', label: 'Checklist atualizado' });
      }
    } else if (parsed && parsed.malformed) {
      stripBlock(/<<CHECKLIST_ACTION>>[\s\S]*?<<END>>/i);
    }
  } catch (e) { console.error('[GroupChat] checklist err:', e.message); }

  // ─── ANOTAÇÃO ─────────────────────────────────────────────────────────────
  try {
    const noteMarker = require('./note-marker');
    const notesService = require('./notes');
    const parsed = noteMarker.parseNoteActionMarker(reply);
    if (parsed && parsed.malformed) {
      stripBlock(/<<NOTE_ACTION>>[\s\S]*?<<END>>/i);
      actions.push({ kind: 'note', status: 'fail', label: 'Anotação', detail: 'marker malformado' });
    } else if (parsed && parsed.action) {
      reply = (parsed.cleanText || '').trim();
      const a = parsed.action;
      if (!collab) { noCollab('note', a.title || 'Anotação'); }
      else {
        let res;
        try {
          if (a.action === 'create') {
            const { ids } = await notesService.resolveShareNames(supabase, a.share_with || []);
            res = await notesService.createNote(supabase, collab.id, { title: a.title, body: a.body, source: 'tom', sharedWith: ids });
          } else if (a.action === 'share') {
            const { ids } = await notesService.resolveShareNames(supabase, a.share_with || []);
            res = await notesService.shareNote(supabase, collab.id, a.note, ids);
          } else {
            res = await notesService.appendToNote(supabase, collab.id, a.note, a.body);
          }
        } catch (eNote) { res = { ok: false, error: eNote.message }; }
        if (res && res.ok) actions.push({ kind: 'note', status: 'ok', label: a.title || 'Anotação salva' });
        else actions.push({ kind: 'note', status: 'fail', label: a.title || 'Anotação', detail: res?.error === 'note_not_found' ? 'não achei essa anotação' : 'não consegui salvar' });
      }
    }
  } catch (e) { console.error('[GroupChat] note err:', e.message); }

  // ─── SILÊNCIO + MONTAGEM ──────────────────────────────────────────────────
  reply = (reply || '').replace(/<<SILENCIO>>/gi, '').trim();

  // Anti-mentira (fala = persistência): se ALGUMA ação falhou, descarta a prosa otimista do
  // LLM — a lista estruturada de ações carrega a verdade (linha vermelha + motivo real).
  const hasFailure = actions.some((a) => a.status === 'fail');
  let prose = hasFailure ? '' : reply;

  let content = prose.trim();
  if (actions.length) content = (content ? content + '\n' : '') + ACTIONS_DELIM + JSON.stringify(actions);
  if (!content.trim()) return null; // nada a dizer (silêncio)

  const { data: inserted, error } = await supabase.from('group_chat_messages').insert({
    group_id: groupId, sender_id: null, role: 'tom', kind: 'text', content, channel: 'app',
  }).select('id').single();
  if (error) { console.error(`[GroupChat] falha ao gravar resposta TOM: ${error.message}`); return null; }

  return inserted;
}

module.exports = { processGroupChatMessage, loadContext, ACTIONS_DELIM };
