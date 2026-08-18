'use strict';
// EVENT-APP-RESCHEDULE-NO-RENOTIFY (audit 18/08, John): reagendar evento NO APP não avisava os
// participantes (só o caminho TOM/engine fazia o fan-out). Aqui a lógica PURA de montar os avisos,
// extraída do engine (engine.js:3522-3549) pra ser fonte única entre o handler EVENT_UPDATE e o
// novo endpoint /internal/event-rescheduled. Regras: avisa invited/confirmed/tentative, EXCLUI quem
// remarcou (actorId) e quem está inativo/sem telefone; só informa (não mexe em RSVP).

const test = require('node:test');
const assert = require('node:assert');
const { buildRescheduleNotices } = require('./event-reschedule-notify');

const base = {
  eventId: 'ev1',
  title: 'Reunião MKT - NBG!',
  senderName: 'Yuri',
  whenStr: '19/08/2026 13:00',
  actorId: 'yuri',
};

test('avisa participantes elegíveis e monta a mensagem/meta', () => {
  const rows = buildRescheduleNotices({
    ...base,
    participants: [{ collaborator_id: 'john', status: 'invited' }],
    collaborators: [{ id: 'john', phone: '5521999', is_active: true }],
  });
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0].body, /remarcada por \*Yuri\*/);
  assert.match(rows[0].body, /19\/08\/2026 13:00/);
  assert.strictEqual(rows[0].phone, '5521999');
  assert.strictEqual(rows[0].meta.kind, 'event_reschedule');
  assert.strictEqual(rows[0].meta.event_id, 'ev1');
  assert.strictEqual(rows[0].meta.collaborator_id, 'john');
});

test('EXCLUI quem remarcou (actorId)', () => {
  const rows = buildRescheduleNotices({
    ...base,
    participants: [
      { collaborator_id: 'yuri', status: 'confirmed' },
      { collaborator_id: 'john', status: 'confirmed' },
    ],
    collaborators: [
      { id: 'yuri', phone: '5521000', is_active: true },
      { id: 'john', phone: '5521999', is_active: true },
    ],
  });
  assert.deepStrictEqual(rows.map((r) => r.meta.collaborator_id), ['john']);
});

test('inclui invited/confirmed/tentative, EXCLUI declined', () => {
  const rows = buildRescheduleNotices({
    ...base,
    participants: [
      { collaborator_id: 'a', status: 'invited' },
      { collaborator_id: 'b', status: 'confirmed' },
      { collaborator_id: 'c', status: 'tentative' },
      { collaborator_id: 'd', status: 'declined' },
    ],
    collaborators: [
      { id: 'a', phone: '1', is_active: true }, { id: 'b', phone: '2', is_active: true },
      { id: 'c', phone: '3', is_active: true }, { id: 'd', phone: '4', is_active: true },
    ],
  });
  assert.deepStrictEqual(rows.map((r) => r.meta.collaborator_id).sort(), ['a', 'b', 'c']);
});

test('EXCLUI inativo e sem telefone', () => {
  const rows = buildRescheduleNotices({
    ...base,
    participants: [
      { collaborator_id: 'a', status: 'invited' },
      { collaborator_id: 'b', status: 'invited' },
      { collaborator_id: 'c', status: 'invited' },
    ],
    collaborators: [
      { id: 'a', phone: '1', is_active: false },
      { id: 'b', phone: null, is_active: true },
      { id: 'c', phone: '3', is_active: true },
    ],
  });
  assert.deepStrictEqual(rows.map((r) => r.meta.collaborator_id), ['c']);
});

test('sem participantes elegíveis → vazio', () => {
  assert.deepStrictEqual(buildRescheduleNotices({ ...base, participants: [], collaborators: [] }), []);
  assert.deepStrictEqual(buildRescheduleNotices({
    ...base,
    participants: [{ collaborator_id: 'yuri', status: 'confirmed' }],
    collaborators: [{ id: 'yuri', phone: '1', is_active: true }],
  }), []); // só o ator
});

test('entradas inválidas não lançam', () => {
  assert.doesNotThrow(() => buildRescheduleNotices({ ...base, participants: null, collaborators: null }));
});
