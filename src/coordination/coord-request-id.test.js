const { test } = require('node:test');
const assert = require('node:assert');
const { isValidCoordRequestId, resolveCoordRequest } = require('./coord-request-id');

// ── isValidCoordRequestId ────────────────────────────────────────────────
// Audit 08/07 — caso Jereh: <<COORDINATION_RESPONSE>> com request_id short-id.
test('aceita short-id de 8 hex (caso Jereh real: 9d08f967)', () => {
  assert.strictEqual(isValidCoordRequestId('9d08f967'), true);
});

test('aceita short-id em uppercase', () => {
  assert.strictEqual(isValidCoordRequestId('9D08F967'), true);
});

test('aceita UUID completo (compat: comportamento antigo preservado)', () => {
  assert.strictEqual(isValidCoordRequestId('9d08f967-3ded-4b5e-834e-856aa09262bf'), true);
});

test('tolera espaços nas bordas', () => {
  assert.strictEqual(isValidCoordRequestId('  9d08f967  '), true);
});

test('rejeita vazio / não-string', () => {
  assert.strictEqual(isValidCoordRequestId(''), false);
  assert.strictEqual(isValidCoordRequestId(null), false);
  assert.strictEqual(isValidCoordRequestId(undefined), false);
  assert.strictEqual(isValidCoordRequestId(123), false);
});

test('rejeita não-hex', () => {
  assert.strictEqual(isValidCoordRequestId('xyztuvw'), false);
});

test('rejeita curto demais (<4 hex)', () => {
  assert.strictEqual(isValidCoordRequestId('9d0'), false);
});

test('rejeita comprido não-UUID (13 hex soltos)', () => {
  assert.strictEqual(isValidCoordRequestId('9d08f9673ded4'), false);
});

// ── resolveCoordRequest (guarda de ambiguidade — parecer catraca 08/07) ───
test('resolve: short-id único → ok (caso Jereh)', () => {
  const rows = [
    { id: '9d08f967-3ded-4b5e-834e-856aa09262bf', requester_id: 'gabi' },
    { id: 'a1b2c3d4-0000-0000-0000-000000000000', requester_id: 'outro' },
  ];
  const r = resolveCoordRequest(rows, '9d08f967');
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.req.id, '9d08f967-3ded-4b5e-834e-856aa09262bf');
});

test('resolve: UUID completo → ok', () => {
  const rows = [{ id: '9d08f967-3ded-4b5e-834e-856aa09262bf' }];
  const r = resolveCoordRequest(rows, '9d08f967-3ded-4b5e-834e-856aa09262bf');
  assert.strictEqual(r.status, 'ok');
});

test('resolve: prefixo casa N>1 → ambiguous (NÃO chuta o [0])', () => {
  const rows = [
    { id: 'abcd1234-1111-2222-3333-444444444444' },
    { id: 'abcd1234-5555-6666-7777-888888888888' },
  ];
  const r = resolveCoordRequest(rows, 'abcd1234');
  assert.strictEqual(r.status, 'ambiguous');
  assert.strictEqual(r.matches.length, 2);
});

test('resolve: nenhum match → none', () => {
  const rows = [{ id: '9d08f967-3ded-4b5e-834e-856aa09262bf' }];
  assert.strictEqual(resolveCoordRequest(rows, 'ffffffff').status, 'none');
});

test('resolve: candRows vazio/nulo → none', () => {
  assert.strictEqual(resolveCoordRequest([], '9d08f967').status, 'none');
  assert.strictEqual(resolveCoordRequest(null, '9d08f967').status, 'none');
});
