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
// Identidade CRUA do remetente, sem o que não é identidade.
// O WhatsApp entrega o remetente como "<id>[:<aparelho>]@<dominio>". O ":<aparelho>" aparece
// quando a pessoa fala de um celular/desktop VINCULADO — é o número do APARELHO, não dela.
// Tirar "todo caractere não-dígito" (como era antes) EMENDAVA o aparelho no id: um lid de 15
// dígitos virava 17 e não casava mais com o lid de 15 do /group/info. Foi assim que a "Fê ✨"
// mandou 10 mensagens numa manhã e nenhuma teve autor (Administração Recreio, 04/09).
function idDoRemetente(raw) {
  const local = String(raw || '').split('@')[0].split(':')[0];
  return local.replace(/\D/g, '') || null;
}

// Número do PARTICIPANTE que mandou (no grupo, o remetente é data.sender, não o chatid).
// Em @lid (id linkado do WhatsApp) os dígitos não são telefone → quem resolve é o degrau do lid.
function extractSenderPhone(body) {
  return idDoRemetente(getData(body)?.sender);
}

// Normaliza um nome p/ comparação: minúsculas, sem acento, só alfanumérico + espaço.
function normalizeName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Casa por TELEFONE, com a regra do 9º dígito do Brasil: o WhatsApp devolve ora com, ora sem o
// 9 inicial do celular, e o cadastro guarda de um jeito só. Compara pelos últimos dígitos nas
// duas formas — sem isso o casamento erra em massa e a pessoa fica SEM AUTOR.
function chavesTelefone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length < 8) return [];
  // Tira o DDI 55 EXPLICITAMENTE. Fatiar "os ultimos 11" quebra o numero SEM o 9: ele tem 12
  // digitos com o 55 (55 + DDD + 8), e o corte comia o DDD — a Vitoria, DDD 31, virava 53, e
  // ela ficava sem autor. Medido no ADM CG em 02/09.
  const on = (d.length >= 12 && d.startsWith('55')) ? d.slice(2) : d;
  const sem9 = on.length === 11 ? on.slice(0, 2) + on.slice(3) : on;
  return [...new Set([on, sem9])];
}

