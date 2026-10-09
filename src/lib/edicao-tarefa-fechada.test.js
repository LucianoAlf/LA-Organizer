'use strict';
// TASK-UPDATE-ALVO-JA-FECHADO — o `update` dizia "Não achei a tarefa … Me diz o nome certinho?"
// sobre uma tarefa que EXISTE e só não está aberta.
//
// Caso do banco (finding 0dcfafe9, Rafinha 05/10 18:21:20 BRT):
//   marker: {"action":"update","title":"Comprar 2 pads de estudo — Barra",
//            "new_title":"Comprar 2 Pad Eva Estudo Base Madeira 12 Polegadas — Barra", ...}
//   marker_logs: TASK_UPDATE | rejected | all_failed:1
//   banco: 547edde2 "Comprar 2 pads de estudo — Barra", status done, completed_at 05/10 09:50 BRT,
//          completed_by NULL (fechada fora do marker), assigned_to = created_by = Rafinha.
// O nome estava certo. Pedir "o nome certinho" é falso e é beco: repetir dá a mesma resposta.
// Terceira porta da família (evento 21/09, complete 05/10): o resolvedor só enxerga vivos.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { escolherFechadaParaEdicao, mensagemEdicaoFechada } = require('./edicao-tarefa');

const RAFINHA = 'c9e72a40-3f91-4be8-bc6c-0e4060f7fc84';
const PADS = {
  id: '547edde2-ebb0-4170-8013-6357c47a4189', title: 'Comprar 2 pads de estudo — Barra',
  status: 'done', completed_at: '2026-10-05T12:50:44.428939+00:00', completed_by: null,
  updated_at: '2026-10-05T12:50:44.428939+00:00', assigned_to: RAFINHA, created_by: RAFINHA,
};

test('caso Rafinha: a tarefa fechada de manhã é encontrada (completed_by NULL não exclui)', () => {
  const r = escolherFechadaParaEdicao([PADS], RAFINHA);
  assert.strictEqual(r && r.id, PADS.id);
});

test('caso Rafinha: a fala diz o ESTADO e não pede "o nome certinho"', () => {
  const m = mensagemEdicaoFechada('Comprar 2 pads de estudo — Barra', PADS);
  assert.match(m, /Comprar 2 pads de estudo — Barra/);
  assert.match(m, /concluída/);
  assert.match(m, /05\/10/);
  assert.match(m, /09:50/);
  assert.doesNotMatch(m, /nome certinho|não achei/i);
});

test('cancelada diz cancelada', () => {
  const m = mensagemEdicaoFechada('X', { ...PADS, status: 'cancelled', completed_at: null });
  assert.match(m, /cancelada/);
  assert.doesNotMatch(m, /concluída/);
});

test('controle: tarefa de OUTRA pessoa não conta', () => {
  const r = escolherFechadaParaEdicao([{ ...PADS, assigned_to: 'outro', created_by: 'outro' }], RAFINHA);
  assert.strictEqual(r, null);
});

test('controle: tarefa ainda aberta não é "fechada"', () => {
  assert.strictEqual(escolherFechadaParaEdicao([{ ...PADS, status: 'pending' }], RAFINHA), null);
});

test('várias fechadas: vence a mais recente', () => {
  const velha = { ...PADS, id: 'velha', completed_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z' };
  assert.strictEqual(escolherFechadaParaEdicao([velha, PADS], RAFINHA).id, PADS.id);
});

test('a fala passa pelas portas de honestidade sem ser comida (com controle que dispara)', () => {
  const { downgradeEmptyPromise } = require('./promise-honesty');
  const { sanitizeOptimisticConfirm } = require('./optimistic-confirm');
  const m = mensagemEdicaoFechada('Comprar 2 pads de estudo — Barra', PADS);
  const d = downgradeEmptyPromise(m);
  assert.strictEqual(d.fired, false);
  assert.strictEqual(sanitizeOptimisticConfirm(m, 'failed'), m);
  // controle: verbo de conclusão em 1ª pessoa é comido
  assert.notStrictEqual(sanitizeOptimisticConfirm('Concluí a tarefa dos pads.', 'failed'), 'Concluí a tarefa dos pads.');
});

test('catraca de fonte: o not-found do `update` consulta as fechadas antes de pedir o nome', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  const i = src.indexOf("} else if (a.action === 'update') {");
  assert.ok(i > 0);
  const j = src.indexOf('pra atualizar. Me diz o nome certinho?', i);
  assert.ok(j > i);
  const trecho = src.slice(i, j);
  assert.match(trecho, /escolherFechadaParaEdicao/);
  assert.match(trecho, /mensagemEdicaoFechada/);
});
