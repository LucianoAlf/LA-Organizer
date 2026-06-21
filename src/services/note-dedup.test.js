'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scoreNoteSimilarity, isProbableDuplicate, findDuplicateNote } = require('./note-dedup');

const C7_EXISTING = { title: 'Lista de compras — mercado', body: '5kg de arroz\n2kg de feijão\nBiscoitos para Alice\nIogurte para a Alice' };
const C7_NEW = { title: 'Lista de compras', body: '5kg de arroz\n2 kg de feijão\nBiscoitos para Alice levar para a escola' };

test('C7: mesma lista, título diferente → duplicata', () => {
  assert.strictEqual(isProbableDuplicate(C7_NEW, C7_EXISTING), true);
});
test('Reunião com datas diferentes e corpo diferente → NÃO duplicata', () => {
  const a = { title: 'Reunião 12/06', body: 'Pauta: orçamento Q2, contratações' };
  const b = { title: 'Reunião 19/06', body: 'Pauta: retrospectiva, planejamento da Barra' };
  assert.strictEqual(isProbableDuplicate(a, b), false);
});
test('Títulos totalmente diferentes → NÃO duplicata', () => {
  const a = { title: 'Ideias de marketing', body: 'reels, parcerias' };
  const b = { title: 'Lista de compras', body: 'arroz, feijão' };
  assert.strictEqual(isProbableDuplicate(a, b), false);
});
test('Mesmo título, corpos sem overlap → NÃO duplicata (notas homônimas distintas)', () => {
  const a = { title: 'Anotações', body: 'comprar presente da Alice' };
  const b = { title: 'Anotações', body: 'ligar pro contador sobre imposto' };
  assert.strictEqual(isProbableDuplicate(a, b), false);
});
test('scoreNoteSimilarity retorna titleSim e bodyOverlap', () => {
  const s = scoreNoteSimilarity(C7_NEW, C7_EXISTING);
  assert.ok(s.titleSim > 0.85 && s.bodyOverlap >= 0.4, JSON.stringify(s));
});
test('findDuplicateNote: acha a melhor acima do limiar', async () => {
  const fakeSupabase = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [C7_EXISTING, { title: 'Outra coisa', body: 'nada a ver' }] }) }) }) }) }) }) };
  const r = await findDuplicateNote(fakeSupabase, 'collab-1', C7_NEW);
  assert.ok(r && r.note.title === 'Lista de compras — mercado', JSON.stringify(r));
});
test('findDuplicateNote: nada parecido → null', async () => {
  const fakeSupabase = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ title: 'Ideias projeto X', body: 'foo' }] }) }) }) }) }) }) };
  const r = await findDuplicateNote(fakeSupabase, 'collab-1', C7_NEW);
  assert.strictEqual(r, null);
});
