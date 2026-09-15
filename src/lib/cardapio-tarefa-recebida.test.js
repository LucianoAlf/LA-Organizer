'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ehCardapio, escolhaDoCardapio, cardapiosEmAberto, textoResolvoAgora, textoPerguntaAgendo, textoApoioAvisado, textoApoioParaCriador } = require('./cardapio-tarefa-recebida');

// A notificação REAL que o Rafinha recebeu duas vezes em 14/09 19:13 BRT.
const CARDAPIO = 'Oi, Rafinha 👋\n\n📋 O Dudu abriu uma tarefa pra você:\n*Baquetas não estão voltando pra recepção — CG* (prazo 14/09)\n\n❓ *Como você quer tratar?*\n1️⃣ *Resolvo agora* — vou cuidar disso hoje\n2️⃣ *Agendo* — vou tratar nos próximos dias\n3️⃣ *Delego* — passa pra outra pessoa da equipe\n4️⃣ *Preciso de apoio* — me ajuda a destravar\n_Responde com o número_';

test('reconhece o cardápio de tarefa recebida — e não outros menus numerados', () => {
  assert.strictEqual(ehCardapio(CARDAPIO), true);
  assert.strictEqual(ehCardapio('Achei um compromisso parecido já criado… 1️⃣ É o mesmo compromisso 2️⃣ É outro'), false);
  assert.strictEqual(ehCardapio('Fechamento do dia, Dudu 1. Marcar consulta — fez?'), false);
});

test('Rafinha: "Resolve aí" é a opção 1', () => {
  assert.strictEqual(escolhaDoCardapio('Resolve aí'), '1');
});

test('número puro, com emoji e com "opção"', () => {
  assert.strictEqual(escolhaDoCardapio('1'), '1');
  assert.strictEqual(escolhaDoCardapio('2'), '2');
  assert.strictEqual(escolhaDoCardapio('3️⃣'), '3');
  assert.strictEqual(escolhaDoCardapio('opção 4'), '4');
  assert.strictEqual(escolhaDoCardapio('5'), null);
  assert.strictEqual(escolhaDoCardapio('1 e 2'), null, 'resposta de fechamento não é escolha de cardápio');
});

test('respostas em palavras', () => {
  assert.strictEqual(escolhaDoCardapio('deixa comigo'), '1');
  assert.strictEqual(escolhaDoCardapio('pode deixar que eu resolvo'), '1');
  assert.strictEqual(escolhaDoCardapio('agendo pra semana'), '2');
  assert.strictEqual(escolhaDoCardapio('delega pra Mayra'), '3');
  assert.strictEqual(escolhaDoCardapio('preciso de ajuda nessa'), '4');
  assert.strictEqual(escolhaDoCardapio('tô travado aqui'), '4');
});

test('"preciso de ajuda" vence "resolver" quando os dois aparecem', () => {
  assert.strictEqual(escolhaDoCardapio('não consigo resolver sozinho'), '4');
  assert.strictEqual(escolhaDoCardapio('não resolvo sozinho, preciso de ajuda'), '4');
});

test('fala longa não é resposta de cardápio', () => {
  assert.strictEqual(escolhaDoCardapio('então, sobre as baquetas eu acho que eu resolvo amanhã depois que eu falar com o Dudu na recepção'), null);
  assert.strictEqual(escolhaDoCardapio('bom dia'), null);
});

test('textos do sistema: uma tarefa e duas', () => {
  assert.strictEqual(textoResolvoAgora(['Baquetas — CG']), '✅ Fechado — *Baquetas — CG* fica com você pra hoje. Quando resolver, me fala que eu dou baixa.');
  assert.match(textoResolvoAgora(['A', 'B']), /ficam com você pra hoje:\n• \*A\*\n• \*B\*/);
  assert.strictEqual(textoPerguntaAgendo(['A']), '📅 Pra quando você agenda *A*? Me diz o dia.');
  assert.strictEqual(textoApoioAvisado({ criadores: ['Dudu'], titulos: ['A'] }), '📣 Avisei *Dudu* que você precisa de apoio pra destravar *A*.');
  assert.strictEqual(textoApoioParaCriador({ quemPede: 'Rafinha', titulos: ['A'] }), '🆘 Rafinha precisa de apoio pra destravar *A*. Dá uma força?');
});

test('cardápios em aberto: a sequência mais nova, parando na primeira fala que não é cardápio', () => {
  const c = (id) => ({ content: CARDAPIO, ref_type: 'task', ref_id: id });
  assert.deepStrictEqual(cardapiosEmAberto([c('b'), c('a'), { content: 'Bom dia!' }, c('velho')]).map((r) => r.ref_id), ['b', 'a']);
  assert.deepStrictEqual(cardapiosEmAberto([{ content: 'Fechamento do dia 1. X' }, c('a')]), [], 'depois do cardápio o TOM falou outra coisa: o número é dessa outra');
  assert.deepStrictEqual(cardapiosEmAberto([{ content: CARDAPIO }]), [], 'cardápio sem vínculo com tarefa não tem alvo');
});

test('textos com várias tarefas não deixam pontuação solta', () => {
  assert.strictEqual(textoPerguntaAgendo(['A', 'B']), '📅 Pra quando você agenda essas?\n• *A*\n• *B*\n\nMe diz o dia.');
  assert.strictEqual(textoApoioParaCriador({ quemPede: 'Rafinha', titulos: ['A', 'B'] }), '🆘 Rafinha precisa de apoio pra destravar:\n• *A*\n• *B*\n\nDá uma força?');
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: a notificação sai vinculada à tarefa e a resposta tem executor antes do LLM', () => {
  assert.ok(ENG.includes("content: notifText, collaboratorId: recipient.id, refType: 'task', refId: taskId"), 'o cardápio ainda sai sem vínculo');
  assert.ok(ENG.includes('const _cdEscolha = cd.escolhaDoCardapio(userText);'), 'ninguém lê a resposta do cardápio');
  assert.ok(ENG.includes('let _cdAlvos = cd.cardapiosEmAberto(_outs || []);'), 'o executor pode roubar o número de outro menu');
  assert.ok(ENG.includes("if (!_citado || !cd.ehCardapio(_citado.content) || _citado.ref_type !== 'task' || !_citado.ref_id) return null;"), 'citar outra mensagem não pode virar escolha de cardápio');
  const iBypass = ENG.indexOf('const dupBypass = await tryDupBypass(');
  const iCard = ENG.indexOf('try { _cardapio = await tryCardapioTarefa(collab, String(inboundVerbatimText');
  assert.ok(iBypass > 0 && iCard > iBypass, 'o cardápio de tarefa roda depois do menu de duplicata (que tem prazo de 10 min e vence)');
});
