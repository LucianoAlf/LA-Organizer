'use strict';
// Achado 3b33aa68 (Matheus 28/09 11:35 BRT): a trava colou "não consegui registrar" na resposta
// CERTA de quem pediu pra deixar as contas em aberto. Falas reais (marker_logs.raw_excerpt).
const test = require('node:test');
const assert = require('node:assert');
const { pedidoDeNadaARegistrar } = require('./nada-a-registrar');
const { enforceNoMarkerHonesty, NO_MARKER_HONEST_NOTE } = require('./optimistic-confirm');

const U1 = 'nao nao .. perdao, achei que fossem contas do mes 09. deixa tudo em aberto ainda';
const R1 = 'Show, sem problema. Fica tudo em aberto mesmo, nenhuma foi marcada como paga.\n\nQualquer uma delas vencendo eu te aviso de novo. 👍';
const U2 = 'as contas ainda estao abertos, nao marcar como pago';
const R2 = 'Beleza, Matheus, fica tudo como tá — nada marcado como pago, contas em aberto. 👍';

const trava = (u, r, extra = {}) => enforceNoMarkerHonesty(r, {
  nothingPersisted: true, markerAttempted: false, reportedState: pedidoDeNadaARegistrar(u, r), ...extra,
}, { meta: true });

test('turno real 11:35:17 — "deixa tudo em aberto" + "nenhuma foi marcada como paga" passa intacto', () => {
  assert.strictEqual(pedidoDeNadaARegistrar(U1, R1), true);
  const h = trava(U1, R1);
  assert.strictEqual(h.fired, false);
  assert.strictEqual(h.reply, R1);
});

test('turno real 11:35:46 — "nao marcar como pago" + "nada marcado como pago" passa intacto', () => {
  assert.strictEqual(pedidoDeNadaARegistrar(U2, R2), true);
  assert.strictEqual(trava(U2, R2).fired, false);
});

test('prova de que o veto é o que muda: sem ele, a trava dispara nas duas falas reais', () => {
  for (const r of [R1, R2]) {
    const h = enforceNoMarkerHonesty(r, { nothingPersisted: true }, { meta: true });
    assert.strictEqual(h.fired, true);
    assert.ok(h.reply.includes(NO_MARKER_HONEST_NOTE));
  }
});

test('controle: TOM em 1ª pessoa de escrita segue pego mesmo com pedido de não marcar', () => {
  assert.strictEqual(pedidoDeNadaARegistrar(U1, '✅ Marquei as 4 como pagas'), false);
  assert.strictEqual(trava(U1, '✅ Marquei as 4 como pagas').fired, true);
});

test('controle: afirmação sem negação ("tudo marcado como pago") segue pega', () => {
  assert.strictEqual(pedidoDeNadaARegistrar(U2, '✅ Tudo marcado como pago'), false);
});

test('controle: a pessoa PEDIU escrita — não libera', () => {
  assert.strictEqual(pedidoDeNadaARegistrar('marca como pago', R1), false);
  assert.strictEqual(pedidoDeNadaARegistrar('tudo pago !', R1), false);
  assert.strictEqual(pedidoDeNadaARegistrar('nao marca a 1, marca a 2 como paga', 'Fica tudo em aberto, nenhuma foi marcada como paga'), false);
});

test('controle: linha negada ao lado de linha que AFIRMA escrita — não libera', () => {
  const r = 'Nenhuma foi marcada como paga.\n✅ Tarefa criada pra conferir amanhã';
  assert.strictEqual(pedidoDeNadaARegistrar(U1, r), false);
});

test('controle: marker tentado-e-rejeitado continua freando (markerAttempted)', () => {
  assert.strictEqual(trava(U1, R1, { markerAttempted: true }).fired, true);
});

// ── ligação (âncora de código) ────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
test('1:1: ligado na porta reportedState com a fala DA PESSOA; optimistic-confirm.js intocado', () => {
  const engine = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  assert.match(engine, /\|\| pedidoDeNadaARegistrar\(stripReplyScaffold\(String\(text \|\| ''\)\)\.userText, reply\),\n/);
  assert.match(engine, /require\('\.\/lib\/nada-a-registrar'\)/);
  assert.ok(!fs.readFileSync(path.join(__dirname, 'optimistic-confirm.js'), 'utf8').includes('nada-a-registrar'));
});
