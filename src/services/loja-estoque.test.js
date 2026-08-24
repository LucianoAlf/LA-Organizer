'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { agregarEstoque, enriquecerProdutos } = require('./loja-estoque');

// INVENTORY-ESTOQUE-BAIXO-FALSE-ALARM (audit 24/08)

test('agregarEstoque soma o mesmo produto em várias unidades', () => {
  const m = agregarEstoque([
    { produto_id: 1, quantidade: 3 },
    { produto_id: 1, quantidade: 10 },   // outra unidade
    { produto_id: 2, quantidade: 5 },
  ]);
  assert.equal(m.get(1), 13);
  assert.equal(m.get(2), 5);
});

test('agregarEstoque ignora linhas lixo (produto_id/quantidade inválidos)', () => {
  const m = agregarEstoque([
    { produto_id: null, quantidade: 9 },
    { produto_id: 3, quantidade: 'abc' },
    null,
    { produto_id: 3, quantidade: 4 },
  ]);
  assert.equal(m.get(3), 4);
  assert.equal(m.has(null), false);
});

test('enriquecerProdutos reflete estoque REAL (não zera tudo)', () => {
  const produtos = [
    { id: 1, nome: 'Caderno Teclado', estoque_minimo: 25 },
    { id: 2, nome: 'Camiseta P', estoque_minimo: 3 },
    { id: 3, nome: 'Boa venda', estoque_minimo: 5 },
  ];
  const estoque = [
    { produto_id: 1, quantidade: 8 }, { produto_id: 1, quantidade: 5 }, // total 13
    { produto_id: 3, quantidade: 10 },                                   // acima do min
  ];
  const r = enriquecerProdutos(produtos, estoque);
  // produto 1: 13 < 25 → abaixo, não zerado
  assert.deepEqual({ q: r[0].estoque_atual, ab: r[0].abaixo_minimo, z: r[0].zerado }, { q: 13, ab: true, z: false });
  // produto 2: sem linha de estoque → 0, zerado, abaixo
  assert.deepEqual({ q: r[1].estoque_atual, ab: r[1].abaixo_minimo, z: r[1].zerado }, { q: 0, ab: true, z: true });
  // produto 3: 10 >= 5 → ok
  assert.deepEqual({ q: r[2].estoque_atual, ab: r[2].abaixo_minimo, z: r[2].zerado }, { q: 10, ab: false, z: false });
});

test('estoque_minimo=0 → nunca abaixo_minimo (mesmo zerado)', () => {
  const r = enriquecerProdutos([{ id: 9, nome: 'X', estoque_minimo: 0 }], []);
  assert.equal(r[0].abaixo_minimo, false);
  assert.equal(r[0].zerado, true);
});

test('lista vazia / nula não quebra', () => {
  assert.deepEqual(enriquecerProdutos(null, null), []);
  assert.deepEqual(enriquecerProdutos([], [{ produto_id: 1, quantidade: 2 }]), []);
});
