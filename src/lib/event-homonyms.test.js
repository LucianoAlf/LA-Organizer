'use strict';
// #2D1 — fan-out de complete pra eventos homônimos (caso Leo "Entre Teclas").
// Rodar: node --test src/lib/event-homonyms.test.js
const test = require('node:test');
const assert = require('node:assert');
const { pickHomonymSiblingsToComplete } = require('./event-homonyms');

// "agora" = 28/06 18:00 UTC. Leo: 2 "Entre Teclas" (26 22:00 e 27 13:00), ambos passados.
const NOW = Date.parse('2026-06-28T18:00:00Z');
const ev26 = { id: 'aaaa1111', title: 'Entre Teclas', status: 'scheduled', start_at: '2026-06-26T22:00:00Z' };
const ev27 = { id: 'bbbb2222', title: 'Entre Teclas', status: 'scheduled', start_at: '2026-06-27T13:00:00Z' };

test('Leo: resolveu o de 27 → fan-out pega o de 26 (homônimo passado, <3d)', () => {
  const ids = pickHomonymSiblingsToComplete(ev27, [ev26, ev27], NOW);
  assert.deepStrictEqual(ids, ['aaaa1111']);
});
test('simétrico: resolveu o de 26 → pega o de 27', () => {
  assert.deepStrictEqual(pickHomonymSiblingsToComplete(ev26, [ev26, ev27], NOW), ['bbbb2222']);
});

// ── Armadilha da RECORRÊNCIA semanal: não fechar instâncias de semanas atrás ──
test('recorrência semanal: "aula de hoje" NÃO fecha a da semana passada (>3d)', () => {
  const hoje = { id: 'h1', title: 'Aula de violão', status: 'scheduled', start_at: '2026-06-28T14:00:00Z' };
  const semanaPassada = { id: 'h0', title: 'Aula de violão', status: 'scheduled', start_at: '2026-06-21T14:00:00Z' };
  // resolved precisa ser passado; uso NOW = 28T18:00 (hoje 14:00 já passou)
  assert.deepStrictEqual(pickHomonymSiblingsToComplete(hoje, [hoje, semanaPassada], NOW), []);
});

// ── escopos de segurança ──
test('título diferente → não pega', () => {
  const outro = { id: 'x1', title: 'Outra coisa', status: 'scheduled', start_at: '2026-06-27T12:00:00Z' };
  assert.deepStrictEqual(pickHomonymSiblingsToComplete(ev27, [ev27, outro], NOW), []);
});
test('irmão já done/cancelled → não pega', () => {
  const done = { id: 'd1', title: 'Entre Teclas', status: 'done', start_at: '2026-06-26T22:00:00Z' };
  const canc = { id: 'c1', title: 'Entre Teclas', status: 'cancelled', start_at: '2026-06-26T22:00:00Z' };
  assert.deepStrictEqual(pickHomonymSiblingsToComplete(ev27, [ev27, done, canc], NOW), []);
});
test('irmão FUTURO → não pega (fan-out só de passado)', () => {
  const futuro = { id: 'f1', title: 'Entre Teclas', status: 'scheduled', start_at: '2026-06-29T13:00:00Z' };
  assert.deepStrictEqual(pickHomonymSiblingsToComplete(ev27, [ev27, futuro], NOW), []);
});
test('resolvido FUTURO → nenhum fan-out', () => {
  const futuro = { id: 'f2', title: 'Entre Teclas', status: 'scheduled', start_at: '2026-06-30T13:00:00Z' };
  assert.deepStrictEqual(pickHomonymSiblingsToComplete(futuro, [ev26, ev27, futuro], NOW), []);
});
test('título normalizado (espaços/caixa) casa', () => {
  const messy = { id: 'm1', title: '  ENTRE   teclas ', status: 'scheduled', start_at: '2026-06-26T22:00:00Z' };
  assert.deepStrictEqual(pickHomonymSiblingsToComplete(ev27, [ev27, messy], NOW), ['m1']);
});
test('cap MAX respeitado', () => {
  const sibs = Array.from({ length: 8 }, (_, i) => ({ id: 's' + i, title: 'Entre Teclas', status: 'scheduled', start_at: '2026-06-27T1' + i + ':00:00Z' }));
  const ids = pickHomonymSiblingsToComplete(ev27, [ev27, ...sibs], NOW, { max: 4 });
  assert.strictEqual(ids.length, 4);
});
test('entradas inválidas não quebram', () => {
  assert.deepStrictEqual(pickHomonymSiblingsToComplete(null, [], NOW), []);
  assert.deepStrictEqual(pickHomonymSiblingsToComplete(ev27, null, NOW), []);
  assert.deepStrictEqual(pickHomonymSiblingsToComplete({ id: 'z', title: 'X' }, [], NOW), []); // sem start_at
});
