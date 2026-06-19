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

const { detectDisengageTrigger, isEngaged, isVocativeTom, isAddressedToTom, AWAIT_WINDOW_MS } = require('../services/group-chat-triggers');
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
setInterval(() => { const cut = Date.now() - 60 * 60 * 1000; for (const [k, t] of _recovered) if (t < cut) _recovered.delete(k); }, 60 * 60 * 1000);

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

async function processOne(supabase, msg) {
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
  const senderCollabId = msg.sender_id;
  if (!senderCollabId) return;

  const { data: group } = await supabase.from('work_groups')
    .select('tom_chat_engaged_at, wa_group_jid').eq('id', msg.group_id).maybeSingle();
  const engaged = isEngaged(group?.tom_chat_engaged_at, new Date());

  // ── Pré-filtro determinístico (SEM IA): o TOM ouve tudo, mas só RESPONDE quando endereçado.
  const vocative = isVocativeTom(text);
  // reply entra no fast-follow (precisa de coluna + bridge-in); no v1 é sempre false.
  const tomAwaiting = vocative ? false : await computeTomAwaiting(supabase, msg.group_id);
  const addressed = isAddressedToTom({ text, isReplyToTom: false, tomAwaiting });

  let shouldRun = false, clearAfter = false;
  if (addressed && detectDisengageTrigger(text)) {
    shouldRun = true; clearAfter = true;           // "valeu Tom" → responde e fecha a sessão
  } else if (addressed) {
    shouldRun = true;
    if (!engaged) {
      // Abre a sessão (início, não desliza) só quando ENDEREÇADO — pro card de fechamento/memória.
      await supabase.from('work_groups')
        .update({ tom_chat_engaged_at: new Date().toISOString(), tom_chat_closed_session_at: null })
        .eq('id', msg.group_id);
    }
  }
  if (!shouldRun) return; // SILÊNCIO real: nada de "escrevendo…", nada de chamada de IA

  // "Tom escrevendo…" só AGORA — quando já sabemos que ele vai responder (fim do "escreve e some").
  if (group?.wa_group_jid) sendGroupTyping(group.wa_group_jid);

  await processGroupChatMessage({ supabase, groupId: msg.group_id, senderCollabId, text });

  if (clearAfter) {
    await supabase.from('work_groups').update({ tom_chat_engaged_at: null }).eq('id', msg.group_id);
    console.log(`[GroupChat] desengajado do grupo ${msg.group_id}`);
  }
}

// Varredura por grupo engajado: recupera mensagem órfã OU fecha a sessão por ociosidade.
async function sweepEngaged(supabase) {
  const { data: groups } = await supabase.from('work_groups')
    .select('id, name, tom_chat_engaged_at, tom_chat_closed_session_at, tom_chat_memory')
    .not('tom_chat_engaged_at', 'is', null);
  for (const g of groups || []) {
    try {
      const { data: lastArr } = await supabase.from('group_chat_messages')
        .select('id, role, sender_id, content, kind, media_url, created_at')
        .eq('group_id', g.id).order('created_at', { ascending: false }).limit(1);
      const last = (lastArr || [])[0];
      const lastMs = last ? new Date(last.created_at).getTime() : new Date(g.tom_chat_engaged_at).getTime();
      const ageMs = Date.now() - lastMs;

      // 1) Recuperação: última mensagem é de MEMBRO, sem resposta, idade entre ORPHAN_MIN e IDLE.
      //    Provável resposta perdida num restart → re-libera pro poll reprocessar (uma vez).
      if (last && last.role === 'member' && ageMs >= ORPHAN_MIN_S * 1000 && ageMs < IDLE_MIN * 60 * 1000 && !_recovered.has(last.id)) {
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
    for (const msg of rows || []) {
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

module.exports = { startGroupChatWatcher, tick, computeTomAwaiting };
