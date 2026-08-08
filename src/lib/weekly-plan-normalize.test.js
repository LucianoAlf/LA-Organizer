'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalizeWeeklyPlan } = require('./weekly-plan-normalize');

// Fixtures REAIS: os dois payloads que o Quintela perdeu em 03/08, copiados de
// marker_logs.raw_excerpt (marker_type=WEEKLY_PLAN, result=rejected, reason=schema_invalid).

test('caso Quintela 21:13 — forma "items[{day,title}]" vira goals + distribution', () => {
  const real = {
    week_start: '2026-08-03',
    items: [
      { day: '2026-08-03', title: 'Planejamento semanal', status: 'done' },
      { day: '2026-08-04', title: 'Revisar inventário das unidades' },
      { day: '2026-08-05', title: 'Revisar atualização dos alunos de Musicalização' },
      { day: '2026-08-06', title: 'Revisar gerador de relatórios' },
      { day: '2026-08-06', title: 'Jornada do Aluno' },
      { day: '2026-08-06', title: 'LA educa' },
    ],
  };
  const out = normalizeWeeklyPlan(real);
  assert.ok(out, 'não pode devolver null — o plano estava todo ali');
  assert.strictEqual(out.week_start, '2026-08-03');
  assert.strictEqual(out.distribution.length, 4, 'quatro dias distintos');
  // quinta juntou os três itens do mesmo dia
  const quinta = out.distribution.find((d) => d.day === '2026-08-06');
  assert.deepStrictEqual(quinta.items,
    ['Revisar gerador de relatórios', 'Jornada do Aluno', 'LA educa']);
  // 6 itens distintos, mas o schema limita goals a 5 — trunca em vez de perder o plano
  assert.strictEqual(out.goals.length, 5);
  assert.strictEqual(out.goals[0], 'Planejamento semanal');
});

test('caso Quintela 19:25 — forma "days:{monday:…}" vira goals + distribution', () => {
  const real = {
    week_start: '2026-08-03',
    days: {
      monday: 'Planejamento semanal',
      tuesday: 'Revisar inventário',
      wednesday: 'Revisar atualização alunos de Musicalização',
      thursday: 'Revisar gerador de relatórios',
      friday: 'buffer',
    },
  };
  const out = normalizeWeeklyPlan(real);
  assert.ok(out);
  assert.strictEqual(out.distribution.length, 5);
  assert.deepStrictEqual(out.distribution[0], { day: '2026-08-03', items: ['Planejamento semanal'] });
  assert.deepStrictEqual(out.distribution[4], { day: '2026-08-07', items: ['buffer'] });
});

test('nome de dia em português e array de itens no mesmo dia', () => {
  const out = normalizeWeeklyPlan({
    week_start: '2026-08-03',
    days: { 'segunda-feira': ['Item A', 'Item B'], 'quarta': 'Item C', 'sábado': 'Item D' },
  });
  assert.deepStrictEqual(out.distribution[0], { day: '2026-08-03', items: ['Item A', 'Item B'] });
  assert.deepStrictEqual(out.distribution[1], { day: '2026-08-05', items: ['Item C'] });
  assert.deepStrictEqual(out.distribution[2], { day: '2026-08-08', items: ['Item D'] });
});

test('items com nome de dia em vez de data ISO também resolve', () => {
  const out = normalizeWeeklyPlan({
    week_start: '2026-08-03',
    items: [{ day: 'terça', title: 'Entrega X' }, { day: 'sexta', title: 'Entrega Y' }],
  });
  assert.deepStrictEqual(out.distribution,
    [{ day: '2026-08-04', items: ['Entrega X'] }, { day: '2026-08-07', items: ['Entrega Y'] }]);
});

test('payload JÁ canônico passa intacto — não mexe no que funciona', () => {
  const canonico = {
    week_start: '2026-08-03',
    goals: ['A', 'B'],
    distribution: [{ day: '2026-08-03', items: ['A'] }, { day: '2026-08-04', items: ['B'] }],
  };
  assert.strictEqual(normalizeWeeklyPlan(canonico), canonico, 'devolve a MESMA referência');
});

test('goals explícito do LLM tem precedência sobre o derivado', () => {
  const out = normalizeWeeklyPlan({
    week_start: '2026-08-03',
    goals: ['Meta principal'],
    items: [{ day: '2026-08-03', title: 'Tarefa 1' }],
  });
  assert.deepStrictEqual(out.goals, ['Meta principal']);
});

test('item repetido no mesmo dia não duplica', () => {
  const out = normalizeWeeklyPlan({
    week_start: '2026-08-03',
    items: [{ day: '2026-08-03', title: 'X' }, { day: '2026-08-03', title: 'X' }],
  });
  assert.deepStrictEqual(out.distribution, [{ day: '2026-08-03', items: ['X'] }]);
});

// NÃO INVENTA DADO: sem o que derivar, devolve null e o parser rejeita como antes.
test('fail-closed: nada aproveitável → null', () => {
  for (const p of [
    null, undefined, 'texto', [],
    { items: [{ day: '2026-08-03', title: 'X' }] },              // sem week_start
    { week_start: 'ontem', items: [{ day: '2026-08-03', title: 'X' }] },
    { week_start: '2026-08-03' },                                 // sem items nem days
    { week_start: '2026-08-03', items: [] },
    { week_start: '2026-08-03', days: { naoehdia: 'X' } },        // chave que não é dia
    { week_start: '2026-08-03', items: [{ day: '2026-08-03', title: '  ' }] },
  ]) {
    assert.strictEqual(normalizeWeeklyPlan(p), null, `${JSON.stringify(p)} deveria ser null`);
  }
});
