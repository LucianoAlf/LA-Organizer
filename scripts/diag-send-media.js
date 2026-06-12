// scripts/diag-send-media.js — VPS: node --env-file=.env scripts/diag-send-media.js
// Diagnostica o 500 do /send/media testando variantes de payload.
const axios = require('axios');
const config = require('../src/config');
const api = axios.create({
  baseURL: config.uazapi.url,
  headers: { 'Content-Type': 'application/json', token: config.uazapi.token },
  timeout: 20000,
});
const JID = '120363422067640143@g.us';
const URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/240px-PNG_transparency_demonstration_1.png';
const variants = [
  { label: 'image + docName', payload: { number: JID, type: 'image', file: URL, text: '💬 *Alf*: diag1', readchat: true, docName: 'teste.png' } },
  { label: 'image sem docName', payload: { number: JID, type: 'image', file: URL, text: '💬 *Alf*: diag2', readchat: true } },
];
(async () => {
  for (const v of variants) {
    try {
      const r = await api.post('/send/media', v.payload);
      console.log(`OK [${v.label}]:`, JSON.stringify(r.data).slice(0, 200));
      return; // para no primeiro que funcionar
    } catch (e) {
      console.log(`FAIL [${v.label}] ${e.response?.status}:`, JSON.stringify(e.response?.data || e.message).slice(0, 300));
    }
  }
})();
