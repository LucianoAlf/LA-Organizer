// Regressão do gate da skill financeiro-pessoal. Roda: node scripts/smoke-finance-gate.js
// Cada caso que escapa daqui = TOM regride pra "skill: none" e nega capacidade.
const assert = require('assert');
const { financeGateMatches } = require('../src/prompts/finance-gate');

// DEVEM casar (financeiro real) — inclui os 2 casos do Matheus 07/06 que regrediram:
const MATCH = [
  '50,00 de combustível no débito.. salva aí',                                  // FIN-GATE: combustível+débito (sem R$)
  'vai nas minhas contas fixas e faz um cálculo do total que eu preciso pagar dia 10', // contas fixas (plural) + pagar dia N
  'gastei 50 no ifood',
  'Estacionamento: R$ 90,00 - expo center',
  'paguei a fatura do nubank',
  'comprei TV 3200 em 10x no nubank',
  'recebi 500 de comissão',
  'quanto preciso pagar esse mês?',
  'paguei 30 no pix',
  'me manda o boleto do condomínio',
  'guardei 500 pro carro',
];

// NÃO devem casar (não-financeiro) — guarda contra over-match:
const NO_MATCH = [
  'bom dia, tom!',
  'marca a reunião com o Quintela amanhã às 10h',
  'me lembra de estudar pro simulado',
  'criar tarefa: revisar o repertório',
  'manda um zap pro Yuri',
];

// Frases novas — Task 5 (R-DIARIO, R-SEMANA, R-MENSAL/fechamento):
for (const msg of ['resumo do dia', 'balanço do dia', 'resumo da semana', 'fechamento do mês', 'resumo de maio', 'como fechou abril']) assert.ok(financeGateMatches(msg), `gate F6: ${msg}`);

// Frases novas — Task 7 (R-GASTOS, R-CONTA, R-EXTRATO):
for (const msg of [
  'quanto gastei em abril', 'meus gastos do mês', 'onde gasto mais',
  'extrato do nubank', 'lançamentos de maio',
  'saldo do nubank', 'como está o itaú',
]) assert.ok(financeGateMatches(msg), `gate deve pegar: ${msg}`);

let fail = 0;
for (const m of MATCH) {
  try { assert.ok(financeGateMatches(m), `DEVERIA casar: "${m}"`); }
  catch (e) { console.error('❌', e.message); fail++; }
}
for (const m of NO_MATCH) {
  try { assert.ok(!financeGateMatches(m), `NÃO deveria casar: "${m}"`); }
  catch (e) { console.error('❌', e.message); fail++; }
}

if (fail) { console.error(`\nFALHOU: ${fail} caso(s).`); process.exit(1); }
console.log(`PASS — ${MATCH.length} match + ${NO_MATCH.length} no-match OK.`);
