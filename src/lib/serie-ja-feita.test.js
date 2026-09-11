'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { irmaJaFeita, avisoJaFeitaNaSerie } = require('./serie-ja-feita');

// Jhonatan 03/08 (964232a9) — as ocorrências reais da série "Falar do cashback com a Vitória".
const HOJE = '2026-08-03';
const DE_0108 = { id: 'f6e7', due_date: '2026-08-01', status: 'done', completed_at: '2026-08-03T12:19:36Z' };
const DE_0109 = { id: '9bfa', title: 'Falar do cashback com a Vitória', due_date: '2026-09-01', status: 'pending' };

test('Jhonatan: a de 01/08 concluída há pouco é o que ele fez — não a de 01/09', () => {
  assert.strictEqual(irmaJaFeita([DE_0108], HOJE), DE_0108);
  assert.strictEqual(avisoJaFeitaNaSerie(DE_0108, DE_0109),
    '✅ *Falar do cashback com a Vitória* de 01/08 já estava concluída — a próxima é 01/09.');
});

test('irmã concluída mas com vencimento no FUTURO não conta', () => {
  assert.strictEqual(irmaJaFeita([{ ...DE_0108, due_date: '2026-08-10' }], HOJE), null);
});

test('não concluída, lista vazia → null; várias → a de conclusão mais recente', () => {
  assert.strictEqual(irmaJaFeita([{ ...DE_0108, status: 'pending' }], HOJE), null);
  assert.strictEqual(irmaJaFeita([], HOJE), null);
  const antiga = { ...DE_0108, id: 'old', completed_at: '2026-08-03T09:00:00Z' };
  assert.strictEqual(irmaJaFeita([antiga, DE_0108], HOJE).id, 'f6e7');
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: antes da guarda de futuro, irmã da série concluída há ≤ 3h conta como feita', () => {
  assert.match(ENG, /\.from\('tasks'\)\.select\('id, title, created_by, assigned_to, due_date, recurrence_parent_id'\)/);
  assert.match(ENG, /\.eq\('recurrence_parent_id', fullTask\.recurrence_parent_id\)\.eq\('status', 'done'\)\s*\n\s*\.gte\('completed_at', new Date\(Date\.now\(\) - 180 \* 60000\)\.toISOString\(\)\)/);
  assert.match(ENG, /const _irmaFeita = irmaJaFeita\(_irmasFeitas \|\| \[\], todayYmdSP\(\)\);/);
});
