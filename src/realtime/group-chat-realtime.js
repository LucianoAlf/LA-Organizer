// src/realtime/group-chat-realtime.js
// Chat de grupo Fase 2 — subscriber Realtime: escuta mensagens role='member' no chat de
// grupo e aciona o TOM quando engajado/chamado. Espelha o padrão de tom-realtime.js.
const { createClient } = require('@supabase/supabase-js');
// supabase-realtime-js v2.104+ exige Node.js 22+ pra WebSocket nativo.
// O VPS roda Node 20, então passamos o pacote `ws` explicitamente como transport.
const wsLib = require('ws');
const { detectEngageTrigger, detectDisengageTrigger, isEngaged } = require('../services/group-chat-triggers');
const { processGroupChatMessage } = require('../services/group-chat-engine');
const { extractMediaText } = require('../services/group-chat-media');

// Criado lazy para garantir que o .env já foi carregado.
// Usa ANON_KEY — conexão Realtime WebSocket não aceita service_role.
let _client = null;
function getRealtimeClient() {
  if (!_client) {
    _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      realtime: {
        timeout: 30000,
        transport: wsLib, // Node 20 não tem WebSocket nativo — passa ws explícito
      },
    });
  }
  return _client;
}

// Dedup de entrega (id já processado) com TTL de 1h — segurança contra entrega dupla.
const seen = new Map();
function firstTime(id) {
  if (seen.has(id)) return false;
  seen.set(id, Date.now());
  return true;
}
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [k, ts] of seen) if (ts < cutoff) seen.delete(k);
}, 60 * 60 * 1000);

/**
 * @param {object} supabaseMain - cliente Supabase service_role usado pra queries/updates
 */
function startGroupChatRealtime(supabaseMain) {
  console.log('[GroupChat] Iniciando subscriber do chat de grupo...');

  const channel = getRealtimeClient()
    .channel('tom-group-chat')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'group_chat_messages',
      filter: 'role=eq.member', // ANTI-LOOP: nunca reage a role='tom' ou 'system'
    }, async (payload) => {
      const msg = payload.new;
      if (!msg || !msg.id || !msg.group_id) return;
      if (!firstTime(msg.id)) return;

      try {
        // 1) Mídia → extrai texto pro contexto (await pra entrar no prompt do mesmo turno).
        if (['image', 'audio', 'pdf'].includes(msg.kind)) {
          await extractMediaText({ supabase: supabaseMain, message: msg });
        }

        const text = msg.content || '';
        const senderCollabId = msg.sender_id;
        if (!senderCollabId) return; // membro sempre tem sender_id

        // 2) Estado de engajamento.
        const { data: group } = await supabaseMain
          .from('work_groups').select('tom_chat_engaged_at').eq('id', msg.group_id).maybeSingle();
        const engaged = isEngaged(group?.tom_chat_engaged_at, new Date());

        let shouldRun = false;
        let clearAfter = false;

        if (engaged && detectDisengageTrigger(text)) {
          // Engajado + despedida: responde uma última vez e desengaja
          shouldRun = true;
          clearAfter = true;
        } else if (engaged) {
          // Engajado: responde normalmente
          shouldRun = true;
        } else if (detectEngageTrigger(text)) {
          // Não engajado + menção direta: engaja e responde
          shouldRun = true;
          await supabaseMain.from('work_groups')
            .update({ tom_chat_engaged_at: new Date().toISOString() }).eq('id', msg.group_id);
        }
        // else: silêncio — mensagem já está salva (serve como memória)

        if (!shouldRun) return;

        await processGroupChatMessage({
          supabase: supabaseMain,
          groupId: msg.group_id,
          senderCollabId,
          text,
        });

        if (clearAfter) {
          await supabaseMain.from('work_groups')
            .update({ tom_chat_engaged_at: null }).eq('id', msg.group_id);
          console.log(`[GroupChat] desengajado do grupo ${msg.group_id}`);
        }
      } catch (e) {
        console.error('[GroupChat] erro ao processar mensagem:', e.message);
      }
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('[GroupChat] Conectado ao Realtime do chat de grupo');
      } else if (status === 'CHANNEL_ERROR') {
        const detail = (err && (err.message || String(err))) || 'queda transitória, reconectando automaticamente';
        console.warn(`[GroupChat] canal instável: ${detail}`);
      } else if (status === 'TIMED_OUT') {
        console.warn('[GroupChat] timeout — supabase-js tenta reconectar sozinho');
      } else if (status === 'CLOSED') {
        console.log('[GroupChat] Canal fechado');
      }
    });

  process.on('SIGTERM', () => {
    try { getRealtimeClient().removeChannel(channel); } catch {}
  });

  return channel;
}

module.exports = { startGroupChatRealtime };
