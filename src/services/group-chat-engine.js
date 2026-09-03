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
const { applyGroupChatTaskActions, findDuplicatePackage, resolveVisibleInstance, filterNewSubtasks, endSeries, resolveSeriesTemplate, reviveSeries, derecurSeries } = require('./group-chat-tasks');
const { createTaskGroup, addSubtasksToGroup } = require('./task-groups');
const { buildGroupReport, dropOpenWithDoneTwin, categorize, spYmd } = require('./group-report-builder');
const { detectaDataAfirmadaErrada } = require('../utils/date-claim');
const { ehMoldeRecorrente, escondeMoldeComInstancia } = require('../utils/group-task-visibility');
const groupNotes = require('./group-notes');
const { buildBrtDateAnchor } = require('../utils/dates');
const opsAgent = require('./ops-agent');
const { paraWhatsApp, dividirParaWhatsApp } = require('../utils/wa-format');

const HISTORY_LIMIT = 30;
const POOL_LIMIT = 30;
const ACTIONS_DELIM = '‹‹ACTIONS››'; // separador prosa ↔ ações estruturadas (parseado no front)

function displayName(c) {
  return (c?.preferred_name || c?.full_name || '').split(' ')[0] || 'alguém';
}

// FATIA 2 — o que vai como "memoria de longo prazo" no prompt. Ate 2 memorias ativas o grupo
// segue com o resumo rolante velho; da terceira em diante, so o bloco novo (fatos datados, um
// por linha). A troca e por GRUPO — nenhum grupo passa um dia sem contexto.
function memoriaDoPrompt(ctx) {
  const gm = require('./group-memory');
  const r = gm.escolherMemoria({
    memorias: ctx.memoriasDoGrupo,
    bufferAntigo: ctx.group && ctx.group.tom_chat_memory,
  });
  // Sensor: sem isto, "grupo sem memoria" e "leitura falhou" ficam identicos no log.
  console.log(`[GroupMemory] grupo=${ctx.group && ctx.group.id} fonte=${r.fonte} ativas=${r.vivas}`);
  return r.texto;
}

