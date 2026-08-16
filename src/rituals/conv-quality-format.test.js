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
// AUDIT-REGRESSION-PROMOTED-MISMATCH (16/08): a triagem casou o finding a
// TOM-AFIRMA-DEPOIS-DESMENTE por SINTOMA (0.95) e marcou "regression". O agente, no ciclo,
// examinou e promoveu pra um código NOVO (CONFAB-INVERSO-OFERTA-CONDICIONAL) — decidiu que é
// raiz nova, não recorrência daquele KI. O banner "🔁 REGRESSÃO [TOM-AFIRMA-DEPOIS-DESMENTE]"
// ficou com o palpite da triagem, contradizendo o veredito do próprio agente na DM do Alf.
test('formatConvQuality: promovido a código DIFERENTE não é regressão do matched_code', () => {
  const r = formatConvQuality([
    base({ id: 'a', promoted_code: 'CONFAB-INVERSO-OFERTA-CONDICIONAL',
      auto_triage: { decision: 'regression', matched_code: 'TOM-AFIRMA-DEPOIS-DESMENTE' } }),
  ], { inactiveCount: 0 });
  assert.doesNotMatch(r.detail, /REGRESS/i);                       // não é regressão daquele KI
  assert.doesNotMatch(r.detail, /TOM-AFIRMA-DEPOIS-DESMENTE/);     // não aponta o KI errado
  assert.match(r.detail, /1 falha/);                              // mas continua visível no corpo
});
test('formatConvQuality: promovido ao MESMO código segue sendo regressão', () => {
  const r = formatConvQuality([
    base({ id: 'a', promoted_code: 'BUG-9',
      auto_triage: { decision: 'regression', matched_code: 'BUG-9' } }),
  ], { inactiveCount: 0 });
  assert.match(r.detail, /REGRESS/i);  // agente confirmou que É aquele KI voltando
  assert.match(r.detail, /BUG-9/);
});
test('formatConvQuality: regressão SEM promoted_code ainda destaca (palpite vale até o ciclo)', () => {
  const r = formatConvQuality([
    base({ id: 'a', auto_triage: { decision: 'regression', matched_code: 'BUG-9' } }),
  ], { inactiveCount: 0 });
  assert.match(r.detail, /REGRESS/i);
  assert.match(r.detail, /BUG-9/);
});
test('formatConvQuality: anteriores abertos contam mas não poluem corpo', () => {
  const r = formatConvQuality([base({ id: 'a' })], { inactiveCount: 40 });
  assert.match(r.detail, /40 abertos de dias anteriores/i);
  assert.match(r.detail, /1 falha/);   // corpo segue com só 1
});
test('formatConvQuality: tudo suprimido/inativo → status ok', () => {
  const r = formatConvQuality([
    base({ id: 'b', auto_triage: { decision: 'suppress', matched_code: 'BUG-1' } }),
  ], { inactiveCount: 5 });
  assert.strictEqual(r.status, 'ok');
});
