'use strict';
// Achado a0a688e2 (Dudu, 16/09 21:39): a trava de honestidade apagou o eco de um relato da
// própria pessoa e mandou "não consegui registrar". Ver src/lib/eco-relato-usuario.js.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ecoDoRelatoDoUsuario } = require('./eco-relato-usuario');
const { enforceNoMarkerHonesty, NO_MARKER_HONEST_NOTE } = require('./optimistic-confirm');

// Falas REAIS do turno (conversation_history + raw_excerpt do CHOKEPOINT de 16/09 21:39:54).
const DUDU = '[áudio transcrito] Bom, hoje eu já fiz a ronda, tá tudo certo, tudo funcionando, cabo, caixa de som, amplificador, tudo certinho, tá tudo correto, tudo ok.';
const TOM_DUDU = 'Entendi, Dudu:\n\n• ✅ Ronda de hoje feita  \n• ✅ Cabo, caixa de som e amplificador funcionando  \n• ✅ Tudo certo, sem dano identificado\n\nCerto?';

test('caso real do Dudu: relato próprio + eco com pedido de confirmação -> é eco', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario(DUDU, TOM_DUDU), true);
});

test('caso real do Dudu: com o veto, a fala chega INTEIRA e sem a nota de erro', () => {
  const out = enforceNoMarkerHonesty(TOM_DUDU, { nothingPersisted: true, reportedState: ecoDoRelatoDoUsuario(DUDU, TOM_DUDU) });
  assert.strictEqual(out, TOM_DUDU);
  assert.ok(!out.includes(NO_MARKER_HONEST_NOTE));
});

test('controle: SEM o veto a trava continua rebaixando a mesma fala (o veto é o que muda)', () => {
  const out = enforceNoMarkerHonesty(TOM_DUDU, { nothingPersisted: true });
  assert.ok(out.includes(NO_MARKER_HONEST_NOTE));
});

test('a pessoa relata E pede pra marcar -> não é eco (se nada gravou, a trava tem que pegar)', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario('já fiz a ronda, marca como feita pra mim', '✅ Ronda de hoje feita'), false);
  assert.strictEqual(ecoDoRelatoDoUsuario('paguei o boleto da luz, dá baixa aí', '✅ Boleto da luz pago'), false);
  assert.strictEqual(ecoDoRelatoDoUsuario('conferi as salas, me lembra amanhã de novo', '✅ Salas conferidas'), false);
});

test('o TOM fala da PRÓPRIA escrita -> não é eco, mesmo com relato da pessoa', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario(DUDU, '✅ Registrei a ronda de hoje feita'), false);
  assert.strictEqual(ecoDoRelatoDoUsuario(DUDU, 'Marquei: ✅ ronda feita'), false);
  assert.strictEqual(ecoDoRelatoDoUsuario('já paguei o boleto', 'Dei baixa: ✅ boleto pago'), false);
});

test('linha com particípio de escrita no sistema -> não é eco ("marcado", "concluída", "registrado")', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario('já paguei o boleto da luz', '✅ Boleto da luz marcado como pago'), false);
  assert.strictEqual(ecoDoRelatoDoUsuario(DUDU, '✅ Ronda concluída'), false);
  assert.strictEqual(ecoDoRelatoDoUsuario(DUDU, '✅ Ronda registrada'), false);
});

test('linha acusada que não retoma NADA do relato -> não é eco', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario(DUDU, '✅ Reunião com fornecedor feita'), false);
});

test('uma linha de eco NÃO absolve a vizinha que afirma outra coisa (TODAS têm que ser eco)', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario(DUDU, '✅ Ronda de hoje feita\n✅ Reunião com fornecedor feita'), false);
});

test('a pessoa não relatou ação própria -> não é eco', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario('a ronda de hoje foi feita?', '✅ Ronda de hoje feita'), false);
  assert.strictEqual(ecoDoRelatoDoUsuario('faz a ronda hoje', '✅ Ronda de hoje feita'), false);
});

test('nada acusado pela trava ou entrada vazia -> false (nada a vetar)', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario(DUDU, 'Show, Dudu! Valeu por avisar.'), false);
  assert.strictEqual(ecoDoRelatoDoUsuario('', TOM_DUDU), false);
  assert.strictEqual(ecoDoRelatoDoUsuario(DUDU, ''), false);
  assert.strictEqual(ecoDoRelatoDoUsuario(null, null), false);
});

test('marker tentado e rejeitado no turno mantém o freio mesmo com eco', () => {
  const out = enforceNoMarkerHonesty(TOM_DUDU, { nothingPersisted: true, markerAttempted: true, reportedState: true });
  assert.ok(out.includes(NO_MARKER_HONEST_NOTE));
});

// ── ligação (âncora de código) ────────────────────────────────────────────────────────────
const engine = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
const grupo = fs.readFileSync(path.join(__dirname, '..', 'services', 'group-chat-engine.js'), 'utf8');
const oc = fs.readFileSync(path.join(__dirname, 'optimistic-confirm.js'), 'utf8');

test('1:1: o engine passa a fala DA PESSOA (sem o scaffold de citação) pro detector, na porta reportedState', () => {
  assert.match(engine, /reportedState: ecoDoRelatoDoUsuario\(stripReplyScaffold\(String\(text \|\| ''\)\)\.userText, reply\),/);
  assert.match(engine, /require\('\.\/lib\/eco-relato-usuario'\)/);
});

test('grupo: a fala do membro chega ao buildTomContent e soma ao veto de relato', () => {
  assert.match(grupo, /buildTomContent\(reply, actions, \{ onResidual: [^}]*userText: text \}\)/);
  assert.match(grupo, /const relato = isReportedStateClaim\(prose\) \|\| ecoDoRelatoDoUsuario\(\(opts && opts\.userText\) \|\| '', prose\);/);
});

test('optimistic-confirm.js (em parada por 23 commits em 60 dias) NÃO conhece o detector novo', () => {
  assert.ok(!oc.includes('eco-relato-usuario'));
});
