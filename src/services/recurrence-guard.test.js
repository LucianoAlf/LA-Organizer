const { test } = require('node:test');
const assert = require('node:assert');
const { shouldMaterializeTemplate } = require('./recurrence-guard');

// RECUR-RESURRECT-CALLER-GUARD (caso Gabi/equipe 24/06) + FATIA 2 (flip do ciclo de vida).
// O guard "não materializar série encerrada" é o ponto ÚNICO que tranca as 4 portas de
// materialização (cron/engine/PWA/grupo).
//
// FATIA 2 (24/06): a decisão passou a depender do CICLO DE VIDA da série
// (`series_ended_at`), NÃO do status da ocorrência. Concluir a 1ª ocorrência
// (status=done) NÃO encerra mais a série — só `series_ended_at` preenchido encerra.
// Isto mata a dor #1 ("concluí e a série congelou") sem ressuscitar nada.

// --- ENCERRADA: series_ended_at preenchido → NÃO materializa ---
test('série ENCERRADA (series_ended_at preenchido) → NÃO materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate({ series_ended_at: '2026-06-24T12:00:00Z' }), false);
});
test('series_ended_at preenchido bloqueia mesmo com status=pending (revive ainda não limpou)', () => {
  assert.strictEqual(shouldMaterializeTemplate({ status: 'pending', series_ended_at: '2026-06-24T12:00:00Z' }), false);
});

// --- ATIVA: series_ended_at null → materializa, INDEPENDENTE do status da ocorrência ---
test('série ATIVA (series_ended_at null) → materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate({ series_ended_at: null }), true);
});
test('ÂNCORA: ocorrência concluída (status=done) mas série NÃO encerrada → materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate({ status: 'done', series_ended_at: null }), true);
});
test('ocorrência cancelada (status=cancelled) mas série NÃO encerrada → materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate({ status: 'cancelled', series_ended_at: null }), true);
});
test('NÃO QUEBRA: pending ativo (série nova) → materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate({ status: 'pending', series_ended_at: null }), true);
});

// --- FAIL-OPEN (trava C): coluna ausente (undefined) NUNCA bloqueia ---
// Se o SELECT não trouxe series_ended_at, o campo vem undefined → materializa (preserva
// comportamento, evita ressurreição-por-omissão). Só series_ended_at EXPLÍCITO bloqueia.
test('fail-open: objeto sem series_ended_at (coluna não veio no SELECT) → materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate({ id: 'x', recurrence_rule: 'FREQ=DAILY' }), true);
});
test('fail-open: template null/undefined → materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate(null), true);
  assert.strictEqual(shouldMaterializeTemplate(undefined), true);
});
