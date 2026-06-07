// scripts/smoke-coord-guard.js
// Fatia B — prova do guard anti-mentira do COORDINATION_REQUEST malformed: o regex
// deve disparar em AFIRMAÇÃO de envio (avisei/mandei/...) e NÃO disparar em
// pergunta/futuro (quer que eu avise?/vou avisar). Mesmo regex literal do engine.js.
// Rodar: node scripts/smoke-coord-guard.js
const optimisticCoordPattern = /\b(avis(ei|ado|ada|amos)|mand(ei|ado|ada|ando|amos)|repass(ei|ado|ada|ando|amos)|encaminh(ei|ado|ada|ando|amos)|envi(ei|ado|ada|ados|adas)|transmit(i|ido)|comuniqu(ei|ado|ada)|j[áa]\s+(mandei|avisei|enviei|repassei))\b/i;

const POSITIVOS = [
  'Pronto, avisei a Anne.',
  '📨 Avisei a Anne com o resumo completo.',
  'Já mandei pro Quintela.',
  'Repassei pro Jereh agora.',
  'Encaminhei o recado.',
  'Mensagem enviada pra ela.',
  'Comuniquei o time.',
];
const NEGATIVOS = [
  'Quer que eu avise a Anne?',
  'Vou avisar o Quintela.',
  'Posso mandar pra ela?',
  'Beleza, vou pensar.',
  'Quer que eu repasse?',
  'Te aviso assim que tiver retorno.', // futuro
];

let ok = true;
console.log('=== POSITIVOS (devem disparar o aviso honesto) ===');
for (const p of POSITIVOS) { const hit = optimisticCoordPattern.test(p); console.log(`${hit ? '✅' : '❌'} ${p}`); if (!hit) ok = false; }
console.log('\n=== NEGATIVOS (NÃO podem disparar) ===');
for (const n of NEGATIVOS) { const hit = optimisticCoordPattern.test(n); console.log(`${!hit ? '✅' : '❌'} ${n}`); if (hit) ok = false; }
console.log(ok ? '\n🟢 SMOKE PASS' : '\n🔴 SMOKE FAIL');
process.exit(ok ? 0 : 1);
