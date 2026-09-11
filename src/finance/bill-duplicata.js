'use strict';
// bill-duplicata.js — CONTA-DUPLICADA-DEIXA-UMA (Matheus 08/09 — finding 8c38ae2f).
//
// O TOM somou as contas do dia 10 e avisou "Aparece *Léo Marceneiro* duas vezes (R$500 cada). É
// pagamento duplo mesmo ou duplicidade?". Matheus: "Não não, é um só! Pode deixar um só." — e ouviu
// "não consegui registrar". O delete_bill existe, mas com duas contas de mesmo nome ("LÉO
// MARCENEIRO" e "LéO Marceneiro") ele só pergunta "qual delas?" — entre duas IGUAIS, a pergunta não
// tem resposta. Aqui: entre cópias (mesmo nome sem acento/caixa, mesmo valor, mesmo dia) fica a
// mais ANTIGA e as outras saem. Grupos diferentes, ou mais de um grupo de cópias → null (pergunta).
// PURO.

const _norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const _chave = (b) => `${_norm(b.name)}|${Number(b.amount).toFixed(2)}|${b.due_day == null ? '' : b.due_day}`;

/**
 * @param {Array<{id,name,amount,due_day?,created_at?}>} cands contas ativas achadas pelo nome
 * @returns {null | {manter: object, remover: object[]}}
 */
function escolherDuplicatas(cands) {
  const grupos = new Map();
  for (const b of (Array.isArray(cands) ? cands : [])) {
    if (!b || !b.id) continue;
    const k = _chave(b);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(b);
  }
  const comCopia = [...grupos.values()].filter((g) => g.length >= 2);
  if (comCopia.length !== 1) return null;
  const g = comCopia[0].slice().sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
  return { manter: g[0], remover: g.slice(1) };
}

module.exports = { escolherDuplicatas };
