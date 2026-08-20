// src/lib/reacao-muda.test.js
// Rodar: node --test src/lib/reacao-muda.test.js
//
// HABIT-ACTION-SO-ACEITA-ID-REJEITA-TITULO / parte 2 (Bianca 20/08). O marker de hábito
// foi dropado pelo schema (`bad_habit_id`), o texto do LLM era VAZIO e a única saída do
// turno foi um `<<REACT>>✅<<END>>`. A pessoa recebeu um ✅ — confirmação de que o hábito
// foi registrado — e nada foi gravado.
//
// O chokepoint de honestidade não pegou porque ele lê AFIRMAÇÃO DE TEXTO: com reply
// vazio ele não dispara (medido: enforceNoMarkerHonesty('', {nothingPersisted:true,
// markerAttempted:true}) => fired=false). Uma reação é uma afirmação SEM texto — o eixo
// que o guard não enxerga.
//
// Discriminante: marker de DOMÍNIO tentado. Um ✅ respondendo "obrigado" não tem marker
// tentado e continua mudo, como deve ser.
const { test } = require('node:test');
const assert = require('node:assert');
const { reacaoSozinhaMente } = require('./reacao-muda');

test('CASO BIANCA: reply vazio + reação + marker tentado que não gravou = mente', () => {
  assert.strictEqual(reacaoSozinhaMente({
    reply: '', temReacao: true, nothingPersisted: true, markerAttempted: true,
  }), true);
});

test('reply com texto: quem julga é o chokepoint, não este guard', () => {
  assert.strictEqual(reacaoSozinhaMente({
    reply: 'Registrei sim!', temReacao: true, nothingPersisted: true, markerAttempted: true,
  }), false);
  assert.strictEqual(reacaoSozinhaMente({
    reply: '   \n ', temReacao: true, nothingPersisted: true, markerAttempted: true,
  }), true, 'só espaço em branco continua sendo vazio');
});

test('sem marker de domínio tentado, reação sozinha é legítima (👍 num "obrigado")', () => {
  assert.strictEqual(reacaoSozinhaMente({
    reply: '', temReacao: true, nothingPersisted: true, markerAttempted: false,
  }), false);
});

test('marker tentado E gravado: a reação está dizendo a verdade', () => {
  assert.strictEqual(reacaoSozinhaMente({
    reply: '', temReacao: true, nothingPersisted: false, markerAttempted: true,
  }), false);
});

test('sem reação nenhuma não há afirmação a corrigir', () => {
  assert.strictEqual(reacaoSozinhaMente({
    reply: '', temReacao: false, nothingPersisted: true, markerAttempted: true,
  }), false);
});

test('entrada degenerada nunca dispara (fail-open: não inventa fala)', () => {
  for (const v of [null, undefined, 42, 'x', {}]) {
    assert.strictEqual(reacaoSozinhaMente(v), false);
  }
});

// Catraca de FONTE: o guard só vale se estiver LIGADO. Se alguém remover a chamada do
// engine, os testes puros acima continuariam verdes e a Bianca voltaria a receber o ✅ mudo.
const fs = require('node:fs');
const path = require('node:path');
const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');

test('engine: o guard está ligado antes do envio do reply', () => {
  assert.ok(ENGINE.includes('reacaoSozinhaMente({'), 'chamada do guard sumiu do engine');
  assert.ok(/reacaoSozinhaMente\(\{[\s\S]{0,400}?markerAttempted:[\s\S]{0,200}?nothingPersisted:/.test(ENGINE),
    'guard chamado sem os dois discriminantes (markerAttempted + nothingPersisted)');
  const iGuard = ENGINE.indexOf('reacaoSozinhaMente({');
  const iSend = ENGINE.indexOf('if (reply && reply.trim() && !_voiceSent) {');
  assert.ok(iGuard > 0 && iSend > iGuard, 'guard tem que rodar ANTES do envio do reply');
});

test('engine: a nota honesta vem da fonte única, não de string duplicada', () => {
  assert.ok(ENGINE.includes('reply = NO_MARKER_HONEST_NOTE;'),
    'nota literal duplicada no engine — a voz do TOM tem uma fonte só');
});
