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

// ── assembleDigest ──────────────────────────────────────────────────────────
test('assemble: dentro do limite → header + seções + footer com separador', () => {
  const { message, dropped } = assembleDigest({
    header: 'HEAD',
    sections: [{ text: 'A' }, { text: 'B' }],
    footer: 'FOOT',
    maxChars: 4000,
  });
  assert.strictEqual(dropped.length, 0);
  assert.ok(message.startsWith('HEAD'));
  assert.ok(message.includes('A')); assert.ok(message.includes('B'));
  assert.ok(message.trim().endsWith('FOOT'));
});
test('assemble: seção vazia é ignorada', () => {
  const { message } = assembleDigest({ header: 'H', sections: [{ text: '' }, { text: 'X' }], footer: 'F' });
  assert.ok(message.includes('X'));
});
test('assemble: estoura → corta seção droppable da cauda + nota na dashboard', () => {
  const big = 'x'.repeat(3000);
  const { message, dropped } = assembleDigest({
    header: 'H',
    sections: [
      { text: big, droppable: false },              // essencial, fica
      { text: 'CAUDA ' + 'y'.repeat(3000), droppable: true }, // some
    ],
    footer: 'F',
    maxChars: 4000,
  });
  assert.strictEqual(dropped.length, 1);
  assert.ok(!message.includes('CAUDA'));
  assert.ok(message.includes('na dashboard'));
  assert.ok(message.length <= 4000);
});
test('assemble: header e footer NUNCA são cortados', () => {
  const { message } = assembleDigest({
    header: 'HEADER_KEEP',
    sections: [{ text: 'z'.repeat(5000), droppable: true }],
    footer: 'FOOTER_KEEP',
    maxChars: 4000,
  });
  assert.ok(message.includes('HEADER_KEEP'));
  assert.ok(message.includes('FOOTER_KEEP'));
});
