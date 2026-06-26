'use strict';
// ============================================================================
// RAIZ 3 — backstop anti-duplicata de conta fixa (pf_bills).
// F0 (golden, RED antes do F3): caracteriza o createBill REAL como find-or-upsert.
// O dedup vivia SÓ na app e vazava (LLM/UTC/re-import) → a 2ª conta nascia e vivia.
// createBill passa a ser a 1ª linha de defesa (find-or-upsert); o índice parcial
// (F2) é o backstop do banco. Aqui exercito a FUNÇÃO REAL com fake supabase
// in-memory (não mock vazio) — Module._load injeta o fake no require do client.
//
// 4 casos do find-or-upsert + 1 de corrida (23505 grácil = prova o catch do F3).
// ============================================================================
const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const fake = makeFake();
Module._load = (function (orig) {
  return function (req, ...args) {
    if (req.includes('supabase/client')) return fake;
    return orig.call(this, req, ...args);
  };
})(Module._load);

const { createBill } = require('./financeiro-service');

const CID = 'collab-1';

// ── F0-1: nome novo monthly → INSERT (1 linha), updated:false ──
test('F0-1 — nome novo monthly → INSERT (1 linha, updated:false)', async () => {
  fake.__reset();
  const r = await createBill(CID, { name: 'Aluguel', amount: 1200, due_day: 5, category: 'moradia' });
  assert.strictEqual(r.updated, false);
  assert.strictEqual(r.name, 'Aluguel');
  assert.strictEqual(fake.__rows('pf_bills').length, 1);
});

// ── F0-2: mesmo nome ATIVO monthly (case-insensitive) → UPDATE a existente, NÃO cria 2ª ──
test('F0-2 — mesmo nome ativo monthly (case-insensitive "Aluguel"/"aluguel") → UPDATE, não cria 2ª', async () => {
  fake.__reset();
  await createBill(CID, { name: 'Aluguel', amount: 1200, due_day: 5, category: 'moradia' });
  const r = await createBill(CID, { name: 'aluguel', amount: 1350, due_day: 6, category: 'casa', remind_days_before: 3 });
  assert.strictEqual(r.updated, true);
  const rows = fake.__rows('pf_bills');
  assert.strictEqual(rows.length, 1, 'continua 1 linha (dedup)');
  assert.strictEqual(rows[0].amount, 1350, 'amount atualizado');
  assert.strictEqual(rows[0].due_day, 6, 'due_day atualizado');
  assert.strictEqual(rows[0].category, 'casa', 'category atualizada');
  assert.strictEqual(rows[0].remind_days_before, 3, 'remind_days_before atualizado');
});

// ── F0-3: recurrence='once' → SEMPRE INSERT (isento de dedup), mesmo nome de uma monthly ──
test('F0-3 — once → sempre INSERT (isento), convive com a monthly de mesmo nome', async () => {
  fake.__reset();
  await createBill(CID, { name: 'IPVA', amount: 800, due_day: 10, category: 'imposto' });
  const r = await createBill(CID, { name: 'IPVA', amount: 800, recurrence: 'once', due_date: '2026-07-20', category: 'imposto' });
  assert.strictEqual(r.updated, false);
  assert.strictEqual(fake.__rows('pf_bills').length, 2, 'once cria linha própria, não deduplica');
});

// ── F0-4: nome igual mas existente is_active=false → INSERT (histórico não bloqueia) ──
test('F0-4 — existente INATIVA (histórico) não bloqueia → INSERT nova ativa', async () => {
  fake.__reset();
  fake.__seed('pf_bills', { id: 'old', collaborator_id: CID, name: 'Aluguel', amount: 1000, due_day: 5, category: 'moradia', type: 'expense', recurrence: 'monthly', is_active: false });
  const r = await createBill(CID, { name: 'Aluguel', amount: 1200, due_day: 5, category: 'moradia' });
  assert.strictEqual(r.updated, false, 'inativa não casa → cria nova');
  const ativasMonthly = fake.__rows('pf_bills').filter((b) => b.is_active !== false && b.recurrence === 'monthly');
  assert.strictEqual(ativasMonthly.length, 1, '1 ativa monthly');
  assert.strictEqual(fake.__rows('pf_bills').length, 2, 'histórico inativo preservado + nova');
});

