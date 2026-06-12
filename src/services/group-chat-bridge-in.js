// src/services/group-chat-bridge-in.js
// WhatsApp → App. Chamado pelo webhook ANTES do isIgnorable. Trata só mensagens de
// GRUPO LINKADO (work_groups.wa_group_jid). Insere em group_chat_messages como role='member',
// channel='whatsapp' — o watcher (Fase 3) aciona o TOM normalmente.

function isGroupMessage(body) {
  return body?.data?.isGroup === true;
}
function extractGroupJid(body) {
  return body?.data?.chatid || null;
}
// Número do PARTICIPANTE que mandou (no grupo, o remetente é data.sender, não o chatid).
function extractSenderPhone(body) {
  const raw = String(body?.data?.sender || '').replace(/\D/g, '');
  return raw || null;
}

// Retorna { handled: boolean }. handled=true => o webhook deve PARAR (não seguir pro 1:1).
async function maybeHandleGroupMessage(supabase, body, helpers) {
  try {
    if (!isGroupMessage(body)) return { handled: false };
    if (body?.data?.fromMe === true) return { handled: true }; // eco do bot — ignora
    const jid = extractGroupJid(body);
    if (!jid) return { handled: false };

    const { data: group } = await supabase.from('work_groups')
      .select('id').eq('wa_group_jid', jid).maybeSingle();
    if (!group) return { handled: false }; // grupo não linkado → deixa o fluxo normal descartar

    const waId = helpers.extractMessageId(body) || null;
    if (waId) {
      const { data: dup } = await supabase.from('group_chat_messages')
        .select('id').eq('wa_message_id', waId).maybeSingle();
      if (dup) return { handled: true }; // já espelhada
    }

    const text = helpers.extractText(body);
    if (!text || !String(text).trim()) return { handled: true }; // v1: só texto

    const phone = extractSenderPhone(body);
    let sender_id = null;
    if (phone) {
      const { data: collab } = await supabase.from('collaborators')
        .select('id').or(`phone.eq.${phone},phone.eq.${phone.replace(/^55/, '')}`).maybeSingle();
      sender_id = collab?.id || null;
    }
    const waName = body?.data?.senderName || body?.data?.pushName || null;

    await supabase.from('group_chat_messages').insert({
      group_id: group.id,
      sender_id,
      role: 'member',
      kind: 'text',
      content: String(text).trim(),
      channel: 'whatsapp',
      wa_message_id: waId,
      wa_sender_name: sender_id ? null : waName,
    });
    console.log(`[Bridge-in] WA→app grupo=${group.id} sender=${sender_id ? 'collab' : (waName || '?')}`);
    return { handled: true };
  } catch (e) {
    console.error('[Bridge-in] erro:', e.message);
    return { handled: true }; // erro nosso: não cair no fluxo 1:1 com payload de grupo
  }
}

module.exports = { maybeHandleGroupMessage, isGroupMessage, extractGroupJid, extractSenderPhone };
