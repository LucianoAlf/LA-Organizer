'use strict';
// divergencia-saldo.js — separa divergência REAL de conta que nunca foi usada. PURO.
//
// FIN-DIVERG-CONTA-VAZIA (10/08/2026). O comparador do relatório das 18h olhava só
// `pf_accounts.balance` contra o saldo do Pluggy. Uma conta do app com zero lançamentos tem
// balance 0, então a diferença é o saldo real inteiro — e o relatório pedia, todo dia, que
// alguém "acertasse" R$ 13.439,82 no app. Não havia o que acertar: o mapa do Pluggy aponta
// para contas duplicadas vazias ("Itau" enquanto os lançamentos estão em "ITAU").
//
// A distinção que faltava: saldo 0 por AUSÊNCIA DE USO ≠ saldo 0 por conciliação errada.
// A segunda é o que a seção existe pra achar; a primeira é problema de cadastro, que não se
// resolve lendo WhatsApp e por isso não pode virar alerta recorrente.

/**
 * @param {Array<{conta:string, saldoApp:number, saldoReal:number, lancamentos:?number}>} linhas
 * @param {{threshold?: number}} [opts]  Diferença mínima em R$ para virar linha (default 1).
 * @returns {{divergencias: Array, contasVazias: string[]}}
 *   `contasVazias` não vai pro relatório — é o rastro pro log, senão silenciar o alarme
 *   esconderia também o mapeamento errado que o causou.
 */
function filtraDivergencias(linhas, opts = {}) {
  const threshold = Number.isFinite(Number(opts.threshold)) ? Number(opts.threshold) : 1;
  const divergencias = [];
  const contasVazias = [];
  if (!Array.isArray(linhas)) return { divergencias, contasVazias };

  for (const l of linhas) {
    if (!l || typeof l !== 'object') continue;
    const saldoApp = Number(l.saldoApp) || 0;
    const saldoReal = Number(l.saldoReal) || 0;
    const diff = saldoApp - saldoReal;
    if (Math.abs(diff) < threshold) continue;

    // `lancamentos` só silencia quando foi REALMENTE medido e deu zero. null/undefined é
    // falha de leitura — nesse caso reporta, porque "não medi" nunca pode virar "está tudo bem".
    if (l.lancamentos === 0) { contasVazias.push(String(l.conta || '')); continue; }

    divergencias.push({ conta: l.conta, saldoApp, saldoReal, diff });
  }
  return { divergencias, contasVazias };
}

module.exports = { filtraDivergencias };
