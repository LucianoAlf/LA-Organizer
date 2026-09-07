'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { marcadorDeConfirmacao } = require('./confirm-marker');

// O caso real: 6 pedidas, 6 fechadas às 19:42:59 de 02/09, e nenhuma linha em marker_logs.
// O auditor leu o último "rejected all_failed:6" das tentativas do LLM e chamou de confabulação.
test('lote inteiro fechado sai como executed, no mesmo dialeto do applyTaskActions', () => {
  assert.deepStrictEqual(marcadorDeConfirmacao({ tipo: 'task', ok: 6, total: 6, via: 'confirm_batch' }), {
    marker_type: 'TASK_UPDATE', result: 'executed', reason: 'ok=6 fail=0 confirm_batch',
    raw_excerpt: null,
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
    raw_excerpt: null,
  });
});

test('âncora de EVENTO grava EVENT_UPDATE, não TASK_UPDATE', () => {
  const m = marcadorDeConfirmacao({ tipo: 'event', ok: 1, total: 1, via: 'confirm_anchored' });
  assert.strictEqual(m.marker_type, 'EVENT_UPDATE');
  assert.strictEqual(m.reason, 'ok=1 fail=0 confirm_anchored');
});

test('complete ancorado de tarefa: ok=1 fail=0', () => {
  const m = marcadorDeConfirmacao({ tipo: 'task', ok: 1, total: 1, via: 'confirm_anchored' });
  assert.deepStrictEqual(m, { marker_type: 'TASK_UPDATE', result: 'executed', reason: 'ok=1 fail=0 confirm_anchored', raw_excerpt: null });
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

// ---------------------------------------------------------------------------
// RAW-CEGO-NO-GRUPO (medido 07/09). O caminho 1:1 grava `{actions, fails}` no raw desde 08/07;
// o de GRUPO nunca ganhou. As duas rejeicoes mais recentes do acervo — 04/09 e 07/09, ambas
// `all_failed:N grupo` — tem raw NULL, e uma delas e o incidente da Krissya: quando fui
// investigar, o banco nao tinha nada e a diagnose saiu de garimpo em log de motor.
//
// O grupo tem informacao MELHOR que o 1:1 e a jogava fora: `failed:[{action, why}]` traz
// codigo legivel por maquina, enquanto no 1:1 o `fails` e prosa para o usuario.
// ---------------------------------------------------------------------------

test('sem falhas o raw e null — nao inventa objeto vazio', () => {
  const m = marcadorDeConfirmacao({ tipo: 'task', ok: 3, total: 3, via: 'grupo' });
  assert.strictEqual(m.raw_excerpt, null,
    'raw vazio seria indistinguivel de "falhou e nao sei por que" — que e o bug que isto conserta');
});

test('com falhas o raw carrega a acao E o motivo (caso Krissya, 07/09)', () => {
  const m = marcadorDeConfirmacao({
    tipo: 'task', ok: 0, total: 1, via: 'grupo',
    falhas: [{ action: { action: 'reschedule', title: 'Arthur — anotar no campo Instagram' }, why: 'not_found_in_pool' }],
  });
  assert.strictEqual(m.result, 'rejected');
  assert.strictEqual(m.reason, 'all_failed:1 grupo');
  const raw = JSON.parse(m.raw_excerpt);
  assert.deepStrictEqual(raw.fails, ['not_found_in_pool']);
  assert.strictEqual(raw.actions[0].action, 'reschedule');
  assert.match(raw.actions[0].title, /Instagram/);
});

test('o raw e truncado — payload gigante nao pode derrubar o registro', () => {
  const muitas = Array.from({ length: 60 }, (_, i) => ({
    action: { action: 'complete', title: 'Tarefa muito comprida numero ' + i + ' com texto de sobra' },
    why: 'not_found_in_pool',
  }));
  const m = marcadorDeConfirmacao({ tipo: 'task', ok: 0, total: 60, via: 'grupo', falhas: muitas });
  assert.ok(m.raw_excerpt.length <= 500, `raw passou de 500: ${m.raw_excerpt.length}`);
});

test('falha na serializacao nao derruba o marcador (raw e enriquecimento, nao requisito)', () => {
  const circular = { action: {}, why: `x` };
  circular.action.self = circular;   // JSON.stringify lanca
  const m = marcadorDeConfirmacao({ tipo: 'task', ok: 0, total: 1, via: 'grupo', falhas: [circular] });
  assert.strictEqual(m.result, 'rejected');
  assert.strictEqual(m.reason, 'all_failed:1 grupo');
  assert.strictEqual(m.raw_excerpt, null);
});

test('falhas sem `why` nao viram fails vazio silencioso', () => {
  const m = marcadorDeConfirmacao({ tipo: 'task', ok: 0, total: 1, via: 'grupo',
    falhas: [{ action: { action: 'cancel', title: 'X' } }] });
  const raw = JSON.parse(m.raw_excerpt);
  assert.deepStrictEqual(raw.fails, [], 'sem why, o slot fica vazio — mas a ACAO tem que sobrar');
  assert.strictEqual(raw.actions.length, 1);
});
