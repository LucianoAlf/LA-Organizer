'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { linhaSemana } = require('./semana-pendentes');

// E2E de 11/09: "2/19 concluídas" — 16 das 19 eram canceladas. Cancelada não é "a fazer".
test('canceladas saem do denominador e aparecem à parte', () => {
  const s = { total: 19, done: 2, pending: 1, cancelled: 16, pendentes: [{ titulo: 'Fechar escala', n: 1 }] };
  assert.strictEqual(linhaSemana(s), 'Tarefas: 2/3 concluídas (67%) · 1 pendente · 16 canceladas — falta: *Fechar escala*');
});

test('sem canceladas: igual ao de antes', () => {
  assert.strictEqual(linhaSemana({ total: 12, done: 11, pending: 1, cancelled: 0, pendentes: [{ titulo: 'X', n: 1 }] }),
    'Tarefas: 11/12 concluídas (92%) · 1 pendente — falta: *X*');
});
