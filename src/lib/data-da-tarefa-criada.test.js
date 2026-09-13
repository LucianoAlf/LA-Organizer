'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { faltaDataNaFala, textoDataCriada, rotuloDaData, falaCitaData } = require('./data-da-tarefa-criada');

// Yuri, 12/09 (sábado) 13:31 BRT: pediu "segunda feira", a tarefa nasceu 14/09 e a fala foi só a hora.
const HOJE = '2026-09-12';
const SEGUNDA = '2026-09-14';
const FALA_REAL = 'Anotado, Yuri. 🔔 Lembro às 14h.';
const CRIADAS = [{ title: 'Agendar entrevistas — Drums Connections', due_date: SEGUNDA }];

test('Yuri: a fala só tinha a hora → a data entra', () => {
  const alvo = faltaDataNaFala(FALA_REAL, CRIADAS, HOJE);
  assert.deepStrictEqual(alvo, { title: 'Agendar entrevistas — Drums Connections', due_date: SEGUNDA });
  assert.strictEqual(textoDataCriada(alvo, HOJE), '📅 Fica para *segunda, 14/09*.');
});

test('a fala que JÁ diz o dia não recebe nada — por data, por dia da semana ou por "amanhã"', () => {
  assert.strictEqual(faltaDataNaFala('Anotado — 14/09 às 14h.', CRIADAS, HOJE), null);
  assert.strictEqual(faltaDataNaFala('Fechou, fica pra segunda!', CRIADAS, HOJE), null);
  assert.strictEqual(faltaDataNaFala('Fechou, fica pra segunda-feira!', CRIADAS, HOJE), null);
  assert.strictEqual(faltaDataNaFala('Anotado pra amanhã!', [{ title: 'x', due_date: '2026-09-13' }], HOJE), null);
});

test('tarefa de hoje não vira ruído; sem data não inventa', () => {
  assert.strictEqual(faltaDataNaFala('Anotado!', [{ title: 'x', due_date: HOJE }], HOJE), null);
  assert.strictEqual(faltaDataNaFala('Anotado!', [{ title: 'x', due_date: null }], HOJE), null);
  assert.strictEqual(faltaDataNaFala('Anotado!', [], HOJE), null);
});

test('o rótulo é o que a pessoa usaria', () => {
  assert.strictEqual(rotuloDaData(HOJE, HOJE), 'hoje');
  assert.strictEqual(rotuloDaData('2026-09-13', HOJE), 'amanhã (13/09)');
  assert.strictEqual(rotuloDaData(SEGUNDA, HOJE), 'segunda, 14/09');
  assert.strictEqual(rotuloDaData('2026-09-19', HOJE), '19/09');   // além da semana: só a data
  assert.strictEqual(rotuloDaData('2026-10-02', HOJE), '02/10');
});

test('citação por data aceita 14/09 e 14/9, e não casa número solto', () => {
  assert.strictEqual(falaCitaData('marquei 14/9', SEGUNDA, HOJE), true);
  assert.strictEqual(falaCitaData('marquei 14/09', SEGUNDA, HOJE), true);
  assert.strictEqual(falaCitaData('são 14 entrevistas, 9 alunos', SEGUNDA, HOJE), false);
  assert.strictEqual(falaCitaData('fica pra 114/09', SEGUNDA, HOJE), false);
});

test('duas criadas: devolve a primeira que a fala esqueceu', () => {
  const duas = [{ title: 'A', due_date: SEGUNDA }, { title: 'B', due_date: '2026-09-16' }];
  assert.strictEqual(faltaDataNaFala('Anotei A pra segunda', duas, HOJE).title, 'B');
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: guarda a data da tarefa criada, devolve e completa a fala que esqueceu', () => {
  assert.match(ENG, /_criadasDatas\.push\(\{ title: insertRow\.title, due_date: insertRow\.due_date \|\| null \}\);/);
  assert.match(ENG, /criadas: _criadasDatas/);
  assert.match(ENG, /const _alvoData = faltaDataNaFala\(_alvoTxtData, criadas, _hojeYmdData\);/);
});
