'use strict';
// lista-numerada.js — LISTA-NUMERADA-NAO-ENTREGUE (Alf 01/07 — finding 26f817b5).
//
// Alf mandou a lista de tamanhos (4 seções, 71 nomes em "• Nome (M)") e, por áudio, pediu "liste um,
// dois, três, quatro, até pra gente saber quantas são". O TOM contou 71 certo e entregou só as grades —
// a numeração com os nomes nunca veio (duas tentativas). Não há truncador no caminho: é o LLM que
// resume. Quem tem a lista é a mensagem da pessoa; numerar é transformação determinística. Se a fala
// não traz a lista numerada, o engine acrescenta. PURO.

const _norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** A pessoa pediu os itens numerados ("liste um, dois, três", "numera", "lista numerada", "enumera"). */
function pedeListaNumerada(texto) {
  const t = _norm(texto);
  return /\b(numer(?:a|e|ar|ada|ado|ando|em)|enumer\w*)\b/.test(t)
    || /\blist\w*\b[^.?!]{0,40}\bum,? dois\b/.test(t)
    || /\bum, dois, tres\b/.test(t);
}

const CAB_RE = /^\s*\*([^*\n]{2,80})\*\s*:?\s*$/;
const ITEM_RE = /^\s*(?:[•\-–·]|\*(?!\S*\*\s*$)|\d{1,3}[.)])\s+(.+?)\s*$/;

/** Seções e itens de uma lista colada ("*Seção*" + "• item"). null se tiver menos de 5 itens. */
function gruposDaLista(texto) {
  const grupos = [];
  let atual = null;
  for (const linha of String(texto || '').split('\n')) {
    const cab = linha.match(CAB_RE);
    if (cab) { atual = { titulo: cab[1].trim(), itens: [] }; grupos.push(atual); continue; }
    const it = linha.match(ITEM_RE);
    if (!it) continue;
    if (!atual) { atual = { titulo: null, itens: [] }; grupos.push(atual); }
    atual.itens.push(it[1]);
  }
  const cheios = grupos.filter((g) => g.itens.length);
  const total = cheios.reduce((n, g) => n + g.itens.length, 0);
  return total >= 5 ? cheios : null;
}

const totalDe = (grupos) => grupos.reduce((n, g) => n + g.itens.length, 0);

/** A fala já numera (≥ 80% dos itens em linhas "N. …")? Então não repete. */
function falaJaNumera(fala, total) {
  const n = (String(fala || '').match(/^\s*\d{1,3}[.)]\s+\S/gm) || []).length;
  return n >= Math.ceil(total * 0.8);
}

/** "🔢 *Lista numerada — 71*" + seções com a contagem, numeração contínua. */
function textoListaNumerada(grupos) {
  let i = 0;
  const partes = [`🔢 *Lista numerada — ${totalDe(grupos)}*`];
  for (const g of grupos) {
    const linhas = g.itens.map((x) => `${++i}. ${x}`);
    partes.push([g.titulo ? `*${g.titulo}* (${g.itens.length})` : null, ...linhas].filter(Boolean).join('\n'));
  }
  return partes.join('\n\n');
}

module.exports = { pedeListaNumerada, gruposDaLista, falaJaNumera, textoListaNumerada, totalDe };
