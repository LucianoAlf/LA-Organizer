// src/services/reply-ref.test.js
// Rodar: node --test src/services/reply-ref.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveReplyTarget, buildReplyRefCtxHint } = require('./reply-ref');

const ROW = { ref_type: 'task', ref_id: 'aaaaaaaa-0000-0000-0000-000000000001' };
const OBJ = { id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'pending', title: 'Lançar BG' };

test('casa: quotedId + linha com ref + objeto vivo → ancora', () => {
  assert.deepStrictEqual(
    resolveReplyTarget({ quotedId: 'WA1', row: ROW, object: OBJ }),
    { refType: 'task', refId: OBJ.id, title: 'Lançar BG' }
  );
});
test('sem quotedId (não é reply-quote) → null', () => {
  assert.strictEqual(resolveReplyTarget({ quotedId: null, row: ROW, object: OBJ }), null);
});
test('linha sem ref (proativo sem vínculo) → null', () => {
  assert.strictEqual(resolveReplyTarget({ quotedId: 'WA1', row: { ref_type: null, ref_id: null }, object: OBJ }), null);
});
test('objeto concluído → não ancora (não reagenda tarefa morta)', () => {
  assert.strictEqual(resolveReplyTarget({ quotedId: 'WA1', row: ROW, object: { ...OBJ, status: 'done' } }), null);
});
test('objeto cancelado → não ancora', () => {
  assert.strictEqual(resolveReplyTarget({ quotedId: 'WA1', row: ROW, object: { ...OBJ, status: 'cancelled' } }), null);
});
test('objeto sumiu (null) → null', () => {
  assert.strictEqual(resolveReplyTarget({ quotedId: 'WA1', row: ROW, object: null }), null);
});
test('id da linha ≠ id do objeto → null (proteção)', () => {
  assert.strictEqual(resolveReplyTarget({ quotedId: 'WA1', row: ROW, object: { ...OBJ, id: 'outro' } }), null);
});
test('evento vivo → ancora com refType event', () => {
  const evRow = { ref_type: 'event', ref_id: 'bbbbbbbb-0000-0000-0000-000000000002' };
  const evObj = { id: 'bbbbbbbb-0000-0000-0000-000000000002', status: 'pending', title: 'Reunião' };
  assert.deepStrictEqual(
    resolveReplyTarget({ quotedId: 'WA9', row: evRow, object: evObj }),
    { refType: 'event', refId: evObj.id, title: 'Reunião' }
  );
});
test('hint cita id + manda usar TASK_UPDATE; null → string vazia', () => {
  const h = buildReplyRefCtxHint(resolveReplyTarget({ quotedId: 'WA1', row: ROW, object: OBJ }));
  assert.match(h, /TASK_UPDATE/);
  assert.ok(h.includes(OBJ.id));
  assert.strictEqual(buildReplyRefCtxHint(null), '');
});
