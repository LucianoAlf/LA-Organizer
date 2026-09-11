'use strict';
// serie-ja-feita.js — SERIE-JA-FEITA-NAO-E-FUTURO (Jhonatan 03/08 — finding 964232a9).
//
// "Falar do cashback com a Vitória" é rotina mensal. 09:19:36 a ocorrência de 01/08 (atrasada) foi
// concluída; 09:20:38 ele respondeu "Falei também" à pergunta "só falta o cashback — rolou?". A busca
// por título só vê tarefa ABERTA → sobrou a de 01/09 → a guarda de futuro disse "está marcado pra
// 01/09 (ainda não chegou). Confirma?". As duas falas do TOM eram verdade sobre OCORRÊNCIAS diferentes
// e soaram como contradição. Se uma irmã da série, vencida até hoje, foi concluída há pouco, o que a
// pessoa fez é essa — não a futura. PURO.

/**
 * @param {Array<{id,due_date,status,completed_at}>} irmas ocorrências concluídas recentes da mesma série
 * @param {string} hojeYmd  YYYY-MM-DD (BRT)
 * @returns {object|null} a irmã já feita (a de conclusão mais recente) ou null
 */
function irmaJaFeita(irmas, hojeYmd) {
  const cand = (Array.isArray(irmas) ? irmas : [])
    .filter((t) => t && t.status === 'done' && t.due_date && String(t.due_date).slice(0, 10) <= hojeYmd)
    .sort((a, b) => (Date.parse(b.completed_at) || 0) - (Date.parse(a.completed_at) || 0));
  return cand[0] || null;
}

const _dm = (ymd) => { const d = String(ymd || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '?'; };

function avisoJaFeitaNaSerie(irma, futura) {
  return `✅ *${futura.title}* de ${_dm(irma.due_date)} já estava concluída — a próxima é ${_dm(futura.due_date)}.`;
}

module.exports = { irmaJaFeita, avisoJaFeitaNaSerie };
