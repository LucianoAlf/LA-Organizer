// scripts/read-group-participants.js — VPS: node --env-file=.env scripts/read-group-participants.js
// Lê os participantes do grupo Financeiro (LID ↔ telefone) pra resolver menções @lid.
const axios = require('axios');
const config = require('../src/config');
const api = axios.create({
  baseURL: config.uazapi.url,
  headers: { 'Content-Type': 'application/json', token: config.uazapi.token },
  timeout: 15000,
});
const JID = '120363422067640143@g.us';
(async () => {
  try {
    const r = await api.post('/group/info', { groupjid: JID });
    const g = r.data || {};
    console.log('Group:', g.Name || g.name);
    const parts = g.Participants || g.participants || [];
    console.log('Participants count:', parts.length);
    for (const p of parts) console.log(JSON.stringify(p));
  } catch (e) { console.error('group/info falhou:', e.response?.status, JSON.stringify(e.response?.data || e.message)); }
})();
