'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { matchPoolByPhrase, pickVisibleInstance, pickInstanceTarget } = require('./group-chat-tasks');

// GROUPCHAT-FALLBACK-VISIBILITY (Rose 25/08): o fallback por FRASE/LABEL pegava a ocorrência mais
// ANTIGA aberta — inclusive um ciclo velho já com GÊMEA concluída (que o digest esconde). O TOM
// fechou a 25/07 done-twin'd em vez da 25/08 que a Rose fez. Fix: fallback funila no pickVisibleInstance.

const T = 'Cartão 1074 (Kids CG)';
const mk = (id, due, status) => ({
  id, title: T, due_date: due, status,
  is_group: false, recurrence_rule: null, recurrence_parent_id: 'tpl-1074',
  is_recurrence_template: false, created_ymd: '2026-06-10',
});

test('FIX Rose 25/08: label composto → pega 25/08, NÃO a 25/07 done-twin', () => {
  const rows = [
    mk('jul-done-1', '2026-07-25', 'done'),
    mk('jul-done-2', '2026-07-25', 'done'),
    mk('jul-open', '2026-07-25', 'pending'),   // gêmea aberta do ciclo velho (o bug pegava ESTA)
    mk('aug-open', '2026-08-25', 'pending'),   // o ciclo corrente que a Rose fez
    mk('sep-open', '2026-09-25', 'pending'),
  ];
  const matched = matchPoolByPhrase(rows, 'Conciliação de Cartões: Cartão 1074 (Kids CG) (Rose)');
  const target = pickVisibleInstance(matched, '2026-08-25');
  assert.equal(target && target.id, 'aug-open');
});

test('pickVisibleInstance esconde a gêmea-concluída e mira o corrente', () => {
  const rows = [
    mk('jul-done', '2026-07-25', 'done'),
    mk('jul-open', '2026-07-25', 'pending'),
    mk('aug-open', '2026-08-25', 'pending'),
  ];
  assert.equal(pickVisibleInstance(rows, '2026-08-25').id, 'aug-open');
});

test('sem gêmea concluída (backlog real) → pega a mais antiga aberta (inalterado)', () => {
  const rows = [
    mk('jul-open', '2026-07-25', 'pending'),
    mk('aug-open', '2026-08-25', 'pending'),
  ];
  assert.equal(pickVisibleInstance(rows, '2026-08-25').id, 'jul-open');
});

test('matchPoolByPhrase prefere a FILHA (mais específica) ao container', () => {
  const rows = [
    { id: 'pkg', title: 'Conciliação de Cartões', due_date: '2026-08-29', status: 'pending', is_group: true, recurrence_rule: null, recurrence_parent_id: null, is_recurrence_template: false, created_ymd: '2026-06-10' },
    mk('aug-open', '2026-08-25', 'pending'),
  ];
  const matched = matchPoolByPhrase(rows, 'Conciliação de Cartões: Cartão 1074 (Kids CG) (Rose)');
  assert.equal(matched[0] && matched[0].id, 'aug-open');
});

test('lista vazia / lixo não quebra', () => {
  assert.equal(pickVisibleInstance([], '2026-08-25'), null);
  assert.equal(pickVisibleInstance(null, '2026-08-25'), null);
  assert.equal(pickInstanceTarget([]), null);
});
