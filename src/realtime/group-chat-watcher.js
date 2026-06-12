// src/realtime/group-chat-watcher.js
// Chat de grupo Fase 2 — WATCHER por POLLING (service_role).
//
// Por que poll e não realtime: o postgres_changes do Supabase nesta VPS/Node20 não entrega
// eventos pra conexão anon em tabelas com RLS de membro (mesmo com a tabela na publicação e
// REPLICA IDENTITY FULL), além de ser instável (reconexões frequentes). O poll com service_role
// ignora RLS/publicação/replica-identity e é à prova de falha. Latência de POLL_MS é imperceptível
// num chat onde o TOM responde quando chamado.
//
// Idempotência: cada mensagem é "reivindicada" via update condicional de `tom_seen_at` (claim
// atômico). Só quem ganha o claim processa — sobrevive a ticks sobrepostos e a restart (o backfill
// da migration marcou todo o histórico como já visto, então só mensagens NOVAS entram).
// Anti-loop: a query filtra role='member' — nunca reage a 'tom'/'system'.

const { detectEngageTrigger, detectDisengageTrigger, isEngaged } = require('../services/group-chat-triggers');
const { processGroupChatMessage } = require('../services/group-chat-engine');
const { extractMediaText } = require('../services/group-chat-media');
const { processGroupChatClosing } = require('../services/group-chat-closing');

const POLL_MS = 4000;
const BATCH = 10;

let _ticking = false;

async function processOne(supabase, msg) {
  // 1) Claim atômico: só processa quem conseguir marcar tom_seen_at (de NULL).
  const { data: claimed } = await supabase
    .from('group_chat_messages')
    .update({ tom_seen_at: new Date().toISOString() })
    .eq('id', msg.id)
    .is('tom_seen_at', null)
    .select('id');
  if (!claimed || !claimed.length) return; // outro tick já pegou

  // 2) Mídia → extrai texto pro contexto (await pra entrar no mesmo turno).
  if (['image', 'audio', 'pdf'].includes(msg.kind)) {
    await extractMediaText({ supabase, message: msg });
  }

  const text = msg.content || '';
  const senderCollabId = msg.sender_id;
  if (!senderCollabId) return;

  // 3) Estado de engajamento.
  const { data: group } = await supabase
    .from('work_groups')
    .select('tom_chat_engaged_at, tom_chat_closed_session_at, tom_chat_memory')
    .eq('id', msg.group_id)
    .maybeSingle();
  const engaged = isEngaged(group?.tom_chat_engaged_at, new Date());

  let shouldRun = false;
  let clearAfter = false;
  if (engaged && detectDisengageTrigger(text)) {
    shouldRun = true; clearAfter = true;       // responde uma última vez e desengaja
  } else if (engaged) {
    shouldRun = true;                          // janela ativa
  } else if (detectEngageTrigger(text)) {
    shouldRun = true;                          // menção direta → engaja
    await supabase.from('work_groups')
      .update({ tom_chat_engaged_at: new Date().toISOString() }).eq('id', msg.group_id);
  }
  // else: silêncio — já está salvo (memória)

  // Slide da janela: se engajado (mesmo em silêncio), renova tom_chat_engaged_at
  // para que o idle de 8min seja medido a partir da ÚLTIMA mensagem, não do engajamento inicial.
  if (engaged && !clearAfter) {
    await supabase.from('work_groups')
      .update({ tom_chat_engaged_at: new Date().toISOString() }).eq('id', msg.group_id);
  }

  if (!shouldRun) return;

  await processGroupChatMessage({ supabase, groupId: msg.group_id, senderCollabId, text });

  if (clearAfter) {
    await supabase.from('work_groups')
      .update({ tom_chat_engaged_at: null }).eq('id', msg.group_id);
    console.log(`[GroupChat] desengajado do grupo ${msg.group_id}`);
  }
}

async function tick(supabaseMain) {
  if (_ticking) return; // evita sobreposição se um turno demorar mais que POLL_MS
  _ticking = true;
  try {
    const { data: rows, error } = await supabaseMain
      .from('group_chat_messages')
      .select('id, group_id, sender_id, kind, content, media_url, created_at')
      .eq('role', 'member')
      .is('tom_seen_at', null)
      .order('created_at', { ascending: true })
      .limit(BATCH);
    if (error) { console.error('[GroupChat] poll err:', error.message); return; }
    for (const msg of rows || []) {
      try { await processOne(supabaseMain, msg); }
      catch (e) { console.error(`[GroupChat] erro msg=${msg.id}:`, e.message); }
    }

    // Varredura de silêncio: grupos engajados com idle >= 8min → card de fechamento.
    // Barata: 1 select filtrando apenas os grupos com engajamento ativo.
    const { data: idleGroups } = await supabaseMain
      .from('work_groups')
      .select('id, name, tom_chat_engaged_at, tom_chat_closed_session_at, tom_chat_memory')
      .not('tom_chat_engaged_at', 'is', null);
    for (const g of idleGroups || []) {
      const idleMs = Date.now() - new Date(g.tom_chat_engaged_at).getTime();
      if (idleMs >= 8 * 60 * 1000) {
        try { await processGroupChatClosing({ supabase: supabaseMain, group: g }); }
        catch (e) { console.error('[GroupChat] closing err:', e.message); }
      }
    }
  } finally {
    _ticking = false;
  }
}

function startGroupChatWatcher(supabaseMain) {
  console.log(`[GroupChat] Watcher (poll ${POLL_MS}ms) iniciado.`);
  const timer = setInterval(() => { tick(supabaseMain).catch(() => {}); }, POLL_MS);
  process.on('SIGTERM', () => clearInterval(timer));
  return timer;
}

module.exports = { startGroupChatWatcher, tick };
