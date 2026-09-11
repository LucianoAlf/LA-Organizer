'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { complementoDeTarefa: c, alvosDoComplemento: alvos, textoComplemento } = require('./complemento-tarefa');

// Krissya 10/07 16:48 (6a563996) — a fala real do TOM que criou as duas tarefas, e o complemento.
const FALA_TOM = 'Essas faltas precisam ser lançadas no eMusys ou na planilha de presença — não consigo registrar direto, mas crio as tarefas pra você não perder:\n\n✅ Criadas:\n• Lançar falta do Jeyson — quarta 08/07\n• Lançar falta do Gabriel Antony — hoje 10/07';
const NOVAS = [
  { id: 'j', title: 'Lançar falta do Jeyson — quarta 08/07' },
  { id: 'g', title: 'Lançar falta do Gabriel Antony — hoje 10/07' },
];

test('Krissya: "Na planilha de presença" é complemento', () => {
  assert.strictEqual(c('Na planilha de presença'), 'Na planilha de presença');
  assert.strictEqual(c('no eMusys.'), 'no eMusys');
  assert.strictEqual(c('com a Rose'), 'com a Rose');
});

test('não é complemento: data solta, pergunta, verbo de ação, frase longa', () => {
  assert.strictEqual(c('Hoje'), null);
  assert.strictEqual(c('Na planilha de presença?'), null);
  assert.strictEqual(c('na segunda remarca tudo'), null);
  assert.strictEqual(c('no fim do dia eu te aviso se deu pra lançar tudo'), null);
  assert.strictEqual(c(''), null);
});

test('alvos: as duas recém-criadas que a fala do TOM anunciou — não as outras', () => {
  const outra = { id: 'x', title: 'Resolver a questão do Bernardo' };
  assert.deepStrictEqual(alvos([...NOVAS, outra], FALA_TOM).map((t) => t.id), ['j', 'g']);
  assert.deepStrictEqual(alvos(NOVAS, 'Beleza, anotado.'), []);
  assert.deepStrictEqual(alvos(NOVAS, ''), []);
});

test('resposta nomeia as tarefas e o complemento', () => {
  assert.strictEqual(textoComplemento(NOVAS, 'Na planilha de presença'),
    '📝 Anotei em *Lançar falta do Jeyson — quarta 08/07* e *Lançar falta do Gabriel Antony — hoje 10/07*: _Na planilha de presença_.');
  assert.strictEqual(textoComplemento([NOVAS[0]], 'no eMusys'), '📝 Anotei em *Lançar falta do Jeyson — quarta 08/07*: _no eMusys_.');
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: complemento pré-LLM só com tarefas de até 5 min citadas na última fala', () => {
  assert.match(ENG, /const _fragC = complementoDeTarefa\(stripReplyScaffold\(String\(text \|\| ''\)\)\.userText\);/);
  assert.match(ENG, /const _desdeC = new Date\(Date\.now\(\) - 5 \* 60000\)\.toISOString\(\);/);
  assert.match(ENG, /alvosDoComplemento\(_novasC \|\| \[\], _ultC && _ultC\[0\] && _ultC\[0\]\.content\)/);
});
