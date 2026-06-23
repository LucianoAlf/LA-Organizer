'use strict';
// GUARD-CONFIRM-LOOP (10/06) — detectUserConfirmation com opts.allowDone.
// Caso Matheus: "Já conclui!" / "JÁ FOI FEITO" respondendo à pergunta da guarda
// temporal ("confirma que já foi feito?") não casavam o YES_RE → caíam no LLM →
// o complete re-bloqueava → loop. O vocabulário de conclusão só vale com
// allowDone=true (intent ancorada de complete) — nunca no YES genérico.
// Roda na VPS (require puxa supabase/client): node --test src/services/pending-intents-detect.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { detectUserConfirmation } = require('./pending-intents');

test('caso Matheus: "Já conclui!" com allowDone → yes', () => {
  assert.strictEqual(detectUserConfirmation('Já conclui!', { allowDone: true }), 'yes');
});

test('caso Matheus: "JÁ FOI FEITO" com allowDone → yes', () => {
  assert.strictEqual(detectUserConfirmation('JÁ FOI FEITO', { allowDone: true }), 'yes');
});

test('vocabulário done NÃO vaza pro YES genérico (sem allowDone → null)', () => {
  assert.strictEqual(detectUserConfirmation('Já conclui!'), null);
  assert.strictEqual(detectUserConfirmation('JÁ FOI FEITO'), null);
  assert.strictEqual(detectUserConfirmation('feito', {}), null);
});

test('variantes de conclusão com allowDone → yes', () => {
  for (const t of ['feito', 'fiz', 'já fiz', 'pronto', 'concluído', 'concluída', 'conclui', 'tá feito', 'finalizei', 'terminei', 'resolvi', 'fechei', 'foi feito']) {
    assert.strictEqual(detectUserConfirmation(t, { allowDone: true }), 'yes', `esperava yes pra "${t}"`);
  }
});

test('"ainda não" → no (resposta natural à pergunta da guarda)', () => {
  assert.strictEqual(detectUserConfirmation('ainda não', { allowDone: true }), 'no');
  assert.strictEqual(detectUserConfirmation('Ainda não'), 'no');
});

test('resposta com conteúdo (>4 palavras) segue null mesmo com allowDone', () => {
  assert.strictEqual(detectUserConfirmation('não fiz ainda mas faço amanhã', { allowDone: true }), null);
  assert.strictEqual(detectUserConfirmation('Conclui .. esqueci de colocar aqui', { allowDone: true }), null);
});

test('scaffold de reply-quote cru (sem strip) → null (limite de 200 chars)', () => {
  const scaffold = '[O usuário está RESPONDENDO a esta mensagem anterior: "⚠️ *Montar repertório da festa junina* está marcado pra *15/06* (ainda não chegou). Confirma que já foi feito mesmo assim?"]\nJá conclui!';
  assert.strictEqual(detectUserConfirmation(scaffold, { allowDone: true }), null);
});

test('regressões F5 (caso Ana) preservadas', () => {
  assert.strictEqual(detectUserConfirmation('Não foi a ADM foi a de governança'), null);
  assert.strictEqual(detectUserConfirmation('vai dar'), null);
});

test('YES e NO clássicos inalterados', () => {
  assert.strictEqual(detectUserConfirmation('sim'), 'yes');
  assert.strictEqual(detectUserConfirmation('pode'), 'yes');
  assert.strictEqual(detectUserConfirmation('não'), 'no');
  assert.strictEqual(detectUserConfirmation('beleza'), 'yes');
});

// ── BATCH-CONFIRM-LONGPHRASE (Daiana 22/06): confirmação afirmativa estendida ──
test('confirmação afirmativa longa que abre com afirmador forte, sem ressalva → yes', () => {
  assert.strictEqual(detectUserConfirmation('Sim, por favor. Pode fechar as 6 tarefas'), 'yes');
  assert.strictEqual(detectUserConfirmation('Sim, pode fechar todas elas por favor'), 'yes');
  assert.strictEqual(detectUserConfirmation('claro, pode mandar ver agora mesmo'), 'yes');
  assert.strictEqual(detectUserConfirmation('isso mesmo, pode seguir com tudo'), 'yes');
});

test('afirmação longa COM ressalva/negação NÃO confirma → null', () => {
  assert.strictEqual(detectUserConfirmation('sim, mas só depois de amanhã à tarde'), null);
  assert.strictEqual(detectUserConfirmation('sim, mas não as duas primeiras tarefas'), null);
  assert.strictEqual(detectUserConfirmation('claro, deixa pra fazer isso mais tarde'), null);
});

test('afirmação longa que NÃO abre com afirmador forte → null (preserva F5)', () => {
  assert.strictEqual(detectUserConfirmation('já tinha feito isso ontem de manhã cedo'), null);
  assert.strictEqual(detectUserConfirmation('Não foi a ADM foi a de governança hoje'), null);
});
