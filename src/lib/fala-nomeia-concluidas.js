'use strict';
// fala-nomeia-concluidas.js — FALA-OMITE-CONCLUIDA (Rafinha 03/08 — finding 1e546ccb).
//
// Áudio: "Caixa Stunner, já troquei, tá no conserto. Colocar a caixinha no lounge… Repôr as tomadas…
// Recreio na Barra… Cássio Privia, finalizado". O TOM fechou as 5 no banco (ok=7 com 2 reagendadas) e
// escreveu "✅ Baixa em 5:" listando QUATRO — a Caixa Staner ficou de fora e a baixa pareceu ambígua.
// Quem sabe o que foi fechado é o banco, não a prosa: se a fala não nomeia uma tarefa concluída no
// turno, o engine acrescenta "✅ Também fechei: *X*". PURO.

const STOP = new Set(['para', 'pra', 'com', 'sem', 'sobre', 'de', 'da', 'do', 'das', 'dos', 'na', 'no', 'nas', 'nos', 'em',
  'um', 'uma', 'uns', 'umas', 'que', 'por', 'ou', 'as', 'os', 'ao', 'aos', 'sala', 'unidade', 'tarefa']);
const _tokens = (s) => new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z]+/).filter((w) => w.length >= 4 && !STOP.has(w)));

/** Títulos concluídos que a fala NÃO nomeia (≥ 2 palavras significativas do título, ou metade delas). */
function faltamNaFala(fala, titulos) {
  const tf = _tokens(fala);
  const vistos = new Set();
  const faltam = [];
  for (const titulo of (Array.isArray(titulos) ? titulos : [])) {
    if (!titulo || vistos.has(titulo)) continue;
    vistos.add(titulo);
    const tt = [..._tokens(titulo)];
    // sem palavra pra julgar: min(2, 0) = 0 → conta como nomeado (não acusa)
    const hits = tt.filter((w) => tf.has(w)).length;
    const nomeou = hits >= Math.min(2, tt.length) || hits / tt.length >= 0.5;
    if (!nomeou) faltam.push(titulo);
  }
  return faltam;
}

function textoTambemFechei(faltam) {
  return `✅ Também fechei: ${faltam.map((t) => `*${t}*`).join(', ')}.`;
}

module.exports = { faltamNaFala, textoTambemFechei };
