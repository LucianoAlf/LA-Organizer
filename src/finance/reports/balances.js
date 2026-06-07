'use strict';
// Builder puro de Saldos consolidados → ReportModel (agnóstico de canal).
function _semaforo(b) { return Number(b) < 0 ? '🔴' : '✅'; }
function buildBalances(accounts, cardsUsage) {
  const accs = (accounts || []).map((a) => ({
    name: a.name, icon: a.icon || '🏦', balance: Number(a.balance) || 0, status: _semaforo(a.balance),
  }));
  const totalSaldo = accs.reduce((s, a) => s + a.balance, 0);
  const limiteDisponivel = (cardsUsage || []).reduce(
    (s, cu) => s + Math.max(0, Number(cu && cu.usage && cu.usage.available) || 0), 0);
  return { accounts: accs, totalSaldo, limiteDisponivel, totalDisponivel: totalSaldo + limiteDisponivel };
}
module.exports = { buildBalances };
