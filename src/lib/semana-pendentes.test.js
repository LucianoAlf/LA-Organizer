'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { pendentesDaSemana, linhaSemana } = require('./semana-pendentes');

// Quintela 19/06 (1c3472e4): 11 de 12 concluídas — e o TOM não sabia QUAL faltava.
const feita = (i) => ({ title: `Tarefa ${i}`, status: 'done' });
const SEMANA = [...Array.from({ length: 11 }, (_, i) => feita(i)), { title: 'Fechar escala do sábado', status: 'pending' }];

test('Quintela: a linha da semana diz o número E o que falta', () => {
  const s = { total: 12, done: 11, pending: 1, pct: 92, pendentes: pendentesDaSemana(SEMANA) };
  assert.strictEqual(linhaSemana(s), 'Tarefas: 11/12 concluídas (92%) · 1 pendente — falta: *Fechar escala do sábado*');
});

test('"duplicado" de verdade: a mesma tarefa em duas ocorrências aparece agrupada', () => {
  const p = pendentesDaSemana([{ title: 'Ligar pro fornecedor', status: 'pending' }, { title: 'Ligar pro fornecedor', status: 'pending' }, { title: 'X', status: 'cancelled' }]);
  assert.deepStrictEqual(p, [{ titulo: 'Ligar pro fornecedor', n: 2 }]);
  assert.match(linhaSemana({ total: 4, done: 2, pending: 2, pct: 50, pendentes: p }), /falta: \*Ligar pro fornecedor\* \(2x\)$/);
});

test('mais de 3 nomes: mostra 3 e o resto em +N; sem pendente, sem "falta"', () => {
  const muitos = ['A', 'B', 'C', 'D', 'E'].map((t) => ({ title: t, status: 'pending' }));
  assert.match(linhaSemana({ total: 5, done: 0, pending: 5, pct: 0, pendentes: pendentesDaSemana(muitos) }), /falta: \*A\*, \*B\*, \*C\* \+2$/);
  assert.strictEqual(linhaSemana({ total: 3, done: 3, pending: 0, pct: 100, pendentes: [] }), 'Tarefas: 3/3 concluídas (100%) · 0 pendentes');
});

const SYS = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'prompts', 'system.js'), 'utf8');
test('system: fetchPeriodStats traz o título e a semana usa a linha com a lista', () => {
  const corpo = SYS.slice(SYS.indexOf('async function fetchPeriodStats'), SYS.indexOf('async function fetchMonthlyStats'));
  assert.match(corpo, /\.select\('id, status, title'\)/);
  assert.match(corpo, /pendentes: pendentesDaSemana\(tasks\)/);
  assert.match(SYS, /if \(s\.total > 0\) lines\.push\(`  \$\{linhaSemana\(s\)\}`\);/);
});
