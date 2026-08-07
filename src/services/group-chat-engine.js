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
const { applyGroupChatTaskActions, findDuplicatePackage, resolveVisibleInstance, filterNewSubtasks, endSeries, resolveSeriesTemplate, reviveSeries } = require('./group-chat-tasks');
const { createTaskGroup, addSubtasksToGroup } = require('./task-groups');
const { buildGroupReport, dropOpenWithDoneTwin, categorize, spYmd } = require('./group-report-builder');
const { ehMoldeRecorrente, escondeMoldeComInstancia } = require('../utils/group-task-visibility');
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
    // Pool = SÓ tarefa REAL ativa (igual ao builder determinístico): exclui done/cancelled e os
    // moldes de recorrência. Sem isso o LLM via tarefa cancelada como "pendente" e cobrava/concluía
    // tarefa fantasma (GROUPCHAT-PHANTOM-POOL, caso Rose/Conciliação 15/06).
    // GROUPCHAT-POOL-RECUR-TEMPLATE-INVISIBLE (Rose 06/08): o `.is('recurrence_rule', null)`
    // que ficava aqui excluía TODO molde recorrente. A regra existe desde 12/06 para o TOM não
    // ver molde E instância e cobrar em dobro — mas disparava também quando NÃO HÁ instância,
    // e aí escondia trabalho real. Agora o molde vem, e quem some é só o que tem instância viva
    // (decidido abaixo, com consulta ao banco).
    supabase.from('tasks').select('id, title, status, due_date, created_at, is_group, parent_task_id, description, created_by, recurrence_rule, recurrence_parent_id, creator:collaborators!tasks_created_by_fkey(preferred_name, full_name)')
      .eq('assigned_group_id', groupId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false }).limit(POOL_LIMIT * 2),
    supabase.from('group_chat_messages').select('role, content, media_extracted_text, sender_id, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)').eq('group_id', groupId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
    supabase.from('collaborators').select('*').eq('id', senderCollabId).maybeSingle(),
  ]);

  const members = (memberRows || []).map((m) => ({ name: displayName(m.collaborators) }));
  // Pool alinhado ao digest: tira gêmea-done (sobra de churn) e RETROATIVA (criada já vencida) —
  // senão o LLM via tarefa retroativa/duplicada como "atrasada" e cobrava (GROUPREPORT-DONE-TWIN-OVERDUE).
  const poolToday = spYmd(new Date());
  // Map id→título dos containers de pacote (is_group) do result CRU → packageTitle na filha, pro
  // TOM ver "Depósito de Cheques: Venc 05" no contexto (GROUPREPORT-PACKAGE-TITLE-MISSING).
  const poolParentTitleById = new Map();
  for (const t of (poolRows || [])) { if (t.is_group === true && t.id) poolParentTitleById.set(t.id, t.title); }
  // is_group=true = container de pacote (pasta), não tarefa → fora do pool (senão vira fantasma dia-1).
  // Quais moldes desta página JÁ têm instância viva? Vai ao BANCO de propósito: se a instância
  // existir mas cair fora do limite da página, decidir pela página reintroduziria a duplicata
  // de 12/06. Sem molde na página, nem consulta.
  const _moldes = (poolRows || []).filter(ehMoldeRecorrente).map((t) => t.id);
  let _comInstancia = new Set();
  if (_moldes.length) {
    const { data: _inst } = await supabase.from('tasks')
      .select('recurrence_parent_id')
      .in('recurrence_parent_id', _moldes)
      .not('status', 'in', '("done","cancelled")');
    _comInstancia = new Set((_inst || []).map((r) => String(r.recurrence_parent_id)));
  }
  const pool = escondeMoldeComInstancia(
    dropOpenWithDoneTwin((poolRows || []).filter((t) => t.is_group !== true)), _comInstancia)
    // `retroativa` = criada DEPOIS de vencer, logo não é atraso de ninguém. Num MOLDE isso não
    // vale: o due_date é a âncora do ciclo (BYMONTHDAY=5), não data de cadastro atrasado — foi
    // o que sumiu com o "Relatório Mensal Financeiro" (venc. 05, criado 06) da Rose.
    .filter((t) => ehMoldeRecorrente(t)
      || categorize(t.due_date, poolToday, t.created_at ? spYmd(new Date(t.created_at)) : null) !== 'retroativa')
    .slice(0, POOL_LIMIT)
    .map((t) => ({ ...t, packageTitle: (t.parent_task_id && poolParentTitleById.get(t.parent_task_id)) || null }));
  const history = (histRows || []).reverse().map((m) => ({
    who: m.role === 'tom' ? 'TOM' : displayName(m.sender),
    role: m.role,
    content: m.media_extracted_text ? `${m.content || ''} [mídia: ${m.media_extracted_text}]`.trim() : (m.content || ''),
  }));

  return { group, members, pool, poolToday, history, senderName: displayName(senderRow), collab: senderRow || null };
}

