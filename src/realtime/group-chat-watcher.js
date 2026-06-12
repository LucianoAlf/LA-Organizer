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

const { detectEngageTrigger, detectDisengageTrigger, isEngaged } = require('../services/group-chat-triggers');
const { processGroupChatMessage } = require('../services/group-chat-engine');
const { extractMediaText } = require('../services/group-chat-media');
const { processGroupChatClosing } = require('../services/group-chat-closing');

const POLL_MS = 4000;
const BATCH = 10;
const IDLE_MIN = 8;            // silêncio pra fechar a sessão
const ORPHAN_MIN_S = 25;       // idade mínima da msg de membro órfã antes de recuperar

let _ticking = false;
const _recovered = new Map();  // id -> ts (evita re-recuperar a mesma msg infinitamente)
setInterval(() => { const cut = Date.now() - 60 * 60 * 1000; for (const [k, t] of _recovered) if (t < cut) _recovered.delete(k); }, 60 * 60 * 1000);

async function processOne(supabase, msg) {
  // Claim atômico: só processa quem marcar tom_seen_at de NULL (evita 2 processos pegarem a mesma).
  const { data: claimed } = await supabase.from('group_chat_messages')
    .update({ tom_seen_at: new Date().toISOString() })
    .eq('id', msg.id).is('tom_seen_at', null).select('id');
  if (!claimed || !claimed.length) return;

  // Mídia → extrai texto pro contexto.
  if (['image', 'audio', 'pdf'].includes(msg.kind)) await extractMediaText({ supabase, message: msg });

  const text = msg.content || '';
  const senderCollabId = msg.sender_id;
  if (!senderCollabId) return;

  const { data: group } = await supabase.from('work_groups')
    .select('tom_chat_engaged_at').eq('id', msg.group_id).maybeSingle();
  const engaged = isEngaged(group?.tom_chat_engaged_at, new Date());

  let shouldRun = false, clearAfter = false;
  if (engaged && detectDisengageTrigger(text)) { shouldRun = true; clearAfter = true; }
  else if (engaged) { shouldRun = true; }
  else if (detectEngageTrigger(text)) {
    shouldRun = true;
    // Engaja: marca INÍCIO da sessão (não desliza) e reabre pra um novo fechamento.
    await supabase.from('work_groups')
      .update({ tom_chat_engaged_at: new Date().toISOString(), tom_chat_closed_session_at: null })
      .eq('id', msg.group_id);
  }
  if (!shouldRun) return; // silêncio — já memorizado

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
  } finally { _ticking = false; }
}

function startGroupChatWatcher(supabaseMain) {
  console.log(`[GroupChat] Watcher (poll ${POLL_MS}ms) iniciado.`);
  const timer = setInterval(() => { tick(supabaseMain).catch(() => {}); }, POLL_MS);
  process.on('SIGTERM', () => clearInterval(timer));
  return timer;
}

module.exports = { startGroupChatWatcher, tick };
