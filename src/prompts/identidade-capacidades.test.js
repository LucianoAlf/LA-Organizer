'use strict';
// RECUSA-FALSA-DE-CAPACIDADE (triagem 11/09 — 96044578, 0d03301d, 1e85605f).
// O prompt de identidade declarava só que o TOM enxerga mídia (TOM-PDF-CAPABILITY-DENIED, 13/06).
// Rose 20/07: "Não tenho acesso às suas contas pessoais aqui" e, 40s depois, listou 10 contas
// pessoais dela. Rose 07/09: mostrou o saldo certo e se retratou ("não tenho como ver").
// Ana 25/06: negou que avisa quando a tarefa delegada fica pronta — o aviso existe (task-return).
const { test } = require('node:test');
const assert = require('node:assert');
const SYS = require('node:fs').readFileSync(require('node:path').join(__dirname, 'system.js'), 'utf8');
const ini = SYS.indexOf('const BLOCK_IDENTITY = `');
const IDENT = SYS.slice(ini, SYS.indexOf('`;', ini));

test('identidade declara que o TOM lê o financeiro pessoal e proíbe a recusa falsa', () => {
  assert.match(IDENT, /## Você LÊ o financeiro pessoal de quem usa/);
  assert.match(IDENT, /NUNCA diga "não tenho acesso às suas contas pessoais"/);
  assert.match(IDENT, /não se retrate dizendo que não consegue ver/);
});
test('identidade declara o aviso automático a quem delegou', () => {
  assert.match(IDENT, /## Você AVISA quem delegou/);
  assert.match(IDENT, /"você me avisa quando ficar pronta\?", a resposta é SIM/);
});
test('a declaração do aviso é verdadeira: o engine e o app notificam quem delegou na conclusão', () => {
  const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
  const API = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'internal-api.js'), 'utf8');
  assert.match(ENG, /taskReturn\.notifyTaskReturn\(\{ supabase, whatsapp, taskId: t\.id, actorId: collaborator\.id, kind: 'completion'/);
  assert.match(API, /taskReturn\.notifyTaskReturn\(\{ supabase, whatsapp, taskId, actorId, kind: 'completion'/);
});
