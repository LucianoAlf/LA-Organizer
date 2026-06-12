'use strict';
// Testes da visibilidade de tarefas-de-grupo no TOM — GROUP-RECUR-TEMPLATE-VISIBLE-TO-TOM.
// Roda com: node --test src/utils/group-task-visibility.test.js
//
// Caso Rose 12/06: "Conciliação de Cartões" mensal cria, POR DESIGN (taskGroups.ts createGroup),
// uma mãe-TEMPLATE recorrente + a mãe-INSTÂNCIA do ciclo corrente (mesma due), e idem p/ cada
// subcartão. O PWA esconde a mãe-template (fetchGroupsForDay: .is('recurrence_rule', null)), então
// a Rose vê 1; o TOM NÃO escondia → via 2 ("atrasadas duplicadas"). Este módulo dá ao TOM a MESMA
// visão do app: esconder mãe-template recorrente + filhas-template; manter instância + suas filhas.

const test = require('node:test');
const assert = require('node:assert');
const { filterVisibleGroupTasks, isRecurringTemplate } = require('./group-task-visibility');

test('isRecurringTemplate: só is_group + recurrence_rule', () => {
  assert.strictEqual(isRecurringTemplate({ is_group: true, recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=1' }), true);
  assert.strictEqual(isRecurringTemplate({ is_group: true, recurrence_rule: null }), false); // mãe-instância
  assert.strictEqual(isRecurringTemplate({ is_group: false, recurrence_rule: 'FREQ=DAILY' }), false); // task simples recorrente não é grupo
  assert.strictEqual(isRecurringTemplate({ is_group: false, recurrence_rule: null }), false);
  assert.strictEqual(isRecurringTemplate(null), false);
});

// Reproduz a estrutura real do caso Rose (mães + 1 subcartão), template+instância.
const ROSE = [
  // mãe-template (escondida no app)
  { id: 'tpl', title: 'Conciliação de Cartões', is_group: true, recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=1', recurrence_parent_id: null, parent_task_id: null, due_date: '2026-06-01' },
  // mãe-instância (visível no app)
  { id: 'inst', title: 'Conciliação de Cartões', is_group: true, recurrence_rule: null, recurrence_parent_id: 'tpl', parent_task_id: null, due_date: '2026-06-01' },
  // filha-template (pendura na mãe-template → escondida)
  { id: 'kid_tpl', title: 'Cartão 1074 (Kids CG)', is_group: false, recurrence_rule: null, recurrence_parent_id: null, parent_task_id: 'tpl', due_date: '2026-06-25' },
  // filha-instância (pendura na mãe-instância → visível)
  { id: 'kid_inst', title: 'Cartão 1074 (Kids CG)', is_group: false, recurrence_rule: null, recurrence_parent_id: 'kid_tpl', parent_task_id: 'inst', due_date: '2026-06-25' },
];

test('caso Rose: esconde mãe-template + filha-template, mantém instância + filha-instância', () => {
  const vis = filterVisibleGroupTasks(ROSE).map((t) => t.id);
  assert.deepStrictEqual(vis.sort(), ['inst', 'kid_inst']);
  // sem duplicata de título na visão do TOM
  const titles = filterVisibleGroupTasks(ROSE).map((t) => t.title);
  assert.strictEqual(new Set(titles).size, titles.length);
});

test('grupo SEM recorrência (mãe is_group + filhas, sem template) passa inteiro', () => {
  const simples = [
    { id: 'm', is_group: true, recurrence_rule: null, parent_task_id: null },
    { id: 'a', is_group: false, recurrence_rule: null, parent_task_id: 'm' },
    { id: 'b', is_group: false, recurrence_rule: null, parent_task_id: 'm' },
  ];
  assert.deepStrictEqual(filterVisibleGroupTasks(simples).map((t) => t.id), ['m', 'a', 'b']);
});

test('tarefas avulsas (não-grupo) passam', () => {
  const avulsas = [
    { id: 'x', is_group: false, recurrence_rule: null, parent_task_id: null },
    { id: 'y', is_group: false, recurrence_rule: null, parent_task_id: null },
  ];
  assert.deepStrictEqual(filterVisibleGroupTasks(avulsas).map((t) => t.id), ['x', 'y']);
});

test('entrada vazia / não-array → []', () => {
  assert.deepStrictEqual(filterVisibleGroupTasks([]), []);
  assert.deepStrictEqual(filterVisibleGroupTasks(null), []);
  assert.deepStrictEqual(filterVisibleGroupTasks(undefined), []);
});

test('não muta o array de entrada', () => {
  const input = ROSE.slice();
  const len = input.length;
  filterVisibleGroupTasks(input);
  assert.strictEqual(input.length, len);
});
