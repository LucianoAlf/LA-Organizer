// src/realtime/group-chat-watcher.js
// Chat de grupo — WATCHER por POLLING (service_role). Ignora RLS/realtime, à prova de falha.
//
// Modelo de sessão (corrigido 12/06):
//  - `tom_chat_engaged_at` = INÍCIO da sessão (setado no gatilho de entrada; NÃO desliza).
//    Isso garante que o card de fechamento enxergue a sessão INTEIRA (o slide antigo jogava o
//    marco pra depois da última mensagem → "nenhuma mensagem trocada").
//  - Sessão aberta = engaged_at setado (isEngaged). Fecha por: despedida OU ociosidade
//    (silêncio >= IDLE_MIN, medido pela ÚLTIMA mensagem real do grupo) — varredura no tick.
//  - Anti-loop: poll filtra role='member'. Idempotência: claim atômico via tom_seen_at.
//  - Recuperação: se um restart matou o processamento no meio (claim feito, resposta perdida),
//    a varredura detecta a mensagem de membro órfã (última, sem resposta) e a re-libera pro poll.

const { detectDisengageTrigger, isEngaged, isVocativeTom, decideGroupReply, isReacaoSemTexto, planejarFatias, shouldRecoverOrphan, AWAIT_WINDOW_MS } = require('../services/group-chat-triggers');
const { processGroupChatMessage } = require('../services/group-chat-engine');
const { extractMediaText } = require('../services/group-chat-media');
const { processGroupChatClosing } = require('../services/group-chat-closing');
const { runOutboundOnce, runDeleteSyncOnce } = require('../services/group-chat-bridge-out');
const { sendGroupText, sendGroupTyping, sendGroupMedia, deleteWaMessage } = require('../services/uazapi-groups');

const POLL_MS = 4000;
const BATCH = 10;
const IDLE_MIN = 8;            // silêncio pra fechar a sessão
const ORPHAN_MIN_S = 25;       // idade mínima da msg de membro órfã antes de recuperar

let _ticking = false;
const _recovered = new Map();  // id -> ts (evita re-recuperar a mesma msg infinitamente)
// unref: faxina de memória não pode segurar o event loop. Sem isso o módulo é impossível de
// carregar num teste (o processo nunca termina) — e o watcher era justamente a superfície sem
// teste nenhum onde o descarte mudo de 04/09 viveu meses.
{
  const _faxina = setInterval(() => { const cut = Date.now() - 60 * 60 * 1000; for (const [k, t] of _recovered) if (t < cut) _recovered.delete(k); }, 60 * 60 * 1000);
  if (typeof _faxina.unref === 'function') _faxina.unref();
}

// "O TOM está esperando uma resposta?" — sinal barato (sem IA) pra deixar passar um "sim"/"R$ 320"
// sem precisar repetir o nome. Degrada gracioso: na dúvida, retorna false (silêncio).
async function computeTomAwaiting(supabase, groupId) {
  // (1) confirmação estruturada pendente (apagar ficha / encerrar série).
  try {
    const { data: pend } = await supabase.from('group_chat_pending_confirms')
      .select('id').eq('group_id', groupId).gt('expires_at', new Date().toISOString()).limit(1);
    if (pend && pend.length) return true;
  } catch (_) { /* segue */ }
  // (2) última fala do TOM foi pergunta livre ("...?") dentro da janela.
  try {
    const cutoff = Date.now() - AWAIT_WINDOW_MS;
    const { data: tomMsgs } = await supabase.from('group_chat_messages')
      .select('content, created_at').eq('group_id', groupId).eq('role', 'tom').eq('kind', 'text')
      .order('created_at', { ascending: false }).limit(1);
    const last = (tomMsgs || [])[0];
    if (last && new Date(last.created_at).getTime() >= cutoff && String(last.content || '').trim().endsWith('?')) return true;
  } catch (_) { /* segue */ }
  return false;
}

