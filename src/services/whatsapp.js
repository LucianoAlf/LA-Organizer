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

/**
 * Envia mensagem de texto via WhatsApp
 */
async function sendMessage(phone, text) {
  try {
    // QA log — capped at 200 chars to avoid log spam, helps catch leaks in pm2 logs.
    console.log('[OUT]', String(text || '').substring(0, 200));
    const response = await api.post('/send/text', {
      number: phone,
      text: text,
      readchat: true,
    });
    console.log(`[WhatsApp] Mensagem enviada pra ${phone.slice(-4)}`);
    return response.data;
  } catch (err) {
    console.error(`[WhatsApp] Erro ao enviar pra ${phone}: ${err.message}`);
    throw err;
  }
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

module.exports = { sendMessage, sendButtons, sendList, sendMedia, setTyping, isAudioMessage, isImageMessage, isDocumentMessage, isVideoMessage, extractText, extractPhone, extractName, isIgnorable };
