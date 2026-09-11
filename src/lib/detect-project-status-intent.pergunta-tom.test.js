'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectProjectStatusInTomQuestion: d } = require('./detect-project-status-intent');
const { resolveProjectByName } = require('./project-status');

// Arthur 17/07 19:51 (d0197281): pergunta em prosa do TOM, sem âncora → "Sim" → "não consegui registrar".
const ARTHUR = 'Quer encerrar o projeto *LA Teclas* de vez? Confirma.';

test('Arthur: a pergunta do TOM vira concluir o projeto LA Teclas', () => {
  const r = d(ARTHUR);
  assert.strictEqual(r.action, 'complete');
  assert.strictEqual(r.nameHint, 'LA Teclas');
  assert.strictEqual(r.viaProjectToken, true);
});

test('e resolve o projeto certo mesmo com um parecido na lista', () => {
  const vivos = [{ id: '1', name: 'LA Teclas' }, { id: '2', name: 'LA Teclas Kids' }];
  const r = resolveProjectByName(vivos, d(ARTHUR).nameHint, null);
  assert.deepStrictEqual([r.status, r.project && r.project.id], ['match', '1']);
});

test('pergunta que termina em "?" também serve (cancelar)', () => {
  const r = d('Cancelo o projeto Recital de Inverno? Confirma?');
  assert.deepStrictEqual([r.action, r.nameHint], ['cancel', 'Recital de Inverno']);
});

test('pergunta sobre TAREFA, ou sem verbo de status, nunca vira mudança de projeto', () => {
  assert.strictEqual(d('Quer que eu conclua a tarefa Relatório? Confirma.'), null);
  assert.strictEqual(d('Confirma o nome do projeto LA Teclas?'), null);
  assert.strictEqual(d(''), null);
  // "tirar do sistema" sem o token "projeto" o detector aceita (via 3, pode ser tarefa) — aqui NÃO.
  assert.strictEqual(d('Tiro a tarefa Relatório do sistema? Confirma.'), null);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: o "sim" à pergunta sem âncora usa o mesmo executor', () => {
  assert.match(ENG, /!i\.payload\.anchor\s*\n\s*&& withinConfirmWindow\(i\.asked_at, 60\) && detectProjectStatusInTomQuestion\(i\.question_text\)/);
  assert.match(ENG, /via:pergunta_sem_ancora/);
  assert.match(ENG, /\/\/ \(a2\) PROJETO-SIM-SEM-ANCORA[\s\S]{0,4000}\/\/ \(b\) nova intenção "fecha\/cancela o projeto X"/);
});
