'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderBlocoPeriodo, MAX_ITENS } = require('./context-period-block');

const HOJE = '2026-08-27';
const P = { de: '2026-08-27', ate: '2026-08-27', rotulo: 'quinta' };
const t = (id, title, extra = {}) => ({ id, title, status: 'pending', due_date: '2026-08-27', context: 'work', ...extra });

test('CASO RAFINHA: as 3 de quinta aparecem com o total certo', () => {
  const s = renderBlocoPeriodo(P, [t('aaaaaaaa1', 'Carlinho eletricista'), t('bbbbbbbb2', 'Charles led'), t('cccccccc3', 'Léo marcenaria')], HOJE);
  assert.match(s, /3 tarefa\(s\)/);
  for (const n of ['Carlinho eletricista', 'Charles led', 'Léo marcenaria']) assert.ok(s.includes(n), n);
  assert.match(s, /27\/08/);
});

test('VAZIO é uma resposta confiável — e escopada só naquele período', () => {
  const s = renderBlocoPeriodo(P, [], HOJE);
  assert.match(s, /Nenhuma tarefa/i);
  assert.match(s, /COMPLETA/);
  assert.match(s, /só nele|e só nele/i, 'não pode virar licença pra negar outras datas');
});

test('lista cheia manda NÃO negar (é o oposto do bug original)', () => {
  assert.match(renderBlocoPeriodo(P, [t('x', 'A')], HOJE), /não diga que não há nada/i);
});

test('intervalo mostra a data de cada item; dia único não repete', () => {
  const faixa = { de: '2026-08-31', ate: '2026-09-06', rotulo: 'semana que vem' };
  const s = renderBlocoPeriodo(faixa, [t('x', 'A', { due_date: '2026-09-01' })], HOJE);
  assert.match(s, /31\/08 a 06\/09/);
  assert.match(s, /📅 01\/09/);
  assert.ok(!renderBlocoPeriodo(P, [t('x', 'A')], HOJE).includes('📅'), 'dia único não precisa repetir a data');
});

test('marca atrasada e concluída', () => {
  const passado = { de: '2026-08-20', ate: '2026-08-20', rotulo: '20/08' };
  const s = renderBlocoPeriodo(passado, [
    t('a', 'Atrasada', { due_date: '2026-08-20' }),
    t('b', 'Feita', { due_date: '2026-08-20', status: 'done' }),
  ], HOJE);
  assert.match(s, /🔴 Atrasada/);
  assert.match(s, /✅ Feita/);
  assert.ok(!/🔴 ✅|✅ 🔴/.test(s), 'concluída não é atrasada');
});

test('corte, se houver, é DECLARADO e o total real continua visível', () => {
  const muitas = [...Array(MAX_ITENS + 7)].map((_, i) => t('id' + i, `T${i}`));
  const s = renderBlocoPeriodo(P, muitas, HOJE);
  assert.match(s, new RegExp(`${MAX_ITENS + 7} tarefa\\(s\\)`), 'o total real aparece');
  assert.match(s, /\+7 além das/);
});

test('descrição entra truncada, sem quebrar linha', () => {
  const s = renderBlocoPeriodo(P, [t('x', 'A', { description: 'linha1\n\nlinha2 ' + 'z'.repeat(400) })], HOJE);
  assert.match(s, /↳ linha1 linha2/);
  assert.ok(!s.split('↳ ')[1].split('\n')[0].includes('\n'));
  assert.match(s, /…/);
});

test('entrada inválida devolve string vazia (nunca polui o prompt)', () => {
  for (const p of [null, undefined, {}, { de: '2026-08-27' }]) assert.strictEqual(renderBlocoPeriodo(p, [t('x', 'A')], HOJE), '');
  assert.match(renderBlocoPeriodo(P, null, HOJE), /Nenhuma tarefa/i);
});
