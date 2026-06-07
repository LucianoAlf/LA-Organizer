// scripts/smoke-silence-backoff.js
// Fatia D — prova da POLÍTICA de backoff por silêncio (replica a decisão de isChronicallySilent
// sem tocar no banco). Regra (decisão CEO 07/06): suprime cobrança individual SE não houve
// nenhuma resposta (inbound) em 72h E a pessoa foi cobrada em 3+ dias DISTINTOS anteriores.
// Rodar: node scripts/smoke-silence-backoff.js
'use strict';

function shouldBackoff(inbound72h, priorNagDays) {
  return inbound72h === 0 && priorNagDays >= 3;
}

const CASES = [
  // [inbound72h, priorNagDays, esperado(suprime?), descrição]
  [0, 3, true,  'Rafinha: 3 dias cobrado, 0 resposta → backoff'],
  [0, 4, true,  '4 dias cobrado, 0 resposta → continua em backoff'],
  [0, 0, false, 'tarefa nova (1º contato), 0 cobrança prévia → envia'],
  [0, 1, false, '1 dia cobrado, ainda 0 resposta → ainda envia (não bateu 3)'],
  [0, 2, false, '2 dias cobrado → ainda envia (não bateu 3)'],
  [2, 5, false, 'respondeu 2x em 72h, mesmo com 5 dias de cobrança → NÃO backoff (engajou)'],
  [1, 3, false, 'respondeu 1x em 72h → sai do silêncio, cobra normal'],
];

let ok = true;
console.log('=== Backoff por silêncio (Fatia D) ===');
for (const [inb, days, esperado, desc] of CASES) {
  const got = shouldBackoff(inb, days);
  const pass = got === esperado;
  if (!pass) ok = false;
  console.log(`${pass ? '✅' : '❌'} inbound72h=${inb} priorNagDays=${days} → ${got ? 'BACKOFF' : 'envia'} | ${desc}`);
}
console.log(ok ? '\n🟢 SMOKE PASS' : '\n🔴 SMOKE FAIL');
process.exit(ok ? 0 : 1);
