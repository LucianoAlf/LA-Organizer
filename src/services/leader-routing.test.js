// src/services/leader-routing.test.js
// Trava o roteamento de liderança (GovLeader, caso Krissya 06/06). Fixtures espelham
// o org real da LA Music. Rodar: node --test src/services/leader-routing.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveLeadersOf, resolveLeaderIdsOf, groupLeaderIdsFor } = require('./leader-routing');

// ── Fixtures (subset do org real) ───────────────────────────────────────────
const CEO       = { id: 'ceo',      full_name: 'Luciano Alf', role: 'director',    function_role: null,          unit: 'all',          is_ceo: true,  is_active: true };
const KRISSYA   = { id: 'krissya',  full_name: 'Krissya',     role: 'manager',     function_role: null,          unit: 'barra',        is_ceo: false, is_active: true, supervisor_id: 'ceo' };
const JEREH     = { id: 'jereh',    full_name: 'Jereh',       role: 'manager',     function_role: null,          unit: 'campo_grande', is_ceo: false, is_active: true, supervisor_id: 'ceo' };
const CLAYTON   = { id: 'clayton',  full_name: 'Clayton',     role: 'manager',     function_role: null,          unit: 'recreio',      is_ceo: false, is_active: true, supervisor_id: 'ceo' };
const YURI      = { id: 'yuri',     full_name: 'Yuri',        role: 'manager',     function_role: 'marketing',   unit: 'all',          is_ceo: false, is_active: true, supervisor_id: 'ceo' };
const JULIANA   = { id: 'juliana',  full_name: 'Juliana',     role: 'coordinator', function_role: 'pedagogico',  unit: 'all',          is_ceo: false, is_active: true, supervisor_id: 'ceo' };
const QUINTELA  = { id: 'quintela', full_name: 'Quintela',    role: 'coordinator', function_role: 'pedagogico',  unit: 'all',          is_ceo: false, is_active: true, supervisor_id: 'ceo' };

