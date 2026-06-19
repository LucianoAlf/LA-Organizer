// src/rituals/conv-quality-format.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { formatConvQuality } = require('./conv-quality-format');

const base = (over) => ({
  category: 'confabulation', severity: 'medio', summary: 's', occurrences: 1,
  collaborator_id: 'c1', collaborators: { full_name: 'Fulano' }, auto_triage: null, ...over,
});

test('formatConvQuality: suprimidos saem do corpo e viram contagem', () => {
  const r = formatConvQuality([
    base({ id: 'a' }),
    base({ id: 'b', auto_triage: { decision: 'suppress', matched_code: 'BUG-1' } }),
  ], { inactiveCount: 0 });
  assert.match(r.detail, /1 falha/);          // só 1 no corpo
  assert.match(r.detail, /já-corrigid/i);     // contagem de suprimidos
  assert.match(r.detail, /BUG-1/);            // código auditável
});
test('formatConvQuality: regressão aparece em destaque', () => {
  const r = formatConvQuality([
    base({ id: 'a', auto_triage: { decision: 'regression', matched_code: 'BUG-9' } }),
  ], { inactiveCount: 0 });
  assert.match(r.detail, /REGRESS/i);
  assert.match(r.detail, /BUG-9/);
});
test('formatConvQuality: inativos contam mas não poluem corpo', () => {
  const r = formatConvQuality([base({ id: 'a' })], { inactiveCount: 40 });
  assert.match(r.detail, /40 inativ/i);
});
test('formatConvQuality: tudo suprimido/inativo → status ok', () => {
  const r = formatConvQuality([
    base({ id: 'b', auto_triage: { decision: 'suppress', matched_code: 'BUG-1' } }),
  ], { inactiveCount: 5 });
  assert.strictEqual(r.status, 'ok');
});
