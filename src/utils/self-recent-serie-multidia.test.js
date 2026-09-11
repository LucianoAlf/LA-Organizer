const { test } = require('node:test');
const assert = require('node:assert');
const { isSelfRecentConflict } = require('./self-recent-conflict');

// Caso real Ana, 10/09/2026 21:35–21:48 BRT (achado ada0545e).
// Ela pediu "Semana de provas - Faculdade, de 26/09 até 30/09" e depois
// "Marca todos os dias: 26/09 27/09 28/09 29/09 30/09".
// O LLM emitiu 5 TASK_CREATE, um por dia, cada um com due_date própria.
// marker_logs 21:37:54 — os CINCO saíram como
//   TASK_CREATE skipped self_recent_skip:existing=440fcc1b age=2min score=1.00
// contra a tarefa criada 2min antes (440fcc1b, due 2026-09-30), e cada skip
// fez okCount++ → TASK_UPDATE executed ok=5 fail=0. O TOM então disse
// "10 registros (12h e 20h pra cada dia de 26 a 30/09)" e o banco tinha UMA.
//
// Re-emit é o MESMO item emitido duas vezes. Dia diferente = item diferente.

const ANA = 'f238cfb7-54ab-43a7-93ab-3f29c636fb8c';
const WIN = 5 * 60 * 1000;
const NOW = Date.parse('2026-09-10T21:37:54-03:00');

// 440fcc1b, criada 21:35:53 BRT, due 2026-09-30
const existente = (o = {}) => ({
  created_by: ANA,
  created_at: '2026-09-10T21:35:53-03:00',
  due_date: '2026-09-30',
  ...o,
});

test('série multi-dia: candidato de OUTRO dia não é re-emit — não pode ser comido em silêncio', () => {
  for (const dia of ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29']) {
    assert.strictEqual(
      isSelfRecentConflict(existente(), ANA, NOW, WIN, dia),
      false,
      `due_date ${dia} != 2026-09-30 → item distinto, o skip silencioso perde a tarefa`,
    );
  }
});

test('CONTROLE (tem que disparar nas duas versões): mesmo dia = re-emit de verdade', () => {
  assert.strictEqual(
    isSelfRecentConflict(existente(), ANA, NOW, WIN, '2026-09-30'),
    true,
  );
});

test('CONTROLE: sem due_date de um dos lados → comportamento antigo preservado', () => {
  assert.strictEqual(isSelfRecentConflict(existente(), ANA, NOW, WIN, undefined), true);
  assert.strictEqual(isSelfRecentConflict(existente({ due_date: null }), ANA, NOW, WIN, '2026-09-26'), true);
});

test('CONTROLE: outro autor segue fora do skip mesmo com dia diferente', () => {
  assert.strictEqual(
    isSelfRecentConflict(existente({ created_by: 'outro' }), ANA, NOW, WIN, '2026-09-26'),
    false,
  );
});
