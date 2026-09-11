'use strict';
// CANCELAR-O-QUE-ACABOU-DE-FECHAR (triagem 11/09 — 8500f1dd, e74b37dd).
const { test } = require('node:test');
const assert = require('node:assert');
const { decidirCancelamentoDeFechada } = require('./cancelamento-repetido');

const AGORA = Date.parse('2026-07-13T12:06:51Z');

test('Ana 13/07: cancelada 31s antes → já cancelada (ok, sem falhar)', () => {
  assert.strictEqual(decidirCancelamentoDeFechada({ status: 'cancelled', updated_at: '2026-07-13T12:06:20Z' }, AGORA), 'ja_cancelada');
});
test('Ana Paula 17/08: concluída por engano 3 min antes → cancela a concluída', () => {
  const agora = Date.parse('2026-08-17T12:04:57Z');
  assert.strictEqual(decidirCancelamentoDeFechada({ status: 'done', updated_at: '2026-08-17T12:01:31Z' }, agora), 'cancelar_concluida');
});
test('fora da janela, aberta, sem data ou sem tarefa → não decide (segue o "não achei")', () => {
  assert.strictEqual(decidirCancelamentoDeFechada({ status: 'done', updated_at: '2026-07-13T11:30:00Z' }, AGORA), null);
  assert.strictEqual(decidirCancelamentoDeFechada({ status: 'pending', updated_at: '2026-07-13T12:06:20Z' }, AGORA), null);
  assert.strictEqual(decidirCancelamentoDeFechada({ status: 'cancelled', updated_at: null }, AGORA), null);
  assert.strictEqual(decidirCancelamentoDeFechada(null, AGORA), null);
});

// Ligação no engine (catraca de fonte): o helper só protege se o executor de cancel usar.
const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: cancel por título consulta a tarefa fechada há minutos antes de dizer "não achei"', () => {
  assert.match(ENG, /const _dec = decidirCancelamentoDeFechada\(_recT, Date\.now\(\)\);/);
  assert.match(ENG, /if \(_dec === 'ja_cancelada'\) \{[\s\S]{0,200}okCount\+\+;/);
});
test('engine: cancel por id de tarefa já cancelada é ok e não re-notifica quem criou', () => {
  assert.match(ENG, /if \(tCan\.status === 'cancelled'\) \{[\s\S]{0,200}okCount\+\+;\s*continue;/);
});
