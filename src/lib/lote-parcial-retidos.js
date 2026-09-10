'use strict';
// lote-parcial-retidos.js — A2-PERGUNTA-SOME-NO-LOTE-PARCIAL (Juliana 09/09 19:48 BRT).
//
// Num lote em que PARTE entra e parte fica SEGURADA pra confirmar (trava A2 de fechamento em
// lote, trava de data futura, alvo refutado), o LLM já escreveu a fala como se tudo tivesse
// sido feito: "*Feitos:* • Reunião com o Léo… • Conversar com o Peterson…". O ramo parcial do
// engine só conhecia a contagem — colava "Registrei 1 de 3" e jogava fora a pergunta de
// confirmação. A Juliana leu "Feitos", nunca foi perguntada, e as duas seguiram pendentes.
//
// Este helper tira da fala as linhas que afirmam as tarefas seguradas (e o cabeçalho que
// ficar sem item embaixo). O que entrou de verdade continua na fala. Não adivinha: só remove
// linha que cita o título segurado com pelo menos 2 palavras fortes dele (1, se o título só
// tiver uma), o mesmo critério de overlap do veto de escrita recente.
// PURA.

const _STOP = new Set(['para', 'pelo', 'pela', 'esse', 'essa', 'isso', 'este', 'esta', 'como', 'sobre', 'ontem', 'hoje', 'amanha', 'tarefa', 'lembrete']);
function _tokens(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !_STOP.has(t));
}

const _CABECALHO_RE = /:\s*[*_]*\s*$/;

function _afirmaAlgum(linha, titulosTok) {
  const hay = new Set(_tokens(linha));
  if (!hay.size) return false;
  return titulosTok.some((toks) => toks.filter((t) => hay.has(t)).length >= Math.min(2, toks.length));
}

/**
 * @param {string} texto  fala do LLM (cleanText do marker)
 * @param {string[]} titulos  títulos das tarefas SEGURADAS (não executadas neste turno)
 * @returns {string}
 */
function tiraLinhasDosRetidos(texto, titulos) {
  const src = String(texto == null ? '' : texto);
  const titulosTok = (Array.isArray(titulos) ? titulos : []).map(_tokens).filter((t) => t.length);
  if (!src.trim() || !titulosTok.length) return src;
  const linhas = src.split('\n').filter((l) => !_afirmaAlgum(l, titulosTok));
  const out = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].trim();
    if (l && l.length <= 60 && _CABECALHO_RE.test(l)) {
      let j = i + 1;
      while (j < linhas.length && !linhas[j].trim()) j++;
      if (j >= linhas.length || _CABECALHO_RE.test(linhas[j].trim())) continue; // cabeçalho órfão
    }
    out.push(linhas[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { tiraLinhasDosRetidos };
