// src/services/finding-triage.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { decideTriage, MARGIN_MS } = require('./finding-triage');

const fix = '2026-06-10T12:00:00Z';
const hi = (incident_at, last_seen) => ({ incident_at, last_seen, incident_confidence: 'high' });
const m = (over = {}) => ({ codigo: 'BUG-1', status: 'corrigido', corrigido_em: fix, confidence: 0.9, ...over });

test('decideTriage: sem match → keep', () => {
  assert.strictEqual(decideTriage(hi('2026-06-01T00:00:00Z', null), null).decision, 'keep');
});
test('decideTriage: confiança do match abaixo do mínimo → keep', () => {
  assert.strictEqual(decideTriage(hi('2026-06-01T00:00:00Z', null), m({ confidence: 0.5 })).decision, 'keep');
});
test('decideTriage: known-issue não corrigido → keep', () => {
  assert.strictEqual(decideTriage(hi('2026-06-01T00:00:00Z', null), m({ status: 'aberto' })).decision, 'keep');
});
test('decideTriage: last_seen depois do fix → regression (vence supressão)', () => {
  const f = hi('2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z'); // incidente pré-fix, mas reincidiu
  assert.strictEqual(decideTriage(f, m()).decision, 'regression');
});
test('decideTriage: incident_at confiável depois do fix → regression', () => {
  assert.strictEqual(decideTriage(hi('2026-06-12T00:00:00Z', null), m()).decision, 'regression');
});
test('decideTriage: incident_at confiável e claramente pré-fix → suppress', () => {
  assert.strictEqual(decideTriage(hi('2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z'), m()).decision, 'suppress');
});
test('decideTriage: incident_confidence baixo → keep (na dúvida mostra)', () => {
  const f = { incident_at: '2026-06-05T00:00:00Z', last_seen: '2026-06-05T00:00:00Z', incident_confidence: 'low' };
  assert.strictEqual(decideTriage(f, m()).decision, 'keep');
});
test('decideTriage: incidente na margem antes do fix → keep (borda)', () => {
  const justBefore = new Date(Date.parse(fix) - MARGIN_MS / 2).toISOString();
  const f = hi(justBefore, justBefore);
  assert.strictEqual(decideTriage(f, m()).decision, 'keep');
});

// ── parseMatches ────────────────────────────────────────────────────
const { parseMatches } = require('./finding-triage');

test('parseMatches: extrai matches válidos e ignora lixo ao redor', () => {
  const raw = 'antes {"matches":[{"finding_id":"f1","matched_code":"BUG-1","confidence":0.9,"reason":"r"}]} depois';
  const out = parseMatches(raw);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].matched_code, 'BUG-1');
  assert.strictEqual(out[0].confidence, 0.9);
});
test('parseMatches: JSON quebrado → []', () => {
  assert.deepStrictEqual(parseMatches('não é json'), []);
});
test('parseMatches: normaliza matched_code "null" textual e confidence ausente', () => {
  const out = parseMatches('{"matches":[{"finding_id":"f2","matched_code":"null"}]}');
  assert.strictEqual(out[0].matched_code, null);
  assert.strictEqual(out[0].confidence, 0);
});
