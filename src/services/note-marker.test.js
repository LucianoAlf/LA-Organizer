// node --test — parser puro do <<NOTE_ACTION>> (spec 2026-06-10-anotacoes)
const { test } = require('node:test');
const assert = require('node:assert');
const { parseNoteActionMarker } = require('./note-marker');

test('create válido extrai action e cleanText', () => {
  const r = parseNoteActionMarker('Anotado!\n<<NOTE_ACTION>>{"action":"create","title":"Reunião","body":"• item 1"}<<END>>');
  assert.equal(r.malformed, false);
  assert.equal(r.action.action, 'create');
  assert.equal(r.action.title, 'Reunião');
  assert.equal(r.cleanText, 'Anotado!');
});

test('share_with deve ser array de strings', () => {
  const r = parseNoteActionMarker('<<NOTE_ACTION>>{"action":"create","title":"x","body":"y","share_with":"Ana"}<<END>>');
  assert.equal(r.malformed, true);
});

test('append exige note e body', () => {
  assert.equal(parseNoteActionMarker('<<NOTE_ACTION>>{"action":"append","body":"z"}<<END>>').malformed, true);
  assert.equal(parseNoteActionMarker('<<NOTE_ACTION>>{"action":"append","note":"latest","body":"z"}<<END>>').malformed, false);
});

test('share exige note e share_with não-vazio', () => {
  assert.equal(parseNoteActionMarker('<<NOTE_ACTION>>{"action":"share","note":"latest","share_with":[]}<<END>>').malformed, true);
  assert.equal(parseNoteActionMarker('<<NOTE_ACTION>>{"action":"share","note":"latest","share_with":["Ana"]}<<END>>').malformed, false);
});

test('action desconhecida = malformed; sem marker = null; JSON quebrado = malformed', () => {
  assert.equal(parseNoteActionMarker('<<NOTE_ACTION>>{"action":"delete"}<<END>>').malformed, true);
  assert.equal(parseNoteActionMarker('oi sem marker'), null);
  assert.equal(parseNoteActionMarker('<<NOTE_ACTION>>{quebrado<<END>>').malformed, true);
});

test('create sem title usa primeira linha do body (cap 120)', () => {
  const r = parseNoteActionMarker('<<NOTE_ACTION>>{"action":"create","body":"Plano do caixa\\nlinha 2"}<<END>>');
  assert.equal(r.malformed, false);
  assert.equal(r.action.title, 'Plano do caixa');
});

test('create sem body = malformed', () => {
  assert.equal(parseNoteActionMarker('<<NOTE_ACTION>>{"action":"create","title":"x"}<<END>>').malformed, true);
});
