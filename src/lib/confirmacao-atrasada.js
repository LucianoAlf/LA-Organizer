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

// CONFIRM-NOEXEC-ASSUNTO-MUDOU (Rafinha 01/10 13:26 BRT, achado 97588478) — o avesso da regra
// acima, DENTRO da janela de 20 min. A Rafinha mudou de assunto depois da pergunta da foto, o TOM
// propôs outra coisa e o "Isso aí" dela foi amarrado à foto; o ramo sem executor mandou o LLM negar
// ("Confirmei a foto aqui, mas na verdade isso não ficou gravado"). Medido em 90 dias: 9 de 37
// confirmações sem executor chegaram assim, e em 8 a pessoa respondia à fala mais recente.
// Só vale quando a PESSOA falou no meio (ritual sozinho não muda de assunto) e a última fala do TOM
// não é a pergunta. `historico` = conversation_history depois da pergunta, em ordem, com a fala
// atual por último. Fail-closed: sem histórico, false (comportamento de antes).
function conversaSeguiuOutroAssunto({ pergunta, askedAt, historico } = {}) {
  const h = Array.isArray(historico) ? historico : [];
  const t0 = Date.parse(askedAt);
  if (!Number.isFinite(t0) || !h.length) return false;
  const depois = h.filter((m) => Date.parse(m.created_at) > t0);
  const atual = depois[depois.length - 1];
  if (!atual || atual.direction !== 'inbound') return false;
  const antes = depois.slice(0, -1);
  if (!antes.some((m) => m.direction === 'inbound')) return false;
  const falas = antes.filter((m) => m.direction === 'outbound');
  const ultima = falas[falas.length - 1];
  if (!ultima) return false;
  return !perguntaFoiAUltimaFala({ pergunta, ultimaFala: ultima.content, askedAt, agoraMs: Date.parse(atual.created_at) });
}

module.exports = { perguntaFoiAUltimaFala, conversaSeguiuOutroAssunto, MAX_HORAS };
