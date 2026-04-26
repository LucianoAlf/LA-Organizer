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
    const response = await api.post('/send/text', {
      number: phone,
      text: text,
      delay: 2000, // 2s delay → mostra "Digitando..." (mais natural)
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
 * Verifica se uma mensagem é áudio
 */
function isAudioMessage(webhookData) {
  const messageType = webhookData?.messageType || '';
  return ['audio', 'ptt', 'myaudio'].includes(messageType);
}

/**
 * Normaliza o payload — suporta formato novo UAZAPI (EventType + messages[])
 * e formato antigo (event + data).
 */
function getData(body) {
  // Formato novo UAZAPI: { EventType, chat, messages: [{sender, text, fromMe, ...}] }
  if (body?.EventType && body?.messages?.[0]) return body.messages[0];
  // Formato antigo: { event, data: {...} }
  if (body?.data) return body.data;
  return body;
}

/**
 * Extrai texto de um webhook UAZAPI
 * Suporta formato novo (messages[0].text) e antigo (data.text)
 */
function extractText(webhookBody) {
  const data = getData(webhookBody);

  // Campo principal de texto na UAZAPI
  if (data?.text) return data.text;

  // Resposta de botão/menu
  if (data?.convertOptions) return data.convertOptions;

  // Voto em enquete
  if (data?.vote) return data.vote;

  return null;
}

/**
 * Extrai número do remetente de um webhook UAZAPI
 * chatid/sender vem como "5521999999999@s.whatsapp.net"
 */
function extractPhone(webhookBody) {
  const data = getData(webhookBody);

  // UAZAPI usa 'sender' ou 'chatid' ou 'from'
  const raw = data?.sender || data?.chatid || data?.from || '';

  // Remove @s.whatsapp.net e qualquer sufixo
  return raw.replace(/@.*/, '').replace(/[\s\-\+]/g, '');
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
function isIgnorable(webhookBody) {
  // Formato novo UAZAPI
  if (webhookBody?.EventType) {
    if (webhookBody.EventType !== 'messages') return true;
    const msg = webhookBody?.messages?.[0];
    if (!msg) return true;
    if (msg?.fromMe === true) return true;
    if (msg?.isGroup === true) return true;
    if (webhookBody?.chat?.id?.includes('@g.us')) return true;
    return false;
  }

  // Formato antigo
  if (webhookBody?.event && webhookBody.event !== 'message') return true;

  const data = webhookBody?.data || webhookBody;

  // Sem dados
  if (!data) return true;

  // Mensagem enviada pelo próprio bot
  if (data?.fromMe === true) return true;

  // Mensagem de grupo
  if (data?.isGroup === true) return true;

  // Status updates (Sent, Delivered, Read)
  if (data?.status && !data?.text) return true;

  return false;
}

module.exports = { sendMessage, sendButtons, sendList, isAudioMessage, extractText, extractPhone, extractName, isIgnorable };
