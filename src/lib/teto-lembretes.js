'use strict';
// teto-lembretes.js — TETO-DE-LEMBRETES (decisão do Alf, 11/09/2026 — 4b19337f, d1163c32).
//
// O array `reminders_at` do marker de criação ia CRU do LLM pro insert em task_reminders: um
// pedido do Arthur virou 8 lembretes de hora em hora no mesmo segundo. Decisão: no máximo 3
// lembretes por tarefa, com pelo menos 30 min entre um e outro. PURO: ordena por horário, pula
// o que cai perto demais do anterior, guarda os primeiros 3 e devolve os índices ORIGINAIS
// (os rótulos em `reminders_labels` são casados por posição e não podem desalinhar).
const MAX_LEMBRETES = 3;
const ESPACO_MIN = 30;

function limitarLembretes(lista, { max = MAX_LEMBRETES, espacoMin = ESPACO_MIN } = {}) {
  const itens = (Array.isArray(lista) ? lista : [])
    .map((iso, i) => ({ iso, i, t: Date.parse(iso) }))
    .filter((x) => typeof x.iso === 'string' && Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  const mantidos = [];
  for (const x of itens) {
    if (mantidos.length >= max) break;
    if (mantidos.length && x.t - mantidos[mantidos.length - 1].t < espacoMin * 60000) continue;
    mantidos.push(x);
  }
  return { mantidos: mantidos.map((x) => x.iso), indices: mantidos.map((x) => x.i), cortados: itens.length - mantidos.length };
}

module.exports = { limitarLembretes, MAX_LEMBRETES, ESPACO_MIN };
