'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isBulkAdd, parseBulkAdd } = require('./inventario-bulk');

// INVENTORY-BULK-ADD (Leo 18/06, finding 29b8751b) — 90 itens numa ação só.

test('bulk_add com params.items → detecta e normaliza, herda sala/unidade', () => {
  const payload = { action: 'bulk_add', params: {
    sala_nome: 'Kids Club', unidade_nome: 'Barra',
    items: [
      { nome: 'Pandeiros pequenos', quantidade: 2, condicao: 'bom' },
      { nome: 'Cuíca', quantidade: 1, condicao: 'ruim' },
    ],
  } };
  assert.equal(isBulkAdd(payload), true);
  const r = parseBulkAdd(payload);
  assert.equal(r.items.length, 2);
  assert.equal(r.dropped, 0);
  assert.equal(r.salaShared, 'Kids Club');
  assert.equal(r.unidadeShared, 'Barra');
  assert.deepEqual(r.items[0], { nome: 'Pandeiros pequenos', quantidade: 2, condicao: 'bom' });
  assert.equal(r.items[1].condicao, 'ruim');
});

test('aliases de campo por item (item_name/quantity/condition) → normalizados', () => {
  const r = parseBulkAdd({ action: 'bulk_add', params: { items: [
    { item_name: 'TV Smart TCL', quantity: 1, condition: 'novo' },
  ] } });
  assert.deepEqual(r.items[0], { nome: 'TV Smart TCL', quantidade: 1, condicao: 'novo' });
});

test('itens como STRINGS soltas → viram {nome, qtd 1, cond bom}', () => {
  const r = parseBulkAdd({ action: 'bulk_add', params: { itens: ['Puff', '  Tamborim  ', ''] } });
  assert.equal(r.items.length, 2);           // a string vazia é dropada
  assert.equal(r.dropped, 1);
  assert.deepEqual(r.items[0], { nome: 'Puff', quantidade: 1, condicao: 'bom' });
  assert.equal(r.items[1].nome, 'Tamborim');
});

test('item sem nome → dropado e contado', () => {
  const r = parseBulkAdd({ action: 'bulk_add', params: { items: [
    { nome: 'Baqueta', quantidade: 3 },
    { quantidade: 5 },                        // sem nome
    { nome: '   ' },                          // só espaço
  ] } });
  assert.equal(r.items.length, 1);
  assert.equal(r.dropped, 2);
});

test('add_item com items[] (sem action bulk) → detectado como lote', () => {
  const payload = { action: 'add_item', params: { sala_nome: 'Sala 13', items: [{ nome: 'Teclado' }] } };
  assert.equal(isBulkAdd(payload), true);
  const r = parseBulkAdd(payload);
  assert.equal(r.items.length, 1);
  assert.equal(r.salaShared, 'Sala 13');
});

test('add_item SINGLE (sem items) → NÃO é lote', () => {
  const payload = { action: 'add_item', params: { nome: 'Piano', sala_nome: 'Sala 8' } };
  assert.equal(isBulkAdd(payload), false);
  assert.equal(parseBulkAdd(payload), null);
});

test('quantidade string e condicao inválida → parseInt + default bom', () => {
  const r = parseBulkAdd({ action: 'bulk_add', params: { items: [
    { nome: 'Meia-lua', quantidade: '4', condicao: 'meia-boca' },
    { nome: 'Guizo', quantidade: 'abc' },
  ] } });
  assert.equal(r.items[0].quantidade, 4);
  assert.equal(r.items[0].condicao, 'bom');
  assert.equal(r.items[1].quantidade, 1);
});

test('payload flat (items no topo, sem params) → detecta', () => {
  const r = parseBulkAdd({ action: 'bulk_add', sala_nome: 'Kids Club', unidade_id: 7, items: [{ nome: 'Ar-condicionado' }] });
  assert.equal(r.items.length, 1);
  assert.equal(r.salaShared, 'Kids Club');
  assert.equal(r.unidadeIdShared, 7);
});

test('lixo/vazio → não quebra', () => {
  assert.equal(isBulkAdd(null), false);
  assert.equal(isBulkAdd({}), false);
  assert.equal(parseBulkAdd({ action: 'ver', params: { nome: 'piano' } }), null);
});
