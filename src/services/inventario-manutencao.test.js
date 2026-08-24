'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ultimoLogPorItem, selecionarItensParados } = require('./inventario-manutencao');

const DIA = 86400000;
const NOW = Date.parse('2026-08-24T12:00:00Z');
const ymd = (offsetDias) => new Date(NOW - offsetDias * DIA).toISOString().slice(0, 10);

test('ultimoLogPorItem fica com o log mais recente (assume desc)', () => {
  const m = ultimoLogPorItem([
    { item_id: 5, data_manutencao: '2026-08-01' },
    { item_id: 5, data_manutencao: '2026-07-01' },
    { item_id: 9, data_manutencao: '2026-06-01' },
  ]);
  assert.equal(m.get(5).data_manutencao, '2026-08-01');
  assert.equal(m.get(9).data_manutencao, '2026-06-01');
});

test('item parado há 30d → incluído; item mexido há 5d → excluído', () => {
  const itens = [{ id: 1, nome: 'Piano' }, { id: 2, nome: 'Teclado' }];
  const logs = [
    { item_id: 1, data_manutencao: ymd(30) },
    { item_id: 2, data_manutencao: ymd(5) },
  ];
  const r = selecionarItensParados(itens, logs, { nowMs: NOW, diasMin: 14 });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 1);
  assert.equal(r[0].em_manutencao_desde, ymd(30));
});

test('item sem log usa updated_at; 40d → incluído', () => {
  const r = selecionarItensParados(
    [{ id: 7, nome: 'Amp', updated_at: `${ymd(40)}T09:00:00Z` }],
    [], { nowMs: NOW, diasMin: 14 });
  assert.equal(r.length, 1);
  assert.equal(r[0].em_manutencao_desde, ymd(40));
});

test('item sem data confiável nenhuma → incluído (preso suspeito)', () => {
  const r = selecionarItensParados([{ id: 8, nome: 'Sem data' }], [], { nowMs: NOW, diasMin: 14 });
  assert.equal(r.length, 1);
  assert.equal(r[0].em_manutencao_desde, null);
});

test('nenhum item em manutenção → lista vazia (SEM falso-alarme, caso real 24/08)', () => {
  assert.deepEqual(selecionarItensParados([], [{ item_id: 1, data_manutencao: ymd(90) }], { nowMs: NOW }), []);
});
