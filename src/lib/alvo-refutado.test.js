// src/lib/alvo-refutado.test.js
// Rodar: node --test src/lib/alvo-refutado.test.js
//
// ALVO-REFUTADO-VOLTA-IGUAL (Rafinha 19/08 12:49). O TOM propôs fechar 2 tarefas de spot,
// o Rafinha refutou ("Não, o Carlinhos está em Campo Grande. Isso você pode fechar aí") e o
// TOM abriu intent nova com as MESMAS 2 tarefas, com a pergunta idêntica.
const { test } = require('node:test');
const assert = require('node:assert');
const { abreComNegacao, mesmoAlvo, alvoFoiRefutado, mensagemAlvoRefutado } = require('./alvo-refutado');

const SPOTS = ['bcf96b46', 'f6bc1329'];

test('CASO RAFINHA REAL: refuta e a proposta nova mira o mesmo par', () => {
  assert.strictEqual(alvoFoiRefutado({
    inboundText: '[áudio transcrito] Não, o Carlinhos está em Campo Grande. Isso você pode fechar aí.',
    idsPropostos: ['f6bc1329', 'bcf96b46'],   // ordem trocada de propósito
    idsRecusados: SPOTS,
  }), true);
});

test('a mesma refutação NÃO bloqueia fechar outra coisa', () => {
  assert.strictEqual(alvoFoiRefutado({
    inboundText: 'Não, o Carlinhos está em Campo Grande. Isso você pode fechar aí.',
    idsPropostos: ['aa11bb22'],
    idsRecusados: SPOTS,
  }), false);
});

test('sem negação de abertura, proposta repetida segue o fluxo normal', () => {
  assert.strictEqual(alvoFoiRefutado({
    inboundText: 'pode fechar as duas sim',
    idsPropostos: SPOTS, idsRecusados: SPOTS,
  }), false);
});

test('negação no MEIO da frase não conta (é recorte, não refutação)', () => {
  assert.strictEqual(abreComNegacao('fecha a do Recreio, a outra não'), false);
  assert.strictEqual(abreComNegacao('Não é bem assim'), true);
  assert.strictEqual(abreComNegacao('nada disso, Tom'), true);
  assert.strictEqual(abreComNegacao('  [áudio transcrito]  Nao, espera '), true);
});

test('mesmoAlvo: ordem não importa; subconjunto e vazio não casam', () => {
  assert.strictEqual(mesmoAlvo(['a', 'b'], ['b', 'a']), true);
  assert.strictEqual(mesmoAlvo(['a'], ['a', 'b']), false, 'proposta reduzida é proposta NOVA');
  assert.strictEqual(mesmoAlvo([], []), false);
  assert.strictEqual(mesmoAlvo(null, ['a']), false);
  // duplicata colapsa: o ALVO é o conjunto de itens, não a lista — ['a',' a '] e ['a']
  // miram exatamente a mesma tarefa, então insistir nela continua sendo insistir.
  assert.strictEqual(mesmoAlvo(['a', ' a '], ['a']), true);
});

test('entrada degenerada nunca bloqueia (fail-open: gate mudo é pior)', () => {
  for (const v of [null, undefined, 42, 'x', []]) {
    assert.strictEqual(alvoFoiRefutado(v), false);
  }
  assert.strictEqual(abreComNegacao(null), false);
});

test('a fala do gate não inventa alvo nenhum', () => {
  const m = mensagemAlvoRefutado();
  assert.match(m, /não vou insistir nas mesmas/i);
  assert.ok(!/spot|tarefa \*/i.test(m), 'não pode citar o alvo recusado de volta');
});

// Catraca de FONTE: guard puro que ninguém chama não protege ninguém.
const fs = require('node:fs');
const path = require('node:path');
const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');

test('engine: o guard está ligado DENTRO da trava A2, antes de reabrir a pergunta', () => {
  const iA2 = ENGINE.indexOf('batchCompleteNeedsConfirm({');
  const iGuard = ENGINE.indexOf('alvoFoiRefutado({');
  const iReabre = ENGINE.indexOf("`Confirmar fechamento em lote:");
  assert.ok(iA2 > 0 && iGuard > iA2, 'guard fora da trava A2');
  assert.ok(iReabre > iGuard, 'guard tem que decidir ANTES de reabrir a mesma pergunta');
});

test('engine: a intent refutada morre como `denied`, não `superseded`', () => {
  assert.match(ENGINE, /resolveIntent\(_recusada\.id, 'denied'/,
    'sem isso o alvo velho continua rondando o turno seguinte');
});

test('engine: o guard tem gate de RECÊNCIA (não captura "não" de horas atrás)', () => {
  assert.match(ENGINE, /_agora - Date\.parse\(i\.asked_at\)\) <= _janelaMs/);
});
