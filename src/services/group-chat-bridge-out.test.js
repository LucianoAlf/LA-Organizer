// src/services/group-chat-bridge-out.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildWhatsappText } = require('./group-chat-bridge-out');

test('membro vira "💬 *Nome*: texto"', () => {
  assert.equal(
    buildWhatsappText({ role: 'member', kind: 'text', content: 'bom dia' }, 'Rose Silva'),
    '💬 *Rose*: bom dia'
  );
});
test('membro sem nome cai no fallback sem asterisco', () => {
  assert.equal(buildWhatsappText({ role: 'member', kind: 'text', content: 'oi' }, ''), '💬 oi');
});
test('TOM manda só a prosa, sem o bloco de ACTIONS', () => {
  const msg = { role: 'tom', kind: 'text', content: 'Pode deixar, Rose!\n‹‹ACTIONS››[{"kind":"task"}]' };
  assert.equal(buildWhatsappText(msg, ''), 'Pode deixar, Rose!');
});
test('TOM sem prosa (só ACTIONS) → null (não espelha)', () => {
  assert.equal(buildWhatsappText({ role: 'tom', kind: 'text', content: '‹‹ACTIONS››[{"x":1}]' }, ''), null);
});
test('report (card HTML) → null', () => {
  assert.equal(buildWhatsappText({ role: 'tom', kind: 'report', content: '<div>x</div>' }, ''), null);
});
test('mídia (kind != text) → null no v1', () => {
  assert.equal(buildWhatsappText({ role: 'member', kind: 'image', content: '' }, 'Ana'), null);
});
test('membro com texto vazio → null', () => {
  assert.equal(buildWhatsappText({ role: 'member', kind: 'text', content: '   ' }, 'Ana'), null);
});
