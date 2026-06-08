// scripts/smoke-active-window.js
'use strict';
const assert = require('assert');
const { getActiveWindow } = require('../src/services/active-window');

// Supabase fake: builder encadeável; .gte (último elo) resolve a promise.
function fakeSupabase(rows) {
  const builder = {
    select() { return this; },
    eq() { return this; },
    gte() { return Promise.resolve({ data: rows, error: null }); },
  };
  return { from() { return builder; } };
}
// Erro de DB
function fakeSupabaseErr() {
  const builder = {
    select() { return this; },
    eq() { return this; },
    gte() { return Promise.resolve({ data: null, error: { message: 'boom' } }); },
  };
  return { from() { return builder; } };
}

const NOW = new Date('2026-06-07T12:00:00Z');

(async () => {
  // 1) Dado suficiente (Alf-like cedo): 24 msgs em 6 dias distintos → learned ~7h
  const rows = [];
  const baseDays = ['01','02','03','04','05','06'];
  const horasUtc = [10,11,11,12]; // 10h UTC = 07h BRT (-03)
  for (const d of baseDays) {
    for (const h of horasUtc) {
      rows.push({ created_at: `2026-06-${d}T${String(h).padStart(2,'0')}:30:00Z` });
    }
  }
  const learned = await getActiveWindow(fakeSupabase(rows), 'collab-1', NOW);
  assert.strictEqual(learned.source, 'learned', `esperava learned, veio ${learned.source}`);
  assert.strictEqual(learned.confident, true);
  assert.strictEqual(learned.hour, 7, `esperava 7h BRT, veio ${learned.hour}`);

  // 2) Poucos dias distintos → cold-start 09h
  const poucos = [
    { created_at: '2026-06-06T11:00:00Z' },
    { created_at: '2026-06-06T12:00:00Z' },
    { created_at: '2026-06-06T13:00:00Z' },
  ];
  const cold = await getActiveWindow(fakeSupabase(poucos), 'collab-2', NOW);
  assert.strictEqual(cold.source, 'cold_start', `esperava cold_start, veio ${cold.source}`);
  assert.strictEqual(cold.hour, 9);
  assert.strictEqual(cold.confident, false);

  // 3) Sem dado → cold-start
  const vazio = await getActiveWindow(fakeSupabase([]), 'collab-3', NOW);
  assert.strictEqual(vazio.source, 'cold_start');
  assert.strictEqual(vazio.hour, 9);

  // 4) Erro de DB → cold-start (degrada gracioso, nunca derruba)
  const errCase = await getActiveWindow(fakeSupabaseErr(), 'collab-4', NOW);
  assert.strictEqual(errCase.source, 'cold_start');
  assert.strictEqual(errCase.hour, 9);

  // 5) supabase/collabId ausentes → cold-start
  const nil = await getActiveWindow(null, null, NOW);
  assert.strictEqual(nil.source, 'cold_start');

  console.log('OK smoke-active-window — 5/5');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
