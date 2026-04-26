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
function extractText(body) {
  const data = body?.data || body;
  if (data?.text) return data.text;
  if (data?.convertOptions) return data.convertOptions;
  return null;
}
function extractPhone(body) {
  const data = body?.data || body;
  const raw = data?.sender || data?.chatid || '';
  return raw.replace(/@.*/, '').replace(/[\s\-\+]/g, '');
}
function isIgnorable(body) {
  if (body?.event && body.event !== 'message') return true;
  const data = body?.data || body;
  if (data?.fromMe === true) return true;
  if (data?.isGroup === true) return true;
  if (!data) return true;
  if (data?.status && !data?.text) return true;
  return false;
}
module.exports = { sendMessage, extractText, extractPhone, isIgnorable };
