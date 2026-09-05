'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { tasksForRitual } = require('./ritual-task-scope');

// Caso Jereh, 04/09/2026 19:02:31 BRT (finding 0562d931).
// Às 09:31 o briefing listou "🔴 RELATÓRIO TRIMESTRAL ( Q1, Q2, Q3 )" e às 13:00 o TOM
// cobrou a mesma tarefa. Às 19:02 o fechamento respondeu "📭 Sem nada marcado hoje."
// A tarefa é PESSOAL e as de trabalho dele estão delegadas a outros — o fechamento
// zerava `personal`, ficava com as duas listas vazias e reportava vazio honestamente.
const CTX_JEREH = {
  personalTasks: [
    { id: '8b1f746c', title: 'RELATÓRIO TRIMESTRAL ( Q1, Q2, Q3 )', due_date: '2026-09-03' },
  ],
  workTasks: [],
};

test('fechamento enxerga as tarefas pessoais do dia (caso Jereh 04/09)', () => {
  const escopo = tasksForRitual('fechamento', CTX_JEREH);
  assert.strictEqual(escopo.personal.length, 1);
  assert.strictEqual(escopo.personal[0].id, '8b1f746c');
});

test('daily_closing (alias canônico) tem o mesmo escopo do fechamento', () => {
  const escopo = tasksForRitual('daily_closing', CTX_JEREH);
  assert.strictEqual(escopo.personal.length, 1);
});

test('briefing_trabalho segue sem tarefas pessoais', () => {
  const escopo = tasksForRitual('briefing_trabalho', CTX_JEREH);
  assert.deepStrictEqual(escopo.personal, []);
});

test('briefing_pessoal segue sem tarefas de trabalho', () => {
  const escopo = tasksForRitual('briefing_pessoal', {
    personalTasks: CTX_JEREH.personalTasks,
    workTasks: [{ id: 'w1', title: 'Trabalho' }],
  });
  assert.strictEqual(escopo.personal.length, 1);
  assert.deepStrictEqual(escopo.work, []);
});

test('briefing unificado corta pelo cutoff; fechamento passa as listas cruas', () => {
  const ctx = {
    personalTasks: [{ id: 'p1', due_date: '2026-09-03' }, { id: 'p2', due_date: '2026-12-01' }],
    workTasks: [],
  };
  const soHoje = (t) => t.due_date <= '2026-09-05';

  const brief = tasksForRitual('briefing_diario', ctx, soHoje);
  assert.deepStrictEqual(brief.personal.map((t) => t.id), ['p1']);

  // O recorte por dia do fechamento é do engine (buildClosingItems/isVisibleForDay),
  // não do cutoff do briefing — por isso ele recebe a lista inteira.
  const fech = tasksForRitual('fechamento', ctx, soHoje);
  assert.deepStrictEqual(fech.personal.map((t) => t.id), ['p1', 'p2']);
});

test('ritual desconhecido não recorta', () => {
  assert.strictEqual(tasksForRitual('mensagem_avulsa', CTX_JEREH), null);
});
