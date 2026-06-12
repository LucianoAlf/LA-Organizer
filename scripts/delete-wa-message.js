// scripts/delete-wa-message.js — VPS: node --env-file=.env scripts/delete-wa-message.js <id>
// Apaga uma mensagem do WhatsApp pra todos (UAZAPI POST /message/delete { id }).
const axios = require('axios');
const config = require('../src/config');
const api = axios.create({
  baseURL: config.uazapi.url,
  headers: { 'Content-Type': 'application/json', token: config.uazapi.token },
  timeout: 15000,
});
const id = process.argv[2];
(async () => {
  if (!id) { console.error('uso: node scripts/delete-wa-message.js <id>'); process.exit(1); }
  try {
    const r = await api.post('/message/delete', { id });
    console.log('apagada:', JSON.stringify(r.data));
  } catch (e) { console.error('delete falhou:', e.response?.status, JSON.stringify(e.response?.data || e.message)); }
})();
