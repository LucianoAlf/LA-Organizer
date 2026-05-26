// src/services/message-buffer.js — Sprint 28
// ──────────────────────────────────────────────────────────────────────
// Buffer de agregação de mensagens por telefone.
//
// Problema resolvido: user manda PDF + emoji 👀 + texto curto em sequência
// rápida (típico no WhatsApp). Cada evento vira UMA chamada processMessage
// isolada — TOM responde 3 vezes, perde contexto entre elas, e às vezes
// alucina ("chegou duas vezes" quando só veio uma).
//
// Solução: agrupar eventos do mesmo phone dentro de uma janela de
// BUFFER_WINDOW_MS. Cada novo evento ESTENDE a janela (debounce). Quando
// a janela fecha sem novos eventos, o callback é chamado com TODOS os
// items acumulados — quem chamar agrupa em uma única processMessage.
//
// Política:
// - Janela: 3500ms (debounce). Claude já leva 8-15s, então delay é invisível.
// - Sem limite hard de items: usuário pode spammar — agrupamos tudo.
// - Reset no restart do PM2 (não persistente). Mensagens em trânsito durante
//   restart serão re-entregues pela UAZAPI ou perdidas (aceito — buffer = best
//   effort de UX).
// - Não interfere com dedupe.js (que roda ANTES, no webhook).
// - Não interfere com per-user-queue (que continua serializando o flush).

const BUFFER_WINDOW_MS = 3500;

const buffers = new Map(); // phone -> { items: [{text, raw, ts}], timer }

/**
 * Adiciona um item ao buffer do phone. Reseta o timer de debounce a cada add.
 * Quando o timer dispara, chama onFlush(items) UMA vez e limpa o buffer.
 *
 * @param {string} phone — número do user (já sem @s.whatsapp.net)
 * @param {string} text — texto da mensagem (pode incluir prefixos de mídia)
 * @param {object} raw — payload bruto do webhook (último vence pra messageId/reply)
 * @param {function} onFlush — callback(items: Array<{text, raw}>) — invocado após janela fechar
 */
function add(phone, text, raw, onFlush) {
  let b = buffers.get(phone);
  if (!b) {
    b = { items: [], timer: null };
    buffers.set(phone, b);
  }
  b.items.push({ text, raw, ts: Date.now() });
  if (b.timer) clearTimeout(b.timer);
  b.timer = setTimeout(() => {
    const items = b.items;
    buffers.delete(phone);
    try {
      onFlush(items);
    } catch (e) {
      console.error('[MsgBuffer] flush err:', e.message);
    }
  }, BUFFER_WINDOW_MS);
  if (b.items.length > 1) {
    console.log(`[MsgBuffer] phone=${phone.slice(-4)} accumulating (${b.items.length} items, window resets)`);
  }
}

function size() { return buffers.size; }

module.exports = { add, size, BUFFER_WINDOW_MS };
