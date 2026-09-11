'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { pedeListaNumerada, gruposDaLista, falaJaNumera, textoListaNumerada, totalDe } = require('./lista-numerada');

// Alf 01/07 (26f817b5): mesma forma da lista real — 4 seções, 15 + 6 + 13 + 37 = 71 (nomes trocados).
const SECOES = [['Feminina – Colaboradoras', 15], ['Feminina – Professoras', 6], ['Masculina – Colaboradores', 13], ['Masculina – Professores', 37]];
let k = 0;
const LISTA = SECOES.map(([t, n]) => [`*${t}*`, ...Array.from({ length: n }, () => `• Pessoa ${++k} (M)`)].join('\n')).join('\n\n');
const AUDIO = '[áudio transcrito] Então, primeira coisa, eu quero que você organize isso daí, deixe bonitinho e tal, já tá organizado, né? Mas isso daí são os tamanhos aqui das camisas dos colaboradores e eu quero que você liste um, dois, três, quatro, até pra gente saber quantas são, tá bom?';
// A fala real do TOM às 13:24: só grades, nenhum nome.
const FALA = '📋 *Tamanhos de camisetas do uniforme*\n\n👕 *Resumo geral*\n• Total: *71 camisetas*\n• Femininas: *21*\n• Masculinas: *50*\n\n👚 *Grade feminina*\n• PP: 1\n• P: 5\n• M: 10';

test('o áudio do Alf pede lista numerada; pedidos comuns não', () => {
  assert.strictEqual(pedeListaNumerada(AUDIO), true);
  assert.strictEqual(pedeListaNumerada('numera os nomes aí'), true);
  assert.strictEqual(pedeListaNumerada('me manda a lista numerada'), true);
  assert.strictEqual(pedeListaNumerada('liste um dois até o fim'), true);
  assert.strictEqual(pedeListaNumerada('conta um, dois, três pra saber quantas são'), true);
  assert.strictEqual(pedeListaNumerada('organiza isso bonitinho e separa a grade'), false);
  assert.strictEqual(pedeListaNumerada('me liga amanhã, um dia desses'), false);
});

test('a lista do Alf: 4 seções, 71 itens, na ordem', () => {
  const g = gruposDaLista(LISTA);
  assert.deepStrictEqual(g.map((x) => [x.titulo, x.itens.length]), SECOES);
  assert.strictEqual(totalDe(g), 71);
  assert.strictEqual(g[3].itens[36], 'Pessoa 71 (M)');
});

test('menos de 5 itens, ou prosa, não é lista', () => {
  assert.strictEqual(gruposDaLista('• a\n• b\n• c'), null);
  assert.strictEqual(gruposDaLista(AUDIO), null);
});

test('a fala só com grades não numera; a que numera 71 não recebe de novo', () => {
  assert.strictEqual(falaJaNumera(FALA, 71), false);
  const numerada = Array.from({ length: 71 }, (_, i) => `${i + 1}. Pessoa ${i + 1}`).join('\n');
  assert.strictEqual(falaJaNumera(numerada, 71), true);
});

test('texto: numeração contínua entre seções, com a contagem de cada uma', () => {
  const t = textoListaNumerada(gruposDaLista(LISTA));
  assert.match(t, /^🔢 \*Lista numerada — 71\*/);
  assert.match(t, /\*Feminina – Professoras\* \(6\)\n16\. Pessoa 16 \(M\)/);
  assert.match(t, /\n71\. Pessoa 71 \(M\)$/);
});

test('item sem seção também numera', () => {
  const t = textoListaNumerada(gruposDaLista('- arroz\n- feijão\n- ovo\n- leite\n- pão'));
  assert.strictEqual(t, '🔢 *Lista numerada — 5*\n\n1. arroz\n2. feijão\n3. ovo\n4. leite\n5. pão');
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: completa a fala com a lista numerada antes da decisão de voz', () => {
  const i = ENG.indexOf('LISTA-NUMERADA-NAO-ENTREGUE');
  assert.ok(i > 0 && i < ENG.indexOf('  // ---- Sprint 28 — TOM Voice (TTS via ElevenLabs)'));
  assert.match(ENG, /if \(_lnGrupos && !falaJaNumera\(reply, totalDe\(_lnGrupos\)\)\) \{/);
});