// GROUPCHAT-SENDER-NULL-DESCARTE-MUDO (auditoria 04/09) — o defeito mais grave do dia.
//
// O que havia aqui era `const senderCollabId = msg.sender_id; if (!senderCollabId) return;`,
// DEPOIS do claim e ANTES do gate de vocativo. Medido: 13 mensagens de membro entraram com
// `sender_id` NULL (o remetente do WhatsApp não casou com nenhum colaborador cadastrado) e
// foram descartadas em silêncio — exatamente as 13 que ficaram sem `tom_done_at`. Nenhuma
// mensagem com remetente válido ficou sem tratamento. A gerente Krissya chamou o TOM pelo
// nome às 11:15 e nunca foi respondida; o pedido da Fernanda das 09:33 só foi atendido às
// 10:27 de carona no histórico de outra pessoa. E o TOM, perguntado por que calou, INVENTOU
// um motivo — ele não tinha como saber que fora descartado antes de chegar nele.
//
// A DECISÃO, e por quê: o TOM RESPONDE mesmo sem saber quem é, tratando como pessoa
// desconhecida. Uma gerente pedindo e sendo ignorada é o pior desfecho possível justamente
// porque não tem recuperação — ninguém, nem ela nem nós, fica sabendo que houve pedido. O
// segundo pior (executar em nome de alguém que ele não sabe quem é) NÃO precisa acontecer
// junto: são duas portas diferentes. CONVERSAR não exige identidade; EXECUTAR exige, e a
// porta de execução continua fechada — o engine recebe `remetenteDesconhecido` e recusa
// qualquer marker de escrita, dizendo na cara do grupo que não reconhece quem falou e
// pedindo que se identifique. Responder-e-recusar é honesto; calar não é.
//
// `deps` existe pro teste: o watcher era a superfície sem teste nenhum onde este descarte
// morou meses. Em produção os defaults são os módulos reais.
async function processOne(supabase, msg, deps = {}) {
  const processMessage = deps.processMessage || processGroupChatMessage;
  const typing = deps.sendTyping || sendGroupTyping;
  // Claim atômico: só processa quem marcar tom_seen_at de NULL (evita 2 processos pegarem a mesma).
  const { data: claimed } = await supabase.from('group_chat_messages')
    .update({ tom_seen_at: new Date().toISOString() })
    .eq('id', msg.id).is('tom_seen_at', null).select('id');
  if (!claimed || !claimed.length) return;

  // Mídia → extrai texto (áudio→Whisper, imagem→Vision) e USA como texto efetivo:
  // sem isso o gatilho ("fala tom" dito no áudio) e o engine recebiam string vazia → TOM mudo.
  let text = msg.content || '';
  if (['image', 'audio', 'pdf'].includes(msg.kind)) {
    const extracted = await extractMediaText({ supabase, message: msg });
    if (extracted) text = text ? `${text}\n${extracted}` : extracted;
  }
  const senderCollabId = msg.sender_id || null;
  const remetenteDesconhecido = !senderCollabId;

  const { data: group } = await supabase.from('work_groups')
    .select('tom_chat_engaged_at, wa_group_jid').eq('id', msg.group_id).maybeSingle();
  const engaged = isEngaged(group?.tom_chat_engaged_at, new Date());

  // ── Modelo JANELA (Alf 20/06): vocativo ABRE a janela; enquanto aberta o TOM responde à conversa
  // sem precisar repetir o nome; "valeu Tom"/ociosidade (~8min, sweepEngaged) fecham. Pré-filtro
  // determinístico (sem IA): janela fechada + sem chamado → silêncio real.
  const vocative = isVocativeTom(text);
  const isFarewell = detectDisengageTrigger(text);
  const tomAwaiting = (engaged || vocative) ? false : await computeTomAwaiting(supabase, msg.group_id);
  const { shouldRun, clearAfter, opensWindow } = decideGroupReply({ engaged, vocative, isFarewell, tomAwaiting, reacaoSemTexto: isReacaoSemTexto(msg.content) });

  if (!shouldRun) {
    // Marca como TRATADA (silêncio intencional) pra recuperação de órfã NÃO re-disparar.
    await supabase.from('group_chat_messages').update({ tom_done_at: new Date().toISOString() }).eq('id', msg.id);
    // O silêncio nunca mais pode ser MUDO: sem esta linha, "o TOM calou porque a conversa não
    // era com ele" e "o TOM calou porque quebrou" são byte-a-byte iguais no log — a doença que
    // esta casa persegue. Aqui é o ramo SAUDÁVEL, e ele se declara como tal.
    console.log(`[GroupChat] silencio intencional msg=${msg.id} grupo=${msg.group_id} (janela fechada, sem vocativo)`);
    return; // janela fechada e ninguém chamou → silêncio real
  }
  // Rastro do turno DEGRADADO: o TOM vai responder, mas sem saber quem pediu. Log + marker_logs
  // (result só aceita executed|rejected|skipped|fallback) porque este é o sintoma que ficou
  // invisível 13 vezes num único dia — e o laudo diário lê marker_logs, não o console.
  if (remetenteDesconhecido) {
    console.warn(`[GroupChat] remetente DESCONHECIDO msg=${msg.id} grupo=${msg.group_id} — responde como conversa, execução bloqueada`);
    try {
      const { error: _e } = await supabase.from('marker_logs').insert({
        collaborator_id: null,
        marker_type: 'GROUP_SENDER', result: 'skipped',
        reason: `remetente desconhecido (sender_id null) grupo=${msg.group_id}`.slice(0, 120),
      });
      if (_e) console.error(`[GroupChat] sensor de remetente falhou: ${_e.message}`);
    } catch (e) { console.error('[GroupChat] sensor de remetente erro:', e.message); }
  }
  if (opensWindow) {
    // Abre a janela (início da sessão, não desliza) — fica ativa até "valeu Tom" ou ~8 min de silêncio.
    await supabase.from('work_groups')
      .update({ tom_chat_engaged_at: new Date().toISOString(), tom_chat_closed_session_at: null })
      .eq('id', msg.group_id);
  }

  // "Tom escrevendo…" só quando já sabemos que ele vai responder (fim do "escreve e some").
  if (group?.wa_group_jid) typing(group.wa_group_jid);

  await processMessage({ supabase, groupId: msg.group_id, senderCollabId, text, remetenteDesconhecido });

  if (clearAfter) {
    await supabase.from('work_groups').update({ tom_chat_engaged_at: null }).eq('id', msg.group_id);
    console.log(`[GroupChat] desengajado do grupo ${msg.group_id}`);
  }

  // Tratamento concluído → marca tom_done_at (a recuperação de órfã não toca em msg concluída).
  await supabase.from('group_chat_messages').update({ tom_done_at: new Date().toISOString() }).eq('id', msg.id);
}

