const { test } = require('node:test');
const assert = require('node:assert');
const { isSelfRecentConflict } = require('./self-recent-conflict');

// Caso real Rafinha, 17/09/2026 20:02–20:06 BRT (achado a60338c6).
// Ele mandou 4 demandas de manutenção pra Campo Grande. marker_logs 20:02:35:
//   TASK_CREATE skipped self_recent_skip:existing=0dbf3f4b age=0min score=0.99
//   raw: {"action":"create","title":"Trocar lâmpada do corredor do estúdio — Campo Grande",
//         "due_date":"2026-09-18"}
// 0dbf3f4b é "Trocar lâmpada do bistrô — Campo Grande" — OUTRA tarefa. O skip fez
// okCount++ → TASK_UPDATE executed ok=4 fail=0, e o TOM respondeu
// "✅ Confirmado — 4 demandas pra amanhã em Campo Grande" listando as quatro.
// A tabela tasks tem TRÊS. A do corredor nunca existiu.
//
// O detector é fuzzy de propósito; o predicado de re-emit não pode ser. Re-emit é o
// MESMO item emitido duas vezes — título distinto é item distinto, e a dúvida vira
// menu (recuperável), nunca silêncio (irrecuperável).
//
// População medida em 18/09 sobre a história inteira de self_recent_skip (39 skips,
// 10/07→17/09): 18 têm título idêntico (skip correto), 8 já caem no guard de due_date
// de 11/09, e 12 comeram tarefa de título distinto. Estes 12 passam a virar menu.

const RAFINHA = 'c9e72a40-3f91-4be8-bc6c-0e4060f7fc84';
const WIN = 5 * 60 * 1000;
const NOW = Date.parse('2026-09-17T20:02:35-03:00');

// 0dbf3f4b, criada 20:02:34 BRT, due 2026-09-18
const bistro = (o = {}) => ({
  created_by: RAFINHA,
  created_at: '2026-09-17T20:02:34-03:00',
  due_date: '2026-09-18',
  title: 'Trocar lâmpada do bistrô — Campo Grande',
  ...o,
});

test('título distinto não é re-emit: a 4ª lâmpada do Rafinha não pode ser comida em silêncio', () => {
  assert.strictEqual(
    isSelfRecentConflict(bistro(), RAFINHA, NOW, WIN, '2026-09-18',
      'Trocar lâmpada do corredor do estúdio — Campo Grande'),
    false,
  );
});

test('outros títulos distintos da população medida também deixam de ser comidos', () => {
  const casos = [
    ['Arrumar agenda', 'Arrumar valores'],
    ['Receber Thaisi', 'Receber Garden'],
    ['Atualizar Emusys professores', 'Atualizar Emusys pessoal'],
    ['Trocar lâmpada recepção — Campo Grande', 'Trocar lâmpada bistrô — Campo Grande'],
    ['Falar com Leo sobre situação do Aluno Eric do Matheus Reis',
      'Pedir auxílio ao Peterson sobre condução da aula do Matheus Reis — Barra'],
  ];
  for (const [existente, candidato] of casos) {
    assert.strictEqual(
      isSelfRecentConflict(bistro({ title: existente }), RAFINHA, NOW, WIN, '2026-09-18', candidato),
      false,
      `deveria recusar re-emit: "${existente}" vs "${candidato}"`,
    );
  }
});

test('CONTROLE — re-emit de verdade (título idêntico) segue silenciado', () => {
  assert.strictEqual(
    isSelfRecentConflict(bistro(), RAFINHA, NOW, WIN, '2026-09-18',
      'Trocar lâmpada do bistrô — Campo Grande'),
    true,
  );
});

test('CONTROLE — título idêntico a menos de acento/caixa/pontuação ainda é re-emit', () => {
  assert.strictEqual(
    isSelfRecentConflict(bistro(), RAFINHA, NOW, WIN, '2026-09-18',
      'trocar lampada do bistro - campo grande'),
    true,
  );
});

test('CONTROLE — sem título dos dois lados, o predicado não muda de veredito', () => {
  assert.strictEqual(
    isSelfRecentConflict(bistro({ title: null }), RAFINHA, NOW, WIN, '2026-09-18'),
    true,
  );
});
