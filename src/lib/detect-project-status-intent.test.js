'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detectProjectStatusIntent } = require('./detect-project-status-intent');

test('via explícita: "fecha o projeto Marketing" → complete + nameHint', () => {
  assert.deepStrictEqual(detectProjectStatusIntent('fecha o projeto Marketing'),
    { action: 'complete', nameHint: 'Marketing', quotedText: null, viaProjectToken: true });
});

test('via explícita: "cancela o projeto Vendas Q1" → cancel + nameHint', () => {
  assert.deepStrictEqual(detectProjectStatusIntent('cancela o projeto Vendas Q1'),
    { action: 'cancel', nameHint: 'Vendas Q1', quotedText: null, viaProjectToken: true });
});

test('"conclui o projeto X" e "encerra o projeto X" também disparam complete', () => {
  assert.strictEqual(detectProjectStatusIntent('conclui o projeto X').action, 'complete');
  assert.strictEqual(detectProjectStatusIntent('encerra o projeto X').action, 'complete');
});

test('cancel tem precedência quando ambos os verbos aparecem', () => {
  assert.strictEqual(detectProjectStatusIntent('cancela o projeto X').action, 'cancel');
});

test('NEGATIVO: "fechei a tarefa" (sem token projeto, sem reply) → null', () => {
  assert.strictEqual(detectProjectStatusIntent('fechei a tarefa'), null);
  assert.strictEqual(detectProjectStatusIntent('conclui isso'), null);
});

test('NEGATIVO: pergunta não é comando', () => {
  assert.strictEqual(detectProjectStatusIntent('fecho o projeto Marketing?'), null);
});

test('via reply-bare: "pode fechar" com scaffold → complete, nameHint null, quote preservado', () => {
  const raw = '[O usuário está RESPONDENDO a esta mensagem anterior: "✅ Tarefas feitas nesses projetos: • *Marketing* — suas tarefas já tão concluídas 🎉"]\npode fechar';
  const r = detectProjectStatusIntent(raw);
  assert.strictEqual(r.action, 'complete');
  assert.strictEqual(r.nameHint, null);
  assert.strictEqual(r.viaProjectToken, false);
  assert.match(r.quotedText, /Marketing/);
});

test('reply-scaffold com token projeto: lê fala real, não a citação', () => {
  const raw = '[O usuário está RESPONDENDO a esta mensagem anterior: "vence amanhã?"]\nfecha o projeto Lançamento';
  const r = detectProjectStatusIntent(raw);
  assert.strictEqual(r.action, 'complete');
  assert.strictEqual(r.nameHint, 'Lançamento');
  assert.strictEqual(r.viaProjectToken, true);
});

test('NEGATIVO: "pode fechar" SEM scaffold → null (sem âncora de contexto)', () => {
  assert.strictEqual(detectProjectStatusIntent('pode fechar'), null);
});

test('bare com token projeto sem nome → nameHint null (resolve por quote depois)', () => {
  const raw = '[O usuário está RESPONDENDO a esta mensagem anterior: "• *Marketing* concluído?"]\nfecha esse projeto';
  const r = detectProjectStatusIntent(raw);
  assert.strictEqual(r.action, 'complete');
  assert.strictEqual(r.nameHint, null);
});
