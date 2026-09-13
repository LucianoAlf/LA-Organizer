'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ehRemocao, escolherMemoriaParaRemover, textoRemocao } = require('./memoria-remocao');
const { extrairConteudoMemoria } = require('../services/memory-fields');

// Anne Susan, 12/09 11:15 BRT (achado 84d9581f): a memória real de 31/05 e o marcador real que o TOM
// emitiu (action delete, conteúdo na chave `fact`) — que morria como schema_invalid.
const ANNE = { id: 'm-anne', content: 'Anne Susan precisa estudar para a prova de clínica psicanalítica no sábado.' };
const OUTRAS = [
  { id: 'm-2', content: 'Anne Susan prefere receber o briefing às 8h.' },
  { id: 'm-3', content: 'Anne Susan treina de manhã, 10h30.' },
];
const ATIVAS = [ANNE, ...OUTRAS];

test('a linha do marcador pede remoção nas formas que o modelo usa', () => {
  assert.strictEqual(ehRemocao({ action: 'delete', content: 'x' }), true);
  assert.strictEqual(ehRemocao({ action: 'Apagar' }), true);
  assert.strictEqual(ehRemocao({ action: 'esquecer' }), true);
  assert.strictEqual(ehRemocao({ content: 'x' }), false);
  assert.strictEqual(ehRemocao({ action: 'save', content: 'x' }), false);
  assert.strictEqual(ehRemocao(null), false);
});

test('o conteúdo da chave `fact` (a que a Anne caiu) passa a ser lido', () => {
  const r = extrairConteudoMemoria({ action: 'delete', fact: 'prova de clínica psicanalítica' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.content, 'prova de clínica psicanalítica');
});

test('Anne: "prova de clínica psicanalítica" acha a anotação de 31/05 e só ela', () => {
  assert.strictEqual(escolherMemoriaParaRemover('prova de clínica psicanalítica', ATIVAS).id, 'm-anne');
  assert.strictEqual(escolherMemoriaParaRemover('Prova de Clinica Psicanalitica', ATIVAS).id, 'm-anne');
  assert.strictEqual(escolherMemoriaParaRemover(ANNE.content, ATIVAS).id, 'm-anne');
});

test('acha por palavras quando a frase não é literal (2+ significativas, sem empate)', () => {
  assert.strictEqual(escolherMemoriaParaRemover('estudar psicanalitica', ATIVAS).id, 'm-anne');
});

test('na dúvida NÃO apaga: ambíguo, fragmento curto, nada parecido, lista vazia', () => {
  const gemeas = [{ id: 'a', content: 'Reunião de equipe na terça.' }, { id: 'b', content: 'Reunião de equipe na quinta.' }];
  assert.strictEqual(escolherMemoriaParaRemover('reunião de equipe', gemeas), null);
  assert.strictEqual(escolherMemoriaParaRemover('prova', ATIVAS), null);
  assert.strictEqual(escolherMemoriaParaRemover('contrato do Emusys', ATIVAS), null);
  assert.strictEqual(escolherMemoriaParaRemover('prova de clínica psicanalítica', []), null);
});

test('uma palavra significativa só não basta (evita apagar por coincidência)', () => {
  assert.strictEqual(escolherMemoriaParaRemover('briefing', ATIVAS), null);
  assert.strictEqual(escolherMemoriaParaRemover('prova', ATIVAS), null);
});

test('duas anotações IGUAIS não são desempatadas por sorte — ninguém sai', () => {
  const iguais = [{ id: 'x', content: ANNE.content }, { id: 'y', content: ANNE.content }];
  assert.strictEqual(escolherMemoriaParaRemover(ANNE.content, iguais), null);
});

test('uma palavra em comum, ou empate entre duas, não apaga', () => {
  assert.strictEqual(escolherMemoriaParaRemover('estudar sobre contrato emusys', ATIVAS), null);
  const empate = [{ id: 'a', content: 'Reunião mensal sobre contrato da Barra.' }, { id: 'b', content: 'Reunião mensal sobre contrato do Recreio.' }];
  assert.strictEqual(escolherMemoriaParaRemover('reuniao mensal contrato', empate), null);
});

test('o texto anexado diz o que saiu, e a falha é honesta', () => {
  assert.strictEqual(textoRemocao({ removidas: ['Comprar pele de bateria 13'], naoAchadas: [] }),
    '🗑️ Tirei da sua lista: *Comprar pele de bateria 13*.');
  // Título longo entra cortado em 70 chars + reticência (a anotação real da Anne tem 74).
  assert.strictEqual(textoRemocao({ removidas: [ANNE.content], naoAchadas: [] }),
    `🗑️ Tirei da sua lista: *${ANNE.content.slice(0, 70)}…*.`);
  assert.match(textoRemocao({ removidas: [], naoAchadas: ['x'] }), /Não achei essa anotação/);
  assert.strictEqual(textoRemocao({}), '');
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: separa remoção de gravação, desativa só do próprio dono e anexa o que saiu', () => {
  assert.match(ENG, /const _memRemocoes = parsedMem\.rows\.filter\(ehRemocao\);/);
  assert.match(ENG, /\.update\(\{ is_active: false, updated_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(ENG, /\.eq\('collaborator_id', collab\.id\)\.eq\('is_active', true\)/);
  assert.match(ENG, /textoRemocao\(\{ removidas: _memRemovidas, naoAchadas: _memNaoAchadas \}\)/);
});
