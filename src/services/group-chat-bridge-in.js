// src/services/group-chat-bridge-in.js
// WhatsApp → App. Chamado pelo webhook ANTES do isIgnorable. Trata só mensagens de
// GRUPO LINKADO (work_groups.wa_group_jid). Insere em group_chat_messages como role='member',
// channel='whatsapp' — o watcher (Fase 3) aciona o TOM normalmente.

// Normaliza o payload p/ o MESMO objeto que o whatsapp.getData() usa. O formato real da
// UAZAPI entrega { EventType, message:{...} } — NÃO body.data. Cobre os dois (e o
// formato {data:{...}} dos testes puros). Mantido local pra não puxar config/axios.
function getData(body) {
  if (body?.EventType && body?.messages?.length > 0) return body.messages[0];
  if (body?.EventType && body?.message) return body.message;
  if (body?.data) return body.data;
  return body;
}

function isGroupMessage(body) {
  return getData(body)?.isGroup === true;
}
function extractGroupJid(body) {
  return getData(body)?.chatid || null;
}
// Número do PARTICIPANTE que mandou (no grupo, o remetente é data.sender, não o chatid).
// Em @lid (id linkado do WhatsApp) os dígitos não casam com telefone → cai no fallback
// wa_sender_name lá embaixo (sender_id=null). Aceitável no v1.
function extractSenderPhone(body) {
  const raw = String(getData(body)?.sender || '').replace(/\D/g, '');
  return raw || null;
}

// Retorna { handled: boolean }. handled=true => o webhook deve PARAR (não seguir pro 1:1).
async function maybeHandleGroupMessage(supabase, body, helpers) {
  try {
    if (!isGroupMessage(body)) return { handled: false };
    const data = getData(body) || {};
    if (data.fromMe === true) return { handled: true }; // eco do bot — ignora
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
    const waName = data.senderName || data.pushName || null;

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
