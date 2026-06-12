// src/services/uazapi-groups.js
// Conversa com a UAZAPI sobre GRUPOS (Fase 4): listar grupos (achar JID) e enviar texto
// pra um grupo. Reusa a config da instância (mesma do whatsapp.js).
const axios = require('axios');
const config = require('../config');

const api = axios.create({
  baseURL: config.uazapi.url,
  headers: { 'Content-Type': 'application/json', token: config.uazapi.token },
  timeout: 15000,
});

// Lista os grupos da instância. Doc UAZAPI: GET /group/list → { groups: [Group] };
// Group tem JID ("...@g.us") + Name. Retorna [{ jid, name }].
async function listGroups() {
  const resp = await api.get('/group/list');
  const raw = resp.data?.groups || [];
  return raw.map((g) => ({ jid: g.JID, name: g.Name || '' })).filter((g) => g.jid);
}

// Resolve o JID pelo código de convite (a parte depois de chat.whatsapp.com/).
// Doc UAZAPI: POST /group/inviteInfo { invitecode } → Group { JID: "...@g.us" }.
async function getGroupJidByInvite(invitecode) {
  const resp = await api.post('/group/inviteInfo', { invitecode });
  return resp.data?.JID || null;
}

// Posta texto num grupo. `jid` = "xxxxxxxx@g.us" — o campo `number` do /send/text aceita
// @g.us (confirmado na doc). Resposta = schema Message → campo `messageid`.
async function sendGroupText(jid, text) {
  const resp = await api.post('/send/text', { number: jid, text, readchat: true });
  const d = resp.data || {};
  return d.messageid || d.id || (d.key && d.key.id) || null;
}

module.exports = { listGroups, getGroupJidByInvite, sendGroupText };
