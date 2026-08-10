'use strict';
// HABIT-EDIT-SEM-CAMINHO (10/08/2026) — decisão do Alf, no mesmo dia do HABIT-UPDATE-SILENT-LIE:
//
//   "ao invés do TOM avisar que não conseguiu, ele tem que mostrar o caminho. Fala: 'Bianca, é
//    por aqui. Eu não consigo fazer isso, eu não tenho essa função, mas você pode ir lá no
//    aplicativo' e aí mostrar o caminho."
//
// Editar hábito por conversa não existe (o engine implementa create/log/query_progress/delete).
// O fix de honestidade das 08h fez o TOM parar de mentir, mas quem pedisse "tira o lembrete das
// 6h" levava só "_não consegui registrar isso agora — me manda de novo_" — o que é PIOR que a
// mentira em um aspecto: convida a pessoa a repetir um pedido que nunca vai funcionar.
//
// Honestidade sem saída é beco. A capacidade continua não existindo (feature freeze), mas o
// caminho existe e é curto: aba *Hábitos*, que fica na barra inferior do app (BottomNav.tsx:22).

const test = require('node:test');
const assert = require('node:assert');
const { pediuEdicaoDeHabito, respostaSemEdicaoDeHabito } = require('./habit-sem-edicao');

// ── QUANDO RECONHECER ────────────────────────────────────────────────────────────────────────
// O parser devolve os motivos no formato "action[i]:motivo". `unknown_action` é o rastro exato
// de "o LLM inventou uma ação que não existe" — foi assim que o update da Bianca caiu.
test('unknown_action é o sinal de capacidade ausente', () => {
  assert.equal(pediuEdicaoDeHabito(['action[0]:unknown_action']), true);
  assert.equal(pediuEdicaoDeHabito(['action[1]:bad_habit_id', 'action[2]:unknown_action']), true);
});

// Schema errado num verbo que EXISTE é outra história: ali o pedido é possível e vale pedir de
// novo. Mandar a pessoa pro app nesse caso seria empurrar trabalho que o TOM faz.
test('erro de schema em ação existente NÃO vira "vai no app"', () => {
  assert.equal(pediuEdicaoDeHabito(['action[0]:bad_habit_id']), false);
  assert.equal(pediuEdicaoDeHabito(['action[0]:name_missing']), false);
  assert.equal(pediuEdicaoDeHabito(['invalid_json: Unexpected token']), false);
});

test('sem motivos não inventa diagnóstico', () => {
  for (const v of [null, undefined, [], 'lixo', [null]]) assert.equal(pediuEdicaoDeHabito(v), false);
});

// ── A RESPOSTA ───────────────────────────────────────────────────────────────────────────────
test('caso Bianca: a confirmação falsa sai e o caminho entra', () => {
  const falaReal = 'Entendi: quer tirar o lembrete das 6h de *Tomar remédios*, certo?\n\n✅ Lembrete das 6h removido. O hábito continua existindo, só para de te chamar nesse horário.';
  const out = respostaSemEdicaoDeHabito(falaReal);
  assert.ok(!/removido/i.test(out), `a mentira sobreviveu: ${out}`);
  assert.match(out, /Hábitos/, 'sem o nome da aba não é caminho, é desculpa');
  assert.match(out, /app/i);
});

test('diz o que NÃO consegue antes de mandar pro app', () => {
  const out = respostaSemEdicaoDeHabito('✅ Pronto, mudei pra 7h!');
  assert.match(out, /n[ãa]o consigo|n[ãa]o dá|ainda não/i);
  assert.ok(!/mudei/i.test(out));
});

// O aviso genérico de falha técnica ("me manda de novo") não pode coexistir com este: um pede
// pra repetir, o outro diz que repetir não adianta. Este texto não dispara o chokepoint porque
// não afirma conclusão nenhuma — então ele não é seguido do aviso genérico.
test('a resposta não pede pra repetir o que nunca vai funcionar', () => {
  const out = respostaSemEdicaoDeHabito('✅ Removido!');
  assert.doesNotMatch(out, /me manda de novo|me pede de novo|tenta de novo/i);
});

test('a resposta não afirma conclusão — senão o chokepoint a rebaixaria', () => {
  const { hasCompletionClaim } = require('./optimistic-confirm');
  assert.equal(hasCompletionClaim(respostaSemEdicaoDeHabito('✅ Removido!')), false);
});

// A pergunta/contexto que veio antes é a parte verdadeira e sobrevive.
test('preserva o texto útil que não mente', () => {
  const out = respostaSemEdicaoDeHabito('Seu hábito *Tomar remédios* toca às 6h e às 20h.\n✅ Tirei o das 6h.');
  assert.match(out, /toca às 6h e às 20h/);
  assert.ok(!/Tirei/.test(out));
});

test('fala vazia devolve só o caminho, nunca string vazia', () => {
  for (const v of ['', null, undefined, '   ']) {
    const out = respostaSemEdicaoDeHabito(v);
    assert.match(out, /Hábitos/);
    assert.doesNotMatch(out, /undefined|null/);
  }
});
