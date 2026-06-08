// src/rituals/governance-digest.test.js
// Trava o montador puro do digest de governança (Fase 6a).
// Rodar: node --test src/rituals/governance-digest.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { badgeForScorecard, formatScorecardSection, assembleDigest } = require('./governance-digest');

// ── badgeForScorecard ───────────────────────────────────────────────────────
test('badge: closure<0.60 → 🔴 atenção', () => {
  const b = badgeForScorecard({ closure_rate: 0.4, tasks_overdue: 1, tasks_closed: 2 });
  assert.strictEqual(b.dot, '🔴'); assert.strictEqual(b.label, 'atenção');
});
test('badge: overdue>=3 → 🔴 atenção mesmo com closure alto', () => {
  assert.strictEqual(badgeForScorecard({ closure_rate: 0.9, tasks_overdue: 3, tasks_closed: 5 }).dot, '🔴');
});
test('badge: closure 0.80 + 1 atrasada → 🟡 de olho', () => {
  const b = badgeForScorecard({ closure_rate: 0.8, tasks_overdue: 1, tasks_closed: 4 });
  assert.strictEqual(b.dot, '🟡'); assert.strictEqual(b.label, 'de olho');
});
test('badge: closure>=0.85 sem atraso → 🟢 + 🥇', () => {
  const b = badgeForScorecard({ closure_rate: 0.9, tasks_overdue: 0, tasks_stuck: 0, tasks_closed: 9 });
  assert.strictEqual(b.dot, '🟢'); assert.strictEqual(b.badge, '🥇');
});
test('badge: sem tarefas → 🟢 ritmo, sem 🥇 (não pune nem premia vazio)', () => {
  const b = badgeForScorecard({ closure_rate: 0, tasks_overdue: 0, tasks_stuck: 0, tasks_closed: 0 });
  assert.strictEqual(b.dot, '🟢'); assert.strictEqual(b.badge, '');
});
test('badge: delta >= +10pp → 📈 (subindo)', () => {
  const b = badgeForScorecard({ closure_rate: 0.7, tasks_overdue: 1, tasks_closed: 5, delta_closure: 15 });
  assert.ok(b.badge.includes('📈'));
});

// ── formatScorecardSection ──────────────────────────────────────────────────
test('scorecard section: vazio → string vazia', () => {
  assert.strictEqual(formatScorecardSection([]), '');
});
test('scorecard section: ordena pior→melhor e mostra nome/pct', () => {
  const out = formatScorecardSection([
    { leader_name: 'Juliana Boa', closure_rate: 0.95, tasks_overdue: 0, tasks_closed: 10 },
    { leader_name: 'Quintela Ruim', closure_rate: 0.2, tasks_overdue: 5, tasks_closed: 1 },
  ]);
  const lines = out.split('\n');
  assert.ok(lines[0].startsWith('🏆'));
  // pior (Quintela 🔴) vem antes da melhor (Juliana 🟢)
  assert.ok(out.indexOf('Quintela') < out.indexOf('Juliana'));
  assert.ok(out.includes('20%')); assert.ok(out.includes('95%'));
});

// ── assembleDigest (preserva tudo; divide se estourar) ──────────────────────
test('assemble: dentro do limite → 1 mensagem com header + seções + footer', () => {
  const { messages, parts } = assembleDigest({
    header: 'HEAD',
    sections: [{ text: 'A' }, { text: 'B' }],
    footer: 'FOOT',
    maxChars: 4000,
  });
  assert.strictEqual(parts, 1);
  assert.ok(messages[0].startsWith('HEAD'));
  assert.ok(messages[0].includes('A')); assert.ok(messages[0].includes('B'));
  assert.ok(messages[0].trim().endsWith('FOOT'));
});
test('assemble: seção vazia é ignorada', () => {
  const { messages } = assembleDigest({ header: 'H', sections: [{ text: '' }, { text: 'X' }], footer: 'F' });
  assert.ok(messages[0].includes('X'));
});
test('assemble: estoura → DIVIDE em várias mensagens, NADA é perdido', () => {
  const a = 'AAAA' + 'x'.repeat(3000);
  const b = 'BBBB' + 'y'.repeat(3000);
  const { messages, parts } = assembleDigest({
    header: 'H', sections: [{ text: a }, { text: b }], footer: 'F', maxChars: 4000,
  });
  assert.ok(parts >= 2);
  const joined = messages.join('');
  // riqueza preservada: os dois blocos aparecem inteiros em algum chunk
  assert.ok(joined.includes(a)); assert.ok(joined.includes(b));
  for (const m of messages) assert.ok(m.length <= 4000, `chunk ${m.length} > 4000`);
  assert.ok(messages.some(m => /\(1\/\d\)/.test(m)));
});
test('assemble: header e footer presentes mesmo dividindo', () => {
  const { messages } = assembleDigest({
    header: 'HEADER_KEEP',
    sections: [{ text: 'z'.repeat(3500) }, { text: 'w'.repeat(3500) }],
    footer: 'FOOTER_KEEP',
    maxChars: 4000,
  });
  const joined = messages.join('');
  assert.ok(joined.includes('HEADER_KEEP'));
  assert.ok(joined.includes('FOOTER_KEEP'));
});
