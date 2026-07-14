const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeCoordinationFields } = require('./coord-alias');

// COORD-REQUEST-TONAME-ALIAS (audit 14/07): o LLM emite `to_name` (espelhando `from_name`)
// como destinatário do <<COORDINATION_REQUEST>>. A cadeia de aliases do parser cobria
// recipient/to/name mas NÃO to_name → recipient_name:missing → schema_invalid → o recado
// NUNCA saía (81% das rejeições históricas; 100% das de julho: John 14/07, Anne 13/07…).
// Helper puro extraído do engine (1563-1575) + o alias faltante. Aditivo, precedência preserva
// o campo canônico quando presente (zero-regressão do COORD-REQUEST-ALIAS 11/06).

// ── o BUG: to_name vira recipient_name ───────────────────────────────────────
test('John 14/07 REAL: {to_name:"John"} → recipient_name="John"', () => {
  const p = { to_name: 'John', message: 'Passa uma olhada nas tarefas', message_body: 'Passa uma olhada nas tarefas', mode: 'relay_literal' };
  normalizeCoordinationFields(p);
  assert.strictEqual(p.recipient_name, 'John');
});
test('Anne 13/07 REAL: {to_name:"Anne"} → recipient_name="Anne"', () => {
  const p = { to_name: 'Anne', message: 'Rafinha já pegou os cheques', message_body: 'Rafinha já pegou os cheques' };
  normalizeCoordinationFields(p);
  assert.strictEqual(p.recipient_name, 'Anne');
});

// ── zero-regressão: aliases já cobertos (COORD-REQUEST-ALIAS 11/06) seguem valendo ──
test('legado: recipient/to/name ainda mapeiam pra recipient_name', () => {
  const a = { recipient: 'Leo' }; normalizeCoordinationFields(a); assert.strictEqual(a.recipient_name, 'Leo');
  const b = { to: 'Dai' };        normalizeCoordinationFields(b); assert.strictEqual(b.recipient_name, 'Dai');
  const c = { name: 'Rafinha' };  normalizeCoordinationFields(c); assert.strictEqual(c.recipient_name, 'Rafinha');
});
test('precedência: recipient_name canônico NÃO é clobber por to_name', () => {
  const p = { recipient_name: 'Quintela', to_name: 'ERRADO' };
  normalizeCoordinationFields(p);
  assert.strictEqual(p.recipient_name, 'Quintela');
});

// ── message_body aliases (message/body/content/text) preservados ──────────────
test('message/body/content/text → message_body', () => {
  const a = { message: 'oi' };  normalizeCoordinationFields(a); assert.strictEqual(a.message_body, 'oi');
  const b = { body: 'oi' };     normalizeCoordinationFields(b); assert.strictEqual(b.message_body, 'oi');
  const c = { content: 'oi' };  normalizeCoordinationFields(c); assert.strictEqual(c.message_body, 'oi');
  const d = { text: 'oi' };     normalizeCoordinationFields(d); assert.strictEqual(d.message_body, 'oi');
});

// ── mode aliases (relay/literal/assisted/follow-up) preservados ───────────────
test('mode aliases normalizam', () => {
  const a = { mode: 'relay' };      normalizeCoordinationFields(a); assert.strictEqual(a.mode, 'relay_literal');
  const b = { mode: 'literal' };    normalizeCoordinationFields(b); assert.strictEqual(b.mode, 'relay_literal');
  const c = { mode: 'assisted' };   normalizeCoordinationFields(c); assert.strictEqual(c.mode, 'relay_assisted');
  const d = { mode: 'follow-up' };  normalizeCoordinationFields(d); assert.strictEqual(d.mode, 'followup');
  const e = { mode: 'relay_literal' }; normalizeCoordinationFields(e); assert.strictEqual(e.mode, 'relay_literal'); // canônico intacto
});

// ── defensivo ─────────────────────────────────────────────────────────────────
test('defensivo: objeto vazio / sem mode não quebra', () => {
  const a = {}; normalizeCoordinationFields(a); assert.strictEqual(a.recipient_name, undefined);
  const b = { recipient_name: 'X', message_body: 'y' }; normalizeCoordinationFields(b);
  assert.strictEqual(b.recipient_name, 'X'); assert.strictEqual(b.mode, undefined);
});
