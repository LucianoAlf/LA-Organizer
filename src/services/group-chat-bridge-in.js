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
// Em @lid (id linkado do WhatsApp) os dígitos não casam com telefone → cai no match por NOME.
function extractSenderPhone(body) {
  const raw = String(getData(body)?.sender || '').replace(/\D/g, '');
  return raw || null;
}

// Normaliza um nome p/ comparação: minúsculas, sem acento, só alfanumérico + espaço.
function normalizeName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Casa o nome de exibição do WhatsApp ("Rose_Gerente Recreio", "Ana Paula Recepção/ADM",
// "Luciano Alf") contra os MEMBROS do grupo (full_name/preferred_name). Match = o senderName
// COMEÇA com o nome do colaborador (limite de palavra). Pega o nome mais LONGO que casa
// (ex.: "ana paula" ganha de "ana"). Restrito aos membros → sem falso-positivo externo.
// Retorna o collaborator.id ou null. A identidade vem do remetente real (perfil do WhatsApp),
// nunca do LLM — compatível com a regra de collaborator_id.
function matchMemberByName(senderName, members) {
  const s = normalizeName(senderName);
  if (!s) return null;
  let best = null, bestLen = 0;
  for (const m of members || []) {
    for (const cand of [m.preferred_name, m.full_name]) {
      const c = normalizeName(cand);
      if (!c) continue;
      if ((s === c || s.startsWith(c + ' ')) && c.length > bestLen) { best = m.id; bestLen = c.length; }
    }
  }
  return best;
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

    const waName = data.senderName || data.pushName || null;
    const phone = extractSenderPhone(body);
    let sender_id = null;
    // 1) por telefone (1:1 normal). Em grupo o participante quase sempre vem em @lid → falha.
    if (phone) {
      const { data: collab } = await supabase.from('collaborators')
        .select('id').or(`phone.eq.${phone},phone.eq.${phone.replace(/^55/, '')}`).maybeSingle();
      sender_id = collab?.id || null;
    }
    // 2) fallback por NOME, restrito aos membros do grupo (resolve avatar/nome no app +
    //    destrava o watcher, que ignora mensagem sem sender_id). Identidade = perfil real
    //    do WhatsApp do remetente, nunca do LLM.
    if (!sender_id && waName) {
      const { data: mem } = await supabase.from('work_group_members')
        .select('collaborator_id').eq('group_id', group.id);
      const ids = (mem || []).map((r) => r.collaborator_id).filter(Boolean);
      if (ids.length) {
        const { data: cols } = await supabase.from('collaborators')
          .select('id, full_name, preferred_name').in('id', ids);
        sender_id = matchMemberByName(waName, cols || []);
      }
    }

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

module.exports = { maybeHandleGroupMessage, isGroupMessage, extractGroupJid, extractSenderPhone, matchMemberByName, normalizeName };
