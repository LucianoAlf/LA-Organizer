// RECIBO-DE-ACAO-FORJADO-PELO-MODELO (Barra, 03/10 14:02 e 14:04 BRT — Arthur, "alunos de hoje sem
// anamnese" e depois "cade"). O bloco ‹‹ACTIONS›› é o RECIBO do motor: só o código o escreve,
// depois de executar o marcador. Às 12:12 o TOM emitiu <<SITUACAO_ALUNO>> de verdade e a fala
// ficou gravada como "Deixa eu confirmar quem ainda tá pendente: ‹‹ACTIONS››[{situacao ok}]".
// Às 14:02 o modelo releu essa linha no histórico e IMITOU a forma: escreveu o recibo à mão, sem
// marcador. Nenhum `situacao grupo=` no log, nenhum card — e o app mostrou "ok". Às 14:04 a
// segunda resposta copiou a primeira. O Arthur nunca recebeu os nomes.
// Mesma família de GROUPCHAT-DATE-SELF-POISONING (06/08): o que o TOM grava vira o que ele relê.
const { test } = require('node:test');
const assert = require('node:assert');
const { buildTomContent, ACTIONS_DELIM } = require('./group-chat-engine');
const { fmtHistoryLine } = require('./group-chat-prompt');

// Literal gravado em group_chat_messages, 03/10 17:02:29 UTC.
const FORJADO = 'Pauta de hoje já tá no painel — são 14 alunos com aula hoje. Deixa eu confirmar quem ainda falta:\n\n'
  + '‹‹ACTIONS››[{"kind":"situacao","status":"ok","label":"Situação do aluno (anamnese)"}]';

test('recibo escrito pelo MODELO não sobrevive: sem ação executada, sem bloco ACTIONS', () => {
  const c = buildTomContent(FORJADO, []);
  assert.ok(!String(c).includes(ACTIONS_DELIM), `recibo forjado chegou ao content: ${c}`);
  assert.match(String(c), /Deixa eu confirmar quem ainda falta/);
});

test('controle: recibo do MOTOR (ação real) continua sendo anexado, uma vez só', () => {
  const c = buildTomContent(FORJADO, [{ kind: 'situacao', status: 'ok', label: 'Situação do aluno (anamnese)' }]);
  assert.strictEqual(String(c).split(ACTIONS_DELIM).length, 2, 'exatamente um bloco, o do motor');
});

test('histórico: o recibo não é fala — o modelo não relê o bloco ACTIONS', () => {
  const linha = fmtHistoryLine({ role: 'tom', content: FORJADO });
  assert.ok(!linha.includes(ACTIONS_DELIM), `bloco ACTIONS reapresentado ao modelo: ${linha}`);
  assert.ok(!linha.includes('"kind":"situacao"'));
  assert.match(linha, /^TOM: Pauta de hoje/);
});

test('controle: fala de PESSOA fica intacta no histórico', () => {
  const linha = fmtHistoryLine({ role: 'member', who: 'Tutu', content: 'tom, alunos de hoje sem anamnese' });
  assert.strictEqual(linha, 'Tutu: tom, alunos de hoje sem anamnese');
});
