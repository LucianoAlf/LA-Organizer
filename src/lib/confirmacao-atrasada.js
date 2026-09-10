'use strict';
// confirmacao-atrasada.js — CONFIRMACAO-ATRASADA-PERDIA-O-RECADO (10/09/2026).
//
// O executor determinístico de confirmação só aceita "sim" até 20 min depois da pergunta. A
// janela existe por um motivo bom: um "sim" solto horas depois confirmava intent velha de outro
// assunto ("sim" pra criar meta confirmou "cobrar o Rafinha"). Mas ela também perdia o "sim" que
// ERA a resposta: a Krissya respondeu "Isso" 27 min depois de "Aviso o Arthur amanhã às 9:30…
// — confirma?", a Rafinha 36 min depois de "Aviso o Dudu? Confirma?". O recado estava inteiro
// na intent; o "sim" caiu no LLM, que perguntou de novo, e o recado nunca saiu.
// Medido em 90 dias: resposta afirmativa <20 min → 53 de 56 saíram; 20–60 min → 1 de 3.
//
// A regra que separa os dois casos: se a ÚLTIMA fala do TOM pra pessoa foi a própria pergunta,
// nada aconteceu no meio — o "sim" só pode estar respondendo a ela. Se o TOM falou outra coisa
// depois (ritual, outro assunto), a janela de 20 min continua valendo. PURA.

const MAX_HORAS = 24;

function _norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[*_~`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {{pergunta?:string, ultimaFala?:string, askedAt?:string, agoraMs?:number, maxHoras?:number}} a
 * @returns {boolean}
 */
function perguntaFoiAUltimaFala({ pergunta, ultimaFala, askedAt, agoraMs = Date.now(), maxHoras = MAX_HORAS } = {}) {
  const p = _norm(pergunta);
  const u = _norm(ultimaFala);
  if (p.length < 8 || !u) return false;
  const t = Date.parse(askedAt);
  if (!Number.isFinite(t) || agoraMs - t > maxHoras * 3600 * 1000) return false;
  // A fala enviada é a pergunta (às vezes com rodapé depois). Compara o começo, não o todo.
  const cabeca = p.slice(0, 80);
  return u.startsWith(cabeca) || u.includes(cabeca);
}

module.exports = { perguntaFoiAUltimaFala, MAX_HORAS };
