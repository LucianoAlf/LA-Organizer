'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { stripReplyScaffold } = require('../events/detect-approval-reply');
const { detectFinanceEditIntent, detectCorrection } = require('./detect-correction');

// FINEDIT-QUOTE-SCAFFOLD-MISROUTE (27/06) — o engine (8409-8411) deve rodar os detectores de
// edição financeira só na FALA REAL da pessoa (stripReplyScaffold.userText), não no scaffold do
// reply-quote. Caso Rafinha: "Coloca o prazo até final de julho" (prazo de TAREFA) respondendo a
// um card com "Compra..." → "compra" da CITAÇÃO casava RE_TXN_NOUN_LOOSE → misroute pra finança.
// Família DUP-QUOTE-SCAFFOLD / APPROVAL-GENERIC-TOKEN.

const RAFINHA = '[O usuário está RESPONDENDO a esta mensagem anterior: "*Compra e manutenção de instrumentos C.G*\nCheckpoint: *Estúdio L.A*\n🔴 ⚠️ Prazo vencido há 1 dia!"]\nColoca o prazo até final de julho';

test('BUG documentado: no texto CRU (com scaffold), "compra" da citação dispara finance-edit', () => {
  assert.deepEqual(detectFinanceEditIntent(RAFINHA), { op: 'edit' }); // comportamento ERRADO pré-fix
});

test('FIX: no userText (sem scaffold), prazo de TAREFA NÃO vira finance-edit', () => {
  const u = stripReplyScaffold(RAFINHA).userText;
  assert.equal(u, 'Coloca o prazo até final de julho');
  assert.equal(detectFinanceEditIntent(u), null);
  assert.equal(detectCorrection(u), null);
});

test('correção financeira AUTOCONTIDA ainda dispara (texto sem scaffold passa inteiro)', () => {
  const u = stripReplyScaffold('muda o gasto pra 50').userText;
  assert.deepEqual(detectFinanceEditIntent(u), { op: 'edit' });
});

test('reply-quote cujo PRÓPRIO texto tem o substantivo de transação ainda dispara', () => {
  const u = stripReplyScaffold('[O usuário está RESPONDENDO a esta mensagem anterior: "qualquer coisa"]\napaga o gasto de 30').userText;
  assert.deepEqual(detectFinanceEditIntent(u), { op: 'delete' });
});

test('reply-quote de TAREFA (substantivo só na citação) NÃO vira finance (trade-off consciente)', () => {
  const u = stripReplyScaffold('[O usuário está RESPONDENDO a esta mensagem anterior: "Compra de instrumentos — vencida"]\nmuda o prazo pra sexta').userText;
  assert.equal(detectFinanceEditIntent(u), null);
});
