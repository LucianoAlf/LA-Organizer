// src/lib/chokepoint-evidencia.test.js
// Rodar: node --test src/lib/chokepoint-evidencia.test.js
//
// CHOKEPOINT-APAGA-A-PROPRIA-EVIDENCIA (medido 19/08) — nos 3 pontos de rebaixamento do engine
// o `reply` era reatribuído ANTES do logMarker, então `raw_excerpt` guardava a nota honesta
// ("_não consegui registrar isso agora_") em vez da afirmação FALSA que o guard interceptou.
// Como a nota é sempre a MESMA string, o log provava que o guard disparou e nunca POR QUÊ:
// o maior cluster do acervo (23 achados de "não consegui registrar") ficava irrefutável por
// construção — nem marker_logs nem conversation_history (que só guarda o entregue) tinham o
// original. Sem isso não dá pra separar guard CERTO (o TOM ia mentir) de guard ERRADO (o
// falso-positivo do caso Dudu, CHOKEPOINT-NEGA-ESCRITA-RECENTE).
//
// Catraca de FONTE: os 3 sites têm que capturar o original antes de reatribuir. Se alguém
// voltar a logar `String(reply)` depois do `reply = _x.reply`, o teste quebra.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { enforceNoMarkerHonesty } = require('./optimistic-confirm');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');

test('engine: os 3 rebaixamentos capturam o texto ORIGINAL antes de reatribuir reply', () => {
  for (const v of ['_origSh', '_origPd', '_origHon']) {
    assert.ok(ENGINE.includes(`const ${v} = String(reply).slice(`),
      `${v}: captura do original sumiu`);
    assert.ok(ENGINE.includes(`, ${v});`), `${v}: não está sendo passado ao logMarker`);
  }
});

test('engine: nenhum logMarker de CHOKEPOINT redirected loga o reply JÁ rebaixado', () => {
  // Casa "reply = _algo.reply;" seguido, em até 6 linhas, de um logMarker CHOKEPOINT que
  // serialize `reply` — a assinatura exata do bug.
  const re = /reply = _\w+\.reply;[\s\S]{0,420}?CHOKEPOINT', 'redirected'[^\n]*String\(reply\)/g;
  const hits = ENGINE.match(re) || [];
  assert.strictEqual(hits.length, 0,
    `rebaixamento logando reply pós-guard (${hits.length}) — guarde o original antes`);
});

// A trava só vale se o rebaixamento REALMENTE troca o texto: se um dia o guard passar a
// preservar a afirmação, capturar "o original" deixa de ter sentido. Fixa a premissa.
test('premissa: o guard TROCA o texto (por isso o original precisa ser salvo à parte)', () => {
  const original = '✅ Pronto, registrei a tarefa!';
  const out = enforceNoMarkerHonesty(original, {
    nothingPersisted: true, actionableIntent: true, markerAttempted: false,
  }, { meta: true });
  assert.ok(out.fired, 'o guard tem que disparar neste caso');
  assert.notStrictEqual(out.reply, original, 'se não trocasse, não haveria evidência a perder');
  assert.match(out.reply, /não consegui registrar/i);
});
