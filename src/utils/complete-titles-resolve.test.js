'use strict';
// complete-titles-resolve.test.js — Fatia 4. Resolve título→short-id pra batch_complete, FAIL-
// CLOSED: só devolve ids se TODOS os títulos resolverem 'exato'. Um ambíguo/não-achado → null.
// queryCandidatos é injetável (testa sem DB); resolveTaskTarget é o resolvedor puro real.
//
// Rodar: node --test src/utils/complete-titles-resolve.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveTitlesToBatchComplete } = require('./complete-titles-resolve');
const { resolveTaskTarget } = require('../lib/task-target');

const T = (id, title, extra = {}) => ({ id, title, due_date: '2026-08-16', ...extra });

test('todos exato → short-ids na ordem', async () => {
  const banco = {
    'Renovação': [T('aaaaaaaa-1111-2222-3333-444444444444', 'Renovação')],
    'Report': [T('bbbbbbbb-1111-2222-3333-444444444444', 'Report')],
  };
  const r = await resolveTitlesToBatchComplete({
    queryCandidatos: async (t) => banco[t] || [],
    resolveTaskTarget, titles: ['Renovação', 'Report'],
  });
  assert.deepStrictEqual(r, { ids: ['aaaaaaaa', 'bbbbbbbb'] });
});

test('um título AMBÍGUO (linhagens distintas) → null (fail-closed, não fecha errado)', async () => {
  const banco = {
    'Renovação': [T('aaaaaaaa-1111-2222-3333-444444444444', 'Renovação')],
    // duas avulsas com o mesmo nome = ambiguidade real (resolveTaskTarget → 'ambiguo')
    'Ligar': [T('cccccccc-1111-2222-3333-444444444444', 'Ligar'), T('dddddddd-1111-2222-3333-444444444444', 'Ligar')],
  };
  const r = await resolveTitlesToBatchComplete({
    queryCandidatos: async (t) => banco[t] || [],
    resolveTaskTarget, titles: ['Renovação', 'Ligar'],
  });
  assert.strictEqual(r, null);
});

test('um título NÃO-ACHADO → null (fail-closed)', async () => {
  const banco = { 'Renovação': [T('aaaaaaaa-1111-2222-3333-444444444444', 'Renovação')] };
  const r = await resolveTitlesToBatchComplete({
    queryCandidatos: async (t) => banco[t] || [],
    resolveTaskTarget, titles: ['Renovação', 'Some inexistente'],
  });
  assert.strictEqual(r, null);
});

test('mesma série (2 instâncias) → exato pelo ciclo corrente (menor due_date)', async () => {
  const banco = {
    'Presença Emusys': [
      T('eeeeeeee-1111-2222-3333-444444444444', 'Presença Emusys', { due_date: '2026-09-01', recurrence_parent_id: 'serie-1' }),
      T('ffffffff-1111-2222-3333-444444444444', 'Presença Emusys', { due_date: '2026-08-01', recurrence_parent_id: 'serie-1' }),
    ],
  };
  const r = await resolveTitlesToBatchComplete({
    queryCandidatos: async (t) => banco[t] || [],
    resolveTaskTarget, titles: ['Presença Emusys'],
  });
  assert.deepStrictEqual(r, { ids: ['ffffffff'] }, 'o ciclo corrente é o de agosto (menor due_date)');
});

test('titles vazio/ausente → null', async () => {
  for (const titles of [[], null, undefined]) {
    assert.strictEqual(await resolveTitlesToBatchComplete({ queryCandidatos: async () => [], resolveTaskTarget, titles }), null);
  }
});