function matchMemberByPhone(phone, members) {
  const alvo = new Set(chavesTelefone(phone));
  if (!alvo.size) return null;
  for (const m of members || []) {
    if (chavesTelefone(m.phone).some((k) => alvo.has(k))) return m.id;
  }
  return null;
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
//
// ONDE ESTÁ A LINHA DO RISCO (revisão 04/09). O emoji/acento/caixa já morrem no normalizeName —
// "Anne ✨" vira "anne". O que faltava era o caminho INVERSO: o perfil traz só o COMEÇO do nome
// ("Anne" para quem é "Anne Susan"). Isso entrou, mas com duas travas:
//   1) o casamento invertido só vale no LIMITE DE PALAVRA ("anne susan" começa com "anne "), e
//   2) só quando UMA ÚNICA pessoa casa — "Ana" com "Ana Paula" e "Ana Beatriz" no mesmo grupo
//      fica SEM AUTOR de propósito.
// O que NÃO entrou: casar por pedaço DENTRO da palavra. "Fê" é começo de "Fefê", mas também de
// "Fernanda", "Felipe", "Fernando" — duas letras de um perfil qualquer não podem carregar a
// identidade de uma pessoa real, porque autor errado abre execução em nome de quem não pediu.
// Quem resolve a Fefê é o TELEFONE (degrau do lid); pro nome, o rastro avisa o dono, que
// cadastra "Fê" como alias — porta revisada por humano.
function matchMemberByName(senderName, members) {
  const s = normalizeName(senderName);
  if (!s) return null;
  const candidatosDe = (m) => [m.preferred_name, m.full_name, ...(Array.isArray(m.aliases) ? m.aliases : [])];

  // (1) O nome do perfil COMEÇA com o nome do cadastro ("Rose_Gerente Recreio" → "Rose").
  let best = null, bestLen = 0, empate = false;
  for (const m of members || []) {
    for (const cand of candidatosDe(m)) {
      const c = normalizeName(cand);
      if (!c) continue;
      if (s !== c && !s.startsWith(c + ' ')) continue;
      if (c.length > bestLen) { best = m.id; bestLen = c.length; empate = false; }
      else if (c.length === bestLen && best && best !== m.id) empate = true; // duas PESSOAS empatadas
    }
  }
  if (empate) return null; // empate entre pessoas diferentes: calar é melhor que chutar
  if (best) return best;

  // (2) Caminho inverso: o perfil traz só o começo ("Anne" → "Anne Susan"). Único ou nada.
  if (s.length < 2) return null;
  const donos = new Set();
  for (const m of members || []) {
    for (const cand of candidatosDe(m)) {
      const c = normalizeName(cand);
      if (c && c.startsWith(s + ' ')) donos.add(m.id);
    }
  }
  return donos.size === 1 ? [...donos][0] : null;
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

// Cache curto dos participantes por JID (evita bater /group/info a cada menção). 5 minutos.
// NÃO guarda lista vazia: uma resposta vazia é quase sempre soluço da UAZAPI, e guardá-la
// cegava o degrau do lid por 5 minutos inteiros sem ninguém saber.
const _partCache = new Map(); // jid -> { at, parts }
async function getParticipantsCached(fetchFn, jid) {
  const hit = _partCache.get(jid);
  const now = Date.now();
  if (hit && now - hit.at < 5 * 60 * 1000) return hit.parts;
  const parts = await fetchFn(jid);
  if (Array.isArray(parts) && parts.length) _partCache.set(jid, { at: now, parts });
  return parts;
}
// Cadastro inteiro em cache curto, usado SÓ pra CONFERIR identidade (nunca pra decidir).
let _cadastroCache = { at: 0, rows: null };
async function cadastroParaConferencia(supabase) {
  const now = Date.now();
  if (_cadastroCache.rows && now - _cadastroCache.at < 5 * 60 * 1000) return _cadastroCache.rows;
  const { data } = await supabase.from('collaborators').select('id, full_name, preferred_name, aliases');
  if (data && data.length) _cadastroCache = { at: now, rows: data };
  return data || [];
}

// Só pros testes: os caches são de módulo e vivem junto com o processo.
function _limpaCacheParticipantes() { _partCache.clear(); _cadastroCache = { at: 0, rows: null }; }

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

// Procura no CADASTRO INTEIRO por telefone. Telefone é identificador DURO: não muda quando a
// pessoa edita o perfil e não se repete entre pessoas — por isso ele pode olhar além de
// work_group_members (o degrau 1, por telefone, já olha o cadastro todo; o degrau do lid olhava
// só os membros e ficava, sem motivo, mais fraco que ele com a MESMA evidência).
// Sem esta ponte, quem está no grupo do WhatsApp mas ainda não tem linha em work_group_members
// fica invisível pra sempre mesmo com o telefone batendo — medido no ADM Barra em 04/09.
// Exige casamento ÚNICO: dois cadastros no mesmo número é dado sujo, e aí calar é o certo.
async function achaNoCadastroPorTelefone(supabase, telefone) {
  const alvo = new Set(chavesTelefone(telefone));
  if (!alvo.size) return { id: null, ambiguo: false };
  const { data } = await supabase.from('collaborators').select('id, phone');
  const ids = [...new Set((data || [])
    .filter((c) => chavesTelefone(c.phone).some((k) => alvo.has(k)))
    .map((c) => c.id))];
  return { id: ids.length === 1 ? ids[0] : null, ambiguo: ids.length > 1 };
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
      // Só os 4 últimos dígitos: log não carrega dado pessoal, e 4 dígitos já distinguem perfis.
      console.warn(`[QA] mensagem de perfil de teste em grupo — descartada (final ${_remetenteQA.slice(-4)})`);
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
    // TRILHA: cada degrau escreve aqui POR QUE não resolveu. Sem isso, 10 mensagens de uma
    // gerente atravessaram uma manhã inteira sem autor e ninguém ficou sabendo (04/09).
    // Nunca guarda telefone/lid — só o motivo. Dado pessoal não entra em log.
    const trilha = [];
    // 1) por telefone (1:1 normal). Em grupo o participante quase sempre vem em @lid → falha.
    if (!phone) trilha.push('telefone:evento sem remetente');
    if (phone) {
      const { data: collab } = await supabase.from('collaborators')
        .select('id').or(`phone.eq.${phone},phone.eq.${phone.replace(/^55/, '')}`).maybeSingle();
      sender_id = collab?.id || null;
      if (!sender_id) trilha.push('telefone:remetente nao e telefone conhecido (grupo em modo lid)');
    }
    // Membros do grupo (carregados 1x) — p/ identidade por telefone/nome E p/ menções.
    let members = null;
    if (!sender_id || hasMention) members = await loadGroupMembers(supabase, group.id);

    // 1b) @lid → TELEFONE pelos PARTICIPANTES do grupo. Em grupo no modo lid os dígitos do
    // remetente não são telefone, e a identidade caía toda no nome do perfil — que a pessoa
    // escolhe e muda. No ADM CG (02/09) o perfil do Jhon chega como "n." literal: 6 mensagens
    // sem autor, e sem autor o TOM não processa — ele ficou MUDO pra ele. O par (lid, phone)
    // já vem de /group/info e o cache já existe; só não era usado pra identidade.
    // Número não muda com o humor de quem edita o perfil.
    // O `members.length` saiu da porta de entrada: grupo sem membro cadastrado ainda pode ter
    // o remetente no cadastro geral, e barrar aqui matava o degrau antes de ele tentar.
    if (!sender_id && phone && helpers.getGroupParticipants) {
      try {
        const parts = await getParticipantsCached(helpers.getGroupParticipants, jid);
        if (!Array.isArray(parts) || !parts.length) {
          trilha.push('lid:/group/info devolveu lista de participantes VAZIA');
        } else {
          // Normaliza o lid do participante do mesmo jeito que o do remetente (o ":aparelho"
          // pode aparecer dos dois lados) — a comparação tem que ser entre iguais.
          const hit = parts.find((p) => idDoRemetente(p.lid) === phone);
          if (!hit) trilha.push('lid:remetente nao esta na lista de participantes do grupo');
          else if (!hit.phone) trilha.push('lid:participante sem telefone no /group/info');
          else {
            sender_id = matchMemberByPhone(hit.phone, members);
            if (!sender_id) {
              const noCadastro = await achaNoCadastroPorTelefone(supabase, hit.phone);
              if (noCadastro.ambiguo) trilha.push('lid:telefone AMBIGUO — mais de um cadastro no mesmo numero');
              else if (noCadastro.id) {
                sender_id = noCadastro.id;
                console.warn(`[Bridge-in] identidade por TELEFONE fora de work_group_members: grupo=${group.id} perfil=${JSON.stringify(waName)} colaborador=${sender_id} — vale a pena incluir no grupo do app`);
              } else trilha.push('lid:telefone do participante nao esta no cadastro');
            }
          }
        }
      } catch (e) {
        // Antes era `catch (_) {}`: o degrau podia estar morto há dias sem deixar marca.
        trilha.push(`lid:falhou (${e.message})`);
        console.warn(`[Bridge-in] degrau do lid falhou grupo=${group.id}: ${e.message}`);
      }
    }

    const veioDoTelefone = !!sender_id; // degrau 1 ou degrau do lid: evidência DURA

    // 2) fallback de identidade por NOME (resolve avatar/nome no app + destrava o watcher).
    if (!sender_id && waName && members) {
      sender_id = matchMemberByName(waName, members);
      if (!sender_id) trilha.push('nome:perfil do WhatsApp nao casa com nome/apelido de nenhum membro');
    } else if (!sender_id && !waName) trilha.push('nome:evento sem nome de perfil');

    // CONFLITO DE IDENTIDADE: o telefone aponta uma pessoa e o nome do perfil aponta OUTRA,
    // também cadastrada. NÃO muda o autor — telefone é a evidência dura e mudar por causa do
    // nome era justamente o erro que a gente saiu de. Mas grita, porque isso é cadastro sujo:
    // medido em 04/09, o número gravado na linha de "Krissya" é o número do perfil "Anne", e
    // as mensagens da Anne entram como Krissya. Sem este aviso o TOM fala em nome de quem não
    // pediu e ninguém enxerga.
    if (sender_id && veioDoTelefone && waName) {
      try {
        const porNome = matchMemberByName(waName, await cadastroParaConferencia(supabase));
        if (porNome && porNome !== sender_id) {
          console.warn(`[Bridge-in] CONFLITO DE IDENTIDADE grupo=${group.id} perfil=${JSON.stringify(waName)} — `
            + `telefone aponta colaborador=${sender_id} e o nome do perfil aponta=${porNome}. `
            + 'Autor fica pelo TELEFONE; o cadastro precisa de conferência humana.');
        }
      } catch (e) { console.warn(`[Bridge-in] conferencia de identidade falhou: ${e.message}`); }
    }

    // O SILÊNCIO NUNCA MAIS: toda mensagem que termina sem autor deixa rastro com quem tentou
    // falar, em qual grupo e em que degrau a cadeia parou. Vale pra texto E pra mídia.
    if (!sender_id) {
      console.warn(`[Bridge-in] SEM AUTOR grupo=${group.id} perfil=${JSON.stringify(waName || '(sem nome de perfil)')} `
        + `parou_em=${JSON.stringify(trilha[trilha.length - 1] || 'nenhum degrau rodou')} trilha=${JSON.stringify(trilha.join(' > '))}`);
    }

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
      } catch (e) { console.warn(`[Bridge-in] mencoes nao resolvidas grupo=${group.id}: ${e.message}`); }
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

module.exports = { maybeHandleGroupMessage, isGroupMessage, extractGroupJid, extractSenderPhone, idDoRemetente, matchMemberByName, matchMemberByPhone, achaNoCadastroPorTelefone, chavesTelefone, normalizeName, resolveMentions, firstName, mediaKindFromBody, parseDeletedWaIds, maybeHandleGroupDelete, getParticipantsCached, _limpaCacheParticipantes };
