// src/services/group-chat-bridge-out.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildWhatsappText, buildWhatsappMedia, selectRevocable } = require('./group-chat-bridge-out');

test('selectRevocable: só rows app-origin, não sincronizadas, com wa_message_id real', () => {
  const rows = [
    { id: 1, deleted_origin: 'app', deleted_synced: false, wa_message_id: '3EBXYZ' },
    { id: 2, deleted_origin: 'app', deleted_synced: false, wa_message_id: 'sent' },
    { id: 3, deleted_origin: 'app', deleted_synced: false, wa_message_id: null },
    { id: 4, deleted_origin: 'whatsapp', deleted_synced: false, wa_message_id: '3EB' },
  ];
  assert.deepEqual(selectRevocable(rows).map((r) => r.id), [1]);
});

test('imagem de membro vira payload type=image com autoria na caption', () => {
  const r = buildWhatsappMedia(
    { role: 'member', kind: 'image', media_url: 'https://x/y.jpg', media_filename: 'y.jpg', content: 'olha o comprovante' },
    'Rose Silva'
  );
  assert.deepEqual(r, { type: 'image', url: 'https://x/y.jpg', caption: '💬 *Rose*: olha o comprovante', filename: 'y.jpg' });
});
test('pdf vira type=document', () => {
  const r = buildWhatsappMedia({ role: 'member', kind: 'pdf', media_url: 'https://x/b.pdf', media_filename: 'boleto.pdf' }, 'Ana');
  assert.equal(r.type, 'document');
  assert.equal(r.caption, '💬 *Ana*');
});
test('audio vira type=audio', () => {
  const r = buildWhatsappMedia({ role: 'member', kind: 'audio', media_url: 'https://x/a.webm' }, 'Ana');
  assert.equal(r.type, 'audio');
});
test('mídia sem media_url → null (ainda subindo)', () => {
  assert.equal(buildWhatsappMedia({ role: 'member', kind: 'image', media_url: null }, 'Ana'), null);
});
test('texto/report não é mídia → null', () => {
  assert.equal(buildWhatsappMedia({ role: 'member', kind: 'text', content: 'oi' }, 'Ana'), null);
  assert.equal(buildWhatsappMedia({ role: 'tom', kind: 'report', content: '<div/>' }, ''), null);
});

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
test('report (card HTML) → espelha como texto formatado WhatsApp', () => {
  const html = '<div><h3>Resumo da sessão</h3><p>Rose pediu lembrete.</p><strong>Em aberto</strong><ul><li>Conferir caixa</li></ul></div>';
  const out = buildWhatsappText({ role: 'tom', kind: 'report', content: html }, '');
  assert.match(out, /\*Resumo da sessão\*/);
  assert.match(out, /Rose pediu lembrete\./);
  assert.match(out, /\*Em aberto\*/);
  assert.match(out, /• Conferir caixa/);
  assert.ok(!/[<>]/.test(out), 'não pode sobrar tag HTML');
});
test('report com cerca ```html é limpo (sem markdown fence no zap)', () => {
  const out = buildWhatsappText({ role: 'tom', kind: 'report', content: '```html\n<h3>Resumo</h3>\n```' }, '');
  assert.equal(out, '*Resumo*');
});
test('report com <hr> entre blocos vira linha separadora no WhatsApp', () => {
  const html = '<div><h3>🔴 Atrasadas · 1</h3><ul><li>01/06 — X</li></ul><hr><h3>⏰ Esta semana · 1</h3><ul><li>15/06 — Y</li></ul></div>';
  const out = buildWhatsappText({ role: 'tom', kind: 'report', content: html }, '');
  assert.match(out, /──────────/);              // <hr> virou linha de traços
  assert.match(out, /\*🔴 Atrasadas · 1\*/);
  assert.match(out, /\*⏰ Esta semana · 1\*/);
  assert.ok(!/[<>]/.test(out), 'não pode sobrar tag HTML');
});
test('report vazio → null', () => {
  assert.equal(buildWhatsappText({ role: 'tom', kind: 'report', content: '   ' }, ''), null);
});
test('mídia (kind != text) → null no v1', () => {
  assert.equal(buildWhatsappText({ role: 'member', kind: 'image', content: '' }, 'Ana'), null);
});
test('membro com texto vazio → null', () => {
  assert.equal(buildWhatsappText({ role: 'member', kind: 'text', content: '   ' }, 'Ana'), null);
});
