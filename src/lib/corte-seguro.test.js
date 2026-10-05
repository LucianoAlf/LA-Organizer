'use strict';
// PERFIL-400-EMOJI-PARTIDO (05/10, caso Juliana). "[Dream] updateProfile err for Juliana: 400 Invalid
// body: failed to parse JSON value" em 03, 04 e 05/10. O updateCollaboratorProfile corta cada
// mensagem em 200 unidades UTF-16 (`.slice(0, 200)`); quando a 200ª cai no MEIO de um emoji sobra
// meio par de surrogates, o JSON.stringify do SDK escreve "\ud83d" solto e a OpenAI recusa o corpo.
// Reprodução read-only com as mensagens reais dela: 1 msg partida em 03/10, 3 em 04/10 e 05/10;
// com texto sintético, "bom dia 😀".slice(0, 9) → 400 e .slice(0, 8) → ok. Não é só a Juliana: o
// rituals.log tem o mesmo 400 pra Vitoria, John, Quintela, Duda, Vitoria Andrade e [QA] Replay 01.
const { test } = require('node:test');
const assert = require('node:assert');
const { cortarSemPartir } = require('./corte-seguro');

const SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test('corte que cairia no meio do emoji recua um código (não deixa surrogate solto)', () => {
  const msg = 'a'.repeat(199) + '😀 resto';
  assert.ok(SOLTO.test(msg.slice(0, 200)), 'premissa: o slice cru parte o emoji');
  const c = cortarSemPartir(msg, 200);
  assert.strictEqual(SOLTO.test(c), false);
  assert.strictEqual(c, 'a'.repeat(199));
  assert.doesNotMatch(JSON.stringify(c), /\\ud83d/i, 'o corpo que vai pro provedor fica JSON válido pra eles');
});

test('corte que não parte nada é idêntico ao slice (sem mudar o que já funcionava)', () => {
  for (const s of ['bom dia', 'a'.repeat(500), 'ok 😀 fim', '😀😀😀']) {
    for (const n of [0, 1, 2, 4, 6, 200]) {
      const cru = s.slice(0, n);
      if (!SOLTO.test(cru)) assert.strictEqual(cortarSemPartir(s, n), cru, `${s}/${n}`);
    }
  }
});

test('surrogate solto que JÁ veio no texto (gravado partido) também sai', () => {
  assert.strictEqual(cortarSemPartir('x\uD83Dy', 10), 'xy');
  assert.strictEqual(cortarSemPartir('\uDE00z', 10), 'z');
});

test('entrada nula/numérica não quebra', () => {
  assert.strictEqual(cortarSemPartir(null, 10), '');
  assert.strictEqual(cortarSemPartir(12345, 3), '123');
});

test('updateCollaboratorProfile corta pelo helper (os dois cortes: 200 por msg e 8000 no bloco)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'engine.js'), 'utf8');
  const ini = src.indexOf('async function updateCollaboratorProfile');
  const corpo = src.slice(ini, src.indexOf('\nasync function ', ini + 10));
  assert.match(corpo, /cortarSemPartir\(String\(m\.content \|\| ''\), 200\)/);
  assert.match(corpo, /cortarSemPartir\([^;]*8000\)/);
  assert.doesNotMatch(corpo, /\.slice\(0, 200\)/);
});

test('a consolidação semanal também corta sem partir emoji', () => {
  const E = require('fs').readFileSync(require('path').join(__dirname, '..', 'engine.js'), 'utf8');
  const i = E.indexOf('const historyText = _cortarC(');
  assert.ok(i > 0, 'consolidação voltou a usar slice cru');
});
