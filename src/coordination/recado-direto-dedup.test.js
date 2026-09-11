'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// RECADO-DIRETO-DEDUP-DIZIA-MANDANDO (achado no E2E de 11/09): recado pré-confirmado barrado pelo dedup
// de 30 min saía com a fala do LLM "📨 Mandando." — afirmação de envio sobre algo que não saiu.
const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');

test('despacho direto: dedup vira "já tinha ido", nunca a fala otimista do LLM', () => {
  const bloco = ENG.slice(ENG.indexOf('const _extrasD = []'), ENG.indexOf('if (_extrasD.length && _extrasD.length === parsedCoord.items.length)'));
  assert.ok(bloco.length > 0, 'não achei o laço do despacho direto');
  assert.match(bloco, /else if \(result\.ok && result\.reason === 'dedup_recent_relay'\) _extrasD\.push\(`📨 Esse recado já tinha ido pra \*\$\{item\.recipient_name\}\* agora há pouco/);
});
