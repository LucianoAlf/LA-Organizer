const { test } = require('node:test');
const assert = require('node:assert');
const { isSelfRecentConflict, buildSelfRecentSkipReason } = require('./self-recent-conflict');

const NOW = Date.parse('2026-07-07T13:00:00-03:00');
const WIN = 5 * 60 * 1000; // 5 min
const ME = 'collab-ana';

function conflict(overrides = {}) {
  return { created_by: ME, created_at: '2026-07-07T12:58:00-03:00', ...overrides };
}

test('mesmo autor + criado há 2min → auto-conflito recente (silencia)', () => {
  assert.strictEqual(isSelfRecentConflict(conflict(), ME, NOW, WIN), true);
});

test('autor DIFERENTE (tarefa delegada a mim por outro) → NÃO silencia', () => {
  assert.strictEqual(isSelfRecentConflict(conflict({ created_by: 'outro' }), ME, NOW, WIN), false);
});

test('mesmo autor mas criado há 10min (fora da janela) → NÃO silencia', () => {
  assert.strictEqual(isSelfRecentConflict(conflict({ created_at: '2026-07-07T12:50:00-03:00' }), ME, NOW, WIN), false);
});

test('exatamente no limite da janela → silencia (<=)', () => {
  assert.strictEqual(isSelfRecentConflict(conflict({ created_at: '2026-07-07T12:55:00-03:00' }), ME, NOW, WIN), true);
});

test('created_at no futuro (clock skew) → NÃO silencia (age<0)', () => {
  assert.strictEqual(isSelfRecentConflict(conflict({ created_at: '2026-07-07T13:05:00-03:00' }), ME, NOW, WIN), false);
});

test('sem created_at / created_at inválido → NÃO silencia', () => {
  assert.strictEqual(isSelfRecentConflict(conflict({ created_at: null }), ME, NOW, WIN), false);
  assert.strictEqual(isSelfRecentConflict(conflict({ created_at: 'lixo' }), ME, NOW, WIN), false);
});

test('conflict/requester nulos → NÃO silencia', () => {
  assert.strictEqual(isSelfRecentConflict(null, ME, NOW, WIN), false);
  assert.strictEqual(isSelfRecentConflict(conflict(), null, NOW, WIN), false);
});

// --- buildSelfRecentSkipReason: reason auditável pra marker_logs (audit 08/07, catraca) ---
// Formato exigido: self_recent_skip:existing=<8hex> age=<Nmin> score=<X.XX>

test('reason no formato exigido (8hex + Nmin + X.XX)', () => {
  assert.strictEqual(
    buildSelfRecentSkipReason({ existingId: 'abcdef1234567890', ageMs: 120000, score: 0.97 }),
    'self_recent_skip:existing=abcdef12 age=2min score=0.97'
  );
});

test('id longo é truncado em 8 hex; score sempre 2 casas', () => {
  assert.strictEqual(
    buildSelfRecentSkipReason({ existingId: 'e3dcc969-1111-2222-3333-444455556666', ageMs: 0, score: 0.9 }),
    'self_recent_skip:existing=e3dcc969 age=0min score=0.90'
  );
});

test('age arredonda pro minuto mais próximo (segundos → 0/1min)', () => {
  assert.strictEqual(buildSelfRecentSkipReason({ existingId: 'aa', ageMs: 5000, score: 1 }),
    'self_recent_skip:existing=aa age=0min score=1.00');
  assert.strictEqual(buildSelfRecentSkipReason({ existingId: 'aa', ageMs: 59000, score: 1 }),
    'self_recent_skip:existing=aa age=1min score=1.00');
});

test('score ausente/inválido → "na" (não quebra, auditável)', () => {
  assert.strictEqual(buildSelfRecentSkipReason({ existingId: 'aa', ageMs: 60000 }),
    'self_recent_skip:existing=aa age=1min score=na');
  assert.strictEqual(buildSelfRecentSkipReason({ existingId: 'aa', ageMs: 60000, score: NaN }),
    'self_recent_skip:existing=aa age=1min score=na');
});

test('existingId ausente → "unknown"; ageMs ausente → 0min; sem args não quebra', () => {
  assert.strictEqual(buildSelfRecentSkipReason({ ageMs: 60000, score: 0.5 }),
    'self_recent_skip:existing=unknown age=1min score=0.50');
  assert.strictEqual(buildSelfRecentSkipReason({ existingId: 'aa', score: 0.5 }),
    'self_recent_skip:existing=aa age=0min score=0.50');
  assert.strictEqual(buildSelfRecentSkipReason(),
    'self_recent_skip:existing=unknown age=0min score=na');
});

test('ageMs negativo (clock skew) → clamp em 0min', () => {
  assert.strictEqual(buildSelfRecentSkipReason({ existingId: 'aa', ageMs: -5000, score: 0.88 }),
    'self_recent_skip:existing=aa age=0min score=0.88');
});
