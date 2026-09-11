'use strict';
// complemento-tarefa.js — COMPLEMENTO-DE-TAREFA-RECEM-CRIADA (Krissya 10/07 — finding 6a563996).
//
// 16:47 "Colocar a falta do Jeyson de quarta e gabriel Antony de hoje" → o TOM criou "Lançar falta do
// Jeyson" e "Lançar falta do Gabriel Antony". 16:48 "Na planilha de presença" — ONDE lançar, um
// complemento das duas tarefas que acabaram de nascer. O LLM prometeu sem marker e ela leu "problema
// técnico, nada executado". Complemento curto logo depois da criação vira DETALHE dessas tarefas.
// PURO: reconhece o complemento e escolhe as tarefas-alvo (as recém-criadas que a última fala do TOM citou).

const PREP_RE = /^(?:na|no|nas|nos|numa|num|em|pela|pelo|pelas|pelos|via|com|até|ate|pra|pro|para|dentro\s+d[aoe])\s+\S/i;
const VERBO_RE = /\b(?:cri[ae]|cria[r]?|marc[ae]r?|lembr[ae]r?|cancel[ae]r?|apag[ae]r?|remarc[ae]r?|conclu\w*|fiz|feito|fecha|exclu\w*|delet\w*|avis[ae]r?|mand[ae]r?)\b/i;
const MAX_PALAVRAS = 8;

const _norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim();

/** "Na planilha de presença" → "Na planilha de presença"; qualquer outra coisa → null. */
function complementoDeTarefa(texto) {
  const t = String(texto || '').trim().replace(/[.!]+$/, '');
  if (!t || /\?/.test(t) || /\n/.test(t)) return null;
  if (t.split(/\s+/).length > MAX_PALAVRAS) return null;
  if (!PREP_RE.test(t)) return null;
  if (VERBO_RE.test(t)) return null;
  return t;
}

/** Recém-criadas cujo título aparece na última fala do TOM (a que anunciou a criação). */
function alvosDoComplemento(recemCriadas, ultimaFalaTom) {
  const fala = _norm(ultimaFalaTom);
  if (!fala) return [];
  return (Array.isArray(recemCriadas) ? recemCriadas : []).filter((t) => t && t.id && t.title && fala.includes(_norm(t.title)));
}

function textoComplemento(alvos, frag) {
  const nomes = alvos.map((t) => `*${t.title}*`);
  const lista = nomes.length <= 1 ? nomes.join('') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  return `📝 Anotei em ${lista}: _${frag}_.`;
}

module.exports = { complementoDeTarefa, alvosDoComplemento, textoComplemento };
