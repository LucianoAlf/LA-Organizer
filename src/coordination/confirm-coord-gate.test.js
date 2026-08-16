'use strict';
// confirm-coord-gate.test.js — Fatia 8. podeLiberarRecado decide se a pergunta de confirmação SEM
// payload executável é uma proposta de RECADO (então o "sim" pode compor+despachar em vez de o LLM
// desistir). Espelha o confirm-create-gate. Rodar: node --test src/coordination/confirm-coord-gate.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { podeLiberarRecado } = require('./confirm-coord-gate');

test('proposta de recado → true', () => {
  assert.strictEqual(podeLiberarRecado('Mando um agradecimento pro Jhonatan? Confirma?'), true);
  assert.strictEqual(podeLiberarRecado('Aviso o Yuri sobre a reunião? Confirma?'), true);
  assert.strictEqual(podeLiberarRecado('Aviso 2 pessoas (Rafael, Gabriel)? Confirma?'), true);
  assert.strictEqual(podeLiberarRecado('Mando um recado pro Alf? Confirma?'), true);
  assert.strictEqual(podeLiberarRecado('Aviso o Alf sobre os calendários das escolas? Confirma?'), true);
});

test('fechamento / delegação / criação / vazio → false (fail-closed)', () => {
  assert.strictEqual(podeLiberarRecado('Confirma o fechamento destas 2 tarefas: *X*, *Y*?'), false);
  assert.strictEqual(podeLiberarRecado('Delego a tarefa *X* pro Alf e tiro da sua fila? Confirma?'), false);
  assert.strictEqual(podeLiberarRecado('Crio a tarefa de ligar amanhã às 10h? Confirma?'), false);
  assert.strictEqual(podeLiberarRecado('Confirma?'), false);
  for (const v of [null, undefined, '', '   ', 42]) assert.strictEqual(podeLiberarRecado(v), false);
});

test('veto: recado que TAMBÉM mexe em item existente → false', () => {
  // "avisa e cancela a reunião" — o cancel (ação sobre existente) veta.
  assert.strictEqual(podeLiberarRecado('Aviso o Yuri e cancelo a reunião? Confirma?'), false);
});