const ARTHUR    = { id: 'arthur',   full_name: 'Arthur',      role: 'collaborator', function_role: 'farmer',     unit: 'barra',        is_ceo: false, is_active: true, supervisor_id: null };
const GABI      = { id: 'gabi',     full_name: 'Gabi',        role: 'collaborator', function_role: 'farmer',     unit: 'campo_grande', is_ceo: false, is_active: true, supervisor_id: null };
const JHONATAN  = { id: 'jhonatan', full_name: 'Jhonatan',    role: 'collaborator', function_role: 'farmer',     unit: 'campo_grande', is_ceo: false, is_active: true, supervisor_id: null }; // já com unit corrigida
const KAILANE   = { id: 'kailane',  full_name: 'Kailane',     role: 'collaborator', function_role: null,         unit: 'barra',        is_ceo: false, is_active: true, supervisor_id: null };
const LEO       = { id: 'leo',      full_name: 'Leo',         role: 'collaborator', function_role: 'pedagogico',  unit: 'barra',        is_ceo: false, is_active: true, supervisor_id: 'krissya' };
const DAI       = { id: 'dai',      full_name: 'Dai',         role: 'collaborator', function_role: 'pedagogico',  unit: 'all',          is_ceo: false, is_active: true, supervisor_id: 'juliana' };
const PETERSON  = { id: 'peterson', full_name: 'Peterson',    role: 'collaborator', function_role: 'pedagogico',  unit: null,           is_ceo: false, is_active: true, supervisor_id: 'ceo' };
const JOHN      = { id: 'john',     full_name: 'John',        role: 'collaborator', function_role: 'marketing',   unit: 'all',          is_ceo: false, is_active: true, supervisor_id: null };
const RAFINHA   = { id: 'rafinha',  full_name: 'Rafinha',     role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all',         is_ceo: false, is_active: true, supervisor_id: 'ceo' };
const KINHO_OFF = { id: 'kinho',    full_name: 'Kinho',       role: 'collaborator', function_role: 'pedagogico',  unit: null,           is_ceo: false, is_active: false, supervisor_id: null };

const ALL = [CEO, KRISSYA, JEREH, CLAYTON, YURI, JULIANA, QUINTELA, ARTHUR, GABI, JHONATAN, KAILANE, LEO, DAI, PETERSON, JOHN, RAFINHA, KINHO_OFF];

// Líderes de grupo (governance_leaders) — anexa group_leader_ids como o loader real faz.
const GROUP_LEADERS = [
  { group_key: 'pedagogico', unit: 'all', leader_id: 'juliana' },
  { group_key: 'pedagogico', unit: 'all', leader_id: 'quintela' },
  { group_key: 'marketing',  unit: 'all', leader_id: 'yuri' },
];
for (const c of ALL) c.group_leader_ids = groupLeaderIdsFor(c, GROUP_LEADERS);

const ids = (collab) => resolveLeaderIdsOf(collab, ALL).sort();

// ── Farmers/comercial por unidade → gerente da unidade ──────────────────────
test('Arthur (farmer/Barra) → Krissya', () => {
  assert.deepStrictEqual(ids(ARTHUR), ['krissya']);
});
test('Gabi (farmer/Campo Grande) → Jereh', () => {
  assert.deepStrictEqual(ids(GABI), ['jereh']);
});
test('Jhonatan (farmer/Campo Grande após fix) → Jereh', () => {
  assert.deepStrictEqual(ids(JHONATAN), ['jereh']);
});
test('Kailane (comercial/Barra, sem function_role) → Krissya', () => {
  assert.deepStrictEqual(ids(KAILANE), ['krissya']);
});

// ── Pedagógicos → AMBOS coordenadores (os dois veem todos) ───────────────────
test('Dai (pedagógico, supervisor=Juliana) → Juliana + Quintela (os dois veem)', () => {
  assert.deepStrictEqual(ids(DAI), ['juliana', 'quintela']);
});
test('Peterson (pedagógico, supervisor=CEO) → Juliana + Quintela', () => {
  assert.deepStrictEqual(ids(PETERSON), ['juliana', 'quintela']);
});

// ── Leo = pedagógico + Barra → fan-out triplo ───────────────────────────────
test('Leo (pedagógico/Barra) → Juliana + Quintela + Krissya (3 líderes)', () => {
  assert.deepStrictEqual(ids(LEO), ['juliana', 'krissya', 'quintela']);
});

// ── Marketing → Yuri ────────────────────────────────────────────────────────
test('John (marketing) → Yuri', () => {
  assert.deepStrictEqual(ids(JOHN), ['yuri']);
});
test('grupo via tabela: comercial (global) cai no líder comercial', () => {
  const GL = [{ group_key: 'comercial', unit: 'all', leader_id: 'cm' }];
  const CM = { id: 'cm', role: 'manager', function_role: 'comercial', unit: 'all', is_ceo: false, is_active: true };
  const CC = { id: 'cc', role: 'collaborator', function_role: 'comercial', unit: 'all', is_ceo: false, is_active: true, group_leader_ids: groupLeaderIdsFor({ function_role: 'comercial', unit: 'all' }, GL) };
  assert.deepStrictEqual(resolveLeaderIdsOf(CC, [CEO, CM, CC]), ['cm']);
});
test('groupLeaderIdsFor: farmer por unidade casa só a unidade; global casa todas', () => {
  const GL = [
    { group_key: 'farmer', unit: 'campo_grande', leader_id: 'gabi' },
    { group_key: 'farmer', unit: 'recreio', leader_id: 'fefe' },
    { group_key: 'comercial', unit: 'all', leader_id: 'kr' },
  ];
  assert.deepStrictEqual(groupLeaderIdsFor({ function_role: 'farmer', unit: 'campo_grande' }, GL), ['gabi']);
  assert.deepStrictEqual(groupLeaderIdsFor({ function_role: 'farmer', unit: 'recreio' }, GL), ['fefe']);
  assert.deepStrictEqual(groupLeaderIdsFor({ function_role: 'comercial', unit: 'barra' }, GL), ['kr']);
  assert.deepStrictEqual(groupLeaderIdsFor({ function_role: null, unit: 'barra' }, GL), []);
});

// ── Órfãos / ops / líderes → CEO ────────────────────────────────────────────
test('Rafinha (ops_tecnicas) → CEO', () => {
  assert.deepStrictEqual(ids(RAFINHA), ['ceo']);
});
test('Krissya (manager) → CEO (tarefa do próprio gerente sobe pro CEO, não some)', () => {
  assert.deepStrictEqual(ids(KRISSYA), ['ceo']);
});
test('Juliana (coordinator) → CEO, NUNCA pra Quintela (par não é líder de par)', () => {
  assert.deepStrictEqual(ids(JULIANA), ['ceo']);
});

// ── Garantias estruturais ───────────────────────────────────────────────────
test('nunca roteia pra si mesmo', () => {
  for (const c of ALL) {
    assert.ok(!resolveLeaderIdsOf(c, ALL).includes(c.id), `${c.full_name} roteou pra si`);
  }
});
test('só líderes ativos — Kinho (inativo) nunca aparece como líder de ninguém', () => {
  for (const c of ALL) {
    assert.ok(!resolveLeaderIdsOf(c, ALL).includes('kinho'), `${c.full_name} roteou p/ Kinho inativo`);
  }
});
test('todo colaborador tem ao menos 1 líder (ninguém fica órfão de cobrança)', () => {
  for (const c of ALL.filter((x) => !x.is_ceo && x.is_active)) {
    assert.ok(resolveLeaderIdsOf(c, ALL).length >= 1, `${c.full_name} ficou sem líder`);
  }
});
test('entradas inválidas não quebram', () => {
  assert.deepStrictEqual(resolveLeadersOf(null, ALL), []);
  assert.deepStrictEqual(resolveLeadersOf(ARTHUR, null), []);
  assert.deepStrictEqual(resolveLeadersOf(undefined, undefined), []);
});

// ── Override manual (explicit_leader_ids) ───────────────────────────────────
test('aresta explícita define o líder (Dudu → Rafinha, não cai no CEO)', () => {
  const RAF  = { id: 'raf',  role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all', is_ceo: false, is_active: true };
  const DUDU = { id: 'dudu', role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all', is_ceo: false, is_active: true, explicit_leader_ids: ['raf'] };
  const arr = [CEO, RAF, DUDU];
  assert.deepStrictEqual(resolveLeaderIdsOf(DUDU, arr), ['raf']);
});
test('aresta soma aos líderes de grupo e deduplica (pedagógico + aresta Juliana = ju+qt)', () => {
  const X = { id: 'x', role: 'collaborator', function_role: 'pedagogico', unit: 'all', is_ceo: false, is_active: true,
    explicit_leader_ids: ['juliana'], group_leader_ids: groupLeaderIdsFor({ function_role: 'pedagogico', unit: 'all' }, GROUP_LEADERS) };
  assert.deepStrictEqual(resolveLeaderIdsOf(X, [...ALL, X]).sort(), ['juliana', 'quintela']);
});
test('aresta apontando o CEO é ignorada → fallback CEO', () => {
  const X = { id: 'x2', role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all', is_ceo: false, is_active: true, explicit_leader_ids: ['ceo'] };
  assert.deepStrictEqual(resolveLeaderIdsOf(X, [CEO, X]), ['ceo']);
});
