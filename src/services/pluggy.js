// src/services/pluggy.js — cliente HTTP da API Pluggy (https://api.pluggy.ai).
// auth cacheia o apiKey em memória (~110min; expira em 2h). LEITURA APENAS. (Fase D / D1)
const BASE = 'https://api.pluggy.ai';
const TTL_MS = 110 * 60 * 1000;
let _apiKey = null, _apiKeyAt = 0;

async function getApiKey() {
  if (_apiKey && (Date.now() - _apiKeyAt) < TTL_MS) return _apiKey;
  const r = await fetch(`${BASE}/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`pluggy auth ${r.status}`);
  _apiKey = (await r.json()).apiKey; _apiKeyAt = Date.now();
  return _apiKey;
}
async function _get(path) {
  const key = await getApiKey();
  const r = await fetch(`${BASE}${path}`, { headers: { 'X-API-KEY': key } });
  if (!r.ok) throw new Error(`pluggy GET ${path} ${r.status}`);
  return r.json();
}
async function fetchItem(itemId) { return _get(`/items/${itemId}`); }
async function fetchAccounts(itemId) { return (await _get(`/accounts?itemId=${itemId}`)).results || []; }
async function fetchTransactions(accountId, { from } = {}) {
  const out = []; let page = 1;
  for (;;) {
    const j = await _get(`/transactions?accountId=${accountId}&pageSize=500&page=${page}` + (from ? `&from=${from}` : ''));
    const res = j.results || [];
    out.push(...res);
    if (res.length < 500 || page >= (j.totalPages || 1)) break;
    page++;
  }
  return out;
}
async function fetchInvestments(itemId) { return (await _get(`/investments?itemId=${itemId}`)).results || []; }
// Faturas (bills) do cartão = a fatura REAL a pagar (totalAmount + dueDate), diferente de
// account.balance (saldo devedor TOTAL). O Open Finance pode atrasar 1-3d na virada. (D5 fatura)
async function fetchBills(accountId) { return (await _get(`/bills?accountId=${accountId}`)).results || []; }
module.exports = { getApiKey, fetchItem, fetchAccounts, fetchTransactions, fetchInvestments, fetchBills };
