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

// ————— Via 3: "tirar/remover do sistema" (KRISSYA-PROJECT-SYSTEM-REMOVE-NO-TOKEN, 07/07) —————

test('Krissya REAL: "L.A teclas concluido, pode tirar do sistema" → complete + nome antes do verbo', () => {
  assert.deepStrictEqual(detectProjectStatusIntent('L.A teclas concluido, pode tirar do sistema'),
    { action: 'complete', nameHint: 'L.A teclas', quotedText: null, viaProjectToken: false });
});

test('via 3 com nome DEPOIS do verbo: "pode tirar o LA Teclas do sistema" → cancel (remoção pura)', () => {
  assert.deepStrictEqual(detectProjectStatusIntent('pode tirar o LA Teclas do sistema'),
    { action: 'cancel', nameHint: 'LA Teclas', quotedText: null, viaProjectToken: false });
});

test('via 3: "remove a Copa do Mundo do app" → cancel + nome', () => {
  const r = detectProjectStatusIntent('remove a Copa do Mundo do app');
  assert.strictEqual(r.action, 'cancel');
  assert.strictEqual(r.nameHint, 'Copa do Mundo');
  assert.strictEqual(r.viaProjectToken, false);
});

test('via 3 NÃO rouba a via 1: "remove o projeto LA Teclas do sistema" segue viaProjectToken=true', () => {
  const r = detectProjectStatusIntent('remove o projeto LA Teclas do sistema');
  assert.strictEqual(r.viaProjectToken, true);
});

test('NEGATIVO via 3: remover sem "do sistema/app" → null (como hoje)', () => {
  assert.strictEqual(detectProjectStatusIntent('tira o leite da lista'), null);
  assert.strictEqual(detectProjectStatusIntent('remove essa tarefa aí'), null);
});

test('NEGATIVO via 3: conclusão sem pedido de remoção → null (como hoje)', () => {
  assert.strictEqual(detectProjectStatusIntent('L.A teclas concluido'), null);
});

test('NEGATIVO via 3: pergunta não é comando', () => {
  assert.strictEqual(detectProjectStatusIntent('tiro o LA Teclas do sistema?'), null);
});

// ── PROJECT-INTENT-TRANSCRIPT-HIJACK (Luciano 08/07) ─────────────────────────
// Transcrição de reunião colada no chat (multi-linha, centenas de chars) continha
// "projeto"+verbo de fechar em falas → Via 1 consumia o turno e respondia "Não achei
// um projeto com esse nome" em 0.8s. Comando real é CURTO: texto longo → null (LLM).
test('transcrição de reunião colada NÃO é comando de status de projeto', () => {
  const raw = 'jul. 8, 2026\nReunião em 8 de jul. de 2026 às 09:00 GMT-03:00 - Transcrição\n00:00:19\n\n'
    + 'Luciano Alf: Oi, oi, pessoal. Bom dia.\nVitor Moreira: Bom dia,\n'
    + 'Luciano Alf: Vamos fechar o cronograma do projeto novo da Benj hoje.\n'
    + 'Fabíola Moreira: Pera aí que eu já vou resolver o áudio.\n'
    + 'Vitor Moreira: Acho que dá pra concluir essa fase do projeto até sexta.\n'
    + 'Luciano Alf: Fechou. Depois a gente alinha o resto com a equipe.\n';
  assert.strictEqual(detectProjectStatusIntent(raw), null);
});

test('texto de 1 linha porém quilométrico NÃO é comando (guarda de tamanho)', () => {
  const raw = 'fechar o projeto ' + 'da reunião de alinhamento sobre o cronograma novo '.repeat(8);
  assert.strictEqual(detectProjectStatusIntent(raw), null);
});

test('CONTROLE: comando curto segue detectando após a guarda', () => {
  assert.deepStrictEqual(detectProjectStatusIntent('fecha o projeto Marketing'),
    { action: 'complete', nameHint: 'Marketing', quotedText: null, viaProjectToken: true });
});
