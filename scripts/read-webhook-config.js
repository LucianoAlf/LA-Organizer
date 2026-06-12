// scripts/read-webhook-config.js — roda na VPS: node --env-file=.env scripts/read-webhook-config.js
// Lê a config atual do webhook da instância (read-only) pra sabermos o que está excluído.
const axios = require('axios');
const config = require('../src/config');
const api = axios.create({
  baseURL: config.uazapi.url,
  headers: { 'Content-Type': 'application/json', token: config.uazapi.token },
  timeout: 15000,
});
(async () => {
  for (const path of ['/webhook', '/instance/webhook', '/webhook/find']) {
    try {
      const r = await api.get(path);
      console.log(`>>> GET ${path} OK:`);
      console.log(JSON.stringify(r.data, null, 2));
      return;
    } catch (e) { console.log(`GET ${path} -> ${e.response?.status || e.message}`); }
  }
})();
