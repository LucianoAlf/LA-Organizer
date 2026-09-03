'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { marcadorDeConfirmacao } = require('./confirm-marker');

// O caso real: 6 pedidas, 6 fechadas às 19:42:59 de 02/09, e nenhuma linha em marker_logs.
// O auditor leu o último "rejected all_failed:6" das tentativas do LLM e chamou de confabulação.
test('lote inteiro fechado sai como executed, no mesmo dialeto do applyTaskActions', () => {
  assert.deepStrictEqual(marcadorDeConfirmacao({ tipo: 'task', ok: 6, total: 6, via: 'confirm_batch' }), {
    marker_type: 'TASK_UPDATE', result: 'executed', reason: 'ok=6 fail=0 confirm_batch',
  });
});

// Parcial é ação BOA com número menor — não é mentira inteira. Era isso que faltava o auditor ver.
test('lote parcial é executed e o número diz o resto', () => {
  const m = marcadorDeConfirmacao({ tipo: 'task', ok: 4, total: 6, via: 'confirm_batch' });
  assert.strictEqual(m.result, 'executed');
  assert.strictEqual(m.reason, 'ok=4 fail=2 confirm_batch');
});

test('nada fechado (short-id stale) vira rejected e PARA DE SUMIR', () => {
  assert.deepStrictEqual(marcadorDeConfirmacao({ tipo: 'task', ok: 0, total: 6, via: 'confirm_batch' }), {
    marker_type: 'TASK_UPDATE', result: 'rejected', reason: 'all_failed:6 confirm_batch',
  });
});

test('âncora de EVENTO grava EVENT_UPDATE, não TASK_UPDATE', () => {
  const m = marcadorDeConfirmacao({ tipo: 'event', ok: 1, total: 1, via: 'confirm_anchored' });
  assert.strictEqual(m.marker_type, 'EVENT_UPDATE');
  assert.strictEqual(m.reason, 'ok=1 fail=0 confirm_anchored');
});

test('complete ancorado de tarefa: ok=1 fail=0', () => {
  const m = marcadorDeConfirmacao({ tipo: 'task', ok: 1, total: 1, via: 'confirm_anchored' });
  assert.deepStrictEqual(m, { marker_type: 'TASK_UPDATE', result: 'executed', reason: 'ok=1 fail=0 confirm_anchored' });
});

test('sem via, o reason não fica com espaço solto', () => {
  assert.strictEqual(marcadorDeConfirmacao({ tipo: 'task', ok: 1, total: 1 }).reason, 'ok=1 fail=0');
  assert.strictEqual(marcadorDeConfirmacao({ tipo: 'task', ok: 0, total: 0 }).reason, 'all_failed:1');
});

test('entrada suja não quebra nem inventa número', () => {
  const m = marcadorDeConfirmacao({ tipo: 'task', ok: null, total: undefined, via: 'x' });
  assert.strictEqual(m.result, 'rejected');
  assert.strictEqual(m.reason, 'all_failed:1 x');
  // total menor que ok não pode virar fail negativo
  assert.strictEqual(marcadorDeConfirmacao({ tipo: 'task', ok: 3, total: 1 }).reason, 'ok=3 fail=0');
});
