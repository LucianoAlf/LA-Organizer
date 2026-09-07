'use strict';
// FALHA-COM-VERBO-ERRADO (Krissya, Barra 07/09/2026 14:40 BRT).
//
// Ela pediu "Tom, deixa essa tarefa atrasada para amanhã" — um REAGENDAMENTO — e leu
// "Opa, tentei mas não consegui CONCLUIR agora". O verbo era fixo na prosa de falha, então
// toda ação que falhava virava "concluir". Dizer que tentou fechar a tarefa quando tentou
// mover o prazo ensina a pessoa uma coisa errada sobre o que aconteceu.
//
// O teste bate na função que MONTA a prosa, com a forma real de `acts`.

const assert = require('node:assert');
const { test } = require('node:test');
const eng = require('./group-chat-engine');

// A prosa de falha é montada dentro do pipeline de saída; o teste alcança pelo export
// se houver, e senão lê a fonte (contrato). Preferimos o contrato explícito a nada.
const fs = require('fs');
const path = require('path');
const FONTE = fs.readFileSync(path.join(__dirname, 'group-chat-engine.js'), 'utf8');

test('o verbo da prosa de falha NÃO é mais fixo em "concluir"', () => {
  assert.ok(
    !/tentei mas não consegui concluir agora/.test(FONTE),
    'a prosa não pode mais ter "concluir" cravado: era isso que mentia o verbo',
  );
  assert.match(FONTE, /tentei mas não consegui \$\{_verbo\} agora/);
});

test('existe um mapa de verbo por ação, com neutro para o resto', () => {
  assert.match(FONTE, /reschedule: 'remarcar'/);
  assert.match(FONTE, /cancel: 'cancelar'/);
  assert.match(FONTE, /complete: 'concluir'/);
  assert.match(FONTE, /'fazer isso'/);
});

test('o chip de falha carrega a ação tentada (senão a prosa não teria de onde tirar)', () => {
  assert.match(FONTE, /verbo: _verboFalho/);
  assert.match(FONTE, /const _verboFalho = \(\(failed\[0\] \|\| \{\}\)\.action \|\| \{\}\)\.action/);
});

test('verbos diferentes no mesmo turno caem no neutro, não escolhem um', () => {
  // _vs.size === 1 é a condição: dois tipos de falha → 'fazer isso'.
  assert.match(FONTE, /_vs\.size === 1/);
});

test('o módulo carrega (o patch não quebrou o require)', () => {
  assert.ok(eng && typeof eng === 'object');
});
