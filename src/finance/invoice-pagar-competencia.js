'use strict';
// src/finance/invoice-pagar-competencia.js
// A RAIZ do caso Rose (14/08): "paguei a fatura nubank" sem dizer o mês. O handler de
// pay_invoice usava `currentCompetencia(card)` — o ciclo ABERTO — como padrão. Com
// closing_day=7 e a mensagem em 14/08, o ciclo aberto já é setembro (0 lançamentos): o TOM
// respondia "está zerada", ela insistia achando que ele não reconhecia o cartão, quando na
// verdade olhava o mês errado. A fatura de agosto — fechada, vencendo 14/08, R$593,32 — é
// que estava em aberto.
//
// Quem PAGA fatura sem dizer o mês quer dizer a fatura DEVIDA (fechada, com saldo), nunca a
// que ainda está acumulando lançamentos. Pura — decide, não consulta o banco.

/**
 * @param {Array<{competencia:string, remaining:number}>} faturasFechadasNaoPagas
 * @param {string} competenciaAberta fallback (ciclo corrente, ainda acumulando)
 * @returns {string} a competência a usar como padrão
 */
function escolherCompetenciaParaPagar(faturasFechadasNaoPagas, competenciaAberta) {
  const abertas = (Array.isArray(faturasFechadasNaoPagas) ? faturasFechadasNaoPagas : [])
    .filter((f) => f && f.remaining > 0.005);
  if (!abertas.length) return competenciaAberta;
  // A mais ANTIGA primeiro — se houver mais de um mês em atraso, "a fatura" costuma
  // significar a mais vencida, não a mais recente.
  return abertas.slice().sort((a, b) => (a.competencia < b.competencia ? -1 : 1))[0].competencia;
}

module.exports = { escolherCompetenciaParaPagar };
