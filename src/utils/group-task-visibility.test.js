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
const { filterVisibleGroupTasks, isRecurringTemplate, dropPackageContainers } = require('./group-task-visibility');

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

// ---------------------------------------------------------------------------
// GROUPPKG-CONTAINER-COMPLETABLE-1TO1 (caso Rose 03/08/2026)
//
// O container do pacote (is_group=true, recurrence_rule=null) é uma PASTA, não
// tarefa. Os readers do chat de GRUPO (group-chat-engine.js) e do digest
// (group-report-builder.js shapeOpenTasks) já o excluem desde 20/06
// (GROUPPKG-CONTAINER-PHANTOM-FLATLIST). O reader do chat 1:1
// (prompts/system.js → myGroupTasks) ficou de fora da varredura.
//
// Consequência real: o container "Conciliação de Cartões" (due 01/08, herdada do
// BYMONTHDAY=1) entrou no bloco "Tarefas abertas dos SEUS grupos (você também
// pode concluir)" com id. O TOM listou como atrasada, a Rose confirmou "foram
// feitas sim" e o engine fechou a PASTA — as 6 filhas (due 12–27/08, trabalho
// que nem tinha vencido) ficaram pending. Fantasma dia-1, igual ao de 20/06.
// ---------------------------------------------------------------------------
const PACOTE_AGOSTO = [
  // container do ciclo de agosto — due dia 1 (BYMONTHDAY=1), sem recurrence_rule
  { id: '2fbbe3b6', title: 'Conciliação de Cartões', is_group: true, recurrence_rule: null, parent_task_id: null, due_date: '2026-08-01' },
  // as 6 filhas reais, que vencem DEPOIS do container
  { id: 'k8516', title: 'Cartão 8516 (Barra)', is_group: false, recurrence_rule: null, parent_task_id: '2fbbe3b6', due_date: '2026-08-12' },
  { id: 'k2270', title: 'Cartão 2270 (EMLA)', is_group: false, recurrence_rule: null, parent_task_id: '2fbbe3b6', due_date: '2026-08-12' },
  { id: 'k8641', title: 'Cartão 8641 (Recreio)', is_group: false, recurrence_rule: null, parent_task_id: '2fbbe3b6', due_date: '2026-08-17' },
  { id: 'k8434', title: 'Cartão 8434 (Kids CG)', is_group: false, recurrence_rule: null, parent_task_id: '2fbbe3b6', due_date: '2026-08-25' },
  { id: 'k1074', title: 'Cartão 1074 (Kids CG)', is_group: false, recurrence_rule: null, parent_task_id: '2fbbe3b6', due_date: '2026-08-25' },
  { id: 'kmp', title: 'Cartão Mercado Pago (Barra)', is_group: false, recurrence_rule: null, parent_task_id: '2fbbe3b6', due_date: '2026-08-27' },
  // tarefa avulsa do mesmo grupo — tem de continuar visível
  { id: 'avulsa', title: 'Dar baixa no prolabore', is_group: false, recurrence_rule: null, parent_task_id: null, due_date: '2026-08-01' },
];

test('caso Rose 03/08: container do pacote NÃO é tarefa — sai do pool do TOM', () => {
  const ids = dropPackageContainers(PACOTE_AGOSTO).map((t) => t.id);
  assert.ok(!ids.includes('2fbbe3b6'), 'container is_group não pode chegar ao TOM como tarefa concluível');
  // as 6 filhas e a avulsa continuam — o trabalho real não some
  assert.deepStrictEqual(ids, ['k8516', 'k2270', 'k8641', 'k8434', 'k1074', 'kmp', 'avulsa']);
});

test('composição com filterVisibleGroupTasks: some template E container, ficam as filhas', () => {
  const ids = dropPackageContainers(filterVisibleGroupTasks(ROSE)).map((t) => t.id);
  assert.deepStrictEqual(ids, ['kid_inst']);
});

test('dropPackageContainers: avulsas e filhas passam; entrada inválida → []', () => {
  const avulsas = [{ id: 'x', is_group: false }, { id: 'y' }];
  assert.deepStrictEqual(dropPackageContainers(avulsas).map((t) => t.id), ['x', 'y']);
  assert.deepStrictEqual(dropPackageContainers([]), []);
  assert.deepStrictEqual(dropPackageContainers(null), []);
  assert.deepStrictEqual(dropPackageContainers(undefined), []);
});

test('dropPackageContainers não muta a entrada', () => {
  const input = PACOTE_AGOSTO.slice();
  const len = input.length;
  dropPackageContainers(input);
  assert.strictEqual(input.length, len);
});
