'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { separarTarefaQueEEvento } = require('./tarefa-que-e-evento');

test('caso real Alf 07/10: complete de tarefa com o id da Mentoria Levi, que o EVENT_UPDATE do turno já conclui → sai do lote', () => {
  const tarefa = [{ action: 'complete', id: 'd898903f-0c00-4bc1-8bed-2f75fbdb7cc3' }];
  const evento = [{ action: 'complete', id: 'd898903f' }, { action: 'complete', id: 'e9d192a4' }, { action: 'complete', id: 'e29bf364' }];
  const r = separarTarefaQueEEvento(tarefa, evento);
  assert.deepStrictEqual(r.ficam, []);
  assert.strictEqual(r.duplicadas.length, 1);
});
test('tarefa de verdade no mesmo turno continua no lote', () => {
  const r = separarTarefaQueEEvento([{ action: 'complete', id: 'aaaaaaaa-1' }, { action: 'complete', title: 'Pagar luz' }], [{ action: 'complete', id: 'd898903f' }]);
  assert.strictEqual(r.ficam.length, 2);
  assert.strictEqual(r.duplicadas.length, 0);
});
test('sem EVENT_UPDATE no turno nada sai (falha honesta segue)', () => {
  const r = separarTarefaQueEEvento([{ action: 'complete', id: 'd898903f-0c00' }], null);
  assert.strictEqual(r.ficam.length, 1);
});
test('fiação: o engine separa antes de executar o lote de tarefa', () => {
  const E = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  const i = E.indexOf('let parsedTask = parseTaskUpdateMarker(reply);');
  assert.ok(i > 0);
  assert.match(E.slice(i, i + 2500), /separarTarefaQueEEvento\(parsedTask\.actions/);
});
