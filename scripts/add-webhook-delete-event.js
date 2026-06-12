// scripts/add-webhook-delete-event.js — VPS: node --env-file=.env scripts/add-webhook-delete-event.js
// Adiciona 'messages_update' aos eventos do webhook (deleção zap→app), preservando o resto.
const axios = require('axios');
const config = require('../src/config');
const api = axios.create({
  baseURL: config.uazapi.url,
  headers: { 'Content-Type': 'application/json', token: config.uazapi.token },
  timeout: 15000,
});
(async () => {
  const cur = (await api.get('/webhook')).data;
  const w = Array.isArray(cur) ? cur[0] : cur;
  console.log('ANTES:', JSON.stringify({ url: w.url, events: w.events, excludeMessages: w.excludeMessages }));
  const events = Array.from(new Set([...(w.events || []), 'messages_update']));
  const body = {
    enabled: w.enabled !== false,
    url: w.url,
    events,
    excludeMessages: w.excludeMessages || [],
    addUrlEvents: !!w.addUrlEvents,
    addUrlTypesMessages: !!w.addUrlTypesMessages,
  };
  const r = await api.post('/webhook', body);
  console.log('POST status:', r.status);
  const after = (await api.get('/webhook')).data;
  const a = Array.isArray(after) ? after[0] : after;
  console.log('DEPOIS:', JSON.stringify({ url: a.url, events: a.events, excludeMessages: a.excludeMessages }));
})().catch((e) => { console.error('ERRO:', e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 300)); process.exit(1); });
