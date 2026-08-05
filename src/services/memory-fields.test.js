'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extrairConteudoMemoria, CHAVES_CONTEUDO } = require('./memory-fields');

// ── Caso Matheus, 04/08/2026 ──────────────────────────────────────────────────
// Ele pediu TRÊS vezes, em maiúsculas, que não o cobrassem antes de quinta. As duas
// primeiras foram recusadas pelo NOSSO validador: o TOM escreveu o texto em `body`, e o
// parser aceitava só content/text/value. `MEMORY_SAVE/rejected:schema_invalid` — nada
// persistiu, o TOM respondeu "anotado" mesmo assim, e ele teve que repetir.
//
// O contrato do parser era mais estreito que a variação natural do modelo. Corrigir é
// aceitar a variação onde ela é inequívoca — e, quando NENHUMA chave casar, dizer quais
// vieram, para o próximo desvio não exigir arqueologia no banco.
test('payload REAL do Matheus (usa `body`) é aceito', () => {
  const r = extrairConteudoMemoria({
    type: 'feedback',
    title: 'Não cobrar antes do prazo reagendado',
    body: 'Quando Matheus reagenda uma tarefa pra um dia específico, NÃO cobrar antes desse dia.',
  });
  assert.ok(r.ok, 'rejeitado — foi isso que fez ele repetir 3x');
  assert.match(r.content, /NÃO cobrar antes desse dia/);
});

for (const chave of ['content', 'text', 'value', 'body']) {
  test(`aceita \`${chave}\` como conteúdo`, () => {
    const r = extrairConteudoMemoria({ [chave]: 'lembrar disso' });
    assert.equal(r.ok, true);
    assert.equal(r.content, 'lembrar disso');
  });
}

test('precedência: content ganha de body quando os dois vêm', () => {
  const r = extrairConteudoMemoria({ content: 'canônico', body: 'secundário' });
  assert.equal(r.content, 'canônico');
});

test('string vazia ou só espaço não conta como conteúdo', () => {
  assert.equal(extrairConteudoMemoria({ content: '   ' }).ok, false);
  assert.equal(extrairConteudoMemoria({ body: '' }).ok, false);
});

test('valor não-string é recusado (objeto aninhado não vira memória)', () => {
  assert.equal(extrairConteudoMemoria({ content: { texto: 'x' } }).ok, false);
});

// A instrumentação é metade do fix: sem ela, o próximo campo novo custa uma
// investigação no banco — foi o que custou neste caso.
test('quando nada casa, o motivo DIZ quais chaves vieram', () => {
  const r = extrairConteudoMemoria({ type: 'feedback', title: 'x', observacao: 'y' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /observacao/, 'o motivo tem que nomear a chave desconhecida');
  assert.match(r.motivo, /missing_content/);
});

test('row nulo/inválido não explode', () => {
  assert.equal(extrairConteudoMemoria(null).ok, false);
  assert.equal(extrairConteudoMemoria(undefined).ok, false);
  assert.equal(extrairConteudoMemoria('texto solto').ok, false);
});

test('a lista de chaves aceitas é explícita e fechada', () => {
  assert.deepEqual(CHAVES_CONTEUDO, ['content', 'text', 'value', 'body']);
});
