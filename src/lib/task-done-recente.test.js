'use strict';
// TASK-HONESTY-NEGA-BAIXA-FEITA (Kailane 12/08 19:21) — o irmão do COORD-HONESTY nas TAREFAS.
//
// O caso, com os timestamps do banco:
//   19:21:17-18  as 3 tarefas ficam `done` (completed_at prova)
//   19:21:23     TOM: "✅ Dei baixa nas 3 pendências: ..."   ← verdade
//   19:21:26     Kailane: "pode finalizar"
//   19:21:42     TOM: "não consegui finalizar por aqui — me manda de novo quais quer fechar?"
//
// Reincidiu 5× em 11 e 12/08, os dois dias em que o fallback do GPT respondeu (62 e 33 spawns).
// Zero commits nesses dias: o código não mudou, o modelo mudou. O ramo `!hasConcrete` do
// markerRule sempre foi frágil — com o Claude ele raramente era alcançado; sob fallback virou
// o caminho comum, e a instrução que ele carrega afirma um absoluto que a evidência não sustenta.

const test = require('node:test');
const assert = require('node:assert');
const { concluidasRecentes, regraComConclusaoRecente } = require('./task-done-recente');

const REGRA_BASE = 'O payload NÃO tem item concreto (sem draft/ids): você NÃO consegue executar isso agora. NÃO emita marker nenhum e NÃO toque em tasks/eventos existentes. E NÃO afirme que fez — nada foi gravado. Em UMA linha curta e natural, assuma que não conseguiu registrar e peça pra pessoa repetir o pedido com os detalhes.';

const KAILANE = new Date('2026-08-12T22:21:42Z');       // o turno que negou
const TAREFAS_KAILANE = [
  { title: 'Mandar mensagem para Vanessa Cunha — matrícula', completed_at: '2026-08-12T22:21:17Z' },
  { title: 'Lembrar os alunos da primeira aula', completed_at: '2026-08-12T22:21:17Z' },
  { title: 'Enviar todos os checklists pendentes', completed_at: '2026-08-12T22:21:18Z' },
];

// ── PROVA DE REVERSÃO ────────────────────────────────────────────────────────────────────────
test('caso Kailane: as 3 baixas de 25s atrás entram na regra', () => {
  const titulos = concluidasRecentes(TAREFAS_KAILANE, KAILANE);
  assert.equal(titulos.length, 3);
  const regra = regraComConclusaoRecente(REGRA_BASE, titulos);
  assert.match(regra, /Vanessa Cunha/);
  assert.match(regra, /PROIBIDO/);
  assert.match(regra, /3 tarefa/);
});

// A prova de que o teste pega o bug: a regra ORIGINAL, sozinha, é o que produziu a fala do TOM.
// Ela manda pedir repetição sem nenhuma ressalva — é isso que o fix precisa cobrir.
test('a regra base sozinha manda pedir repetição — era o defeito', () => {
  assert.match(REGRA_BASE, /peça pra pessoa repetir/);
  assert.doesNotMatch(REGRA_BASE, /PROIBIDO|já concluiu/);
});

test('a proibição de emitir marker CONTINUA — o fix não afrouxa o gate original', () => {
  const regra = regraComConclusaoRecente(REGRA_BASE, concluidasRecentes(TAREFAS_KAILANE, KAILANE));
  assert.match(regra, /NÃO emita marker nenhum/, 'o perigo do LLM chutar alvo (Rose 10/06) segue barrado');
  assert.match(regra, /NÃO toque em tasks\/eventos existentes/);
});

// ── QUANDO NÃO AGIR — o caminho comum não pode mudar ─────────────────────────────────────────
test('sem conclusão recente a regra volta idêntica', () => {
  assert.strictEqual(regraComConclusaoRecente(REGRA_BASE, []), REGRA_BASE);
  assert.strictEqual(regraComConclusaoRecente(REGRA_BASE, null), REGRA_BASE);
});

test('conclusão antiga não conta — "recente" tem que significar recente', () => {
  const ontem = [{ title: 'Coisa velha', completed_at: '2026-08-11T22:21:17Z' }];
  assert.deepEqual(concluidasRecentes(ontem, KAILANE), []);
});

test('conclusão no futuro (relógio torto) é ignorada, não vira aviso', () => {
  const futuro = [{ title: 'Do futuro', completed_at: '2026-08-12T23:00:00Z' }];
  assert.deepEqual(concluidasRecentes(futuro, KAILANE), []);
});

test('linha degenerada não entra na lista nem quebra', () => {
  const sujo = [null, {}, { title: '   ', completed_at: '2026-08-12T22:21:17Z' },
    { title: 'Boa', completed_at: 'lixo' }, { title: 'Ok', completed_at: '2026-08-12T22:21:17Z' }];
  assert.deepEqual(concluidasRecentes(sujo, KAILANE), ['Ok']);
});

test('entrada inválida devolve lista vazia, sem exceção', () => {
  for (const v of [null, undefined, 'lixo', 42]) assert.deepEqual(concluidasRecentes(v, KAILANE), []);
  assert.deepEqual(concluidasRecentes(TAREFAS_KAILANE, NaN), []);
});

// ── A FALA NÃO PODE VIRAR PAREDE ─────────────────────────────────────────────────────────────
// Isto entra num prompt de turno de WhatsApp: lista longa rouba atenção da parte que importa,
// que é a proibição de negar.
test('mais de 3 títulos vira resumo, e o total continua dito', () => {
  const muitas = ['A', 'B', 'C', 'D', 'E'].map((t) => ({ title: t, completed_at: '2026-08-12T22:21:17Z' }));
  const regra = regraComConclusaoRecente(REGRA_BASE, concluidasRecentes(muitas, KAILANE));
  assert.match(regra, /5 tarefa/);
  assert.match(regra, /e mais 2/);
  assert.doesNotMatch(regra, /"E"/);
});

// A regra NÃO pode afirmar que o pedido atual já foi atendido — isso seria chutar alvo, o
// perigo que criou o ramo proibitivo. Ela entrega o fato e deixa o LLM decidir se é o mesmo item.
test('não afirma que o pedido atual já foi feito — só entrega o fato', () => {
  const regra = regraComConclusaoRecente(REGRA_BASE, concluidasRecentes(TAREFAS_KAILANE, KAILANE));
  assert.match(regra, /Se o pedido dela for sobre esses itens/);
  assert.match(regra, /Só peça os detalhes se o pedido for claramente sobre OUTRA coisa/);
});
