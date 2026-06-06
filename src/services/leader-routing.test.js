// src/services/leader-routing.test.js
// Trava o roteamento de liderança (GovLeader, caso Krissya 06/06). Fixtures espelham
// o org real da LA Music. Rodar: node --test src/services/leader-routing.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveLeadersOf, resolveLeaderIdsOf } = require('./leader-routing');

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

// ── Pedagógicos → AMBOS coordenadores ───────────────────────────────────────
test('Dai (pedagógico/all) → Juliana + Quintela', () => {
  assert.deepStrictEqual(ids(DAI), ['juliana', 'quintela']);
});
test('Peterson (pedagógico, sem unidade) → Juliana + Quintela (não fica só no CEO)', () => {
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
