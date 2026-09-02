// src/services/group-chat-bridge-in.js
// WhatsApp → App. Chamado pelo webhook ANTES do isIgnorable. Trata só mensagens de
// GRUPO LINKADO (work_groups.wa_group_jid). Insere em group_chat_messages como role='member',
// channel='whatsapp' — o watcher (Fase 3) aciona o TOM normalmente.

const qaIsolation = require('./qa-isolation');

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
// `aliases` entra junto de preferred_name/full_name: em grupo @lid a identidade sai do NOME do
// perfil do WhatsApp, e quem se apresenta lá com outro nome ("Fernanda ADM Recreio" pra quem é
// "Fefê" no cadastro) entrava SEM AUTOR — a falha muda de sempre. O casamento segue ancorado no
// começo do nome e restrito aos MEMBROS do grupo, então alias não abre porta pra estranho.
function matchMemberByName(senderName, members) {
  const s = normalizeName(senderName);
  if (!s) return null;
  let best = null, bestLen = 0;
  for (const m of members || []) {
    const apelidos = Array.isArray(m.aliases) ? m.aliases : [];
    for (const cand of [m.preferred_name, m.full_name, ...apelidos]) {
      const c = normalizeName(cand);
      if (!c) continue;
      if ((s === c || s.startsWith(c + ' ')) && c.length > bestLen) { best = m.id; bestLen = c.length; }
    }
  }
  return best;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

// Troca menções @<lid> pelo @<PrimeiroNome>. lidToName: { '61087554768984': 'Rose' }.
// Não-resolvidas ficam como estão (cosmético, nunca quebra).
function resolveMentions(text, lidToName) {
  if (!text || !lidToName) return text;
  return String(text).replace(/@(\d{5,})/g, (m, lid) => (lidToName[lid] ? `@${lidToName[lid]}` : m));
}

// Cache curto dos participantes por JID (evita bater /group/info a cada menção).
const _partCache = new Map(); // jid -> { at, parts }
async function getParticipantsCached(fetchFn, jid) {
  const hit = _partCache.get(jid);
  const now = Date.now();
  if (hit && now - hit.at < 5 * 60 * 1000) return hit.parts;
  const parts = await fetchFn(jid);
  _partCache.set(jid, { at: now, parts });
  return parts;
}

// Colaboradores que são membros do grupo (id, nomes, phone) — reusado p/ identidade e menções.
async function loadGroupMembers(supabase, groupId) {
  const { data: mem } = await supabase.from('work_group_members')
    .select('collaborator_id').eq('group_id', groupId);
  const ids = (mem || []).map((r) => r.collaborator_id).filter(Boolean);
  if (!ids.length) return [];
  const { data: cols } = await supabase.from('collaborators')
    .select('id, full_name, preferred_name, phone, aliases').in('id', ids);
  return cols || [];
}

// Extrai os wa_message_id apagados de um evento messages_update. DEFENSIVO: só retorna id
// quando há sinal explícito de deleção (status 'Deleted'/'Revoked' OU wasDeleted/isDeleted/deleted).
// Sem sinal → []. Assim um update de leitura/edição NUNCA apaga por engano.
function parseDeletedWaIds(body) {
  if (!body || body.EventType !== 'messages_update') return [];
  const ev = body.event || {};
  // Sinal de deleção (formato real UAZAPI): type='DeletedMessage' / state='Deleted' / event.Type='Deleted'.
  const isDel = body.type === 'DeletedMessage'
    || String(body.state || '').toLowerCase() === 'deleted'
    || String(ev.Type || '').toLowerCase() === 'deleted';
  if (!isDel) return [];
  const ids = Array.isArray(ev.MessageIDs) ? ev.MessageIDs
    : (ev.MessageID ? [ev.MessageID] : []);
  return ids.filter(Boolean);
}

// Trata o evento messages_update (deleção feita no WhatsApp). Marca deleted_at nas rows
// cujo wa_message_id casa, em grupos LINKADOS. deleted_synced=true (não re-ecoa pro zap).
async function maybeHandleGroupDelete(supabase, body) {
  try {
    if (!body || body.EventType !== 'messages_update') return { handled: false };
    const ids = parseDeletedWaIds(body);
    if (!ids.length) return { handled: true }; // update sem deleção → consome e ignora
    for (const waId of ids) {
      // O id do evento vem SEM prefixo; o stored (msg vinda do zap) pode ter 'sender:'.
      // Casa por sufixo (termina com o id). waId é hex → sem caractere especial de LIKE.
      await supabase.from('group_chat_messages')
        .update({ deleted_at: new Date().toISOString(), deleted_origin: 'whatsapp', deleted_synced: true })
        .like('wa_message_id', `%${waId}`).is('deleted_at', null);
    }
    console.log(`[Bridge-in] WA delete espelhado: ${ids.length} msg(s)`);
    return { handled: true };
  } catch (e) {
    console.error('[Bridge-in] erro delete:', e.message);
    return { handled: true };
  }
}

// Detecta o tipo de mídia do payload usando os detectores do whatsapp.js (injetados).
function mediaKindFromBody(body, d) {
  if (d.isAudioMessage(body)) return 'audio';
  if (d.isImageMessage(body)) return 'image';
  if (d.isDocumentMessage(body)) return 'pdf';
  return null;
}

// Retorna { handled: boolean }. handled=true => o webhook deve PARAR (não seguir pro 1:1).
async function maybeHandleGroupMessage(supabase, body, helpers) {
  try {
    if (!isGroupMessage(body)) return { handled: false };
    const data = getData(body) || {};
    if (data.fromMe === true) return { handled: true }; // eco do bot — ignora

    // ---- Isolamento do Replay Lab (spec 05/08, fronteira do grupo) ----
    // Perfil de QA nunca participa de chat de grupo: uma mensagem de cenário espelhada
    // num grupo real apareceria na frente do time. Grupo tem caminho próprio e fica
    // fora da Fase 1 — o guard garante isso por CÓDIGO, não por combinado.
    const _remetenteQA = extractSenderPhone(body);
    if (_remetenteQA && !qaIsolation.permiteGrupo(_remetenteQA)) {
      console.warn(`[QA] mensagem de perfil de teste em grupo — descartada (${_remetenteQA})`);
      return { handled: true };
    }
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

    // Detecta mídia (image/audio/pdf). v2: mídia espelhada; texto segue como v1.
    const mkind = helpers.mediaDetectors ? mediaKindFromBody(body, helpers.mediaDetectors) : null;
    let text = helpers.extractText(body); // em imagem/doc, devolve a caption
    if (!mkind && (!text || !String(text).trim())) return { handled: true }; // texto vazio e sem mídia
    text = text ? String(text).trim() : '';

    const waName = data.senderName || data.pushName || null;
    const phone = extractSenderPhone(body);
    const hasMention = /@\d{5,}/.test(text);
    let sender_id = null;
    // 1) por telefone (1:1 normal). Em grupo o participante quase sempre vem em @lid → falha.
    if (phone) {
      const { data: collab } = await supabase.from('collaborators')
        .select('id').or(`phone.eq.${phone},phone.eq.${phone.replace(/^55/, '')}`).maybeSingle();
      sender_id = collab?.id || null;
    }
    // Membros do grupo (carregados 1x) — p/ match de identidade por nome E p/ resolver menções.
    let members = null;
    if ((!sender_id && waName) || hasMention) members = await loadGroupMembers(supabase, group.id);
    // 2) fallback de identidade por NOME (resolve avatar/nome no app + destrava o watcher).
    if (!sender_id && waName && members) sender_id = matchMemberByName(waName, members);

    // MÍDIA: baixa da UAZAPI → sobe no bucket group-chat → insere. O watcher (extractMediaText)
    // transcreve áudio / analisa imagem → TOM entende. Degrada gracioso: falha → loga e pula.
    if (mkind) {
      let media_url = null, media_mime = null, media_filename = null;
      try {
        const dl = await helpers.downloadMedia(body); // { buffer, mime }
        if (!dl || !dl.buffer) { console.warn('[Bridge-in] download de mídia vazio — pula'); return { handled: true }; }
        media_mime = dl.mime || null;
        const ext = (media_mime && media_mime.includes('/')) ? media_mime.split('/')[1].split(';')[0]
          : (mkind === 'pdf' ? 'pdf' : mkind === 'audio' ? 'ogg' : 'jpg');
        media_filename = dl.filename || `${mkind}.${ext}`;
        const path = `${group.id}/wa-${waId || Date.now()}.${ext}`;
        const up = await supabase.storage.from('group-chat').upload(path, dl.buffer, { contentType: media_mime || undefined, upsert: true });
        if (up.error) { console.error('[Bridge-in] upload falhou:', up.error.message); return { handled: true }; }
        media_url = supabase.storage.from('group-chat').getPublicUrl(path).data.publicUrl;
      } catch (e) { console.error('[Bridge-in] erro mídia (pula):', e.message); return { handled: true }; }

      await supabase.from('group_chat_messages').insert({
        group_id: group.id, sender_id, role: 'member', kind: mkind,
        content: text || null, media_url, media_mime, media_filename,
        channel: 'whatsapp', wa_message_id: waId, wa_sender_name: sender_id ? null : waName,
      });
      console.log(`[Bridge-in] WA→app MÍDIA(${mkind}) grupo=${group.id}`);
      return { handled: true };
    }

    // Menções no texto: @<lid> → @<PrimeiroNome>.
    if (hasMention && helpers.getGroupParticipants && members && members.length) {
      try {
        const parts = await getParticipantsCached(helpers.getGroupParticipants, jid);
        const phoneToName = new Map(members
          .filter((m) => m.phone)
          .map((m) => [String(m.phone).replace(/\D/g, ''), firstName(m.preferred_name || m.full_name)]));
        const lidToName = {};
        for (const p of parts) { const nm = phoneToName.get(p.phone); if (nm) lidToName[p.lid] = nm; }
        text = resolveMentions(text, lidToName);
      } catch (e) { /* menção é cosmética — segue com o texto cru */ }
    }

    await supabase.from('group_chat_messages').insert({
      group_id: group.id,
      sender_id,
      role: 'member',
      kind: 'text',
      content: text,
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

module.exports = { maybeHandleGroupMessage, isGroupMessage, extractGroupJid, extractSenderPhone, matchMemberByName, normalizeName, resolveMentions, firstName, mediaKindFromBody, parseDeletedWaIds, maybeHandleGroupDelete };
