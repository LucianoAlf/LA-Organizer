'use strict';
// LIDER-FECHA-TAREFA-DE-OUTRO (decisão do Alf 11/09 — 60fbb2e3).
const { test } = require('node:test');
const assert = require('node:assert');
const { alcanceDoLider, podeFecharComoLider, filtroOrDoLider } = require('./lider-fecha-tarefa');

const ALF = { id: 'alf', role: 'director', is_ceo: true };
const GER = { id: 'ger', role: 'manager' };
const COORD = { id: 'coo', role: 'collaborator', has_coord_permissions: true };
const COMUM = { id: 'com', role: 'collaborator' };
const T = (x) => ({ id: 't', status: 'pending', assigned_to: 'yuri', created_by: 'yuri', governance_owner_id: null, recurrence_rule: null, recurrence_parent_id: null, ...x });

test('alcance: direção/CEO total; gerência e coordenação só as delegadas; colaborador comum nada', () => {
  assert.strictEqual(alcanceDoLider(ALF), 'total');
  assert.strictEqual(alcanceDoLider({ id: 'd', role: 'director' }), 'total');
  assert.strictEqual(alcanceDoLider(GER), 'delegadas');
  assert.strictEqual(alcanceDoLider({ id: 'c', role: 'coordinator' }), 'delegadas');
  assert.strictEqual(alcanceDoLider(COORD), 'delegadas');
  assert.strictEqual(alcanceDoLider(COMUM), null);
});
test('Alf 22/07: direção fecha a tarefa do Yuri', () => {
  assert.strictEqual(podeFecharComoLider(ALF, T()), true);
});
test('gerência/coordenação: só o que delegou ou cobra', () => {
  assert.strictEqual(podeFecharComoLider(GER, T()), false);
  assert.strictEqual(podeFecharComoLider(GER, T({ created_by: 'ger' })), true);
  assert.strictEqual(podeFecharComoLider(COORD, T({ governance_owner_id: 'coo' })), true);
});
test('nunca: colaborador comum, tarefa própria, fechada, cancelada ou molde de série', () => {
  assert.strictEqual(podeFecharComoLider(COMUM, T({ created_by: 'com' })), false);
  assert.strictEqual(podeFecharComoLider(ALF, T({ assigned_to: 'alf' })), false);
  assert.strictEqual(podeFecharComoLider(ALF, T({ status: 'done' })), false);
  assert.strictEqual(podeFecharComoLider(ALF, T({ status: 'cancelled' })), false);
  assert.strictEqual(podeFecharComoLider(ALF, T({ recurrence_rule: 'FREQ=DAILY' })), false);
});
test('filtro PostgREST do alcance', () => {
  assert.strictEqual(filtroOrDoLider(ALF), null);
  assert.strictEqual(filtroOrDoLider(GER), 'created_by.eq.ger,governance_owner_id.eq.ger');
  assert.strictEqual(filtroOrDoLider(GER, { incluiProprias: true }), 'created_by.eq.ger,governance_owner_id.eq.ger,assigned_to.eq.ger');
  assert.strictEqual(filtroOrDoLider(COMUM), null);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: conclusão por id cai no resolvedor do líder e grava com o dono real', () => {
  assert.match(ENG, /let t = await resolveTaskByShortId\(collaborator\.id, a\.id\);\s*if \(!t\) t = await resolveTaskParaLider\(collaborator, a\.id\);/);
  assert.match(ENG, /\.eq\('assigned_to', t\._comoLider \? t\.assigned_to : collaborator\.id\)/);
  assert.match(ENG, /await avisarDonoFechadaPeloLider\(t, collaborator\);/);
});
test('engine: conclusão por título, pergunta de fechamento e lote enxergam o alcance do líder', () => {
  assert.match(ENG, /complete LÍDER title-lookup/);
  assert.match(ENG, /if \(alcanceDoLider\(collab\)\) \{\s*const _fl = filtroOrDoLider\(collab, \{ incluiProprias: true \}\);/);
  assert.match(ENG, /resolveTaskByShortId: _resolverLider, collaboratorId: collab\.id,/);
});
