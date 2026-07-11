const { test } = require('node:test');
const assert = require('node:assert');
const { confirmationBindOk } = require('./confirm-bind');

// CONFIRM-ANCHOR-WRONGBIND (Ana 10/07): "Bombonha Alice - feito" (frase-longa, allowDone→yes)
// confirmou o anchor ERRADO ("Falar com a Fefê") só porque tem "feito". O citation gate só
// amarra a confirmação de FRASE-LONGA no anchor se a msg menciona algo DELE: título OU número
// OU "tudo/todas/geral". Curto (≤4 palavras) = confirmação genérica → sempre amarra (atual).

// ── o BUG: bloqueia (→ LLM) quando a frase não menciona nada do anchor ───────
test('Ana REAL: "Bombonha Alice - feito ..." NÃO amarra em "Falar com a Fefê" (bloqueia)', () => {
  assert.strictEqual(
    confirmationBindOk('Bombonha Alice - feito \n\nAcademia - vou agora a noite', 'Falar com a Fefê sobre o script'),
    false);
});

// ── ressalva da catraca: NÃO pode quebrar BATCH-CONFIRM-* (confirma por número/tudo) ──
test('Rose BATCH-IMPERATIVE-NUM: "conclui as 3 que já fiz" libera (número)', () => {
  assert.strictEqual(confirmationBindOk('conclui as 3 que já fiz', 'Qualquer Tarefa'), true);
});
test('BATCH-LONGPHRASE: "Sim, por favor. Pode fechar as 6 tarefas" libera (número)', () => {
  assert.strictEqual(confirmationBindOk('Sim, por favor. Pode fechar as 6 tarefas', 'Qualquer'), true);
});
test('"fiz tudo que tava pendente hoje" libera (tudo/todas/geral)', () => {
  assert.strictEqual(confirmationBindOk('fiz tudo que tava pendente hoje', 'Qualquer'), true);
});

// ── confirmação curta segue genérica (comportamento atual) ──────────────────
test('curto (≤4 palavras) sempre amarra: "feito", "já fiz", "sim pode fechar"', () => {
  assert.strictEqual(confirmationBindOk('feito', 'Falar com a Fefê'), true);
  assert.strictEqual(confirmationBindOk('já fiz', 'Falar com a Fefê'), true);
  assert.strictEqual(confirmationBindOk('sim pode fechar', 'Falar com a Fefê'), true);
});

// ── frase-longa que MENCIONA o título → amarra ──────────────────────────────
test('frase-longa citando o título do anchor libera', () => {
  assert.strictEqual(confirmationBindOk('já terminei o lançamentos bg hoje de manhã', 'Lançamentos BG'), true);
  assert.strictEqual(confirmationBindOk('acabei de falar com a fefê agora sobre o script', 'Falar com a Fefê sobre o script'), true);
});

// ── defensivo ───────────────────────────────────────────────────────────────
test('defensivo: vazio/null/sem título → não bloqueia (true)', () => {
  assert.strictEqual(confirmationBindOk('', 'x'), true);
  assert.strictEqual(confirmationBindOk(null, 'x'), true);
  assert.strictEqual(confirmationBindOk('fiz aqui agora rapidão tranquilo', null), true); // sem título → não dá pra checar → não bloqueia
});
