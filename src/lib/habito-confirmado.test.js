'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolverConclusaoDeHabito } = require('./habito-confirmado');

// O caso real, com os nomes e as falas do banco. `c91bd1bf` é o hábito "Tomar remédios" da
// Bianca (ativo, lembrete 06:00). Ela mandou a fala abaixo em 19/07, 19/08, 01/09, 03/09,
// 05/09 e 09/09 — e o hábito tem 8 registros no total, o último de 07/09.
const REMEDIOS = { id: 'c91bd1bf-749a-4fdd-a301-12dcd6a5f5f7', name: 'Tomar remédios' };
const AGUA = { id: 'aaaa1111-0000-0000-0000-000000000001', name: 'Beber água' };
const CORRIDA = { id: 'bbbb2222-0000-0000-0000-000000000002', name: 'Corrida e caminhada' };

test('a fala da Bianca marca o hábito dela', () => {
  const r = resolverConclusaoDeHabito({ texto: 'Remédios tomados', habitos: [REMEDIOS, AGUA] });
  assert.strictEqual(r.modo, 'exato', 'esta é a fala de 09/09 08:17:38 — 52 dias caindo no vão');
  assert.strictEqual(r.habitId, REMEDIOS.id);
});

test('a pessoa conjuga o verbo e o cadastro não — o casamento tem que alcançar', () => {
  // "Tomar" (cadastro) precisa alcançar "tomados"/"tomei" (fala). Igualdade exata perde os dois.
  for (const fala of ['Remédios tomados', 'já tomei os remédios', 'tomei remédio']) {
    const r = resolverConclusaoDeHabito({ texto: fala, habitos: [REMEDIOS, AGUA] });
    assert.strictEqual(r.modo, 'exato', `"${fala}" tinha que casar`);
    assert.strictEqual(r.habitId, REMEDIOS.id);
  }
  const c = resolverConclusaoDeHabito({ texto: 'corri hoje', habitos: [REMEDIOS, CORRIDA] });
  assert.strictEqual(c.modo, 'exato', '"corri" tem que alcançar "Corrida"');
  assert.strictEqual(c.habitId, CORRIDA.id);
});

test('sem afirmação de conclusão não grava nada', () => {
  // Mencionar o hábito não é dizer que fez. Sem esta trava, qualquer frase com "remédios"
  // marcaria o dia.
  for (const fala of ['os remédios', 'e os remédios?', 'remédios acabaram']) {
    assert.strictEqual(resolverConclusaoDeHabito({ texto: fala, habitos: [REMEDIOS] }).modo,
      'nenhum', `"${fala}" não afirma conclusão`);
  }
});

test('negação e futuro derrubam o turno inteiro', () => {
  // Marcar hábito errado corrompe o streak, que é o único número que a pessoa usa pra saber
  // se está conseguindo. Quem não marcou marca depois; quem marcou errado não desfaz.
  for (const fala of ['não tomei os remédios', 'esqueci de tomar remédio',
    'vou tomar os remédios agora', 'preciso tomar remédio amanhã']) {
    assert.strictEqual(resolverConclusaoDeHabito({ texto: fala, habitos: [REMEDIOS] }).modo,
      'nenhum', `"${fala}" NÃO é conclusão`);
  }
});

test('pergunta nunca é conclusão', () => {
  // Mesmo erro que eu já cometi no parser do Fechamento do dia em 07/09: "isso era pra mim
  // mesmo? 🤔" fechou tarefa. Aqui a trava nasce junto.
  assert.strictEqual(resolverConclusaoDeHabito({ texto: 'tomei os remédios?', habitos: [REMEDIOS] }).modo,
    'nenhum');
});

test('empate entre dois hábitos é ambiguidade — não grava', () => {
  const dois = [{ id: 'x1', name: 'Tomar remédio da manhã' }, { id: 'x2', name: 'Tomar remédio da noite' }];
  const r = resolverConclusaoDeHabito({ texto: 'remédio tomado', habitos: dois });
  assert.strictEqual(r.modo, 'ambiguo', 'com dois candidatos igualmente fortes, quem pergunta é o LLM');
  assert.ok(!r.habitId, 'ambíguo não pode devolver id — o chamador gravaria');
});

test('quem casa mais tokens ganha, sem empate', () => {
  const r = resolverConclusaoDeHabito({
    texto: 'tomei os remédios', habitos: [REMEDIOS, { id: 'y1', name: 'Tomar vitamina' }],
  });
  assert.strictEqual(r.modo, 'exato');
  assert.strictEqual(r.habitId, REMEDIOS.id, '2 tokens casados ganham de 1');
});

test('fala longa é conversa, não confirmação seca', () => {
  const longa = 'bom dia, hoje acordei bem e já tomei os remédios antes de sair de casa pro trabalho cedo';
  assert.strictEqual(resolverConclusaoDeHabito({ texto: longa, habitos: [REMEDIOS] }).modo,
    'nenhum', 'parágrafo com o nome de passagem é assunto do LLM');
});

test('entrada torta nunca lança', () => {
  // Este módulo roda ANTES do LLM, no caminho de todo turno. Se ele lançar, o turno morre.
  for (const e of [null, undefined, {}, { texto: 'tomei' }, { habitos: [REMEDIOS] },
    { texto: 'tomei remédio', habitos: [null, {}, { id: 'z' }, { name: 'sem id' }] }]) {
    assert.doesNotThrow(() => resolverConclusaoDeHabito(e));
  }
  assert.strictEqual(resolverConclusaoDeHabito({ texto: 'tomei remédio', habitos: [{ id: 'z' }] }).modo,
    'nenhum', 'hábito sem nome não casa nada');
});
