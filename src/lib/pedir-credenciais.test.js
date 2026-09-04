const test = require('node:test');
const assert = require('node:assert');
const { hasPedirCredenciaisMarker, stripPedirCredenciaisMarker } = require('./pedir-credenciais');

test('hasPedirCredenciaisMarker: detecta o marker com e sem END', () => {
  assert.equal(hasPedirCredenciaisMarker('<<PEDIR_CREDENCIAIS>><<END>>'), true);
  assert.equal(hasPedirCredenciaisMarker('texto antes <<PEDIR_CREDENCIAIS>> depois'), true);
  assert.equal(hasPedirCredenciaisMarker('<<pedir_credenciais>>'), true, 'case-insensitive');
});

test('hasPedirCredenciaisMarker: não confunde com outros markers', () => {
  assert.equal(hasPedirCredenciaisMarker('<<TASK_UPDATE>>[]<<END>>'), false);
  assert.equal(hasPedirCredenciaisMarker('me manda o link da anamnese'), false);
  assert.equal(hasPedirCredenciaisMarker(''), false);
  assert.equal(hasPedirCredenciaisMarker(null), false);
});

test('stripPedirCredenciaisMarker: remove marker e normaliza espaços', () => {
  assert.equal(stripPedirCredenciaisMarker('<<PEDIR_CREDENCIAIS>><<END>>'), '');
  assert.equal(stripPedirCredenciaisMarker('oi <<PEDIR_CREDENCIAIS>><<END>> tudo bem'), 'oi  tudo bem'.replace(/\s+/g, ' ').trim());
  assert.equal(stripPedirCredenciaisMarker(null), '');
});