async function loadContext(supabase, groupId, senderCollabId) {
  const [{ data: group }, { data: memberRows }, { data: poolRows }, { data: histRows }, { data: senderRow },
    memoriasDoGrupo] = await Promise.all([
    supabase.from('work_groups').select('id, name, tom_chat_engaged_at, tom_chat_memory, la_report_unidade_id').eq('id', groupId).maybeSingle(),
    supabase.from('work_group_members').select('collaborators(full_name, preferred_name)').eq('group_id', groupId),
    // Pool = SÓ tarefa REAL ativa (igual ao builder determinístico): exclui done/cancelled e os
    // moldes de recorrência. Sem isso o LLM via tarefa cancelada como "pendente" e cobrava/concluía
    // tarefa fantasma (GROUPCHAT-PHANTOM-POOL, caso Rose/Conciliação 15/06).
    // GROUPCHAT-POOL-RECUR-TEMPLATE-INVISIBLE (Rose 06/08): o `.is('recurrence_rule', null)`
    // que ficava aqui excluía TODO molde recorrente. A regra existe desde 12/06 para o TOM não
    // ver molde E instância e cobrar em dobro — mas disparava também quando NÃO HÁ instância,
    // e aí escondia trabalho real. Agora o molde vem, e quem some é só o que tem instância viva
    // (decidido abaixo, com consulta ao banco).
    supabase.from('tasks').select('id, title, status, due_date, created_at, is_group, parent_task_id, description, created_by, recurrence_rule, recurrence_parent_id, is_recurrence_template, creator:collaborators!tasks_created_by_fkey(preferred_name, full_name)')
      .eq('assigned_group_id', groupId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false }).limit(POOL_LIMIT * 2),
    supabase.from('group_chat_messages').select('role, content, media_extracted_text, sender_id, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)').eq('group_id', groupId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
    supabase.from('collaborators').select('*').eq('id', senderCollabId).maybeSingle(),
    // FATIA 2 — leitura da memoria de grupo. Devolve array puro (nao { data }), por isso fica no
    // FIM: a destruturacao acima e posicional.
    require('./group-memory').carregarMemoriasDoGrupo(supabase, groupId),
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
    // VERDADE ÚNICA (Fatia 2): esconde a filha-BLUEPRINT (marcador intrínseco + rule==null) do
    // pool que o TOM vê — era double-count com a filha-instância (mesmo título/data). Preciso de
    // propósito: NÃO toca o MOLDE (rule!=null), que segue governado por escondeMoldeComInstancia
    // (molde-sem-instância É a ocorrência corrente e precisa aparecer — Rose 06/08).
    dropOpenWithDoneTwin((poolRows || []).filter((t) => t.is_group !== true
      && !(t.is_recurrence_template === true && t.recurrence_rule == null))), _comInstancia)
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

  return { group, members, pool, poolToday, history, senderName: displayName(senderRow), collab: senderRow || null,
    memoriasDoGrupo: memoriasDoGrupo || null };
}

// Insere uma mensagem de texto do TOM no chat do grupo (mesmo caminho do fluxo normal → bridge-out espelha).
async function postTomText(supabase, groupId, content) {
  const { data, error } = await supabase.from('group_chat_messages')
    .insert({ group_id: groupId, sender_id: null, role: 'tom', kind: 'text', content, channel: 'app' })
    .select('id').single();
  if (error) { console.error(`[GroupChat] falha ao postar texto TOM: ${error.message}`); return null; }
  return data;
}

// "Tom escrevendo…" enquanto o agente trabalha. O watcher já dispara UM `sendGroupTyping` ao
// receber a mensagem, mas o `composing` do WhatsApp expira em ~25s e o agente leva minutos —
// por isso a barrinha sumia e o grupo parecia morto (reclamação do Alf, 08/08).
const TYPING_BATIDA_MS = 20000;
const TYPING_TETO_MS = 12 * 60 * 1000;   // acima do timeout do agente: rede contra vazamento

function iniciarTypingSustentado(supabase, groupId) {
  let vivo = true;
  let timer = null;
  const parar = () => { vivo = false; if (timer) { clearInterval(timer); timer = null; } };
  (async () => {
    const { data: g } = await supabase.from('work_groups')
      .select('wa_group_jid').eq('id', groupId).maybeSingle();
    const jid = g && g.wa_group_jid;
    if (!jid || !vivo) return;
    const { sendGroupTyping } = require('./uazapi-groups');
    const bater = () => { if (vivo) Promise.resolve(sendGroupTyping(jid)).catch(() => {}); };
    bater();
    timer = setInterval(bater, TYPING_BATIDA_MS);
    // unref: um "digitando" pendente não pode segurar o shutdown do processo.
    if (typeof timer.unref === 'function') timer.unref();
    setTimeout(parar, TYPING_TETO_MS).unref?.();
  })().catch(() => { /* cosmético: nunca derruba o pedido */ });
  return parar;
}

// Falha de ENTREGA no grupo. Carrega o parcial de propósito: quem chama precisa saber se o
// grupo ficou com meio relatório na tela, e é isso que vai pro log do ciclo.
class GroupPostError extends Error {
  constructor(message, { entregues = 0, total = 0 } = {}) {
    super(message);
    this.name = 'GroupPostError';
    this.entregues = entregues;
    this.total = total;
  }
}

// Resultado do agente de ops → grupo. Passa pelo sanitizador (markdown não renderiza no
// WhatsApp) e sai em mensagens de tamanho legível, em série pra não embaralhar a ordem no
// espelho. Divide em vez de truncar: num relatório de auditoria a conclusão fica no fim.
//
// REJEITA quando não entrega (GOVLOG-SEM-ENTREGA, 09/08): `postTomText` devolve null em falha
// de insert, e engolir esse null aqui fazia o chamador — o ciclo de governança e o digest de
// auditoria — gravar `sent` em `ritual_logs` sem nada ter chegado ao grupo. O gate de
// idempotência então bloqueava o retry do dia: mensagem nenhuma, aviso nenhum.
async function postOpsResult(supabase, groupId, texto) {
  const partes = dividirParaWhatsApp(paraWhatsApp(texto));
  if (!partes.length) {
    const aviso = await postTomText(supabase, groupId, 'Terminei, mas voltei sem texto nenhum — isso é bug meu. Pede de novo?');
    if (!aviso) throw new GroupPostError('não cheguei a postar nem o aviso de resposta vazia', { entregues: 0, total: 1 });
    return aviso;
  }
  let ultimo = null;
  let entregues = 0;
  for (const parte of partes) {
    const r = await postTomText(supabase, groupId, parte);
    // Para no primeiro erro DE PROPÓSITO. Seguir postando a 3 e a 4 depois de perder a 2
    // deixa no grupo um relatório furado no meio, que ninguém detecta lendo — e o `ultimo`
    // truthy do fim faria o chamador concluir que a entrega inteira deu certo.
    if (!r) {
      throw new GroupPostError(
        `entrega incompleta no grupo: ${entregues} de ${partes.length} parte(s)`,
        { entregues, total: partes.length });
    }
    ultimo = r;
    entregues += 1;
  }
  if (partes.length > 1) console.log(`[OpsAgent] resposta em ${partes.length} mensagens`);
  return ultimo;
}

async function processGroupChatMessage({ supabase, groupId, senderCollabId, text }) {
  // ── CANAL DE OPS (grupo LA ORGANIZER - TOM) ────────────────────────────────────────────
  // Neste grupo o TOM não é assistente: é o agente de engenharia do Alf e do Hugo, com
  // ferramentas reais (Bash/Read/Write/Edit no repo, banco via script, git). Roda em Opus 5,
  // caminho totalmente separado do `chat()` normal — que segue com `--tools ''`.
  // O gate tem DUAS condições verificadas em código (grupo E remetente na allowlist), nunca
  // no prompt: pedido escrito por terceiro e colado aqui não vira comando, porque quem manda
  // é o senderCollabId que o bridge resolveu. Nasce atrás de TOM_OPS_ENABLED=1.
  if (opsAgent.isOpsChannel({ groupId, senderCollabId })) {
    let quem = 'alguém do grupo';
    try {
      const { data: c } = await supabase.from('collaborators')
        .select('full_name, preferred_name').eq('id', senderCollabId).maybeSingle();
      if (c) quem = c.preferred_name || c.full_name || quem;
    } catch (_) { /* nome é cosmético */ }

    // O agente pode levar minutos (auditoria, teste, deploy). O watcher do grupo é um poll
    // curto: segurar o turno até o fim penduraria a fila inteira. Então confirma na hora e
    // devolve o resultado quando terminar, num segundo post.
    // Se o processo cair no meio (deploy = `pm2 restart`), o drain hook avisa por aqui em vez
    // de deixar o grupo esperando um "Tô nisso" que nunca volta.
    opsAgent.configurarCanalAviso((txt) => postTomText(supabase, groupId, txt));
    const pararTyping = iniciarTypingSustentado(supabase, groupId);

    // `runOpsAgent` nunca lança (devolve `{ ok:false, text }` já pronto pro grupo), então quem
    // cai neste catch é a ENTREGA — daí a prosa falar de envio, e não de o agente ter quebrado.
    opsAgent.runOpsAgent(text, { quem })
      .then((r) => {
        // O custo vem do CLI e não tem onde ser gravado aqui (pedido sob demanda não tem linha
        // em ritual_logs). Fica no log: sem isso o preço do canal interativo some por completo.
        const _custo = opsAgent.linhaDeCusto(quem, r && r.custo);
        if (_custo) console.log(_custo);
        return postOpsResult(supabase, groupId, r.text);
      })
      .catch((e) => {
        console.error('[OpsAgent] falha ao entregar o resultado:', e.message);
        return postTomText(supabase, groupId, `Terminei, mas não consegui te entregar aqui — ${e.message}. Pede de novo que eu reenvio.`);
      })
      .catch((e) => console.error('[OpsAgent] falha ao postar resultado:', e.message))
      .finally(pararTyping);

    console.log(`[OpsAgent] pedido de ${quem}: "${String(text).slice(0, 80)}"`);
    return await postTomText(supabase, groupId, opsAgent.ackDoPedido(text, quem));
  }

  // ── PRÉ-PASSO: confirmação determinística de ação destrutiva pendente (roda ANTES do LLM) ──
  // Um "sim"/"não" seco do MESMO remetente resolve a pendência (apagar ficha OU encerrar série).
  // Determinístico: NÃO confia no LLM pro threading "sim/não" (lição dos rituais de fechamento).
  try {
    const { data: pend } = await supabase.from('group_chat_pending_confirms')
      .select('*').eq('group_id', groupId).eq('sender_collab_id', senderCollabId)
      .in('op', ['delete_note', 'end_series', 'derecur_series']).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (pend) {
      const verdict = groupNotes.decideConfirm(pend, text);
      if (verdict === 'execute') {
        await supabase.from('group_chat_pending_confirms').delete().eq('id', pend.id);
        if (pend.op === 'end_series') {
          await endSeries({ supabase, templateId: pend.target_id });
          return await postTomText(supabase, groupId, `Encerrei a série *${pend.summary}* — não gera mais tarefa nova. Pra voltar é só pedir "religa a série ${pend.summary}". ✅`);
        }
        if (pend.op === 'derecur_series') {
          await derecurSeries({ supabase, templateId: pend.target_id });
          return await postTomText(supabase, groupId, `Feito — a *${pend.summary}* fica só neste mês e não repete mais nos próximos. Pra voltar a repetir é só pedir "volta a recorrência ${pend.summary}". ✅`);
        }
        await groupNotes.softDeleteGroupNoteById({ supabase, noteId: pend.target_id });
        return await postTomText(supabase, groupId, `Apaguei a ficha *${pend.summary}* — tá na lixeira. É só pedir "restaura a ficha ${pend.summary}" que eu trago de volta. 🗑️`);
      }
      if (verdict === 'cancel') {
        await supabase.from('group_chat_pending_confirms').delete().eq('id', pend.id);
        const msg = pend.op === 'end_series' ? `Ok, mantive a série *${pend.summary}* rodando. 👍`
          : pend.op === 'derecur_series' ? `Ok, mantive a recorrência de *${pend.summary}*. 👍`
          : `Ok, não apaguei a ficha *${pend.summary}*. 👍`;
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
    longTermMemory: memoriaDoPrompt(ctx),
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

  // Velocímetro GROUPCHAT-DATE-SELF-POISONING: as entradas já entram sem carimbo de data, mas
  // o nascimento do erro (a 1ª fala errada de cada rajada) é alucinação e nenhuma limpeza de
  // entrada garante zero. Aqui só MEDIMOS. Corrigir a string seria maquiagem: quando ele parte
  // da data errada, a aritmética inteira sai contaminada ("prazo era ontem, 06/08 (1 dia)") e
  // trocar o número esconderia o defeito em vez de expô-lo.
  try {
    const erradas = detectaDataAfirmadaErrada(reply, ctx.poolToday);
    if (erradas.length) {
      const detalhe = erradas.map((e) => `${e.rotulo}=${e.disse} (era ${e.esperado})`).join(', ');
      console.warn(`[GroupChat][DATE-CLAIM] grupo=${groupId} hoje=${ctx.poolToday} afirmou: ${detalhe}`);
    }
  } catch (_) { /* velocímetro nunca derruba a resposta */ }

  const actions = []; // { kind, status, label, detail } → render rico no MessageBubble
  const cards = []; // HTML dos cards; gravados DEPOIS da fala (ver o fim de processGroupChatMessage)
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
        // O label era o literal 'Tarefa', então a pessoa lia "Tarefa: não achei essa tarefa no
        // grupo" e ninguém — nem ela, nem nós no log — descobria QUAL nome ele tentou. Mostrar o
        // título pedido é o que transforma "não achei" em algo que dá pra conferir na hora.
        const _pedido = ((failed[0] || {}).action || {}).title;
        actions.push({ kind: 'task', status: 'fail', label: _pedido ? `"${String(_pedido).slice(0, 60)}"` : 'Tarefa', detail: friendlyTaskFail((failed[0] || {}).why) });
        console.warn(`[GroupChat] task FAIL grupo=${groupId} pedido="${String(_pedido || '').slice(0, 60)}" why=${(failed[0] || {}).why}`);
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

  // ─── CICLO DE SÉRIE RECORRENTE (encerrar / parar de repetir / religar) ─────
  // <<TASK_SERIES>>{action:end|derecur|revive, title}<<END>> — group-only. 'end' e 'derecur'
  // CONFIRMAM (pré-passo); 'revive' é direto. 'derecur' = para de repetir MAS mantém o ciclo
  // corrente (Fatia 3). NÃO passa pelo validateTaskAction do engine (blast radius zero).
  const tsMatch = reply.match(/<<TASK_SERIES>>([\s\S]*?)<<END>>/i);
  if (tsMatch) {
    stripBlock(/<<TASK_SERIES>>[\s\S]*?<<END>>/i);
    let ps = null; try { ps = JSON.parse(tsMatch[1].trim()); } catch (_) { ps = null; }
    if (!ps || !['end', 'derecur', 'revive'].includes(ps.action)) {
      actions.push({ kind: 'task', status: 'fail', label: 'Série', detail: 'marker malformado' });
    } else if (ps.action === 'end' || ps.action === 'derecur') {
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
          const op = ps.action === 'derecur' ? 'derecur_series' : 'end_series';
          const detail = ps.action === 'derecur' ? '❓ confirmar parar a recorrência (mantém este mês)' : '❓ confirmar encerramento da série';
          await supabase.from('group_chat_pending_confirms')
            .upsert({ group_id: groupId, sender_collab_id: senderCollabId, op, target_id: templateId, summary, expires_at: expires }, { onConflict: 'group_id,sender_collab_id,op' });
          actions.push({ kind: 'task', status: 'pending', label: summary, detail });
          console.log(`[GroupChat] task_series ${ps.action} PENDENTE grupo=${groupId}: "${summary}"`);
        }
      } catch (e) { console.error(`[GroupChat] TASK_SERIES ${ps.action}:`, e.message); actions.push({ kind: 'task', status: 'fail', label: ps.title || 'Série', detail: 'não consegui montar' }); }
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
      cards.push(html);
      actions.push({ kind: 'report', status: 'ok', label: 'Relatório gerado' });
      console.log(`[GroupChat] relatório grupo=${groupId} scope=${scope} window=${window}`);
    } catch (e) {
      console.error('[GroupChat] relatório falhou:', e.message);
      actions.push({ kind: 'report', status: 'fail', label: 'Relatório', detail: 'não consegui montar' });
    }
  }

  // ─── SITUAÇÃO DO ALUNO (LA Report) ─────────────────────────────────
  // A LLM interpreta a pergunta e emite o marker; QUEM ESCREVE OS NÚMEROS É O CÓDIGO.
  // Zero regex de roteamento (decisão do Alf 02/09: "eu fujo de regex") e zero chance de
  // confabular — ele nunca redige o número, igual ao <<GROUP_REPORT>>.
  const situMatch = reply.match(/<<SITUACAO_ALUNO>>([\s\S]*?)<<END>>/i);
  if (situMatch) {
    stripBlock(/<<SITUACAO_ALUNO>>[\s\S]*?<<END>>/i);
    try {
      const situ = require('./situacao-aluno');
      let p = {};
      try { p = JSON.parse(situMatch[1].trim()) || {}; } catch (_) { p = {}; }
      // A unidade dita na fala vence a do grupo: no Sucesso do Aluno, que atravessa as três,
      // é a fala que diz de quem se está falando. Sem nenhuma das duas, PERGUNTA.
      const unidadeId = situ.resolverUnidade(p.unidade) || (ctx.group && ctx.group.la_report_unidade_id);
      // CONTAR exige a unidade — o número muda. ACHAR UMA PESSOA pelo nome, não: procura nas
      // três e o card diz onde ela está. No Sucesso do Aluno, que atende as três, exigir a
      // unidade antes de cada nome é fricção sem ganho nenhum de honestidade.
      if (!unidadeId && !p.aluno) {
        // 'ask', não 'fail': falta um dado que só a pessoa tem. Ver buildTomContent.
        actions.push({ kind: 'situacao', status: 'ask', label: 'Situação do aluno',
          detail: 'de qual unidade? Recreio, Barra ou Campo Grande' });
      } else {
        const recorte = situ.normalizarRecorte(p.recorte);
        // O cabecalho do card assina a UNIDADE, nao o grupo (ver cabecalhoDe).
        const unidadeNome = situ.nomeDaUnidade(unidadeId);
        const pagina = Math.max(0, Number(p.pagina) || 0);
        const { laReportClient, isLaReportConfigured } = require('./la-report-client');
        if (!isLaReportConfigured()) throw new Error('credenciais do LA Report ausentes');

        let html;
        // FICHA DE UM ALUNO: sai da MESMA lista que os recortes usam — nenhuma ida nova ao
        // banco. Nome ambiguo NAO e escolhido no chute: vira pergunta, igual a unidade.
        if (p.aluno) {
          const alvos = unidadeId ? [unidadeId] : situ.UNIDADES_IDS;
          const { pessoas, falharam } = await situ.buscarAlunoNasUnidades({ unidadeIds: alvos, client: laReportClient });
          // Uma unidade fora do ar vira "nao achei" silencioso se ninguem contar. Zero por
          // FALHA tem que soar diferente de zero por SAUDE.
          if (falharam.length === alvos.length) throw new Error('nenhuma unidade respondeu');
          const ressalva = falharam.length
            ? ` (não consegui consultar ${falharam.map(situ.nomeDaUnidade).filter(Boolean).join(' e ')} agora)` : '';
          const r = situ.resolverAluno(pessoas, p.aluno);
          if (r.pessoa) html = situ.renderFicha(r.pessoa, { grupoNome: ctx.group.name, professores: situ.conjuntoDeProfessores(pessoas) });
          else if (r.erro === 'ambiguo') html = situ.renderAmbiguo(r.candidatos, p.aluno, r.total);
          else {
            const onde = unidadeId ? 'nessa unidade' : 'em nenhuma das três unidades';
            actions.push({ kind: 'situacao', status: 'ask', label: 'Ficha do aluno',
              detail: r.erro === 'termo_curto' ? 'me diz o nome do aluno'
                : `não achei ninguém com esse nome entre os alunos ativos ${onde}${ressalva} — confere o nome pra mim?` });
          }
        } else if (recorte === 'resumo') {
          const { data } = await situ.consultarComCache({ tipo: 'resumo', unidadeId, client: laReportClient });
          html = situ.renderResumo(data, { grupoNome: ctx.group.name, unidadeNome });
        } else {
          const { data } = await situ.consultarComCache({ tipo: 'lista', unidadeId, client: laReportClient });
          // Recorte por período de matrícula: a LLM traduz "agosto de 2026" em datas, o código
          // filtra e o cabeçalho DIZ qual eixo usou (entrou na escola x matrícula nova).
          const periodo = (p.periodo_de || p.periodo_ate)
            ? { de: p.periodo_de || null, ate: p.periodo_ate || null, criterio: p.periodo_criterio === 'recente' ? 'recente' : 'entrada' }
            : null;
          let pessoas = situ.filtrarPorRecorte(data || [], recorte);
          if (periodo) pessoas = situ.filtrarPorPeriodo(pessoas, periodo);
          html = situ.renderLista({ recorte, pessoas, total: pessoas.length, pagina,
            grupoNome: ctx.group.name, unidadeNome, periodo,
            professores: situ.conjuntoDeProfessores(data || []) });
        }
        // Sem card nao ha insert: nome nao encontrado ja virou 'ask' la em cima, e gravar
        // content null deixaria uma mensagem vazia no grupo.
        if (html) {
          cards.push(html);
          const rotulo = p.aluno ? `Ficha: ${p.aluno}` : `Situação do aluno (${recorte})`;
          actions.push({ kind: 'situacao', status: 'ok', label: rotulo });
          console.log(`[GroupChat] situacao grupo=${groupId} ${p.aluno ? `aluno=${p.aluno}` : `recorte=${recorte} pagina=${pagina}`}`);
        }
      }
    } catch (e) {
      // Falha é DITA. Número de aluno errado ou inventado é pior que não responder.
      console.error('[GroupChat] situacao falhou:', e.message);
      actions.push({ kind: 'situacao', status: 'fail', label: 'Situação do aluno',
        detail: 'não consegui consultar o LA Report agora' });
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

  // GROUP-NOTE-CONFAB — SENSOR. O chokepoint acima corrige a fala, mas sem registro ninguém
  // sabe QUANTAS vezes o TOM afirmou escrita sem escrever num grupo. Zero por saúde e zero por
  // falta de instrumento são byte-a-byte iguais; o laudo diário do Alf lê este marcador.
  try {
    const { NO_MARKER_HONEST_NOTE } = require('../lib/optimistic-confirm');
    if (NO_MARKER_HONEST_NOTE && content.includes(NO_MARKER_HONEST_NOTE)) {
      await supabase.from('marker_logs').insert({
        marker_type: 'CONFAB', result: 'fallback',
        reason: `grupo_claim_sem_marker: ${groupId}`.slice(0, 120),
      });
    }
  } catch (_) { /* sensor é best-effort; nunca derruba a resposta */ }

  const { data: inserted, error } = await supabase.from('group_chat_messages').insert({
    group_id: groupId, sender_id: null, role: 'tom', kind: 'text', content, channel: 'app',
  }).select('id').single();
  if (error) { console.error(`[GroupChat] falha ao gravar resposta TOM: ${error.message}`); return null; }

  // Os cards saem DEPOIS da fala. O modelo escreve a linha de abertura antes de ver o resultado
  // (ele so emitiu o marker), então a fala termina em "👇" — e o 👇 tem que apontar pra alguma
  // coisa. Gravando o card no meio do processamento, ele chegava ANTES e o dedo apontava pro
  // vazio (Sucesso do Aluno, 02/09).
  for (const html of cards) {
    const { error: e2 } = await supabase.from('group_chat_messages').insert({
      group_id: groupId, sender_id: null, role: 'tom', kind: 'report', content: html, channel: 'app',
    });
    if (e2) console.error(`[GroupChat] falha ao gravar card: ${e2.message}`);
  }

  return inserted;
}

// Monta o conteúdo final da mensagem do TOM (prosa + bloco ‹‹ACTIONS››). Pura/testável.
// Regra ANTI-MENTIRA: se ALGUMA ação falhou, NÃO usa a prosa otimista do LLM (pode dizer
// "pronto!" sem ter feito) — a lista estruturada carrega a verdade. MAS na falha não pode ficar
// MUDO: o bloco ACTIONS é stripado no espelho do WhatsApp (bridge-out), então sem prosa o membro
// acha que o TOM o ignorou (caso Rose 15/06, GROUPCHAT-FAIL-NOPROSE-SILENT). Por isso, na FALHA
// troca a prosa otimista por uma HONESTA (com o motivo). Sucesso fica INALTERADO (zero regressão
// no fluxo normal/relatório, que já tem prosa do LLM ou espelha o próprio card).
// A nota honesta ("Na real não consegui registrar isso agora") é a voz do SISTEMA — quem a
// escreve é o chokepoint, depois de MEDIR que nada persistiu. Em 02/09, no Sucesso do Aluno, o
// próprio modelo a escreveu no fim de uma resposta correta (ele explicava, com razão, que não
// filtra por mês de matrícula) e o resultado foi o TOM se acusando de uma falha que não houve,
// na frente da equipe. Guard invertido: alarme falso destrói o sinal do alarme verdadeiro.
// Arrancamos a nota da fala do modelo SEMPRE; se ela tiver que existir, o chokepoint abaixo a
// devolve — aí com medição por trás.
const NOTA_DO_SISTEMA_RE = /_?⚠️?\s*Na real n[ãa]o consegui registrar isso agora[^\n]*/gi;

function buildTomContent(rawReply, actions) {
  const acts = Array.isArray(actions) ? actions : [];
  const bruto = String(rawReply || '');
  const modeloEscreveuNota = NOTA_DO_SISTEMA_RE.test(bruto);
  NOTA_DO_SISTEMA_RE.lastIndex = 0; // regex com /g guarda estado entre chamadas
  if (modeloEscreveuNota) console.log('[GroupChat] nota honesta veio DO MODELO — arrancada');
  const cleaned = bruto
    .replace(/<<SILENCIO>>/gi, '')
    .replace(NOTA_DO_SISTEMA_RE, '')
    .trim();
  const hasFailure = acts.some((a) => a && a.status === 'fail');
  // PEDIR informação não é FALHAR (achado na bateria E2E de 02/09). Quando o que falta é um
  // dado que só a pessoa tem — qual unidade, qual aluno —, a resposta é uma PERGUNTA. Vestir
  // isso de "tentei mas não consegui" ensina o time a achar que ele quebrou, e some com a
  // pergunta no meio do pedido de desculpa.
  const asks = acts.filter((a) => a && a.status === 'ask');
  let prose = hasFailure ? '' : cleaned;
  if (hasFailure) {
    const motivos = acts.filter((a) => a && a.status === 'fail')
      .map((a) => `${a.label || 'ação'}${a.detail ? ': ' + a.detail : ''}`).join(' · ');
    prose = `Opa, tentei mas não consegui concluir agora — ${motivos}. Dá uma conferida ou me explica de outro jeito que eu tento de novo. 🙏`;
  }
  // A pergunta entra ANTES do chokepoint: ela não é afirmação de escrita, é coleta.
  if (!hasFailure && asks.length) {
    const perguntas = asks.map((a) => a.detail).filter(Boolean).join(' · ');
    prose = prose.trim() ? `${prose.trim()}\n\n${perguntas}` : perguntas;
  }

  // GROUP-NOTE-CONFAB (Clayton, Recreio 02/09): a regra acima só cobre ação que FALHOU. Quando
  // o LLM não emite marker NENHUM e mesmo assim afirma a escrita na prosa ("Anotado aqui pra
  // contexto"), `acts` vem vazio, `hasFailure` é false e a afirmação passa inteira — o membro
  // fica achando que ficou registrado e `group_notes` tem zero linha. É o mesmo buraco que o
  // 1:1 fechou com o chokepoint; aqui ele nunca tinha sido ligado.
  //
  // Reusa `enforceNoMarkerHonesty` em vez de escrever outro vocabulário: é a fonte única de
  // "isto afirma conclusão", com os vetos que a casa já pagou pra descobrir —
  // content-solicitation ("Anotado! Pode mandar o próximo" é coleta, não escrita) e pergunta
  // pendente de confirmação (a ação ainda vai acontecer).
  if (!hasFailure && prose.trim()) {
    const persistiuOuVaiPersistir = acts.some((a) => a && (a.status === 'ok' || a.status === 'pending' || a.status === 'ask'));
    if (!persistiuOuVaiPersistir) {
      try {
        const { enforceNoMarkerHonesty } = require('../lib/optimistic-confirm');
        const rc = require('./reply-classify');
        const antes = prose;
        prose = enforceNoMarkerHonesty(prose, {
          nothingPersisted: true,
          infoGathering: rc.hasTrailingQuestion(prose) || rc.isInfoGatheringReply(prose),
          contentSolicitation: rc.isContentSolicitationReply(prose),
          markerAttempted: false,
          awaitingConfirm: false,
        });
        if (prose !== antes) {
          console.log('[GroupChat] chokepoint DISPAROU e rebaixou a fala');
          const _oc = require('../lib/optimistic-confirm');
          String(antes).split(String.fromCharCode(10)).filter((l) => l.trim()).forEach((l) => {
            const forte = _oc.hasCompletionClaim(l);
            const fraca = _oc.hasWeakCompletionClaim(l);
            if (forte || fraca) console.log(`[GroupChat]   gatilho ${forte ? 'FORTE' : 'fraca'}: ${l.slice(0, 110)}`);
          });
        }
      } catch (e) { console.error('[GroupChat] chokepoint err:', e.message); }
    }
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

module.exports = { processGroupChatMessage, loadContext, ACTIONS_DELIM, buildTomContent, friendlyTaskFail, postOpsResult, GroupPostError };
