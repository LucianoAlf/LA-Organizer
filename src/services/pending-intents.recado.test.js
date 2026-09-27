'use strict';
// Clayton 26/09 09:03: "Quer que eu peça pra Fefê…?" não virava pergunta pendente, o "Ok" chegava
// solto e o recado era perguntado DE NOVO — nunca saiu. Falas REAIS dos últimos 30 dias.
const { test } = require('node:test');
const assert = require('node:assert');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
const { detectConfirmationQuestion } = require('./pending-intents');

const SIM = [
  'Os alunos com contrato vencido estão na consulta de renovação do LA Report, do Recreio. Quer que eu peça pra Fefê te mandar a lista dos que já venceram?',
  'Me repete: você quer que eu mande mensagem pro Valdo amanhã às 10h perguntando sobre alunos de guitarra com menos de 10 anos aptos pra banda?',
  'Me manda de novo: aviso pro Rafinha sobre as rondas e abro as duas demandas de baqueta com urgência?',
  'Quer que eu avise a Rose?',
];
const NAO = [
  'Qual é a mensagem que quer mandar pra elas?',
  'Não consegui processar o aviso pro Rafinha dessa vez — pode me confirmar de novo o que quer mandar pra ele?',
  'Isso é pra lembrar a *Juliana* de falar com a Sheila na segunda às 14h, ou é um lembrete pra você mesma sobre isso?',
  'Quer que eu peça pra Fefê cancelar a aula de amanhã?', // mexe em item existente: continua vetado
];

test('proposta de recado de SIM/NÃO vira pergunta pendente (o "Ok" passa a valer)', () => {
  for (const q of SIM) assert.deepStrictEqual(detectConfirmationQuestion(q), { kind: 'confirmation' }, q);
});

test('pergunta aberta, de alternativa ou que mexe em item existente NÃO vira', () => {
  for (const q of NAO) assert.strictEqual(detectConfirmationQuestion(q), null, q);
});

test('o que já funcionava continua igual', () => {
  assert.deepStrictEqual(detectConfirmationQuestion('Aviso o Hugo? Confirma?'), { kind: 'confirmation' });
  assert.deepStrictEqual(detectConfirmationQuestion('Crio pra você?'), { kind: 'task_creation' });
  assert.strictEqual(detectConfirmationQuestion('Bom dia! Tudo tranquilo por aí'), null);
});
