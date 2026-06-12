// src/services/group-chat-bridge-out.js
// App → WhatsApp. Esta task entrega só a função PURA buildWhatsappText.
// O runner runOutboundOnce é adicionado na Task 5.
const ACTIONS_DELIM = '‹‹ACTIONS››';

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

// Converte uma row de group_chat_messages (channel='app') no texto a postar no WhatsApp.
// Retorna string, ou null quando NÃO deve espelhar (mídia, report, ou TOM sem prosa).
function buildWhatsappText(msg, senderName) {
  if (!msg || (msg.kind && msg.kind !== 'text')) return null; // v1: só texto
  if (msg.role === 'tom') {
    const prose = String(msg.content || '').split(ACTIONS_DELIM)[0].trim();
    return prose || null;
  }
  const body = String(msg.content || '').trim();
  if (!body) return null;
  const nm = firstName(senderName);
  return nm ? `💬 *${nm}*: ${body}` : `💬 ${body}`;
}

// Espelha pro WhatsApp as mensagens nascidas no app (channel='app') ainda não enviadas.
// deps.sendGroupText(jid, text) injetado (uazapi-groups). Degrada gracioso: 503 → re-tenta
// no próximo ciclo (deixa wa_message_id null). Marca 'skipped' o que não se espelha (mídia/report).
async function runOutboundOnce(supabase, deps, limit = 10) {
  const { data: groups } = await supabase.from('work_groups')
    .select('id, wa_group_jid').not('wa_group_jid', 'is', null);
  const byId = new Map((groups || []).map((g) => [g.id, g.wa_group_jid]));
  if (!byId.size) return 0;

  const { data: rows } = await supabase.from('group_chat_messages')
    .select('id, group_id, role, kind, content, sender_id, wa_sender_name, ' +
            'sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)')
    .in('group_id', [...byId.keys()])
    .eq('channel', 'app').is('wa_message_id', null)
    .order('created_at', { ascending: true }).limit(limit);

  let sent = 0;
  for (const m of rows || []) {
    const jid = byId.get(m.group_id);
    const senderName = m.sender?.preferred_name || m.sender?.full_name || m.wa_sender_name || '';
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

module.exports = { buildWhatsappText, firstName, runOutboundOnce };
