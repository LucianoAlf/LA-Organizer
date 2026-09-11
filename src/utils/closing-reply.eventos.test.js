'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildClosingItems } = require('./closing-reply');

// 24/08 (9cc4df98): fechamento de um dia só com EVENTO — a lista saía vazia, sem âncora, e o
// "fecha" foi pro LLM escolher entre 30 gêmeos da série. Agora o evento que já rolou ganha número.
const HOJE = '2026-08-24';
const AGORA = new Date('2026-08-24T21:00:00-03:00');
const ev = (o) => ({ id: 'e1', title: 'Aula de canto', start_at: '2026-08-24T19:00:00-03:00', status: 'scheduled', ...o });

test('dia só com evento: o evento que já rolou vira o item 1, ancorado por id', () => {
  const itens = buildClosingItems([], { today: HOJE, now: AGORA, events: [ev()] });
  assert.deepStrictEqual(itens, [{ index: 1, type: 'event', id: 'e1', title: '🗓️ Aula de canto' }]);
});

test('eventos vêm depois das tarefas, em ordem de horário', () => {
  const tarefas = [{ id: 't1', title: 'Relatório', due_date: HOJE }];
  const evs = [ev({ id: 'e2', title: 'Reunião', start_at: '2026-08-24T15:00:00-03:00' }), ev()];
  const itens = buildClosingItems(tarefas, { today: HOJE, now: AGORA, events: evs });
  assert.deepStrictEqual(itens.map((i) => `${i.index}:${i.type}:${i.id}`), ['1:task:t1', '2:event:e2', '3:event:e1']);
});

test('fora: evento que ainda não começou, de outro dia (o gêmeo de amanhã), fechado ou cancelado', () => {
  const evs = [
    ev({ id: 'futuro', start_at: '2026-08-24T22:30:00-03:00' }),
    ev({ id: 'amanha', start_at: '2026-08-25T19:00:00-03:00' }),
    ev({ id: 'feito', status: 'done' }),
    ev({ id: 'cancelado', status: 'cancelled' }),
  ];
  assert.deepStrictEqual(buildClosingItems([], { today: HOJE, now: AGORA, events: evs }), []);
});

test('fora: evento de ONTEM que ficou aberto (o fechamento é do dia)', () => {
  const evs = [ev({ id: 'ontem', start_at: '2026-08-23T19:00:00-03:00' })];
  assert.deepStrictEqual(buildClosingItems([], { today: HOJE, now: AGORA, events: evs }), []);
});

test('sem events (briefing): nada muda', () => {
  const itens = buildClosingItems([{ id: 't1', title: 'X', due_date: HOJE }], { today: HOJE });
  assert.deepStrictEqual(itens.map((i) => i.type), ['task']);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: o fechamento passa os eventos do PRÓPRIO dono e o prompt numera os 🗓️', () => {
  assert.match(ENG, /filter\(\(e\) => e && e\.collaborator_id === collab\.id\);\n\s*_closingItems = buildClosingItems\(_closingPool, \{ today: _todayYmd, events: _eventosFech \}\);/);
  assert.match(ENG, /os marcados 🗓️ são eventos que já aconteceram hoje/);
  assert.doesNotMatch(ENG, /FORA desta numeração/);
});
