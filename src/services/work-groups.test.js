// node --test — resolução de grupo de trabalho por nome/slug (spec grupos-de-trabalho)
const { test } = require('node:test');
const assert = require('node:assert');
const { slugify, resolveGroupByName, memberIdsOf, isMember } = require('./work-groups');

const groups = [
  { id: 'g-fin', name: 'Financeiro', slug: 'financeiro', leader_id: 'id-rose', active: true,
    members: [{ collaborator_id: 'id-rose', full_name: 'Rose' }, { collaborator_id: 'id-ana', full_name: 'Ana Paula' }] },
  { id: 'g-ped', name: 'Pedagógico Barra', slug: 'pedagogico-barra', leader_id: 'id-leo', active: true,
    members: [{ collaborator_id: 'id-leo', full_name: 'Léo' }] },
  { id: 'g-ped2', name: 'Pedagógico Recreio', slug: 'pedagogico-recreio', leader_id: 'id-dai', active: true,
    members: [{ collaborator_id: 'id-dai', full_name: 'Dai' }] },
];

test('slugify: minúsculo, sem acento, hífens', () => {
  assert.equal(slugify('Financeiro'), 'financeiro');
  assert.equal(slugify('Pedagógico Barra'), 'pedagogico-barra');
  assert.equal(slugify('  Operações  CG '), 'operacoes-cg');
});

test('match exato por nome ou slug, case/acento-insensível', () => {
  assert.equal(resolveGroupByName(groups, 'financeiro').group.id, 'g-fin');
  assert.equal(resolveGroupByName(groups, 'FINANCEIRO').group.id, 'g-fin');
  assert.equal(resolveGroupByName(groups, 'Pedagógico Barra').group.id, 'g-ped');
  assert.equal(resolveGroupByName(groups, 'pedagogico-barra').group.id, 'g-ped');
});

test('prefixo único resolve; ambíguo devolve candidates sem chutar', () => {
  assert.equal(resolveGroupByName(groups, 'finan').group.id, 'g-fin');
  const amb = resolveGroupByName(groups, 'pedagogico');
  assert.equal(amb.group, null);
  assert.deepEqual(amb.candidates.map((g) => g.id).sort(), ['g-ped', 'g-ped2']);
});

test('não encontrado → group null e candidates vazio', () => {
  const r = resolveGroupByName(groups, 'marketing');
  assert.equal(r.group, null);
  assert.deepEqual(r.candidates, []);
});

test('memberIdsOf e isMember', () => {
  assert.deepEqual(memberIdsOf(groups[0]).sort(), ['id-ana', 'id-rose']);
  assert.equal(isMember(groups[0], 'id-ana'), true);
  assert.equal(isMember(groups[0], 'id-leo'), false);
});