// ── F0-5: CORRIDA/leak — find viu 0 mas o índice mordeu (23505) → re-find → UPDATE grácil.
//    NUNCA propaga erro pro chamador (senão regride FIN-BILL-DEFEATIST). É o catch do F3. ──
test('F0-5 — corrida: insert bate 23505 → re-find → UPDATE, NUNCA propaga erro', async () => {
  fake.__reset();
  // simula o concorrente: o próximo insert "descobre" a linha já criada por outro processo e devolve 23505
  fake.__raceNextInsert({ id: 'race', collaborator_id: CID, name: 'Aluguel', amount: 1200, due_day: 5, category: 'moradia', type: 'expense', recurrence: 'monthly', is_active: true });
  const r = await createBill(CID, { name: 'Aluguel', amount: 1290, due_day: 7, category: 'moradia' });
  assert.strictEqual(r.updated, true, 'tratou 23505 como UPDATE grácil');
  const rows = fake.__rows('pf_bills');
  assert.strictEqual(rows.length, 1, 'só a linha do concorrente, atualizada (sem 2ª)');
  assert.strictEqual(rows[0].amount, 1290, 'patch aplicado no re-find');
  assert.strictEqual(rows[0].due_day, 7);
});

// ============================================================================
// Fake Supabase in-memory — chain encadeável e thenable, respeita .single() em
// insert/update/select; __raceNextInsert simula o índice mordendo numa corrida.
// ============================================================================
function makeFake() {
  let store = {};
  let idc = 0;
  let raceRow = null;
  function builder(table) {
    const st = { table, op: 'select', eqs: [], payload: null, single: false };
    const api = {
      select() { return api; },
      insert(rows) { st.op = 'insert'; st.payload = Array.isArray(rows) ? rows : [rows]; return api; },
      update(patch) { st.op = 'update'; st.payload = patch; return api; },
      delete() { st.op = 'delete'; return api; },
      eq(c, v) { st.eqs.push([c, v]); return api; },
      is(c, v) { st.eqs.push([c, v]); return api; },
      ilike() { return api; },
      order() { return api; },
      limit() { return api; },
      single() { st.single = true; return api; },
      maybeSingle() { st.single = true; return api; },
      then(res, rej) { return Promise.resolve().then(() => resolve(st)).then(res, rej); },
    };
    return api;
  }
  function matches(r, st) { return st.eqs.every(([c, v]) => r[c] === v); }
  function resolve(st) {
    const rows = store[st.table] || (store[st.table] = []);
    if (st.op === 'insert') {
      if (raceRow) { // corrida: o concorrente já inseriu → índice morde, retorna 23505 (NÃO lança)
        rows.push({ ...raceRow });
        raceRow = null;
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "pf_bills_active_monthly_uq"' } };
      }
      // pf_bills.is_active default no banco = true (DDL). O find seguinte filtra is_active=true,
      // então a linha recém-criada PRECISA herdar o default — senão o fake diverge do banco real.
      const ins = st.payload.map((r) => ({ is_active: true, ...r, id: r.id || `fk-${++idc}` }));
      rows.push(...ins);
      return { data: st.single ? ins[0] : ins, error: null };
    }
    if (st.op === 'update') {
      const hit = rows.filter((r) => matches(r, st));
      hit.forEach((r) => Object.assign(r, st.payload));
      return { data: st.single ? (hit[0] ? { ...hit[0] } : null) : hit.map((r) => ({ id: r.id })), error: null };
    }
    if (st.op === 'delete') { store[st.table] = rows.filter((r) => !matches(r, st)); return { data: null, error: null }; }
    const out = rows.filter((r) => matches(r, st));
    return { data: st.single ? (out[0] || null) : out, error: null };
  }
  return {
    from: (t) => builder(t),
    __reset() { store = {}; idc = 0; raceRow = null; },
    __rows(t) { return store[t] || []; },
    __seed(t, row) { (store[t] || (store[t] = [])).push(row); },
    __raceNextInsert(row) { raceRow = row; },
  };
}
