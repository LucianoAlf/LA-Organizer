'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { fmtEstoqueBaixo, fmtItensManutencao, fmtRevisoes } = require('./inventario-alertas-format');

const NOW = Date.parse('2026-08-24T12:00:00Z');

test('fmtEstoqueBaixo: lista vazia → null (silêncio)', () => {
  assert.equal(fmtEstoqueBaixo([]), null);
  assert.equal(fmtEstoqueBaixo(null), null);
});

test('fmtEstoqueBaixo mostra estoque REAL/mínimo', () => {
  const msg = fmtEstoqueBaixo([{ nome: 'Caderno', estoque_atual: 13, estoque_minimo: 25 }]);
  assert.match(msg, /Estoque baixo.*1 produto/s);
  assert.match(msg, /Caderno: 13\/25/);
});

test('fmtItensManutencao: 0 → null; com item mostra dias parado', () => {
  assert.equal(fmtItensManutencao([], NOW), null);
  const msg = fmtItensManutencao([{ id: 1, nome: 'Piano', em_manutencao_desde: '2026-08-04' }], NOW);
  assert.match(msg, /Piano — parado há 20d/);
});

test('fmtItensManutencao sem data → "em manutenção" sem dias', () => {
  const msg = fmtItensManutencao([{ id: 9, nome: 'Amp', em_manutencao_desde: null }], NOW);
  assert.match(msg, /Amp — em manutenção/);
});

test('fmtRevisoes: 0 → null; com item mostra data pt-BR', () => {
  assert.equal(fmtRevisoes([]), null);
  const msg = fmtRevisoes([{ nome: 'Mesa de som', proxima_revisao: '2026-08-28' }]);
  assert.match(msg, /Mesa de som — 28\/08\/2026/);
});
