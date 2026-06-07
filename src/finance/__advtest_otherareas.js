'use strict';
const { detectRegisterIntent, looksLikeFinanceConfirmation } = require('D:/la-organizer/_remote/src/finance/detect-register-intent.js');

// Categoria: OUTRAS ÁREAS / conversa fiada que contém números mas NÃO é finança.
// Esperado: detectRegisterIntent => null (sem perda financeira porque não há transação).
// Para looksLikeFinanceConfirmation, todas devem ser false (não imitam template).
const cases = [
  { phrase: 'lembra de ligar pro fornecedor 2x essa semana', expect: { detect: null, conf: false } },
  { phrase: 'agenda reunião dia 10 com 5 pessoas', expect: { detect: null, conf: false } },
  { phrase: 'o show tem 300 lugares disponíveis', expect: { detect: null, conf: false } },
  { phrase: 'marca aula de violão com 3 alunos novos', expect: { detect: null, conf: false } },
  { phrase: 'o treino começa às 8 e tem 12 caras confirmados', expect: { detect: null, conf: false } },
  { phrase: 'separa 20 cadeiras pro evento de sábado', expect: { detect: null, conf: false } },
  { phrase: 'a turma 2 tem 15 alunos faltando material', expect: { detect: null, conf: false } },
  { phrase: 'cria tarefa pra revisar os 40 slides amanhã', expect: { detect: null, conf: false } },
  { phrase: 'o jogo do brasil é às 16h com 2 amigos aqui em casa', expect: { detect: null, conf: false } },
  { phrase: 'manda mensagem pros 8 pais que faltaram na reunião', expect: { detect: null, conf: false } },
  { phrase: 'preciso ensaiar a música 3 umas 10 vezes ainda', expect: { detect: null, conf: false } },
  { phrase: 'reserva a sala 4 pra aula das 14h', expect: { detect: null, conf: false } },
  { phrase: 'liga pro João às 9 pra confirmar os 6 instrumentos', expect: { detect: null, conf: false } },
  { phrase: 'agenda a prova do nível 2 pra turma das 8', expect: { detect: null, conf: false } },
  { phrase: 'tem 25 ingressos sobrando ainda pro show', expect: { detect: null, conf: false } },
  { phrase: 'coloca 3 cordas novas no violão antes da aula', expect: { detect: null, conf: false } },
  { phrase: 'o aluno errou 7 notas na escala de dó', expect: { detect: null, conf: false } },
  { phrase: 'bora marcar o churrasco pra 30 pessoas no domingo', expect: { detect: null, conf: false } },
];

let ran = 0;
const failures = [];
function normResult(r) {
  if (r === null) return { isNull: true };
  return { isNull: false, type: r.type, amount: r.amount };
}
for (const c of cases) {
  ran++;
  const real = detectRegisterIntent(c.phrase);
  const realConf = looksLikeFinanceConfirmation(c.phrase);
  // expected detect is null
  const expNull = c.expect.detect === null;
  const realN = normResult(real);
  if (expNull) {
    if (!realN.isNull) {
      failures.push({
        phrase: c.phrase, fn: 'detectRegisterIntent',
        expected: 'null', actual: JSON.stringify(realN),
      });
    }
  }
  if (realConf !== c.expect.conf) {
    failures.push({
      phrase: c.phrase, fn: 'looksLikeFinanceConfirmation',
      expected: String(c.expect.conf), actual: String(realConf),
    });
  }
}
console.log(JSON.stringify({ ran, failuresCount: failures.length, failures }, null, 2));
