'use strict';
// AFIRMACAO-DE-ESTADO-SOB-CONFIRMACAO (frente 7 — 2252e7bd 30/06, e84dd423 Dai 26/06).
const { test } = require('node:test');
const assert = require('node:assert');
const { hasStateAssertionClaim, enforceNoMarkerHonesty, NO_MARKER_HONEST_NOTE } = require('./optimistic-confirm');
const { isWriteConfirmQuestion } = require('./confirm-question');

// As falas reais.
const SING_Q = 'Confirma que eu registro tudo da *Sing* agora?';
const SING_R = 'Show, Dai — lista da *Sing — Barra* confirmada.\n\nPode mandar a próxima sala.';
const FECH_Q = 'Confirma o fechamento destas 5 tarefas: *Marcar reunião com Juliana para definir próximos passos dos treinamentos em julho*, *Reunir com Rafinha para falar do inventário das unidades*?';
const CHECKS_R = '• Reunião com Juliana ✓\n• Reunião com Rafinha ✓\n• Panorama do Matheus Felipe ✓\n• Rodrigo (treinamento) ✓\n• Reunir com Rodrigo ✓\n\nJunho encerrado redondo. 💪';
// Celebração legítima (CONFAB-CHECKLIST): ✓ sem verbo, sem pergunta de escrita pendente.
const RECAP = '• Relatório pro Hugo ✓\n• Fornecedor de pele ✓\n\nMandou bem hoje!';

test('pergunta de ESCRITA: Sing e fechamento sim; horário, "Fechou assim?" e papo não', () => {
  assert.strictEqual(isWriteConfirmQuestion(SING_Q), true);
  assert.strictEqual(isWriteConfirmQuestion(FECH_Q), true);
  assert.strictEqual(isWriteConfirmQuestion('Pode ser às 9h?'), false);
  assert.strictEqual(isWriteConfirmQuestion('Fechou assim, tá certo?'), false);
  assert.strictEqual(isWriteConfirmQuestion('E aí, como foi o dia?'), false);
  assert.strictEqual(isWriteConfirmQuestion('Confirma que eu registro tudo da *Sing* agora.'), false); // sem "?"
});

test('afirmação de estado: "confirmada", "encerrado", 2+ linhas com ✓; 1 linha ✓, pergunta e negação não', () => {
  assert.strictEqual(hasStateAssertionClaim(SING_R), true);
  assert.strictEqual(hasStateAssertionClaim(CHECKS_R), true);
  assert.strictEqual(hasStateAssertionClaim('Junho encerrado redondo. 💪'), true);
  assert.strictEqual(hasStateAssertionClaim('• Relatório pro Hugo ✓\n\nMandou bem!'), false);
  assert.strictEqual(hasStateAssertionClaim('A lista da Sing ficou confirmada?'), false);
  assert.strictEqual(hasStateAssertionClaim('A lista da Sing não foi confirmada ainda.'), false);
});

test('Dai (e84dd423): sob pergunta de escrita, "confirmada" + "Pode mandar a próxima" → nota honesta sem a afirmação', () => {
  const r = enforceNoMarkerHonesty(SING_R, { nothingPersisted: true, pendingWrite: true, infoGathering: true, contentSolicitation: true });
  assert.strictEqual(r, `Pode mandar a próxima sala.\n\n${NO_MARKER_HONEST_NOTE}`);
});

test('2252e7bd: lista de ✓ + "Junho encerrado" depois do "Isso" → só a nota honesta', () => {
  assert.strictEqual(enforceNoMarkerHonesty(CHECKS_R, { nothingPersisted: true, pendingWrite: true }), NO_MARKER_HONEST_NOTE);
});

test('sem pergunta de escrita pendente, ✓ de celebração fica intocado (CONFAB-CHECKLIST)', () => {
  assert.strictEqual(enforceNoMarkerHonesty(RECAP, { nothingPersisted: true, pendingWrite: false, pendingActionRecent: true }), RECAP);
  assert.strictEqual(enforceNoMarkerHonesty(CHECKS_R, { nothingPersisted: true }), CHECKS_R);
});

test('persistiu, reafirma escrita recente ou declara que nada muda → intocado', () => {
  assert.strictEqual(enforceNoMarkerHonesty(CHECKS_R, { nothingPersisted: false, pendingWrite: true }), CHECKS_R);
  assert.strictEqual(enforceNoMarkerHonesty(SING_R, { nothingPersisted: true, pendingWrite: true, infoGathering: true, restatesRecentWrite: true }), SING_R);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: busca a última fala também pra afirmação de estado e passa pendingWrite', () => {
  assert.match(ENG, /\|\| hasStateAssertionClaim\(reply\)\)\) \{/);
  assert.match(ENG, /_pendingWrite = isWriteConfirmQuestion\(_lt && _lt\.content\);/);
  assert.match(ENG, /pendingWrite: _pendingWrite,/);
});
