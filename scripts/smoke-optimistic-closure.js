#!/usr/bin/env node
// Smoke: o detector anti-mentira (Sprint 21.5 + 31.7) precisa pegar confirmações
// de CONCLUSÃO de cobrança ("✅ Fechado", "Concluí", "Resolvido"), senão a
// blindagem não dispara quando o complete é rejeitado (bug Dai 30/05).
// Espelha os regexes de engine.js (TASK_UPDATE ~6356 e EVENT_UPDATE ~6731).

const optimisticPattern = /\b(registrad|agendad|reagendad|atualizad|salvei|salvo|guardad|marqu(ei|amos)|criad|conclu[ií]|fechad|fechei|resolvid|finalizad|encerrad|reagendando|agendando|registrando|feito[!.*\]]?|pronto[!.]?\s|bora[!.]?$)/i;
const optimisticEUPattern = /\b(reagendad|atualizad|movid|cancelad|conclu[ií]d|fechad|fechei|resolvid|finalizad|encerrad|registrad|salvei|feito[!.*\]]?|pronto[!.]?\s)/i;

// DEVEM disparar (confirmação otimista — exige aviso honesto se marker rejeitado).
const MUST_MATCH = [
  '✅ Fechado: *Cobrar proposta do Barra Word com o Luciano*.',
  '✅ Marcado como feito!',
  'Concluí aqui pra você.',
  'Resolvido! Próxima.',
  'Tarefa finalizada ✅',
  'Encerrado, pode seguir.',
  '✅ Registrado!',
  'Reagendado pra amanhã.',
];

// NÃO devem disparar (perguntas / coleta de info — sem promessa de persistência).
const MUST_NOT_MATCH = [
  'Claro! De que é o lembrete?',
  'Qual a unidade do aluno?',
  'Beleza, me conta como foi.',
  'Quer que eu crie essa tarefa?',
];

let ok = true;
for (const s of MUST_MATCH) {
  const m = optimisticPattern.test(s) || optimisticEUPattern.test(s);
  if (!m) { ok = false; console.log(`FALHOU (deveria pegar): "${s}"`); }
}
for (const s of MUST_NOT_MATCH) {
  if (optimisticPattern.test(s)) { ok = false; console.log(`FALHOU (falso-positivo): "${s}"`); }
}
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(ok ? 0 : 1);
