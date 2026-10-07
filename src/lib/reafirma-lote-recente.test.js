'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { reafirmaLoteRecente } = require('./reafirma-lote-recente');

const DUDA = 'Já tá tudo concluído, Duda — essas 4 tarefas já foram fechadas no "confirmo" de agora há pouco. Não tem mais nada pendente pra fechar. 👍';
const T0 = Date.parse('2026-10-06T21:25:05Z');
const ESC = { executadas: 8, maisRecenteMs: Date.parse('2026-10-06T21:24:46Z') };

test('caso real Duda 06/10: reafirma o lote fechado 19s antes → veta o guard', () => {
  assert.strictEqual(reafirmaLoteRecente(DUDA, 'conclui todos', ESC, T0), true);
});
test('sem escrita recente no banco → não veta', () => {
  assert.strictEqual(reafirmaLoteRecente(DUDA, 'conclui todos', { executadas: 0, maisRecenteMs: null }, T0), false);
  assert.strictEqual(reafirmaLoteRecente(DUDA, 'conclui todos', { executadas: 8, maisRecenteMs: T0 - 300_000 }, T0), false);
});
test('pessoa pediu outra coisa (não repetiu conclusão) → não veta', () => {
  assert.strictEqual(reafirmaLoteRecente(DUDA, 'cria uma tarefa pra amanhã', ESC, T0), false);
});
test('número maior que o gravado → não veta', () => {
  const r = 'Já foram fechadas as 12 tarefas agora há pouco.';
  assert.strictEqual(reafirmaLoteRecente(r, 'conclui todos', ESC, T0), false);
});
test('afirma escrita NOVA (não é reafirmação) → não veta', () => {
  const r = 'Já tá feito — e criei mais uma pra amanhã.';
  assert.strictEqual(reafirmaLoteRecente(r, 'feito', ESC, T0), false);
});
test('Rafinha 01/10 (anotei mais esses 2, falso, 552s depois) → não veta', () => {
  const r = 'Beleza, anotei mais esses 2 — já são 5 no total.';
  assert.strictEqual(reafirmaLoteRecente(r, 'Dia 8/10 - evento barra', { executadas: 1, maisRecenteMs: T0 - 552_000 }, T0), false);
});
test('fiação: o veto entra na porta reportedState do engine', () => {
  const E = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  assert.match(E, /\|\| _reafirmaLote\n/);
});