// Insere uma mensagem de texto do TOM no chat do grupo (mesmo caminho do fluxo normal → bridge-out espelha).
async function postTomText(supabase, groupId, content) {
  const { data, error } = await supabase.from('group_chat_messages')
    .insert({ group_id: groupId, sender_id: null, role: 'tom', kind: 'text', content, channel: 'app' })
    .select('id').single();
  if (error) { console.error(`[GroupChat] falha ao postar texto TOM: ${error.message}`); return null; }
  return data;
}

async function processGroupChatMessage({ supabase, groupId, senderCollabId, text }) {
  // ── PRÉ-PASSO: confirmação determinística de ação destrutiva pendente (roda ANTES do LLM) ──
  // Um "sim"/"não" seco do MESMO remetente resolve a pendência (apagar ficha OU encerrar série).
  // Determinístico: NÃO confia no LLM pro threading "sim/não" (lição dos rituais de fechamento).
  try {
    const { data: pend } = await supabase.from('group_chat_pending_confirms')
      .select('*').eq('group_id', groupId).eq('sender_collab_id', senderCollabId)
      .in('op', ['delete_note', 'end_series']).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (pend) {
      const verdict = groupNotes.decideConfirm(pend, text);
      if (verdict === 'execute') {
        await supabase.from('group_chat_pending_confirms').delete().eq('id', pend.id);
        if (pend.op === 'end_series') {
          await endSeries({ supabase, templateId: pend.target_id });
          return await postTomText(supabase, groupId, `Encerrei a série *${pend.summary}* — não gera mais tarefa nova. Pra voltar é só pedir "religa a série ${pend.summary}". ✅`);
        }
        await groupNotes.softDeleteGroupNoteById({ supabase, noteId: pend.target_id });
        return await postTomText(supabase, groupId, `Apaguei a ficha *${pend.summary}* — tá na lixeira. É só pedir "restaura a ficha ${pend.summary}" que eu trago de volta. 🗑️`);
      }
      if (verdict === 'cancel') {
        await supabase.from('group_chat_pending_confirms').delete().eq('id', pend.id);
        const msg = pend.op === 'end_series' ? `Ok, mantive a série *${pend.summary}* rodando. 👍` : `Ok, não apaguei a ficha *${pend.summary}*. 👍`;
        return await postTomText(supabase, groupId, msg);
      }
      // 'ignore' → segue o fluxo normal (a pendência expira sozinha em ~10min)
    }
  } catch (e) { console.error('[GroupChat] pré-passo confirm:', e.message); }

  const ctx = await loadContext(supabase, groupId, senderCollabId);
  if (!ctx.group) { console.warn(`[GroupChat] grupo ${groupId} não encontrado`); return null; }

  let notesCtx = '';
  try { notesCtx = await groupNotes.groupNotesContext({ supabase, groupId }); } catch (_) { notesCtx = ''; }

  // Leitura sob demanda: se a mensagem cita uma ficha, injeta o CONTEÚDO dela (senha mascarada) —
  // assim o TOM nunca diz "não consigo mostrar" pra ficha que existe (GROUPCHAT-NOTES-CRUD).
  try { const fetchCtx = await groupNotes.noteFetchContext({ supabase, groupId, text }); if (fetchCtx) notesCtx = `${notesCtx}\n\n${fetchCtx}`; } catch (_) { /* degrada gracioso */ }

  // Senha sob demanda: se a mensagem pede credencial, acha a ficha que casa, decifra e injeta só ela.
  let credCtx = '';
  try { credCtx = await groupNotes.credentialLookupContext({ supabase, groupId, text }); } catch (_) { credCtx = ''; }

  const systemPrompt = buildGroupChatPrompt({
    soulText: loadGroupChatSoul(),
    groupName: ctx.group.name,
    members: ctx.members,
    pool: ctx.pool,
    today: ctx.poolToday, // GROUPCHAT-POOL-DATE-NO-RELLABEL: pré-computa o dia relativo no pool (paridade 1:1)
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
      const { created, updated, completed, cancelled, failed } = await applyGroupChatTaskActions({ supabase, groupId, senderCollabId, actions: parsed.actions });
      // detecta recorrência pra rotular
      const recurMap = new Set(parsed.actions.filter((a) => a.recurrence_rule).map((a) => (a.title || '').toLowerCase()));
      created.forEach((t) => actions.push({ kind: 'task', status: 'ok', label: t.title, detail: recurMap.has((t.title || '').toLowerCase()) ? 'recorrente' : '' }));
      // Dedup: tarefa existente atualizada no lugar (data corrigida etc.) — não é tarefa nova.
      (updated || []).forEach((t) => actions.push({ kind: 'task', status: 'ok', label: t.title, detail: (t.changed && t.changed.due_date) ? 'data atualizada' : 'atualizada' }));
      completed.forEach((t) => actions.push({ kind: 'task', status: 'ok', label: t.title, detail: 'concluída' }));
      // Cancel bem-sucedido também vira chip 'ok' (antes `cancelled` nem era lido → ficava invisível).
      (cancelled || []).forEach((t) => actions.push({ kind: 'task', status: 'ok', label: t.title, detail: '🗑️ cancelada' }));
      // Falha: mostra o MOTIVO amigável (antes era sempre genérico → membro não entendia o porquê).
      if ((failed || []).length && !created.length && !(updated || []).length && !completed.length && !(cancelled || []).length) {
        actions.push({ kind: 'task', status: 'fail', label: 'Tarefa', detail: friendlyTaskFail((failed[0] || {}).why) });
      }
      console.log(`[GroupChat] task grupo=${groupId}: created=${created.length} updated=${(updated || []).length} completed=${completed.length} cancelled=${(cancelled || []).length} failed=${(failed || []).length}`);
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
          // Anti-churn (RECUR-PACKAGE-CHURN): se já existe pacote ativo de título parecido,
          // NÃO duplica — mergeia só os itens novos no pacote visível (espelha o dedup de tarefa-única).
          const { data: mothers } = await supabase.from('tasks')
            .select('id, title, recurrence_rule, recurrence_parent_id, due_date')
            .eq('assigned_group_id', groupId).eq('is_group', true)
            .not('status', 'in', '("done","cancelled")');
          const dup = findDuplicatePackage(mothers, payload.title);
          if (dup) {
            const instance = resolveVisibleInstance(mothers, dup);
            const { data: kids } = await supabase.from('tasks')
              .select('title').eq('parent_task_id', instance.id).neq('status', 'cancelled');
            const novos = filterNewSubtasks((kids || []).map((k) => k.title), subtasks);
            if (novos.length) {
              const r = await addSubtasksToGroup({ supabase, groupId: instance.id, subtasks: novos });
              actions.push({ kind: 'task', status: 'ok', label: payload.title, detail: `pacote já existia · +${r.added.length} ${r.added.length === 1 ? 'item' : 'itens'}` });
            } else {
              actions.push({ kind: 'task', status: 'ok', label: payload.title, detail: 'pacote já existe (nada novo a adicionar)' });
            }
            console.log(`[GroupChat] task_group DEDUP grupo=${groupId}: "${payload.title}" → mergeado (instância ${String(instance.id).slice(0, 8)}, +${novos.length})`);
          } else {
            const r = await createTaskGroup({
              supabase, groupId, createdBy: senderCollabId,
              input: { title: payload.title, recurrence: payload.recurrence === 'monthly' ? 'monthly' : null,
                groupDay: payload.group_day, weekendAdjust: payload.weekend_adjust, subtasks },
            });
            actions.push({ kind: 'task', status: 'ok', label: payload.title, detail: `pacote · ${r.childIds.length} ${r.childIds.length === 1 ? 'item' : 'itens'}` });
            console.log(`[GroupChat] task_group create grupo=${groupId}: "${payload.title}" filhas=${r.childIds.length}`);
          }
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

  // ─── CICLO DE SÉRIE RECORRENTE (encerrar / religar) ───────────────────────
  // <<TASK_SERIES>>{action:end|revive, title}<<END>> — group-only. 'end' CONFIRMA (pré-passo);
  // 'revive' é direto. NÃO passa pelo validateTaskAction do engine (blast radius zero na recorrência).
  const tsMatch = reply.match(/<<TASK_SERIES>>([\s\S]*?)<<END>>/i);
  if (tsMatch) {
    stripBlock(/<<TASK_SERIES>>[\s\S]*?<<END>>/i);
    let ps = null; try { ps = JSON.parse(tsMatch[1].trim()); } catch (_) { ps = null; }
    if (!ps || (ps.action !== 'end' && ps.action !== 'revive')) {
      actions.push({ kind: 'task', status: 'fail', label: 'Série', detail: 'marker malformado' });
    } else if (ps.action === 'end') {
      try {
        const { data: hit } = await supabase.from('tasks')
          .select('id, title, recurrence_rule, recurrence_parent_id')
          .eq('assigned_group_id', groupId).neq('status', 'cancelled')
          .ilike('title', String(ps.title || '').trim()).limit(5);
        const tpl = resolveSeriesTemplate(hit);
        const templateId = tpl ? tpl.id : (((hit || []).find((r) => r.recurrence_parent_id) || {}).recurrence_parent_id || null);
        if (!templateId) {
          actions.push({ kind: 'task', status: 'fail', label: ps.title || 'Série', detail: 'não achei essa série recorrente' });
        } else {
          const { data: t } = await supabase.from('tasks').select('id, title').eq('id', templateId).maybeSingle();
          const summary = (t && t.title) || ps.title;
          const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
          await supabase.from('group_chat_pending_confirms')
            .upsert({ group_id: groupId, sender_collab_id: senderCollabId, op: 'end_series', target_id: templateId, summary, expires_at: expires }, { onConflict: 'group_id,sender_collab_id,op' });
          actions.push({ kind: 'task', status: 'pending', label: summary, detail: '❓ confirmar encerramento da série' });
          console.log(`[GroupChat] task_series end PENDENTE grupo=${groupId}: "${summary}"`);
        }
      } catch (e) { console.error('[GroupChat] TASK_SERIES end:', e.message); actions.push({ kind: 'task', status: 'fail', label: ps.title || 'Série', detail: 'não consegui montar' }); }
    } else {
      try {
        const r = await reviveSeries({ supabase, groupId, title: ps.title });
        actions.push({ kind: 'task', status: r.revived ? 'ok' : 'fail', label: ps.title, detail: r.revived ? '♻️ série religada' : 'não achei essa série encerrada' });
      } catch (e) { console.error('[GroupChat] TASK_SERIES revive:', e.message); actions.push({ kind: 'task', status: 'fail', label: ps.title || 'Série', detail: 'não consegui religar' }); }
    }
  }

  // ─── ANOTAÇÃO DO GRUPO (base de conhecimento) ─────────────────────────────
  // <<GROUP_NOTE>>{action:create|append,...}<<END>> → src/services/group-notes.js
  const gnMatch = reply.match(/<<GROUP_NOTE>>([\s\S]*?)<<END>>/i);
  if (gnMatch) {
    stripBlock(/<<GROUP_NOTE>>[\s\S]*?<<END>>/i);
    let p = null; try { p = JSON.parse(gnMatch[1].trim()); } catch (_) { p = null; }
    const GN_ACTIONS = ['create', 'append', 'update', 'delete', 'restore'];
    if (!p || !GN_ACTIONS.includes(p.action)) {
      actions.push({ kind: 'note', status: 'fail', label: 'Anotação', detail: 'marker malformado' });
    } else {
      try {
        if (p.action === 'create') {
          let body = p.body;
          if (p.from_doc) {
            // Parte 3-B: body DETERMINÍSTICO = texto organizado do doc financeiro recém-lido
            // (NÃO o do LLM, que truncaria os itens). Busca a última msg com o prefixo do doc.
            const { data: doc } = await supabase.from('group_chat_messages')
              .select('media_extracted_text').eq('group_id', groupId)
              .like('media_extracted_text', '[FATURA/EXTRATO]%')
              .order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (doc && doc.media_extracted_text) body = doc.media_extracted_text.replace(/^\[FATURA\/EXTRATO\]\s*/, '');
          }
          await groupNotes.createGroupNote({ supabase, groupId, createdBy: senderCollabId, note: { title: p.title, type: p.type, category: p.category, tags: p.tags, fields: p.fields, body } });
          actions.push({ kind: 'note', status: 'ok', label: p.title, detail: p.from_doc ? '📄 fatura/extrato salvo organizado' : '📒 anotação do grupo' });
          console.log(`[GroupChat] group_note create grupo=${groupId}: "${p.title}"${p.from_doc ? ' (from_doc)' : ''}`);
        } else if (p.action === 'append') {
          const r = await groupNotes.appendGroupNote({ supabase, groupId, updatedBy: senderCollabId, title: p.title, body: p.body });
          actions.push({ kind: 'note', status: r.appended ? 'ok' : 'fail', label: p.title, detail: r.appended ? '📒 atualizada' : 'não achei essa anotação' });
        } else if (p.action === 'update') {
          const patch = { new_title: p.new_title, type: p.type, tags: p.tags, body: p.body, set_fields: p.set_fields, upsert_field: p.upsert_field, remove_field: p.remove_field };
          const r = await groupNotes.updateGroupNote({ supabase, groupId, updatedBy: senderCollabId, title: p.title, patch });
          actions.push({ kind: 'note', status: r.updated ? 'ok' : 'fail', label: p.title, detail: r.updated ? '✏️ ficha atualizada' : 'não achei essa ficha' });
        } else if (p.action === 'delete') {
          // Não apaga na hora: grava pendência e pede confirmação (o pré-passo executa o soft-delete).
          const hit = await groupNotes.resolveNoteByTitle({ supabase, groupId, title: p.title });
          if (!hit) {
            actions.push({ kind: 'note', status: 'fail', label: p.title || 'Ficha', detail: 'não achei essa ficha' });
          } else {
            const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            await supabase.from('group_chat_pending_confirms')
              .upsert({ group_id: groupId, sender_collab_id: senderCollabId, op: 'delete_note', target_id: hit.id, summary: hit.title, expires_at: expires }, { onConflict: 'group_id,sender_collab_id,op' });
            actions.push({ kind: 'note', status: 'pending', label: hit.title, detail: '❓ confirma a exclusão?' });
            console.log(`[GroupChat] group_note delete PENDENTE grupo=${groupId}: "${hit.title}"`);
          }
        } else if (p.action === 'restore') {
          const r = await groupNotes.restoreGroupNote({ supabase, groupId, title: p.title });
          actions.push({ kind: 'note', status: r.restored ? 'ok' : 'fail', label: p.title, detail: r.restored ? '♻️ restaurada da lixeira' : 'não achei essa ficha na lixeira' });
        }
      } catch (e) { console.error('[GroupChat] GROUP_NOTE:', e.message); actions.push({ kind: 'note', status: 'fail', label: (p && p.title) || 'Anotação', detail: 'não consegui salvar' }); }
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
  const content = buildTomContent(reply, actions);
  if (!content) return null; // nada a dizer (silêncio real — sem prosa e sem ação)

  const { data: inserted, error } = await supabase.from('group_chat_messages').insert({
    group_id: groupId, sender_id: null, role: 'tom', kind: 'text', content, channel: 'app',
  }).select('id').single();
  if (error) { console.error(`[GroupChat] falha ao gravar resposta TOM: ${error.message}`); return null; }

  return inserted;
}

// Monta o conteúdo final da mensagem do TOM (prosa + bloco ‹‹ACTIONS››). Pura/testável.
// Regra ANTI-MENTIRA: se ALGUMA ação falhou, NÃO usa a prosa otimista do LLM (pode dizer
// "pronto!" sem ter feito) — a lista estruturada carrega a verdade. MAS na falha não pode ficar
// MUDO: o bloco ACTIONS é stripado no espelho do WhatsApp (bridge-out), então sem prosa o membro
// acha que o TOM o ignorou (caso Rose 15/06, GROUPCHAT-FAIL-NOPROSE-SILENT). Por isso, na FALHA
// troca a prosa otimista por uma HONESTA (com o motivo). Sucesso fica INALTERADO (zero regressão
// no fluxo normal/relatório, que já tem prosa do LLM ou espelha o próprio card).
function buildTomContent(rawReply, actions) {
  const acts = Array.isArray(actions) ? actions : [];
  const cleaned = String(rawReply || '').replace(/<<SILENCIO>>/gi, '').trim();
  const hasFailure = acts.some((a) => a && a.status === 'fail');
  let prose = hasFailure ? '' : cleaned;
  if (hasFailure) {
    const motivos = acts.filter((a) => a && a.status === 'fail')
      .map((a) => `${a.label || 'ação'}${a.detail ? ': ' + a.detail : ''}`).join(' · ');
    prose = `Opa, tentei mas não consegui concluir agora — ${motivos}. Dá uma conferida ou me explica de outro jeito que eu tento de novo. 🙏`;
  }
  let content = prose.trim();
  // Pendência de confirmação (ex.: apagar ficha): garante uma pergunta CLARA mesmo se o LLM não
  // escreveu prosa — senão o bridge-out (que tira o bloco ACTIONS) espelharia VAZIO no WhatsApp.
  if (!content) {
    const pend = acts.find((a) => a && a.status === 'pending');
    if (pend && pend.kind === 'task') content = `Confirma que é pra encerrar a série *${pend.label}*? Responde "sim" que ela para de gerar tarefa nova (dá pra religar depois). ✅`;
    else if (pend) content = `Confirma que é pra apagar a ficha *${pend.label}*? Responde "sim" que eu mando pra lixeira (dá pra restaurar depois). 🗑️`;
  }
  if (acts.length) content = (content ? content + '\n' : '') + ACTIONS_DELIM + JSON.stringify(acts);
  return content.trim() || null;
}

// Traduz o motivo técnico de falha de tarefa (group-chat-tasks) numa frase que o membro entende.
function friendlyTaskFail(why) {
  const MAP = {
    not_found_in_group: 'não achei essa tarefa no grupo — confere o nome exato pra mim',
    not_found_in_pool: 'não achei essa tarefa no grupo',
    title_missing: 'me diz qual tarefa exatamente',
    race_lost: 'alguém mexeu nela ao mesmo tempo, tenta de novo',
    unsupported_action: 'essa ação eu ainda não faço por aqui',
    package_recurrence_unsupported: 'a data eu ajustei, mas mudar a recorrência de um pacote eu não faço por aqui — dá pra ajustar no app',
  };
  return MAP[why] || 'não consegui registrar';
}

module.exports = { processGroupChatMessage, loadContext, ACTIONS_DELIM, buildTomContent, friendlyTaskFail };
