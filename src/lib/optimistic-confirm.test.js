'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeOptimisticConfirm, hasOptimisticConfirm, hasWeakCompletionClaim, enforceNoMarkerHonesty } = require('./optimistic-confirm');

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

// NOTE-ACTION-CONFAB-NOPROSE (25/06) — os 3 ramos de falha do NOTE_ACTION
// (malformed / dup-skip / res.ok=false) passam o cleanText por sanitize('failed').
// Ancora o caso real do Alf (24/06): NOTE schema_invalid não pode sair com "Anotado!".
test('failed: caso NOTE Alf — "Anotado!" removido, gerúndio/intenção preservados', () => {
  const cleanText = 'Claro, Alf! Salvando nas suas anotações.\n\nAnotado! Agora me conta o resto.';
  const out = sanitizeOptimisticConfirm(cleanText, 'failed');
  assert.ok(!/Anotado!/.test(out), 'não pode sobrar "Anotado!"');
  assert.strictEqual(out, 'Claro, Alf! Salvando nas suas anotações.');
});

test('failed: NOTE dup-skip — linha única toda otimista vira vazio', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('Claro! Anotado! ✅', 'failed'), '');
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

// ─────────────────────────────────────────────────────────────────────────
// REDE 1 — camada FRACA de conclusão ("Fechou/Combinado/Beleza"), gated por
// ESTADO (nothingPersisted + pendingActionRecent), NUNCA por actionable_intent.
// Caso Matheus 14/07 (RESCHEDULE-CONFIRM-NOOP): user "Isso" → TOM "✅ Fechou" sem
// persistir → o gate forte perdia "Fechou" (3ª pessoa) → NOOP silencioso de 11h.
// actionable_intent é FALSO nesse turno (engine.js:12294: inputActionable("Isso")=false,
// replyHasPromise("Fechou")=false) → gate morto + circular. Eixo certo = nothingPersisted.
// ─────────────────────────────────────────────────────────────────────────

test('hasWeakCompletionClaim: detecta afirmações casuais de conclusão', () => {
  assert.strictEqual(hasWeakCompletionClaim('✅ Fechou, Matheus! Bora focar no que tem pra hoje.'), true);
  assert.strictEqual(hasWeakCompletionClaim('Combinado!'), true);
  assert.strictEqual(hasWeakCompletionClaim('Beleza, tá feito.'), true);
});
test('hasWeakCompletionClaim: false em texto neutro / pergunta', () => {
  assert.strictEqual(hasWeakCompletionClaim('Qual horário você prefere?'), false);
  assert.strictEqual(hasWeakCompletionClaim('Vou criar isso já já.'), false);
});

test('(a) "Fechou ✅" sem persist APÓS confirm-question → fira honesto', () => {
  const r = enforceNoMarkerHonesty(
    '✅ Fechou, Matheus! Bora focar no que tem pra hoje.',
    { nothingPersisted: true, pendingActionRecent: true, infoGathering: false, awaitingConfirm: false },
    { meta: true },
  );
  assert.strictEqual(r.fired, true, 'deve firar');
  assert.ok(/não consegui registrar/i.test(r.reply), 'anexa aviso honesto');
  assert.ok(!/Fechou/.test(r.reply), 'remove o falso "Fechou"');
});

test('(b) "Fechou, valeu!" banter (sem ação pendente) → NÃO fira (protege Rose)', () => {
  const r = enforceNoMarkerHonesty(
    '✅ Fechou, valeu!',
    { nothingPersisted: true, pendingActionRecent: false, infoGathering: false, awaitingConfirm: false },
    { meta: true },
  );
  assert.strictEqual(r.fired, false, 'banter não pode firar');
  assert.strictEqual(r.reply, '✅ Fechou, valeu!', 'reply intacto');
});

test('(c) "Fechou ✅" COM marker persistido → NÃO fira (agendou de verdade)', () => {
  const r = enforceNoMarkerHonesty(
    '✅ Fechou, Matheus!',
    { nothingPersisted: false, pendingActionRecent: true, infoGathering: false, awaitingConfirm: false },
    { meta: true },
  );
  assert.strictEqual(r.fired, false, 'algo persistiu → não rebaixa');
});

test('(d) verbo FORTE intocado — fira mesmo sem pendingActionRecent (zero-regressão)', () => {
  const r = enforceNoMarkerHonesty(
    '✅ Reagendei tudo pra amanhã.',
    { nothingPersisted: true, pendingActionRecent: false, infoGathering: false, awaitingConfirm: false },
    { meta: true },
  );
  assert.strictEqual(r.fired, true, 'verbo forte não depende do gate de recência');
});

test('weak sem ✅ ("Fechou, Matheus!") + estado → fira e remove a linha', () => {
  const r = enforceNoMarkerHonesty(
    'Fechou, Matheus!',
    { nothingPersisted: true, pendingActionRecent: true, infoGathering: false, awaitingConfirm: false },
    { meta: true },
  );
  assert.strictEqual(r.fired, true);
  assert.ok(!/Fechou/.test(r.reply), 'weak line removida mesmo sem emoji');
});

test('weak NÃO fira quando infoGathering/awaitingConfirm (gate nativo do chokepoint)', () => {
  const base = { nothingPersisted: true, pendingActionRecent: true };
  assert.strictEqual(enforceNoMarkerHonesty('✅ Fechou!', { ...base, infoGathering: true }, { meta: true }).fired, false);
  assert.strictEqual(enforceNoMarkerHonesty('✅ Fechou!', { ...base, awaitingConfirm: true }, { meta: true }).fired, false);
});

test('zero-regressão: hasOptimisticConfirm segue false em "Beleza, crio separado."', () => {
  assert.strictEqual(hasOptimisticConfirm('Beleza, crio separado.'), false);
  // sanitize default (sem includeWeak) não pode stripar "Beleza" (papo)
  assert.strictEqual(sanitizeOptimisticConfirm('Beleza, crio separado.', 'failed'), 'Beleza, crio separado.');
});
