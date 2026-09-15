'use strict';
// PROMESSA-GUARD-APAGA-A-FRASE-ERRADA (Juliana 14/09 19:23 BRT — achado e1ad051e).
const { test } = require('node:test');
const assert = require('node:assert');
const { downgradeEmptyPromise, PROMISE_NOMARKER_DISCLAIMER, PROMISE_FALHOU_DISCLAIMER } = require('./promise-honesty');

// A fala REAL do TOM. O guard apagou a oferta inofensiva (a última frase) e deixou a promessa falsa.
const REAL = 'Entendido! Projeto ativo e em andamento — divulgação é parte da jornada. Vou parar de cobrar por enquanto. Quando quiser registrar algum avanço ou prazo, é só me dizer.';

test('Juliana: sai a promessa falsa ("vou parar de cobrar"), fica a oferta, e a nota não inventa "problema técnico"', () => {
  const r = downgradeEmptyPromise(REAL, {});
  assert.strictEqual(r.fired, true);
  assert.ok(!/parar de cobrar/.test(r.reply), 'a promessa sem executor continua na resposta');
  assert.ok(r.reply.includes('Quando quiser registrar algum avanço ou prazo, é só me dizer.'), 'a oferta inofensiva foi apagada');
  assert.ok(r.reply.endsWith(PROMISE_NOMARKER_DISCLAIMER));
  assert.ok(!/problema técnico/.test(r.reply), 'sem marcador tentado não houve problema técnico nenhum');
});

test('a nota separa "não foi feito" de "tentei e deu erro"', () => {
  assert.match(PROMISE_NOMARKER_DISCLAIMER, /não foi feito/);
  assert.ok(!/problema técnico/.test(PROMISE_NOMARKER_DISCLAIMER));
  assert.match(PROMISE_FALHOU_DISCLAIMER, /problema técnico/);
  const r = downgradeEmptyPromise('Vou parar de cobrar por enquanto.', { markerAttempted: true });
  assert.strictEqual(r.reply, PROMISE_FALHOU_DISCLAIMER);
});

test('oferta condicional "quando quiser…, é só me dizer" não é promessa', () => {
  assert.strictEqual(downgradeEmptyPromise('Quando quiser registrar algum avanço ou prazo, é só me dizer.', {}).fired, false);
  assert.strictEqual(downgradeEmptyPromise('Se precisar anotar mais alguma coisa, é só me falar.', {}).fired, false);
});

test('o veto é por FRASE: a oferta ao lado não protege a promessa da mesma linha', () => {
  const r = downgradeEmptyPromise('Vou parar de cobrar por enquanto. Se precisar, é só me chamar.', {});
  assert.strictEqual(r.fired, true);
  assert.ok(!/parar de cobrar/.test(r.reply));
  assert.ok(r.reply.startsWith('Se precisar, é só me chamar.'));
});

test('"paro de te cobrar" e "vou parar de cobrar" são promessa; "não vou parar de cobrar" não', () => {
  assert.strictEqual(downgradeEmptyPromise('Beleza, paro de te cobrar essa.', {}).fired, true);
  assert.strictEqual(downgradeEmptyPromise('Combinado, não vou parar de cobrar essa.', {}).fired, false);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: o guard recebe se houve marcador tentado (é o que escolhe a nota)', () => {
  assert.ok(ENG.includes('downgradeEmptyPromise(reply, { markerAttempted: !!_metrics.marker_attempted })'));
  assert.ok(ENG.includes('downgradeEmptyPromise(reply, { restatesRecentWrite: true, markerAttempted: !!_metrics.marker_attempted })'));
});
