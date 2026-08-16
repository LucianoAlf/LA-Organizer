// src/lib/reminder-refs-query.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildReminderRefsQuery, mapRefRows } = require('./reminder-refs-query');

function fakeSb(sink) {
  const b = {
    from(t) { sink.from = t; return b; },
    select(c) { sink.select = c; return b; },
    eq(col, val) { (sink.eq ||= []).push([col, val]); return b; },
    gte(col, val) { sink.gte = [col, val]; return b; },
    order() { return b; },
    limit() { return b; },
  };
  return b;
}

test('a query filtra ref_type=task, outbound, e a janela', () => {
  const sink = {};
  buildReminderRefsQuery(fakeSb(sink), 'collab-1', '2026-08-15T18:00:00Z');
  assert.strictEqual(sink.from, 'conversation_history');
  assert.deepStrictEqual(sink.eq.find(([c]) => c === 'ref_type'), ['ref_type', 'task']);
  assert.deepStrictEqual(sink.eq.find(([c]) => c === 'direction'), ['direction', 'outbound']);
  assert.deepStrictEqual(sink.eq.find(([c]) => c === 'collaborator_id'), ['collaborator_id', 'collab-1']);
  assert.deepStrictEqual(sink.gte, ['created_at', '2026-08-15T18:00:00Z']);
});

test('mapRefRows converte ref_id/created_at e ignora linha sem ref_id', () => {
  const out = mapRefRows([
    { ref_id: 't1', created_at: '2026-08-16T15:00:00Z', content: '⏰ *Remédios* ...' },
    { ref_id: null, created_at: '2026-08-16T16:00:00Z', content: 'nota qualquer' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], { task_id: 't1', title: null, reminded_at: '2026-08-16T15:00:00Z' });
});