// Varredura por grupo engajado: recupera mensagem órfã OU fecha a sessão por ociosidade.
async function sweepEngaged(supabase) {
  const { data: groups } = await supabase.from('work_groups')
    .select('id, name, tom_chat_engaged_at, tom_chat_closed_session_at, tom_chat_memory')
    .not('tom_chat_engaged_at', 'is', null);
  for (const g of groups || []) {
    try {
      const { data: lastArr } = await supabase.from('group_chat_messages')
        .select('id, role, sender_id, content, kind, media_url, created_at, tom_seen_at, tom_done_at')
        .eq('group_id', g.id).order('created_at', { ascending: false }).limit(1);
      const last = (lastArr || [])[0];
      const lastMs = last ? new Date(last.created_at).getTime() : new Date(g.tom_chat_engaged_at).getTime();
      const ageMs = Date.now() - lastMs;

      // 1) Recuperação: SÓ msg de membro RECLAMADA mas NÃO concluída (tom_done_at null) = restart matou
      //    o processamento. Silêncio intencional do TOM marca tom_done_at → NÃO é recuperado (sem loop).
      if (last && shouldRecoverOrphan(last, ageMs, { orphanMinMs: ORPHAN_MIN_S * 1000, idleMaxMs: IDLE_MIN * 60 * 1000, alreadyRecovered: _recovered.has(last.id) })) {
        _recovered.set(last.id, Date.now());
        await supabase.from('group_chat_messages').update({ tom_seen_at: null }).eq('id', last.id);
        console.log(`[GroupChat] recuperando mensagem órfã ${last.id} (resposta perdida)`);
        continue;
      }

      // 2) Fechamento por ociosidade (silêncio >= IDLE_MIN desde a última mensagem).
      if (ageMs >= IDLE_MIN * 60 * 1000) {
        await processGroupChatClosing({ supabase, group: g });
      }
    } catch (e) { console.error('[GroupChat] sweep err:', e.message); }
  }
}

async function tick(supabaseMain) {
  if (_ticking) return;
  _ticking = true;
  try {
    const { data: rows, error } = await supabaseMain.from('group_chat_messages')
      .select('id, group_id, sender_id, kind, content, media_url, created_at')
      .eq('role', 'member').is('tom_seen_at', null)
      .order('created_at', { ascending: true }).limit(BATCH);
    if (error) { console.error('[GroupChat] poll err:', error.message); return; }
    // Rajada de fatias: espera assentar e responde so a ultima (as anteriores seguem no
    // historico, entao o TOM le a frase inteira em vez de meia frase).
    const plano = planejarFatias(rows || []);
    if (plano.silenciar.length) {
      // Marcadas como vistas SEM resposta propria: existem pro contexto, nao pro eco.
      await supabaseMain.from('group_chat_messages')
        .update({ tom_seen_at: new Date().toISOString(), tom_done_at: new Date().toISOString() })
        .in('id', plano.silenciar.map((m) => m.id));
      console.log(`[GroupChat] fatias agrupadas: ${plano.silenciar.length} silenciada(s), respondendo a ultima`);
    }
    for (const msg of plano.processar) {
      try { await processOne(supabaseMain, msg); }
      catch (e) { console.error(`[GroupChat] erro msg=${msg.id}:`, e.message); }
    }
    await sweepEngaged(supabaseMain);
    try { await runOutboundOnce(supabaseMain, { sendGroupText, sendGroupMedia }); }
    catch (e) { console.error('[Bridge-out] tick err:', e.message); }
    try { await runDeleteSyncOnce(supabaseMain, { deleteWaMessage }); }
    catch (e) { console.error('[Bridge-del] tick err:', e.message); }
  } finally { _ticking = false; }
}

function startGroupChatWatcher(supabaseMain) {
  console.log(`[GroupChat] Watcher (poll ${POLL_MS}ms) iniciado.`);
  const timer = setInterval(() => { tick(supabaseMain).catch(() => {}); }, POLL_MS);
  process.on('SIGTERM', () => clearInterval(timer));
  return timer;
}

module.exports = { startGroupChatWatcher, tick, computeTomAwaiting, processOne };
