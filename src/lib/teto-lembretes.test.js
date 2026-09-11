'use strict';
// TETO-DE-LEMBRETES (decisão do Alf 11/09 — 4b19337f, d1163c32).
const { test } = require('node:test');
const assert = require('node:assert');
const { limitarLembretes } = require('./teto-lembretes');

const HORA = (h, m = 0) => `2026-07-14T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`;

test('Arthur: 8 lembretes de hora em hora → ficam os 3 primeiros, 5 cortados', () => {
  const r = limitarLembretes([8, 9, 10, 11, 12, 13, 14, 15].map((h) => HORA(h)));
  assert.deepStrictEqual(r.mantidos, [HORA(8), HORA(9), HORA(10)]);
  assert.strictEqual(r.cortados, 5);
});
test('lembrete a menos de 30 min do anterior é pulado (e o seguinte entra)', () => {
  const r = limitarLembretes([HORA(9), HORA(9, 10), HORA(9, 45)]);
  assert.deepStrictEqual(r.mantidos, [HORA(9), HORA(9, 45)]);
  assert.strictEqual(r.cortados, 1);
});
test('fora de ordem: ordena, e os índices apontam pra posição ORIGINAL (rótulos não desalinham)', () => {
  const r = limitarLembretes([HORA(15), HORA(9), HORA(12)]);
  assert.deepStrictEqual(r.mantidos, [HORA(9), HORA(12), HORA(15)]);
  assert.deepStrictEqual(r.indices, [1, 2, 0]);
  assert.strictEqual(r.cortados, 0);
});
test('até 3 bem espaçados passam intactos; lista vazia/inválida não quebra', () => {
  assert.deepStrictEqual(limitarLembretes([HORA(9), HORA(14)]), { mantidos: [HORA(9), HORA(14)], indices: [0, 1], cortados: 0 });
  assert.deepStrictEqual(limitarLembretes(null), { mantidos: [], indices: [], cortados: 0 });
  assert.deepStrictEqual(limitarLembretes(['lixo']), { mantidos: [], indices: [], cortados: 0 });
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: a criação de tarefa passa os lembretes pelo teto e casa o rótulo pelo índice original', () => {
  assert.match(ENG, /const _teto = limitarLembretes\(_remBrutos\);/);
  assert.match(ENG, /label: typeof labels\[_teto\.indices\[i\]\] === 'string'/);
});
