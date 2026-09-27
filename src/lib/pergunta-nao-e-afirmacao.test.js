'use strict';
// Varredura 27/09: a trava colou "não consegui registrar" em PERGUNTAS do TOM. Falas reais.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { linhasAcusadasSaoPergunta } = require('./pergunta-nao-e-afirmacao');
const { enforceNoMarkerHonesty, NO_MARKER_HONEST_NOTE } = require('./optimistic-confirm');

const HUGO = 'Consigo salvar, sim. Só que esse endereço (*la-performance-report*) parece o do *LA Performance Report*, não o do Organizer. Também é diferente do que te mandei ontem (*la-aperformance-report*), que pode estar errado.\nSalvo como *LA Performance Report* ou como link do *Organizer*?';
const QUINTELA = 'Fechando: *Jornada de Cordas* — qua (30/09) às 13h, presencial, com Luciano (Alf) e Rodrigo.\nConfirma e aviso os dois?';

test('Hugo: "Salvo como X ou Y?" é pergunta — a fala chega inteira', () => {
  assert.strictEqual(linhasAcusadasSaoPergunta(HUGO), true);
  assert.strictEqual(enforceNoMarkerHonesty(HUGO, { nothingPersisted: true, reportedState: true }), HUGO);
});

test('Quintela: "Fechando: …" + "Confirma?" é proposta — a fala chega inteira', () => {
  assert.strictEqual(linhasAcusadasSaoPergunta(QUINTELA), true);
});

test('controle: sem o veto as duas levavam a nota de erro', () => {
  assert.ok(enforceNoMarkerHonesty(HUGO, { nothingPersisted: true }).includes(NO_MARKER_HONEST_NOTE));
  assert.ok(enforceNoMarkerHonesty(QUINTELA, { nothingPersisted: true }).includes(NO_MARKER_HONEST_NOTE));
});

test('Bianca (09/08) continua pega: pergunta numa linha, afirmação "✅ removido" em outra', () => {
  assert.strictEqual(linhasAcusadasSaoPergunta('Entendi: quer tirar o lembrete, certo?\n✅ Lembrete removido'), false);
});

test('Quintela 17:20 (acerto da trava) continua pego: "✅ Marcado! Avisei os dois."', () => {
  assert.strictEqual(linhasAcusadasSaoPergunta('✅ Marcado! Avisei os dois.\n📅 *Jornada de Cordas*\n🗓️ Qua (30/09) · 13h–14h'), false);
});

test('TOM falando da própria gravação mesmo terminando em "?" continua pego', () => {
  assert.strictEqual(linhasAcusadasSaoPergunta('✅ Marquei a reunião pra quarta, tá certo?'), false);
});

test('cabeçalho de proposta SEM pedido de confirmação na fala não é liberado', () => {
  assert.strictEqual(linhasAcusadasSaoPergunta('Fechando: *Jornada de Cordas* — qua às 13h.'), false);
});

test('nada acusado ou vazio -> false', () => {
  assert.strictEqual(linhasAcusadasSaoPergunta('Oi! Tudo certo?'), false);
  assert.strictEqual(linhasAcusadasSaoPergunta(''), false);
});

const engine = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
const grupo = fs.readFileSync(path.join(__dirname, '..', 'services', 'group-chat-engine.js'), 'utf8');
test('ligado no 1:1 e no grupo, somado ao veto de eco', () => {
  assert.match(engine, /reportedState: ecoDoRelatoDoUsuario\([^\n]*\) \|\| linhasAcusadasSaoPergunta\(reply\),/);
  assert.match(grupo, /\|\| linhasAcusadasSaoPergunta\(prose\);/);
});
