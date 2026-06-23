// src/services/finding-triage.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { decideTriage, MARGIN_MS } = require('./finding-triage');

const fix = '2026-06-10T12:00:00Z';
const hi = (incident_at, last_seen) => ({ incident_at, last_seen, incident_confidence: 'high' });
const lo = (incident_at, last_seen) => ({ incident_at, last_seen, incident_confidence: 'low' });
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

// ── O CORE: incident_at (ocorrência real) MANDA sobre last_seen (detecção) ──
test('decideTriage: incident_at pré-fix vence last_seen pós-fix → suppress (não confunde detecção com ocorrência)', () => {
  // Achado detectado DEPOIS do fix (last_seen), mas cujo incidente foi ANTES (incident_at high).
  // Caso real 23/06: COORD/SYNC/INSTALLMENTS corrigidos de madrugada; incidentes na noite anterior.
  const f = hi('2026-06-05T00:00:00Z', '2026-06-15T00:00:00Z');
  assert.strictEqual(decideTriage(f, m()).decision, 'suppress');
});
test('decideTriage: incident_at confiável claramente pré-fix → suppress', () => {
  assert.strictEqual(decideTriage(hi('2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z'), m()).decision, 'suppress');
});
test('decideTriage: incident_at confiável bem depois do fix → regression', () => {
  assert.strictEqual(decideTriage(hi('2026-06-12T00:00:00Z', null), m()).decision, 'regression');
});
test('decideTriage: incidente logo APÓS o fix (dentro da margem) → keep (lag de deploy ou borda)', () => {
  const justAfter = new Date(Date.parse(fix) + MARGIN_MS / 2).toISOString();
  assert.strictEqual(decideTriage(hi(justAfter, justAfter), m()).decision, 'keep');
});
test('decideTriage: incidente na margem ANTES do fix → suppress (pré-fix por definição)', () => {
  const justBefore = new Date(Date.parse(fix) - MARGIN_MS / 2).toISOString();
  assert.strictEqual(decideTriage(hi(justBefore, justBefore), m()).decision, 'suppress');
});

// ── Fallback: sem incident_at confiável, usa last_seen (detecção) ──
test('decideTriage: incident_confidence baixo + last_seen pré-fix → keep', () => {
  assert.strictEqual(decideTriage(lo('2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z'), m()).decision, 'keep');
});
test('decideTriage: incident_confidence baixo + last_seen bem pós-fix → regression (fallback)', () => {
  assert.strictEqual(decideTriage(lo('2026-06-05T00:00:00Z', '2026-06-15T00:00:00Z'), m()).decision, 'regression');
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

// ── triageOpenFindings (orquestração) ───────────────────────────────
const { triageOpenFindings } = require('./finding-triage');

function fakeTriageSb(byTable, calls) {
  let tbl = null;
  const b = {
    from(t) { tbl = t; return this; },
    select() { return this; }, in() { return this; }, gte() { return this; },
    eq() { return this; }, order() { return this; },
    update(p) { calls.updates.push(p); return this; },
    limit() { return Promise.resolve({ data: byTable[tbl] || [], error: null }); },
    then(res) { res({ data: byTable[tbl] || [], error: null }); },
  };
  return b;
}

test('triageOpenFindings: suprime pré-fix (mesmo detectado depois) e marca regressão por incidente pós-fix', async () => {
  const calls = { updates: [] };
  const sb = fakeTriageSb({
    tom_audit_findings: [
      // f1: incidente pré-fix, detectado DEPOIS do fix → suppress (o caso de 23/06)
      { id: 'f1', category: 'confabulation', summary: 'salvar falhou', evidence: 'TOM: não salvei',
        incident_at: '2026-06-05T00:00:00Z', incident_confidence: 'high', last_seen: '2026-06-15T00:00:00Z' },
      // f2: incidente DEPOIS do fix → regressão real
      { id: 'f2', category: 'confabulation', summary: 'salvar falhou de novo', evidence: 'TOM: não salvei',
        incident_at: '2026-06-12T00:00:00Z', incident_confidence: 'high', last_seen: '2026-06-15T00:00:00Z' },
    ],
    tom_known_issues: [
      { codigo: 'BUG-1', titulo: 'salvar falhava', area: 'marker', causa_raiz: 'x', fix_resumo: 'y',
        status: 'corrigido', corrigido_em: '2026-06-10T00:00:00Z' },
    ],
  }, calls);
  const chat = async () => ({ text: '{"matches":[' +
    '{"finding_id":"f1","matched_code":"BUG-1","confidence":0.95,"reason":"mesma causa"},' +
    '{"finding_id":"f2","matched_code":"BUG-1","confidence":0.95,"reason":"mesma causa"}]}' });

  const out = await triageOpenFindings(sb, chat, { nowIso: '2026-06-19T00:00:00Z' });
  assert.strictEqual(out.suppressed, 1);
  assert.strictEqual(out.regressions, 1);
  const decisions = calls.updates.map(u => u.auto_triage && u.auto_triage.decision).filter(Boolean);
  assert.ok(decisions.includes('suppress'));
  assert.ok(decisions.includes('regression'));
});
