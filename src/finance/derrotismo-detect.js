'use strict';
// Caminho 2 / Fatia 0 — detector PROVISÓRIO de recusa falsa (derrotismo).
// Impreciso DE PROPÓSITO: aqui é só sinal de WATCH p/ o velocímetro (linha de métrica
// SEPARADA do confab). Na Fatia 1 o `resolve()` torna isso PRECISO (decide se a recusa
// é mentira de fato). PURO, sem I/O.
//
// Casos-alvo (frases reais): Matheus 24/06 "não existe o comando pra isso aqui",
// "vai direto no app", "faz mais de 2 dias", "não tenho como editar pelo chat".

const RE_DEFEAT = /\bn[ãa]o tenho como\b|\bn[ãa]o existe (o )?comando\b|\bn[ãa]o consigo\b|\bn[ãa]o d[áa] pra (fazer|mexer|editar|alterar|apagar|excluir)\b[^.?!]*\bchat\b|\bvai (direto )?(l[áa] )?no app\b|\bmais de \d+ dias?\b/i;

/**
 * @param {string} reply  resposta gerada (texto do LLM)
 * @param {{actionableIntent?:boolean, markerEmitted?:boolean}} ctx
 * @returns {{suspect:boolean, phrase:string|null}}
 */
function detectDefeatism(reply, { actionableIntent = false, markerEmitted = false } = {}) {
  const t = String(reply || '');
  const m = RE_DEFEAT.exec(t);
  return { suspect: !!m && actionableIntent && !markerEmitted, phrase: m ? m[0] : null };
}

module.exports = { detectDefeatism, RE_DEFEAT };
