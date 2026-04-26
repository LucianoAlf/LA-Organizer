const axios = require('axios');
const config = require('../config');
const api = axios.create({
  baseURL: config.uazapi.url,
  headers: { 'Content-Type': 'application/json', token: config.uazapi.token },
  timeout: 15000,
});

async function sendMessage(phone, text) {
  try {
    await api.post('/send/text', { number: phone, text, delay: 2000, readchat: true });
    console.log('[WhatsApp] Enviado pra', phone.slice(-4));
  } catch (err) {
    console.error('[WhatsApp] Erro:', err.message);
    throw err;
  }
}

function getData(body) {
  // Formato novo UAZAPI: { EventType, chat, messages: [{...}] }
  if (body?.EventType && body?.messages?.[0]) return body.messages[0];
  // Formato antigo: { event, data: {...} }
  if (body?.data) return body.data;
  return body;
}

function extractText(body) {
  const data = getData(body);
  if (data?.text) return data.text;
  if (data?.body) return data.body;
  if (data?.convertOptions) return data.convertOptions;
  return null;
}

function extractPhone(body) {
  const data = getData(body);
  const raw = data?.sender || data?.chatid || data?.from || '';
  return raw.replace(/@.*/, '').replace(/[\s\-\+]/g, '');
}

function isIgnorable(body) {
  // Formato novo UAZAPI
  if (body?.EventType) {
    if (body.EventType !== 'messages') return true;
    const msg = body?.messages?.[0];
    if (!msg) return true;
    if (msg?.fromMe === true) return true;
    if (msg?.isGroup === true) return true;
    if (body?.chat?.id?.includes('@g.us')) return true;
    return false;
  }
  // Formato antigo
  if (body?.event && body.event !== 'message') return true;
  const data = body?.data || body;
  if (data?.fromMe === true) return true;
  if (data?.isGroup === true) return true;
  if (!data) return true;
  return false;
}

module.exports = { sendMessage, extractText, extractPhone, isIgnorable };
