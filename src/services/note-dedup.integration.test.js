'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { findDuplicateNote } = require('./note-dedup');

// Espelha a REGRA do handler (engine.js NOTE_ACTION create) sem subir o engine:
// bloqueia se há dup e não há bypass fresco; senão cria.
function decideNoteCreate({ dup, fresh, nowMs, bypassMs }) {
  if (dup && !(fresh && nowMs - fresh < bypassMs)) return 'blocked';
  return 'create';
}

const EXISTING = { id: 'n1', title: 'Lista de compras — mercado', body: '5kg de arroz\n2kg de feijão\nBiscoitos para Alice' };
function supaWith(notes) {
  return { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: notes }) }) }) }) }) }) };
}

test('nota duplicada presente → 1ª tentativa BLOQUEIA (não cria)', async () => {
  const dup = await findDuplicateNote(supaWith([EXISTING]), 'c1', { title: 'Lista de compras', body: '5kg de arroz\n2 kg de feijão\nBiscoitos para Alice levar pra escola' });
  assert.ok(dup, 'devia achar duplicata');
  assert.strictEqual(decideNoteCreate({ dup, fresh: undefined, nowMs: 1000, bypassMs: 300000 }), 'blocked');
});

test('re-tentativa dentro da janela → CRIA (bypass)', async () => {
  const dup = await findDuplicateNote(supaWith([EXISTING]), 'c1', { title: 'Lista de compras', body: '5kg de arroz\n2 kg de feijão' });
  assert.strictEqual(decideNoteCreate({ dup, fresh: 1000, nowMs: 2000, bypassMs: 300000 }), 'create');
});

test('sem nota parecida → CRIA normal', async () => {
  const dup = await findDuplicateNote(supaWith([{ id: 'n9', title: 'Plano de aula', body: 'escalas maiores' }]), 'c1', { title: 'Lista de compras', body: 'arroz feijão' });
  assert.strictEqual(dup, null);
  assert.strictEqual(decideNoteCreate({ dup, fresh: undefined, nowMs: 1, bypassMs: 300000 }), 'create');
});
