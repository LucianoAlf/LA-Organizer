'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeOptimisticConfirm, hasOptimisticConfirm } = require('./optimistic-confirm');

// ─────────────────────────────────────────────────────────────────────────
// outcome = 'failed' (nada persistiu): rebaixa/remove TODA confirmação otimista
// ─────────────────────────────────────────────────────────────────────────

test('failed: "✅ Criado!" sozinho vira vazio (caso Fefê)', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('✅ Criado!', 'failed'), '');
});

test('failed: linha com emoji no meio é removida, pergunta preservada', () => {
  const out = sanitizeOptimisticConfirm('Boa! ✅ Criado!\n\nQuer que eu te lembre depois?', 'failed');
  assert.strictEqual(out, 'Quer que eu te lembre depois?');
});

test('failed: "✅ *Título*" é removido, ack em presente preservado (caso Juliana)', () => {
  const input = 'Beleza, crio separado.\n\n✅ *Conversar com a Dai sobre o evento LA Love Songs* — prazo terça (16/06).';
  assert.strictEqual(sanitizeOptimisticConfirm(input, 'failed'), 'Beleza, crio separado.');
});

test('failed: verbos de conclusão em 1a pessoa são removidos', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('Criei a tarefa pra você.', 'failed'), '');
  assert.strictEqual(sanitizeOptimisticConfirm('Reagendei pra amanhã.', 'failed'), '');
  assert.strictEqual(sanitizeOptimisticConfirm('Fechei todas as pendências.', 'failed'), '');
  assert.strictEqual(sanitizeOptimisticConfirm('Anotado: comprar pão.', 'failed'), '');
});

test('failed: NÃO remove presente/futuro (intenção, não conclusão)', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('Vou criar isso já já.', 'failed'), 'Vou criar isso já já.');
  assert.strictEqual(sanitizeOptimisticConfirm('Crio agora pra você?', 'failed'), 'Crio agora pra você?');
});

test('failed: preserva texto neutro / perguntas', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('Qual horário você prefere?', 'failed'), 'Qual horário você prefere?');
});

test('failed: "✅ Os dois fechados." é removido (bonus EVENT_UPDATE)', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('✅ Os dois fechados.', 'failed'), '');
});

// ─────────────────────────────────────────────────────────────────────────
// outcome = 'partial' (parte persistiu): rebaixa totalizador absoluto
// ─────────────────────────────────────────────────────────────────────────

test('partial: "fechei todas as pendências" → "a maioria das" (caso Anne)', () => {
  assert.strictEqual(
    sanitizeOptimisticConfirm('fechei todas as pendências', 'partial'),
    'fechei a maioria das pendências',
  );
});

test('partial: emoji removido + totalizador rebaixado', () => {
  assert.strictEqual(
    sanitizeOptimisticConfirm('✅ Fechei todas as pendências!', 'partial'),
    'Fechei a maioria das pendências!',
  );
});

test('partial: "tudo" → "a maior parte"', () => {
  assert.strictEqual(
    sanitizeOptimisticConfirm('Marquei tudo como feito.', 'partial'),
    'Marquei a maior parte como feito.',
  );
});

test('partial: confirmação pura sem totalizador é removida', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('✅ Criado!', 'partial'), '');
});

test('partial: preserva capitalização do totalizador no início', () => {
  assert.strictEqual(
    sanitizeOptimisticConfirm('Todos os itens registrados.', 'partial'),
    'A maioria dos itens registrados.',
  );
});

// ─────────────────────────────────────────────────────────────────────────
// hasOptimisticConfirm
// ─────────────────────────────────────────────────────────────────────────

test('hasOptimisticConfirm: detecta ✅ e verbos de conclusão', () => {
  assert.strictEqual(hasOptimisticConfirm('✅ Criado!'), true);
  assert.strictEqual(hasOptimisticConfirm('Fechei tudo!'), true);
  assert.strictEqual(hasOptimisticConfirm('Reagendei pra amanhã.'), true);
});

test('hasOptimisticConfirm: false em ack/pergunta/presente', () => {
  assert.strictEqual(hasOptimisticConfirm('Beleza, crio separado.'), false);
  assert.strictEqual(hasOptimisticConfirm('Qual horário?'), false);
  assert.strictEqual(hasOptimisticConfirm('Vou criar isso já já.'), false);
});

// ─────────────────────────────────────────────────────────────────────────
// robustez
// ─────────────────────────────────────────────────────────────────────────

test('entrada vazia/nula', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('', 'failed'), '');
  assert.strictEqual(sanitizeOptimisticConfirm(null, 'failed'), '');
  assert.strictEqual(sanitizeOptimisticConfirm(undefined, 'partial'), '');
});

test('outcome desconhecido = não mexe', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('✅ Criado!', 'ok'), '✅ Criado!');
});
