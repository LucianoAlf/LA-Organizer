// src/services/whatsapp.js — Serviço de envio WhatsApp via UAZAPI
// Docs: https://docs.uazapi.com
// Instância TOM: https://lamusic.uazapi.com

const axios = require('axios');
const config = require('../config');

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
      const response = await api.post('/send/text', {
        number: phone,
        text: text,
        readchat: true,
      });
      console.log(`[WhatsApp] Mensagem enviada pra ${phone.slice(-4)}${attempt ? ` (tentativa ${attempt + 1})` : ''}`);
      return response.data;
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
    const response = await api.post('/send/menu', {
      number: phone,
      type: 'button',
      text: text,
      choices: buttons.map((b, i) => `${b}|btn_${i}`),
      footerText: footer,
      delay: 2000,
      readchat: true,
    });
    return response.data;
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
    const response = await api.post('/send/menu', {
      number: phone,
      type: 'list',
      text: text,
      choices: items,
      listButton: buttonText,
      delay: 2000,
      readchat: true,
    });
    return response.data;
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
    const response = await api.post('/send/media', payload);
    console.log(`[WhatsApp] mídia (${type}) enviada pra ${phone.slice(-4)}`);
    return response.data;
  } catch (err) {
    console.error(`[WhatsApp] sendMedia erro pra ${phone}: ${err.message}`);
    throw err;
  }
}

/**
 * Normaliza o payload — suporta formato novo UAZAPI (EventType + messages[])
 * e formato antigo (event + data).
 */
function getData(body) {
  // New format: array (enriched lean payload from curl tests)
  if (body?.EventType && body?.messages?.length > 0) return body.messages[0];
  // New format: singular message object (real UAZAPI delivery)
  if (body?.EventType && body?.message) return body.message;
  // Old format
  if (body?.data) return body.data;
  return body;
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
function extractMessageId(body) {
  const m = getData(body);
  if (!m || typeof m !== 'object') return null;
  const candidates = [
    m.id,
    m.messageid,
    m.message_id,
    m.key && m.key.id,
    body && body.id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length >= 4) return c;
  }
  return null;
}

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
    const response = await api.post('/send/media', {
      number: phone,
      type: 'ptt',
      file: base64,
      mimetype: 'audio/mpeg',
      readchat: true,
    }, { timeout: 30000 });
    console.log(`[WhatsApp] PTT enviado pra ${String(phone).slice(-4)} (${audioBuffer.length} bytes)`);
    return response.data;
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
    const response = await api.post('/message/react', {
      number,
      text: String(emoji),
      id: String(messageId),
    });
    console.log(`[WhatsApp] reação ${emoji} enviada pra ${String(phone).slice(-4)} (msgId=${String(messageId).slice(0,12)})`);
    return response.data;
  } catch (err) {
    console.warn(`[WhatsApp] sendReaction falhou: ${err.message}`);
    return null;
  }
}

module.exports = { sendMessage, sendButtons, sendList, sendMedia, setTyping, sendReaction, sendVoice, isAudioMessage, isImageMessage, isDocumentMessage, isVideoMessage, extractText, extractPhone, extractName, extractFileName, extractMessageId, extractQuotedMessage, isIgnorable, getData };
