'use strict';
// GROUPCHAT-COMPLETE-WRONG-CYCLE-STALE-TWIN (Rose 17/08). O completer do grupo resolvia por
// título + due_date ASC e pegava a ocorrência MAIS ANTIGA aberta — mas o digest ESCONDE as
// ocorrências com gêmea-concluída (dropOpenWithDoneTwin) e as retroativas. Resultado: a Rose
// confirmou a Conciliação 8641 de HOJE (17/08), o TOM fechou o ciclo velho de 17/07 (que já
// tinha gêmea concluída, cd8fbd9a) e a de hoje seguiu aberta. Fix: mirar só o pool VISÍVEL,
// espelhando o filtro do digest.
const { test } = require('node:test');
const assert = require('node:assert');

const { pickVisibleCompletionTarget } = require('./group-chat-tasks');

const T = 'Cartão 8641 (Recreio)';
// Estado real do banco às 09:31 (antes do TOM concluir errado): duas de 17/07 abertas (gêmeas de
// uma 17/07 já CONCLUÍDA), a de HOJE 17/08 aberta, e a de 17/09 futura.
function roseRows() {
  return [
    { id: '770fe95b', title: T, due_date: '2026-07-17', status: 'pending', created_ymd: '2026-06-12', is_group: false, recurrence_rule: null, recurrence_parent_id: '8b4e1c15' },
    { id: 'd07c6a6b', title: T, due_date: '2026-07-17', status: 'pending', created_ymd: '2026-06-13', is_group: false, recurrence_rule: null, recurrence_parent_id: '19a76e5b' },
    { id: 'cd8fbd9a', title: T, due_date: '2026-07-17', status: 'done',    created_ymd: '2026-06-20', is_group: false, recurrence_rule: null, recurrence_parent_id: '19a76e5b' },
    { id: '67d9884e', title: T, due_date: '2026-08-17', status: 'pending', created_ymd: '2026-07-02', is_group: false, recurrence_rule: null, recurrence_parent_id: '19a76e5b' },
    { id: 'c1704532', title: T, due_date: '2026-09-17', status: 'pending', created_ymd: '2026-08-03', is_group: false, recurrence_rule: null, recurrence_parent_id: '19a76e5b' },
  ];
}

test('caso Rose: mira a de HOJE (17/08), NÃO o ciclo velho de 17/07 com gêmea concluída', () => {
  const target = pickVisibleCompletionTarget(roseRows(), '2026-08-17');
  assert.ok(target, 'deveria achar alvo');
  assert.strictEqual(target.id, '67d9884e');
});

test('sem gêmea-concluída: pega a ocorrência aberta mais próxima (17/08), não a futura', () => {
  const rows = roseRows().filter((r) => r.status !== 'done' && !r.due_date.startsWith('2026-07'));
  const target = pickVisibleCompletionTarget(rows, '2026-08-17');
  assert.strictEqual(target.id, '67d9884e');
});

test('container de pacote (is_group) nunca é alvo de conclusão', () => {
  const rows = [
    { id: 'pkg', title: T, due_date: '2026-08-17', status: 'pending', created_ymd: '2026-08-01', is_group: true, recurrence_rule: null, recurrence_parent_id: null },
    { id: '67d9884e', title: T, due_date: '2026-08-17', status: 'pending', created_ymd: '2026-07-02', is_group: false, recurrence_rule: null, recurrence_parent_id: '19a76e5b' },
  ];
  const target = pickVisibleCompletionTarget(rows, '2026-08-17');
  assert.strictEqual(target.id, '67d9884e');
});

test('retroativa (criada depois do vencimento, já vencida) é escondida como no digest', () => {
  const rows = [
    { id: 'retro', title: T, due_date: '2026-07-01', status: 'pending', created_ymd: '2026-07-05', is_group: false, recurrence_rule: null, recurrence_parent_id: '19a76e5b' },
    { id: '67d9884e', title: T, due_date: '2026-08-17', status: 'pending', created_ymd: '2026-07-02', is_group: false, recurrence_rule: null, recurrence_parent_id: '19a76e5b' },
  ];
  const target = pickVisibleCompletionTarget(rows, '2026-08-17');
  assert.strictEqual(target.id, '67d9884e');
});

test('todas com gêmea concluída → null (falha honesta, cai no fallback)', () => {
  const rows = [
    { id: 'open', title: T, due_date: '2026-07-17', status: 'pending', created_ymd: '2026-06-12', is_group: false, recurrence_rule: null, recurrence_parent_id: '19a76e5b' },
    { id: 'twin', title: T, due_date: '2026-07-17', status: 'done',    created_ymd: '2026-06-20', is_group: false, recurrence_rule: null, recurrence_parent_id: '19a76e5b' },
  ];
  const target = pickVisibleCompletionTarget(rows, '2026-08-17');
  assert.strictEqual(target, null);
});
