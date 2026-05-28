// src/services/webhook-persistence.js
// Sprint WQ — Webhook persistence queue.
//
// Problema raiz: shutdown.js chamava server.close() imediatamente no SIGINT,
// fechando a porta 3100 por ~23s enquanto o processo anterior terminava.
// Webhooks que chegavam nessa janela recebiam connection refused e eram perdidos.
//
// Solução:
//   1. shutdown.js NÃO chama mais server.close() — porta fica aberta.
//   2. webhook.js detecta isInShutdown() → salva o payload aqui, retorna 200.
//   3. No próximo startup, index.js chama replayPending() → processa os salvos.

const supabase = require('../supabase/client');

/**
 * Salva um payload de webhook no banco durante graceful shutdown.
 * Retorna silenciosamente em caso de erro (não pode deixar o webhook.js falhar).
 *
 * @param {object} payload - req.body original do webhook
 */
async function saveToQueue(payload) {
  try {
    const { error } = await supabase
      .from('webhook_queue')
      .insert({ payload, status: 'pending' });
    if (error) {
      console.error('[WebhookQueue] save err:', error.message);
    } else {
      const phone = payload?.chat?.phone || payload?.message?.chatid || '?';
      console.log(`[WebhookQueue] saved during shutdown (phone=...${String(phone).slice(-4)})`);
    }
  } catch (e) {
    console.error('[WebhookQueue] save throw:', e.message);
  }
}

/**
 * Replaya webhooks pendentes do banco (max 2h atrás).
 * Chamado pelo index.js 2s após o startup, após TOM estar pronto.
 *
 * @param {Function} processFn - async (body: object) => void — processWebhookBody do webhook.js
 */
async function replayPending(processFn) {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('webhook_queue')
      .select('id, payload, received_at')
      .eq('status', 'pending')
      .gte('received_at', cutoff)
      .order('received_at', { ascending: true });

    if (error) {
      console.error('[WebhookQueue] replay query err:', error.message);
      return;
    }
    if (!data || data.length === 0) return;

    console.log(`[WebhookQueue] replaying ${data.length} pending webhook(s) from shutdown window`);

    for (const row of data) {
      // Optimistic lock: só processa se ainda estiver 'pending'
      const { error: lockErr, count } = await supabase
        .from('webhook_queue')
        .update({ status: 'processing' })
        .eq('id', row.id)
        .eq('status', 'pending')
        .select('id', { count: 'exact', head: true });

      if (lockErr) {
        console.warn('[WebhookQueue] lock err:', lockErr.message);
        continue;
      }
      // count === 0 → outra instância já pegou (não deve acontecer com pm2 fork)
      if (count === 0) {
        console.log(`[WebhookQueue] skip id=${row.id.slice(0, 8)} — already claimed`);
        continue;
      }

      try {
        await processFn(row.payload);
        await supabase
          .from('webhook_queue')
          .update({ status: 'done', processed_at: new Date().toISOString() })
          .eq('id', row.id);
        const age = Math.round((Date.now() - new Date(row.received_at).getTime()) / 1000);
        console.log(`[WebhookQueue] replayed id=${row.id.slice(0, 8)} (${age}s ago)`);
      } catch (e) {
        console.error(`[WebhookQueue] replay err id=${row.id.slice(0, 8)}:`, e.message);
        await supabase
          .from('webhook_queue')
          .update({ status: 'failed', error_msg: e.message.slice(0, 500) })
          .eq('id', row.id);
      }
    }
  } catch (e) {
    console.error('[WebhookQueue] replayPending throw:', e.message);
  }
}

module.exports = { saveToQueue, replayPending };
