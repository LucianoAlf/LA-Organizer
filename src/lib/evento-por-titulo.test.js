'use strict';
// EVENT-UPDATE-POR-TITULO (triagem 11/09 — caf078f2).
const { test } = require('node:test');
const assert = require('node:assert');
const { escolherEventoPorTitulo } = require('./evento-por-titulo');

const AGORA = Date.parse('2026-07-22T11:34:00Z');
const EV = (id, title, start, extra = {}) => ({ id, title, start_at: start, status: 'scheduled', recurrence_rule: null, recurrence_parent_id: null, ...extra });

test('Peterson 22/07: complete pelo título acha o único evento com esse nome', () => {
  const evs = [EV('b1', 'Reunião online de briefing do evento — professores', '2026-07-21T22:00:00Z'), EV('x', 'LA Drum Games', '2026-07-20T12:00:00Z')];
  assert.strictEqual(escolherEventoPorTitulo('Reunião online de briefing do evento — professores', evs, AGORA, 'complete').evento.id, 'b1');
  assert.strictEqual(escolherEventoPorTitulo('reuniao online de briefing', evs, AGORA, 'complete').evento.id, 'b1', 'sem acento e parcial');
});
test('mesmo título repetido (série): complete pega o último que já começou; cancel/reschedule o próximo', () => {
  const evs = [EV('p', 'Reunião ADM', '2026-07-21T13:00:00Z', { recurrence_parent_id: 'T' }), EV('f', 'Reunião ADM', '2026-07-28T13:00:00Z', { recurrence_parent_id: 'T' }), EV('T', 'Reunião ADM', '2026-07-07T13:00:00Z', { recurrence_rule: 'FREQ=WEEKLY' })];
  assert.strictEqual(escolherEventoPorTitulo('Reunião ADM', evs, AGORA, 'complete').evento.id, 'p');
  assert.strictEqual(escolherEventoPorTitulo('Reunião ADM', evs, AGORA, 'cancel').evento.id, 'f');
});
test('títulos diferentes que batem → ambíguo (pergunta), nada casa → null, fechado/cancelado não conta', () => {
  const evs = [EV('a', 'Reunião com pais — Barra', '2026-07-21T13:00:00Z'), EV('b', 'Reunião com pais — Recreio', '2026-07-21T15:00:00Z'), EV('c', 'Ensaio', '2026-07-21T15:00:00Z', { status: 'done' })];
  const r = escolherEventoPorTitulo('Reunião com pais', evs, AGORA, 'complete');
  assert.strictEqual(r.evento, null);
  assert.deepStrictEqual(r.ambiguo.map((e) => e.id), ['a', 'b']);
  assert.strictEqual(escolherEventoPorTitulo('Ensaio', evs, AGORA, 'complete').evento, null);
  assert.strictEqual(escolherEventoPorTitulo('xy', evs, AGORA, 'complete').evento, null, 'curto demais');
});

// Ligação no engine (catraca de fonte): o helper puro só protege se o engine usar.
const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: EVENT_UPDATE sem id e com title passa na validação e resolve pelo título', () => {
  assert.match(ENG, /const _porTitulo = \(a\.id === undefined \|\| a\.id === null \|\| a\.id === ''\) && \['complete', 'cancel', 'reschedule'\]\.includes\(a\.action\)/);
  assert.match(ENG, /const _rt = await resolveEventByTitle\(collaborator\.id, a\.title, a\.action\);/);
});
test('engine: delegação recusada diz o motivo (DELEGATE-RECUSA-MUDA, 824d11c7)', () => {
  assert.match(ENG, /delegate REJECTED id=\$\{a\.id\} \(not owned by \$\{last4\} or not found\)\x60\);\s*\/\/ DELEGATE-RECUSA-MUDA[\s\S]{0,400}failMessages\.push\(/);
  assert.match(ENG, /delegate REJECTED — recipient not found: \$\{a\.to_phone \|\| a\.to_name\}\x60\);\s*failMessages\.push\(/);
});
test('engine: NOTE_ACTION update chama updateNote e explica a trava de encolhimento', () => {
  assert.match(ENG, /a\.action === 'update'\s*\? await notesService\.updateNote\(supabase, collab\.id, a\.note, \{ title: a\.title, body: a\.body \}\)/);
  assert.match(ENG, /res\.error === 'update_encolheu'/);
});
