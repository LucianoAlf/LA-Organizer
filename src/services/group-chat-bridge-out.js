// src/services/group-chat-bridge-out.js
// App → WhatsApp. Esta task entrega só a função PURA buildWhatsappText.
// O runner runOutboundOnce é adicionado na Task 5.
const ACTIONS_DELIM = '‹‹ACTIONS››';

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

// Converte o HTML do card de fechamento na formatação do WhatsApp (*negrito*, _itálico_,
// "• " em listas, quebras de linha entre blocos). Sem parser pesado: regex sobre as tags
// básicas que o card usa (h3/strong/em/li/p/br). Mantém hierarquia visual (não vira corrido).
function htmlToWhatsapp(html) {
  let t = String(html || '');
  // Tira cerca de código markdown (```html ... ```) que a IA às vezes embrulha no card.
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/\s*```\s*$/i, '');
  t = t
    .replace(/<\s*h[1-6][^>]*>/gi, '\n*').replace(/<\s*\/\s*h[1-6]\s*>/gi, '*\n')
    .replace(/<\s*(strong|b)[^>]*>/gi, '*').replace(/<\s*\/\s*(strong|b)\s*>/gi, '*')
    .replace(/<\s*(em|i)[^>]*>/gi, '_').replace(/<\s*\/\s*(em|i)\s*>/gi, '_')
    .replace(/<\s*li[^>]*>/gi, '\n• ').replace(/<\s*\/\s*li\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n').replace(/<\s*\/\s*(ul|ol|div)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ''); // tira o resto das tags
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  return t.split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Converte uma row de group_chat_messages (channel='app') no texto a postar no WhatsApp.
// Retorna string, ou null quando NÃO deve espelhar (mídia, ou TOM sem prosa).
function buildWhatsappText(msg, senderName) {
  if (!msg) return null;
  // Card de fechamento (kind='report', HTML): espelha como TEXTO formatado (Alf pediu o
  // resumo também no WhatsApp, não só no app).
  if (msg.role === 'tom' && msg.kind === 'report') {
    return htmlToWhatsapp(msg.content || '') || null;
  }
  if (msg.kind && msg.kind !== 'text') return null; // outras mídias: v1 não espelha
  if (msg.role === 'tom') {
    const prose = String(msg.content || '').split(ACTIONS_DELIM)[0].trim();
    return prose || null;
  }
  const body = String(msg.content || '').trim();
  if (!body) return null;
  const nm = firstName(senderName);
  return nm ? `💬 *${nm}*: ${body}` : `💬 ${body}`;
}

const KIND_TO_WA_TYPE = { image: 'image', pdf: 'document', audio: 'audio' };

// Converte uma row de mídia (channel='app') no payload de /send/media. null se não for
// mídia mirável ou se media_url ainda não existe (arquivo subindo). caption carrega a autoria.
function buildWhatsappMedia(msg, senderName) {
  if (!msg) return null;
  const type = KIND_TO_WA_TYPE[msg.kind];
  if (!type) return null;
  if (!msg.media_url) return null;
  const nm = firstName(senderName);
  const body = String(msg.content || '').trim();
  const caption = nm ? `💬 *${nm}*${body ? ': ' + body : ''}` : (body || '');
  const out = { type, url: msg.media_url, caption };
  if (msg.media_filename) out.filename = msg.media_filename;
  return out;
}

// Espelha pro WhatsApp as mensagens nascidas no app (channel='app') ainda não enviadas.
// deps.sendGroupText(jid, text) injetado (uazapi-groups). Degrada gracioso: 503 → re-tenta
// no próximo ciclo (deixa wa_message_id null). Marca 'skipped' o que não se espelha (mídia/report).
async function runOutboundOnce(supabase, deps, limit = 10) {
  const { data: groups } = await supabase.from('work_groups')
    .select('id, wa_group_jid, wa_linked_at').not('wa_group_jid', 'is', null);
  const byId = new Map((groups || []).map((g) => [g.id, g.wa_group_jid]));
  if (!byId.size) return 0;

  // Guard anti-flood (GROUPCHAT-FASE4-BACKLOG-FLOOD): ao linkar um grupo ao WhatsApp, todo o
  // histórico do app (Fase 3) fica com wa_message_id NULL e seria despejado de uma vez no grupo
  // real. wa_linked_at (carimbado por trigger no momento do link) é o corte: tudo criado ANTES
  // do link é drenado como 'skipped' em massa (1 UPDATE/grupo, idempotente — 0 linhas após drenar)
  // ANTES do SELECT abaixo, então nem o 1º tick floda. Só o pós-link (created_at >= wa_linked_at)
  // segue pro envio. Sem wa_linked_at → não drena (preserva comportamento).
  for (const g of groups || []) {
    if (!g.wa_linked_at) continue;
    await supabase.from('group_chat_messages')
      .update({ wa_message_id: 'skipped' })
      .eq('group_id', g.id).eq('channel', 'app')
      .is('wa_message_id', null).lt('created_at', g.wa_linked_at);
  }

  const { data: rows } = await supabase.from('group_chat_messages')
    .select('id, group_id, role, kind, content, media_url, media_mime, media_filename, sender_id, wa_sender_name, ' +
            'sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)')
    .in('group_id', [...byId.keys()])
    .eq('channel', 'app').is('wa_message_id', null)
    .order('created_at', { ascending: true }).limit(limit);

  let sent = 0;
  for (const m of rows || []) {
    const jid = byId.get(m.group_id);
    const senderName = m.sender?.preferred_name || m.sender?.full_name || m.wa_sender_name || '';

    // MÍDIA (image/audio/pdf): manda via /send/media. Se media_url ainda não existe, deixa
    // pendente (não marca) — re-tenta quando o upload terminar.
    if (['image', 'audio', 'pdf'].includes(m.kind)) {
      const media = buildWhatsappMedia(m, senderName);
      if (!media) { continue; } // sem media_url ainda → re-tenta próximo tick
      try {
        const waId = await deps.sendGroupMedia(jid, { ...media, mimetype: m.media_mime || '' });
        await supabase.from('group_chat_messages').update({ wa_message_id: waId || 'sent' }).eq('id', m.id);
        sent++;
      } catch (e) {
        const st = e.response?.status;
        if (st && st !== 503) {
          // Erro DEFINITIVO da API (ex.: URL não-baixável, mídia inválida) → re-tentar não
          // resolve. Marca 'skipped' pra não martelar a UAZAPI a cada tick (loop infinito).
          console.error(`[Bridge-out] mídia DESCARTADA msg=${m.id} (${st}): ${JSON.stringify(e.response?.data || '').slice(0, 150)}`);
          await supabase.from('group_chat_messages').update({ wa_message_id: 'skipped' }).eq('id', m.id);
        } else {
          // Transitório (503 hibernação / timeout / rede) → re-tenta no próximo tick.
          console.error(`[Bridge-out] mídia falhou msg=${m.id} (re-tenta): ${st || 'net'} ${e.message}`);
        }
      }
      continue;
    }

    const text = buildWhatsappText(m, senderName);
    if (!text) {
      // nada a espelhar → marca pra não reprocessar todo ciclo
      await supabase.from('group_chat_messages').update({ wa_message_id: 'skipped' }).eq('id', m.id);
      continue;
    }
    try {
      const waId = await deps.sendGroupText(jid, text);
      await supabase.from('group_chat_messages').update({ wa_message_id: waId || 'sent' }).eq('id', m.id);
      sent++;
    } catch (e) {
      console.error(`[Bridge-out] falha msg=${m.id} (re-tenta): ${e.response?.status || ''} ${e.message}`);
      // NÃO marca wa_message_id → re-tenta no próximo tick (resiliente à hibernação 503)
    }
  }
  return sent;
}

module.exports = { buildWhatsappText, buildWhatsappMedia, firstName, runOutboundOnce };
