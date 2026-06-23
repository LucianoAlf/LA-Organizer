// src/lib/sync-excuse-guard.js
// Rede determinística anti-confabulação de CAUSA: o TOM às vezes inventa "delay de
// sincronização" pra justificar por que algo aparece atrasado/pendente. O banco de
// tarefa/evento/projeto é AO VIVO — isso é mentira (caso Matheus 22/06). SÓ é legítimo
// pra FATURA de cartão (Open Finance/Pluggy). 2ª camada — o prompt é a 1ª.
'use strict';

const SYNC_EXCUSE_RES = [
  /\b(delay|atraso)\b[^.!?\n]{0,20}sincroniz/i,
  /sincroniz\w*[^.!?\n]{0,30}(banco|sistema|app|atualiz|meu lado|cai em|dias)/i,
  /demora\w*[^.!?\n]{0,12}atualiz/i,
  /banco[^.!?\n]{0,25}(do )?meu lado/i,
];
const INVOICE_RE = /fatura|cart[ãa]o|open\s*finance|pluggy/i;

function hasSyncExcuse(text) {
  if (!text || typeof text !== 'string') return false;
  return SYNC_EXCUSE_RES.some((re) => re.test(text));
}

function isInvoiceContext(text) {
  if (!text || typeof text !== 'string') return false;
  return INVOICE_RE.test(text);
}

// Remove a(s) sentença(s) que contêm a desculpa; mantém o resto.
function stripSyncExcuse(text) {
  if (!text || typeof text !== 'string') return text;
  const parts = text.split(/(?<=[.!?\n])/); // mantém o delimitador em cada pedaço
  const kept = parts.filter((s) => !SYNC_EXCUSE_RES.some((re) => re.test(s)));
  return kept.join('').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Se NÃO é fatura E tem a desculpa → remove. Senão, intacto.
function enforceNoSyncExcuse(reply) {
  if (!reply || typeof reply !== 'string') return reply;
  if (isInvoiceContext(reply)) return reply;
  if (!hasSyncExcuse(reply)) return reply;
  return stripSyncExcuse(reply);
}

module.exports = { hasSyncExcuse, isInvoiceContext, stripSyncExcuse, enforceNoSyncExcuse };
