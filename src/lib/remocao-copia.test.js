'use strict';
// COPIA-REMOVER (decisão do Alf 11/09 — a4efeaa4).
const { test } = require('node:test');
const assert = require('node:assert');
const { lerRemocaoCopia } = require('./remocao-copia');

test('John 10/07: o marker REAL (title + watchers) é lido', () => {
  assert.deepStrictEqual(lerRemocaoCopia({ action: 'remove_watchers', title: 'Trancamento Pedro', watchers: ['John'] }),
    { id: null, busca: 'Trancamento Pedro', nomes: ['John'] });
});
test('forma espelhada do add_watchers (id + cc) e to_names; nomes repetidos/vazios somem', () => {
  assert.deepStrictEqual(lerRemocaoCopia({ id: 'ab12cd34', cc: ['Jereh', ' ', 'Jereh'] }), { id: 'ab12cd34', busca: null, nomes: ['Jereh'] });
  assert.deepStrictEqual(lerRemocaoCopia({ id: 'ab12cd34', to_names: ['Fefê', 'Yuri'] }).nomes, ['Fefê', 'Yuri']);
});
test('sem tarefa ou sem nome é recusado com motivo', () => {
  assert.deepStrictEqual(lerRemocaoCopia({ watchers: ['John'] }), { erro: 'bad_id' });
  assert.deepStrictEqual(lerRemocaoCopia({ title: 'Trancamento Pedro' }), { erro: 'remove_watchers:no_names' });
  assert.deepStrictEqual(lerRemocaoCopia(null), { erro: 'not_object' });
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
const SYS = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'prompts', 'system.js'), 'utf8');
test('engine: remove_watchers é ação válida, validada e executada', () => {
  assert.match(ENG, /'snooze_reminders', 'return', 'update', 'remove_watchers',/);
  assert.match(ENG, /\} else if \(a\.action === 'remove_watchers'\) \{\s*\/\/ COPIA-REMOVER \(decisão do Alf/);
  assert.match(ENG, /from\('task_watchers'\)\.delete\(\)\.eq\('task_id', t\.id\)\.in\('collaborator_id', _idsCopia\)/);
});
test('engine: quem está só em cópia tira a SI MESMO, nunca os outros', () => {
  assert.match(ENG, /_soEmCopia && _idsCopia\.some\(\(x\) => x !== collaborator\.id\)/);
});
test('prompt: ensina o remove_watchers', () => {
  assert.match(SYS, /pra TIRAR alguém da cópia, action=remove_watchers/);
});
