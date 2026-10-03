'use strict';

// COORD-HONESTY-NEGA-ENVIO-DO-PROPRIO-ENGINE (Rafinha 02/10 16:18:05 BRT)
//
// Terceira porta da família do veto cego (Leo 05/08: envio em turn anterior; Rafinha 04/09:
// devolutiva por outro canal). Aqui o envio foi feito pelo PRÓPRIO engine, no mesmo turno:
// a Rafinha relatou um piano com defeito, o INVENTORY_ACTION maintenance abriu o pedido
// MANUT-E6D5, mandou o card pro Luciano (16:18:03) e anexou a linha determinística
// "🔧 Pedido enviado para *Luciano Alf* aprovar. Você será avisado." Dois segundos depois o
// guard de recado (claimsSent, sem coordination_requests na janela) trocou a resposta INTEIRA
// por "eu ainda NÃO avisei ninguém — nenhuma mensagem chegou a ser enviada". O Luciano
// respondeu "Aprova" às 16:20:39 — o envio era real.
//
// A raiz não é falta de mais um ledger: o guard existe para fala do LLM, e estava julgando
// texto que o engine escreve DEPOIS de enviar. Quem escreve a linha sabe que enviou; o veto
// passa a ler isso (_metrics.envio_deterministico → canal engine_turno).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  enforceSendHonesty,
  recentlySentFrom,
  lineIsSendClaim,
  SEND_NOMARKER_DISCLAIMER,
} = require('./lib/coord-send-honesty');

// raw_excerpt de marker_logs CHOKEPOINT confab:coordination:nosend, 02/10 16:18:04 BRT.
const ORIGINAL = '🔧 Pedido enviado para *Luciano Alf* aprovar. Você será avisado.';
// conversation_history outbound 02/10 16:18:05 BRT — o que a Rafinha recebeu.
const ENTREGUE = SEND_NOMARKER_DISCLAIMER;

const ENGINE = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8').split('\n');

test('ANCORA: sem o canal do engine, o guard reproduz o entregue byte a byte', () => {
  const out = enforceSendHonesty(ORIGINAL, { isQuestion: false, recentlySent: false });
  assert.strictEqual(out.fired, true);
  assert.strictEqual(out.reply, ENTREGUE);
});

test('CASO RAFINHA: com envio determinístico no turno, a linha verdadeira passa intacta', () => {
  const recentlySent = recentlySentFrom({ coordination_request: 0, task_return: 0, engine_turno: 1 });
  const out = enforceSendHonesty(ORIGINAL, { isQuestion: false, recentlySent });
  assert.strictEqual(out.fired, false);
  assert.strictEqual(out.reply, ORIGINAL);
});

test('controle: sem nenhum canal o guard segue podendo disparar', () => {
  assert.strictEqual(recentlySentFrom({ coordination_request: 0, task_return: 0, engine_turno: 0 }), false);
});

test('a evidência do guard inclui o canal engine_turno lido de _metrics', () => {
  const src = ENGINE.join('\n');
  const m = src.match(/const _sendEvidence = \{([^}]*)\}/);
  assert.ok(m, '_sendEvidence não encontrado no engine');
  assert.match(m[1], /engine_turno:\s*_metrics\.envio_deterministico/);
});

// Censo derivado do fonte: toda linha que o ENGINE anexa ao reply e que o guard leria como
// "afirmou envio" tem que registrar o envio no turno. Lista à mão envelhece (escada 24/09).
test('censo: todo template do engine que afirma envio registra _metrics.envio_deterministico', () => {
  const sites = [];
  ENGINE.forEach((l, i) => {
    const m = l.match(/\breply\s*=\s*.*?`([^`]*)`/);
    if (!m) return;
    if (!lineIsSendClaim(m[1].replace(/\$\{[^}]*\}/g, 'X'))) return;
    const janela = ENGINE.slice(Math.max(0, i - 4), i + 2).join('\n');
    sites.push({ linha: i + 1, ok: /_metrics\.envio_deterministico/.test(janela) });
  });
  assert.strictEqual(sites.length, 3, `esperava 3 templates de envio, achei ${sites.length} — decida o canal da porta nova`);
  const mudos = sites.filter((s) => !s.ok).map((s) => s.linha);
  assert.deepStrictEqual(mudos, [], `templates sem registro de envio (linhas: ${mudos.join(', ')})`);
});
