// src/services/whatsapp.js — Serviço de envio WhatsApp via UAZAPI
// Docs: https://docs.uazapi.com
// Instância TOM: https://lamusic.uazapi.com

const axios = require('axios');
const config = require('../config');
const { extractSentMessageId } = require('./sent-message-id');

const api = axios.create({
  baseURL: config.uazapi.url,
  headers: {
    'Content-Type': 'application/json',
    token: config.uazapi.token, // UAZAPI usa header 'token', não 'Authorization'
  },
  timeout: 15000,
});

const SEND_RETRIES = 2;             // tentativas EXTRA além da 1ª (total 3)
const SEND_RETRY_DELAY_MS = 1500;   // backoff: 1.5s, depois 3s
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A UAZAPI dá 404 INTERMITENTE no /send/text (resolução de número/chat) — visto desde 22/05 com
// vários números. 404/408/429/5xx e falhas de rede (sem status) são transitórios → re-tentar entrega.
// 400/401/403 (payload/token inválido) NÃO: re-tentar não muda. Em 404 a UAZAPI respondeu "não enviei",
// então o retry não duplica.
function isRetriableSendError(err) {
  const status = err.response && err.response.status;
  if (!status) return true; // timeout/ECONNRESET/DNS — sem resposta
  if (status === 404 || status === 408 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

/**
 * Envia mensagem de texto via WhatsApp (com retry em falha transitória da UAZAPI).
 */
async function sendMessage(phone, text) {
  // QA log — capped at 200 chars to avoid log spam, helps catch leaks in pm2 logs.
  console.log('[OUT]', String(text || '').substring(0, 200));

  let lastErr;
  for (let attempt = 0; attempt <= SEND_RETRIES; attempt++) {
    try {
      const r = await _postEnviar('/send/text', {
        number: phone,
        text: text,
        readchat: true,
      }, { phone, tipo: 'texto' });
      if (r.bloqueado) return null;
      console.log(`[WhatsApp] Mensagem enviada pra ${phone.slice(-4)}${attempt ? ` (tentativa ${attempt + 1})` : ''}`);
      return r.data;
    } catch (err) {
      lastErr = err;
      const status = (err.response && err.response.status) || 'none';
      const body = err.response && err.response.data ? JSON.stringify(err.response.data).slice(0, 300) : '';
      console.error(`[WhatsApp] Erro ao enviar pra ${phone} (tentativa ${attempt + 1}/${SEND_RETRIES + 1}): status=${status} ${err.message} ${body}`);
      if (attempt < SEND_RETRIES && isRetriableSendError(err)) {
        await _sleep(SEND_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Envia mensagem com botões de resposta rápida
 * UAZAPI usa /send/menu com type: "button"
 */
async function sendButtons(phone, text, buttons, footer = '') {
  try {
    const r = await _postEnviar('/send/menu', {
      number: phone,
      type: 'button',
      text: text,
      choices: buttons.map((b, i) => `${b}|btn_${i}`),
      footerText: footer,
      delay: 2000,
      readchat: true,
    }, { phone, tipo: 'botões' });
    if (r.bloqueado) return null;
    return r.data;
  } catch (err) {
    // Fallback: manda como texto normal se botões falharem
    console.warn('[WhatsApp] Botões falharam, enviando como texto');
    const fallbackText = `${text}\n\nOpções:\n${buttons.map((b, i) => `${i + 1}. ${b}`).join('\n')}`;
    return sendMessage(phone, fallbackText);
  }
}

/**
 * Envia mensagem com lista (menu mais complexo)
 */
async function sendList(phone, text, items, buttonText = 'Ver opções') {
  try {
    const r = await _postEnviar('/send/menu', {
      number: phone,
      type: 'list',
      text: text,
      choices: items,
      listButton: buttonText,
      delay: 2000,
      readchat: true,
    }, { phone, tipo: 'lista' });
    if (r.bloqueado) return null;
    return r.data;
  } catch (err) {
    console.warn('[WhatsApp] Lista falhou, enviando como texto');
    const fallbackText = `${text}\n\n${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;
    return sendMessage(phone, fallbackText);
  }
}

/**
 * Envia indicador de "digitando..." pro chat — UX feels instant.
 * Fire-and-forget: nunca lança erro pra cima.
 * UAZAPI: POST /message/presence { number, presence: "composing" }
 */
async function setTyping(chatid) {
  try {
    const number = String(chatid || '').split('@')[0];
    if (!number) return;
    await api.post('/message/presence', { number, presence: 'composing' }, { timeout: 5000 });
    console.log(`[WhatsApp] setTyping pra ${number.slice(-4)}`);
  } catch (err) {
    console.log('[WhatsApp] setTyping err (silent):', err?.message || err);
  }
}

/**
 * Verifica se uma mensagem é áudio
 */
// Sprint 9 hotfix-3 (28/04/2026): UAZAPI mudou formato do payload em algum
// update — áudio agora identificado em message.mediaType OU
// chat.wa_lastMessageType ("AudioMessage"). Detector defensivo: casa qualquer
// das 4 posições conhecidas, case-insensitive.
function isAudioMessage(body) {
  if (!body) return false;
  const candidates = [
    body.messageType,
    body.message?.messageType,
    body.message?.mediaType,
    body.chat?.wa_lastMessageType,
  ].filter(Boolean).map(String);
  return candidates.some(c => /^(audio|ptt|myaudio|audiomessage)$/i.test(c));
}

function _typeCandidates(body) {
  if (!body) return [];
  return [
    body.messageType,
    body.message?.messageType,
    body.message?.mediaType,
    body.chat?.wa_lastMessageType,
  ].filter(Boolean).map(String);
}

function isImageMessage(body) {
  return _typeCandidates(body).some(c => /^(image|imagemessage|sticker|stickermessage)$/i.test(c));
}

function isDocumentMessage(body) {
  return _typeCandidates(body).some(c => /^(document|documentmessage|documentwithcaptionmessage)$/i.test(c));
}

function isVideoMessage(body) {
  return _typeCandidates(body).some(c => /^(video|videomessage|videowithcaptionmessage|ptv|ptvmessage)$/i.test(c));
}

/**
 * Envia mídia (imagem/documento/vídeo) via UAZAPI.
 * Endpoint: POST /send/media com { number, type, file (url pública), text (caption), docName }
 */
async function sendMedia(phone, { url, type, caption = '', filename = '', mimetype = '' }) {
  try {
    const payload = {
      number: phone,
      type, // 'image' | 'document' | 'video'
      file: url,
      text: caption || '',
      readchat: true,
    };
    if (filename) payload.docName = filename;
    if (mimetype) payload.mimetype = mimetype;
    const r = await _postEnviar('/send/media', payload, { phone, tipo: `mídia:${type}` });
    if (r.bloqueado) return null;
    console.log(`[WhatsApp] mídia (${type}) enviada pra ${phone.slice(-4)}`);
    return r.data;
  } catch (err) {
    console.error(`[WhatsApp] sendMedia erro pra ${phone}: ${err.message}`);
    throw err;
  }
}

/**
 * Normaliza o payload — suporta formato novo UAZAPI (EventType + messages[])
 * e formato antigo (event + data).
 */
// getData e extractMessageId vivem em ./inbound-message-id (funções PURAS, testáveis sem
// env). Reexportadas abaixo — nenhum call site mudou.
const { getData, extractMessageId } = require('./inbound-message-id');
const turnClaim = require('./turn-claim');

// O cliente do banco é resolvido tarde: whatsapp.js é a camada de transporte e não deve
// carregar o supabase no require (quebraria os testes puros que só importam o extrator).
// Lista de perfis QA. Vazia em produção ⇒ a trava de replay nunca age.
function _listaQA() {
  return String(process.env.TOM_QA_PHONES || '').split(',').map(s => s.trim()).filter(Boolean);
}

let _sbCache;
function _sb() {
  if (_sbCache === undefined) {
    try { _sbCache = require('../supabase/client'); } catch (_) { _sbCache = null; }
  }
  return _sbCache;
}

// =====================================================================================
// PONTO ÚNICO DE SAÍDA — a fronteira do turno mora AQUI, no transporte, não em uma
// função específica.
//
// A primeira versão desta fatia colocou o gate dentro do sendMessage e eu afirmei que
// cobria "todo outbound do turno". Não cobria: existem SETE api.post neste arquivo, e o
// gate pegava um. Voz, sticker, mídia, menu e reação saíam sem validar lease e sem
// registrar no ledger. Descer o gate para o POST fecha a classe inteira, inclusive
// qualquer rota de envio que venha a ser escrita depois.
//
// FORA daqui, de propósito: /message/presence (o "digitando"). Não é mensagem, não tem
// id, não é citável nem roteável — bloquear produziria só um efeito visual sem
// contrapartida no contrato.
//
// `api` é injetável para que o teste prove o bloqueio ANTES do POST, sem rede.
async function _postEnviar(rota, payload, { phone, tipo = 'mensagem', api: apiOverride, config, supabase: sbOverride } = {}) {
  const cli = apiOverride || api;
  const sb = sbOverride || _sb();

  // ---- TRAVA DE SAÍDA DO REPLAY LAB (spec 05/08) ----
  // Vem ANTES de tudo: em replay, nenhuma mensagem pode alcançar pessoa real. Fora de
  // replay é no-op — `turn.qa` nunca é true em produção.
  const _dest = turnClaim.decideDestinoQA({
    turn: turnClaim.currentTurn(), phone, listaQA: _listaQA(),
  });
  if (_dest.abortar) {
    // Falha FECHADA. A evidência é PERSISTIDA aqui — memória + JSONL — antes do throw.
    // Não pode depender de alguém dar catch: os 51 `catch` vazios do engine engoliriam,
    // e aí teríamos um vazamento evitado sem registro nenhum de que quase aconteceu.
    const turno = turnClaim.currentTurn() || {};
    const ev = turnClaim.registrarEvidenciaQA({
      evento: 'destino_proibido', rota, tipo,
      numero: _dest.numero, detalhe: _dest.detalhe, runId: turno.runId || null,
    });
    const msg = `[ReplayLab] destino proibido em replay: ${_dest.numero} (${_dest.detalhe}) rota=${rota}`;
    console.error(msg);
    const err = new Error(msg);
    err.code = 'QA_DESTINO_PROIBIDO';
    err.qaEvidencia = ev;
    throw err;
  }
  if (_dest.suprimir) {
    const turno = turnClaim.currentTurn() || {};
    const idSintetico = `QA-SUPPRESSED-${turno.runId || 'sem-run'}-${Date.now()}`;
    // O recibo carrega o run_id: é assim que o cenário prova que o contexto de replay
    // chegou até aqui. Recibo sem run_id reprova, mesmo que nada tenha vazado.
    const ev = turnClaim.registrarEvidenciaQA({
      evento: 'outbound_suppressed', rota, tipo,
      numero: _dest.numero, runId: turno.runId || null, idSintetico,
    });
    console.log(`[ReplayLab] outbound_suppressed rota=${rota} tipo=${tipo} destino=${_dest.numero} run=${turno.runId || '-'}`);
    return { bloqueado: true, suprimido: true, qaEvidencia: ev, data: { id: idSintetico } };
  }

  const gate = await turnClaim.beforeSend({ supabase: sb });
  if (!gate.send) {
    console.warn(`[Turno] NÃO enviou ${tipo} pra ${String(phone).slice(-4)}: ${gate.reason} — outro worker assumiu este turno`);
    return { bloqueado: true, data: null };
  }
  if (gate.degraded) {
    console.warn(`[Turno] lease não verificável (${gate.reason}) — enviando ${tipo} assim mesmo`);
  }
  const response = config ? await cli.post(rota, payload, config) : await cli.post(rota, payload);
  // Já entregue: registrar é contabilidade. Nunca reenvia, nunca lança.
  try {
    await turnClaim.afterSend({ supabase: sb, sentId: extractSentMessageId(response.data), phone });
  } catch (e) {
    console.warn('[Turno] registro do outbound falhou (não reenvia):', e.message);
  }
  return { bloqueado: false, data: response.data };
}

/**
 * Extrai texto de um webhook UAZAPI
 * Suporta formato novo (messages[0].text) e antigo (data.text)
 */
function extractText(body) {
  const data = getData(body);
  let raw = data?.content || data?.text || data?.body || data?.caption || null;
  // Sprint 16 fix: ExtendedTextMessage (reply/quote) tem content como
  // { text: "...", previewType: 0, contextInfo: {...} }, não string.
  // Extrair o .text do objeto pra que webhook não descarte como "non-string".
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    raw = raw.text || raw.body || raw.caption || null;
  }
  return raw;
}

/**
 * Extrai número do remetente de um webhook UAZAPI
 * chatid/sender vem como "5521999999999@s.whatsapp.net"
 */
function extractPhone(body) {
  const data = getData(body);
  let raw = data?.chatid || data?.sender || "";
  if (raw.includes("@lid")) raw = body?.chat?.wa_chatid || raw;
  return raw.split("@")[0] || null;
}

/**
 * Extrai nome do remetente
 */
function extractName(webhookBody) {
  const data = getData(webhookBody);
  return data?.senderName || webhookBody?.chat?.lead_fullName || null;
}

/**
 * Extrai o nome original do arquivo de um documento (DocumentMessage).
 * UAZAPI varia o campo: content.fileName / documentMessage.fileName / title. Best-effort. (Alf 14/06)
 */
function extractFileName(body) {
  const m = getData(body);
  if (!m || typeof m !== 'object') return null;
  const c = (m.content && typeof m.content === 'object') ? m.content : {};
  const dm = (m.documentMessage && typeof m.documentMessage === 'object') ? m.documentMessage
    : (c.documentMessage && typeof c.documentMessage === 'object') ? c.documentMessage : {};
  return (
    c.fileName || c.filename || c.title || c.docName ||
    dm.fileName || dm.title ||
    m.fileName || m.filename || m.title || m.docName ||
    null
  );
}

/**
 * Verifica se a mensagem deve ser ignorada
 */
function isIgnorable(body) {
  if (!body) return true;
  if (body.EventType && body.EventType !== "messages") return true;
  const msg = getData(body);
  if (!msg) return true;
  if (msg.fromMe === true) return true;
  if (msg.isGroup === true) return true;
  return false;
}

/**
 * Extrai o ID da mensagem do user (necessário pra reagir a ela).
 * Casa formatos antigos (data.id) e novos (message.id, message.key.id).
 */

/**
 * Sprint 28 — Extrai mensagem citada (reply) do payload UAZAPI.
 * UAZAPI manda em `content.contextInfo.quotedMessage` (ExtendedTextMessage) ou
 * `message.quotedMessage` direto. Retorna { id, text } ou null se não tem reply.
 *
 * Casos cobertos:
 *  - ExtendedTextMessage: content = { text, contextInfo: { stanzaID, quotedMessage: {...} } }
 *  - Mídia com caption respondendo: contextInfo no nível do message
 *  - QuotedMessage pode ser TextMessage, ImageMessage (.caption), etc.
 */
function extractQuotedMessage(body) {
  const m = getData(body);
  if (!m || typeof m !== 'object') return null;
  // contextInfo pode estar em content.contextInfo OU message.contextInfo
  let ctx = null;
  if (m.content && typeof m.content === 'object' && m.content.contextInfo) {
    ctx = m.content.contextInfo;
  } else if (m.contextInfo) {
    ctx = m.contextInfo;
  }
  if (!ctx || typeof ctx !== 'object') return null;
  const quoted = ctx.quotedMessage;
  if (!quoted || typeof quoted !== 'object') return null;
  // Extrai texto da quoted (varia conforme tipo)
  let text =
    quoted.conversation ||
    quoted.extendedTextMessage?.text ||
    quoted.imageMessage?.caption ||
    quoted.videoMessage?.caption ||
    quoted.documentMessage?.caption ||
    quoted.text ||
    null;
  // Tipo (pra TOM saber se reply é a uma mídia)
  let type = 'text';
  if (quoted.imageMessage) type = 'image';
  else if (quoted.videoMessage) type = 'video';
  else if (quoted.documentMessage) type = 'document';
  else if (quoted.audioMessage) type = 'audio';
  return {
    id: ctx.stanzaID || ctx.stanzaId || null,
    text: typeof text === 'string' ? text.trim() : null,
    type,
    fromMe: ctx.participant === undefined && (m.fromMe === false) ? null : null, // best-effort
  };
}

/**
 * Sprint 28 — Envia mensagem de voz (PTT) via UAZAPI.
 * Recebe buffer MP3 (gerado pelo TTS) e manda como push-to-talk —
 * aparece como mensagem de voz nativa no WhatsApp.
 *
 * UAZAPI aceita base64 no campo `file` (data sem prefix data:). Falha
 * silenciosamente: chamador deve ter fallback pra mandar texto.
 */
async function sendVoice(phone, audioBuffer) {
  try {
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length < 100) {
      throw new Error('audioBuffer inválido ou muito pequeno');
    }
    const base64 = audioBuffer.toString('base64');
    const r = await _postEnviar('/send/media', {
      number: phone,
      type: 'ptt',
      file: base64,
      mimetype: 'audio/mpeg',
      readchat: true,
    }, { phone, tipo: 'voz', config: { timeout: 30000 } });
    if (r.bloqueado) return null;
    console.log(`[WhatsApp] PTT enviado pra ${String(phone).slice(-4)} (${audioBuffer.length} bytes)`);
    return r.data;
  } catch (err) {
    console.error(`[WhatsApp] sendVoice falhou pra ${phone}: ${err.message}`);
    throw err;
  }
}

/**
 * Sprint 28 — Envia reação (emoji) a uma mensagem específica.
 * UAZAPI: POST /message/react { number, text: '<emoji>', id: '<message_id>' }
 * - text vazio remove reação
 * - só funciona em mensagens de OUTROS users (não nas do bot)
 * - falha em msgs com mais de 7 dias
 * Fire-and-forget na chamada — não bloqueia o pipeline se UAZAPI falhar.
 */
async function sendReaction(phone, messageId, emoji) {
  try {
    if (!messageId || !emoji) {
      console.warn('[WhatsApp] sendReaction skipped — missing messageId or emoji');
      return null;
    }
    const number = String(phone).includes('@') ? phone : `${phone}@s.whatsapp.net`;
    const r = await _postEnviar('/message/react', {
      number,
      text: String(emoji),
      id: String(messageId),
    }, { phone, tipo: 'reação' });
    if (r.bloqueado) return null;
    console.log(`[WhatsApp] reação ${emoji} enviada pra ${String(phone).slice(-4)} (msgId=${String(messageId).slice(0,12)})`);
    return r.data;
  } catch (err) {
    console.warn(`[WhatsApp] sendReaction falhou: ${err.message}`);
    return null;
  }
}

module.exports = { sendMessage, sendButtons, sendList, sendMedia, setTyping, sendReaction, sendVoice, isAudioMessage, isImageMessage, isDocumentMessage, isVideoMessage, extractText, extractPhone, extractName, extractFileName, extractMessageId, extractQuotedMessage, extractSentMessageId, isIgnorable, getData,
  // exportado para o teste de TRANSPORTE: prova que o bloqueio acontece antes do POST,
  // com um cliente injetado, sem rede.
  _postEnviar };
