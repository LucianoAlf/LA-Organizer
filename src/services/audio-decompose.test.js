const test = require('node:test');
const assert = require('node:assert');
const { decomposeIfLarge, _setClaudeForTests } = require('./audio-decompose');

test('decomposeIfLarge — extrai lista quando texto passa do gatilho', async () => {
  _setClaudeForTests({
    chat: async (sys, msgs) => ({
      text: '1. marcar reunião com Juliana terça\n2. cobrar Rafinha sobre relatório\n3. comprar pilha pra microfonia',
      provider: 'claude',
    }),
  });
  const long = '[áudio transcrito] ' + 'ah Tom, preciso marcar uma reunião com a Juliana terça, também cobra o Rafinha do relatório e por favor compra pilha pra microfonia, '.repeat(4);
  const r = await decomposeIfLarge(long);
  assert.equal(r.decomposed, true);
  assert.equal(r.items.length, 3);
  assert.ok(r.rewrittenText.includes('Demandas detectadas'));
  assert.ok(r.rewrittenText.includes('1.'));
  assert.ok(r.latencyMs >= 0);
});

test('decomposeIfLarge — pula áudio curto', async () => {
  const short = '[áudio transcrito] marca reunião com Juliana terça';
  const r = await decomposeIfLarge(short);
  assert.equal(r.decomposed, false);
  assert.equal(r.reason, 'too_short');
});

test('decomposeIfLarge — pula texto não-áudio', async () => {
  const txt = 'olá tudo bem? ' + 'lorem '.repeat(200);
  const r = await decomposeIfLarge(txt);
  assert.equal(r.decomposed, false);
  assert.equal(r.reason, 'not_audio');
});

test('decomposeIfLarge — pula áudio grande sem densidade de intenções', async () => {
  const monolog = '[áudio transcrito] ' + 'estava pensando na vida ontem '.repeat(40);
  const r = await decomposeIfLarge(monolog);
  assert.equal(r.decomposed, false);
  assert.equal(r.reason, 'low_intent_density');
});

test('decomposeIfLarge — fallback gracioso quando extractor falha', async () => {
  _setClaudeForTests({
    chat: async () => { const e = new Error('timeout'); e.kind = 'timeout'; throw e; },
  });
  const long = '[áudio transcrito] ' + 'preciso marcar uma reunião, cobra o Rafa, compra pilha, agenda a sala, '.repeat(10);
  const r = await decomposeIfLarge(long);
  assert.equal(r.decomposed, false);
  assert.equal(r.reason, 'extractor_failed');
});
