'use strict';
// ============================================================================
// REDE DE SEGURANÇA do ciclo de vida da recorrência — Raiz 1 / Abordagem B.
// FATIA 2 (24/06 — flip): a materialização passa a depender de SE A SÉRIE FOI
// ENCERRADA (`series_ended_at`), não do status da ocorrência. Concluir a 1ª
// ocorrência (status=done) NÃO congela mais a série. Só "encerrar série"
// (engine scope:'series' / grupo endSeries) seta series_ended_at; reviveSeries limpa.
//
// O PAR (a propriedade que torna o flip seguro): para CADA estado fechado,
//   • "done/cancelled COM series_ended_at" → NÃO gera (série encerrada);
//   • "done/cancelled SEM series_ended_at" → GERA (ocorrência concluída ≠ série encerrada).
// A 2ª metade é a ÂNCORA — o bug que a Fatia 2 mata.
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const fakeSupabase = makeFakeSupabase();
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...args) {
  if (req.includes('supabase/client')) return req;
  return _origResolve.call(this, req, ...args);
};
Module._load = (function (orig) {
  return function (req, ...args) {
    if (req.includes('supabase/client')) return fakeSupabase;
    if (req.includes('recurrence-time')) return { shiftReminderToInstance: () => {} };
    return orig.call(this, req, ...args);
  };
})(Module._load);

const { materializeSeries, endSeries1on1 } = require('./recurrence-engine');
const { shouldMaterializeTemplate } = require('./recurrence-guard');
const { endSeries, reviveSeries } = require('./group-chat-tasks');

function todayYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
function ymdPlus(days) {
  const d = new Date(Date.now() + days * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}
const TS = '2026-06-24T12:00:00.000Z'; // series_ended_at de exemplo (encerrada)

// Molde ATIVO (series_ended_at null) — DAILY ancorado hoje → ≥1 ocorrência no horizonte.
function dailyTemplate(over = {}) {
  return {
    id: 'tpl-1',
    title: 'Série diária de teste',
    recurrence_rule: 'FREQ=DAILY',
    recurrence_parent_id: null,
    due_date: todayYmd(),
    status: 'pending',
    series_ended_at: null,
    is_group: false,
    data_classification: 'real',
    ...over,
  };
}

// ── GM1 — molde ATIVO (series_ended_at null) → GERA. INVARIANTE. ──
test('GM1 — molde ativo (series_ended_at null) materializa as próximas ocorrências', async () => {
  fakeSupabase.__reset();
  const r = await materializeSeries('tasks', dailyTemplate());
  assert.ok(r.created > 0, `esperava created>0, veio ${JSON.stringify(r)}`);
});

// ── GM2/GM3 — O PAR: série ENCERRADA (series_ended_at preenchido) → 0, qualquer status. ──
test('GM2 — série encerrada (series_ended_at set, status=done) → 0 (reason closed_template)', async () => {
  fakeSupabase.__reset();
  const r = await materializeSeries('tasks', dailyTemplate({ status: 'done', series_ended_at: TS }));
  assert.strictEqual(r.created, 0);
  assert.strictEqual(r.reason, 'closed_template');
});
test('GM3 — série encerrada (series_ended_at set, status=cancelled) → 0', async () => {
  fakeSupabase.__reset();
  const r = await materializeSeries('tasks', dailyTemplate({ status: 'cancelled', series_ended_at: TS }));
  assert.strictEqual(r.created, 0);
  assert.strictEqual(r.reason, 'closed_template');
});

// ── ANCHOR9 (a 2ª metade do PAR; era `todo`, AGORA VERDE): ocorrência concluída/cancelada
//    SEM encerrar a série (series_ended_at null) → GERA. É o bug que a Fatia 2 mata. ──
test('ANCHOR9b — engine: molde done mas NÃO encerrado (series_ended_at null) segue gerando 2..N', async () => {
  fakeSupabase.__reset();
  const r = await materializeSeries('tasks', dailyTemplate({ status: 'done', series_ended_at: null }));
  assert.ok(r.created > 0, `série não-encerrada deve gerar; veio ${JSON.stringify(r)}`);
});
test('PAR — molde cancelled mas NÃO encerrado (series_ended_at null) → gera (cancelar ocorrência ≠ encerrar série)', async () => {
  fakeSupabase.__reset();
  const r = await materializeSeries('tasks', dailyTemplate({ status: 'cancelled', series_ended_at: null }));
  assert.ok(r.created > 0, `veio ${JSON.stringify(r)}`);
});

// ── GM4 — deletar instância de série ATIVA → idempotente + recria o dia liberado. INVARIANTE. ──
test('GM4 — deletar instância de série ativa: 2ª rodada idempotente, re-materializa o dia liberado', async () => {
  fakeSupabase.__reset();
  const tpl = dailyTemplate();
  const r1 = await materializeSeries('tasks', tpl);
  assert.ok(r1.created > 0, `1ª rodada devia criar; veio ${JSON.stringify(r1)}`);
  const r2 = await materializeSeries('tasks', tpl);
  assert.strictEqual(r2.created, 0, `2ª rodada devia ser idempotente; veio ${JSON.stringify(r2)}`);
  const store = fakeSupabase.__store();
  assert.ok(store.tasks.length > 0, 'fake devia ter instâncias armazenadas');
  store.tasks.splice(0, 1);
  const r3 = await materializeSeries('tasks', tpl);
  assert.ok(r3.created >= 1, `devia recriar o dia liberado; veio ${JSON.stringify(r3)}`);
});

// ── GM5 — deletar instância de série ENCERRADA (series_ended_at set) → NÃO ressuscita. ──
test('GM5 — deletar instância de série encerrada (series_ended_at set) NÃO ressuscita', async () => {
  fakeSupabase.__reset();
  const store = fakeSupabase.__store();
  store.tasks.push({ id: 'inst-velha', recurrence_parent_id: 'tpl-1', due_date: ymdPlus(1), status: 'pending' });
  store.tasks.splice(0, store.tasks.length); // "apago" → slot liberado
  const r = await materializeSeries('tasks', dailyTemplate({ status: 'done', series_ended_at: TS }));
  assert.strictEqual(r.created, 0, `série encerrada não regenera; veio ${JSON.stringify(r)}`);
  assert.strictEqual(r.reason, 'closed_template');
});

// ── GM6 — guard puro (espelha recurrence-guard.test.js): series_ended_at é a chave. ──
test('GM6 — shouldMaterializeTemplate: ended→false, ativo→true, done-sem-ended→true (âncora), fail-open', () => {
  assert.strictEqual(shouldMaterializeTemplate({ series_ended_at: TS }), false);
  assert.strictEqual(shouldMaterializeTemplate({ series_ended_at: null }), true);
  assert.strictEqual(shouldMaterializeTemplate({ status: 'done', series_ended_at: null }), true); // ÂNCORA
  assert.strictEqual(shouldMaterializeTemplate({ id: 'x' }), true);   // fail-open (coluna ausente)
  assert.strictEqual(shouldMaterializeTemplate(null), true);
});

// ── GM8 — endSeries (grupo) agora SETA series_ended_at no molde + cancela não-done. ──
test('GM8 — endSeries (grupo) seta series_ended_at + cancela não-done, preserva done', async () => {
  fakeSupabase.__reset();
  const store = fakeSupabase.__store();
  store.tasks.push(
    { id: 'tpl-1', recurrence_rule: 'FREQ=DAILY', recurrence_parent_id: null, status: 'pending', series_ended_at: null },
    { id: 'inst-futura', recurrence_parent_id: 'tpl-1', due_date: ymdPlus(2), status: 'pending' },
    { id: 'inst-done', recurrence_parent_id: 'tpl-1', due_date: ymdPlus(-1), status: 'done' },
  );
  const out = await endSeries({ supabase: fakeSupabase, templateId: 'tpl-1' });
  assert.strictEqual(out.ended, true);
  const byId = Object.fromEntries(store.tasks.map((t) => [t.id, t]));
  assert.ok(byId['tpl-1'].series_ended_at, 'molde devia ganhar series_ended_at');
  assert.strictEqual(byId['tpl-1'].status, 'cancelled');
  assert.strictEqual(byId['inst-futura'].status, 'cancelled');
  assert.strictEqual(byId['inst-done'].status, 'done', 'done preservado');
});

// ── REGRESSÃO "para de me lembrar" (scope:'series' 1:1) — RED antes do write-flip, GREEN depois.
//    Encerrar a série (endSeries1on1) seta series_ended_at e PARA a geração, MESMO com molde done
//    (ocorrência já concluída). É a prova anti-Gabi: sem o write de series_ended_at, o guard novo
//    (que keia series_ended_at) regeneraria → "para de me lembrar" voltaria a falhar. ──
test('REGRESSÃO "para de me lembrar": endSeries1on1 encerra a série (mesmo molde done) → geração PARA', async () => {
  fakeSupabase.__reset();
  const store = fakeSupabase.__store();
  // molde DONE (1ª ocorrência concluída), série AINDA ativa (series_ended_at null)
  store.tasks.push(
    { id: 'tpl-1', assigned_to: 'alf', recurrence_rule: 'FREQ=DAILY', recurrence_parent_id: null,
      due_date: todayYmd(), status: 'done', series_ended_at: null, is_group: false, data_classification: 'real' },
    { id: 'inst-futura', assigned_to: 'alf', recurrence_parent_id: 'tpl-1', due_date: ymdPlus(2), status: 'pending' },
    { id: 'inst-passada', assigned_to: 'alf', recurrence_parent_id: 'tpl-1', due_date: ymdPlus(-3), status: 'pending' },
  );
  const out = await endSeries1on1({ supabase: fakeSupabase, templateId: 'tpl-1', ownerId: 'alf' });
  assert.strictEqual(out.ended, true);
  const tpl = store.tasks.find((t) => t.id === 'tpl-1');
  assert.ok(tpl.series_ended_at, 'molde devia ganhar series_ended_at mesmo done');
  assert.strictEqual(tpl.status, 'done', 'molde done PRESERVADO (não un-completa)');
  assert.strictEqual(store.tasks.find((t) => t.id === 'inst-futura').status, 'cancelled', 'futura cancelada');
  assert.strictEqual(store.tasks.find((t) => t.id === 'inst-passada').status, 'cancelled', 'passada (overdue) TAMBÉM cancelada — F3 uniformizado (não vira nag fantasma)');
  // A geração PARA (a série está encerrada agora).
  const r = await materializeSeries('tasks', { ...tpl });
  assert.strictEqual(r.created, 0, `série encerrada não pode gerar; veio ${JSON.stringify(r)}`);
  assert.strictEqual(r.reason, 'closed_template');
});

// ── RELIGAR (reviveSeries) — limpa series_ended_at → a série VOLTA a gerar. ──
test('reviveSeries limpa series_ended_at e a série volta a materializar', async () => {
  fakeSupabase.__reset();
  const store = fakeSupabase.__store();
  store.tasks.push({
    id: 'tpl-1', assigned_group_id: 'grp', title: 'Conciliação', recurrence_rule: 'FREQ=DAILY',
    recurrence_parent_id: null, due_date: todayYmd(), status: 'cancelled', series_ended_at: TS,
    is_group: false, data_classification: 'real',
  });
  const out = await reviveSeries({ supabase: fakeSupabase, groupId: 'grp', title: 'Conciliação' });
  assert.strictEqual(out.revived, true);
  const tpl = store.tasks.find((t) => t.id === 'tpl-1');
  assert.strictEqual(tpl.series_ended_at, null, 'series_ended_at devia ser limpo');
  assert.strictEqual(tpl.status, 'pending');
  // re-materializou (a série voltou): há instâncias novas no store.
  const insts = store.tasks.filter((t) => t.recurrence_parent_id === 'tpl-1');
  assert.ok(insts.length > 0, 'religar devia re-materializar a série');
});

// ============================================================================
// Fake Supabase in-memory — chain encadeável e thenable.
// ============================================================================
function makeFakeSupabase() {
  let store = blankStore();
  let idc = 0;
  function blankStore() {
    return { tasks: [], events: [], task_reminders: [], event_reminders: [] };
  }
  function builder(table) {
    const st = { table, op: 'select', eqs: [], neqs: [], nots: [], payload: null, single: false };
    const api = {
      select(_cols) { return api; },                        // no-op: op já vem de insert/update/delete (default 'select')
      insert(rows) { st.op = 'insert'; st.payload = Array.isArray(rows) ? rows : [rows]; return api; },
      update(patch) { st.op = 'update'; st.payload = patch; return api; },
      delete() { st.op = 'delete'; return api; },
      eq(c, v) { st.eqs.push([c, v]); return api; },
      is(c, v) { st.eqs.push([c, v]); return api; },        // .is(col, null) ≈ eq null
      neq(c, v) { st.neqs.push([c, v]); return api; },
      not(c, op, v) { st.nots.push([c, op, v]); return api; }, // .not(col,'in','("a","b")') / .not(col,'is',null)
      in() { return api; },
      gte() { return api; },
      lte() { return api; },
      ilike() { return api; },                               // no-op: testes casam por eq
      order() { return api; },
      limit() { return api; },
      maybeSingle() { st.single = true; return api; },
      single() { st.single = true; return api; },
      then(res, rej) { return Promise.resolve().then(() => resolve(st)).then(res, rej); },
    };
    return api;
  }
  function matches(r, st) {
    if (!st.eqs.every(([c, v]) => r[c] === v)) return false;
    if (!st.neqs.every(([c, v]) => r[c] !== v)) return false;
    for (const [c, op, v] of st.nots) {
      if (op === 'in') {
        const set = String(v).replace(/[()"]/g, '').split(',').map((s) => s.trim());
        if (set.includes(r[c])) return false;                // NOT IN (...)
      } else if (op === 'is' && v === null) {
        if (r[c] === null || r[c] === undefined) return false; // NOT (col IS NULL)
      }
    }
    return true;
  }
  function resolve(st) {
    const rows = store[st.table] || (store[st.table] = []);
    if (st.op === 'insert') {
      const ins = st.payload.map((r) => ({ ...r, id: r.id || `fk-${st.table}-${++idc}` }));
      rows.push(...ins);
      return { data: ins, error: null };
    }
    if (st.op === 'update') {
      const hit = rows.filter((r) => matches(r, st));
      hit.forEach((r) => Object.assign(r, st.payload));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    if (st.op === 'delete') {
      store[st.table] = rows.filter((r) => !matches(r, st));
      return { data: null, error: null };
    }
    const out = rows.filter((r) => matches(r, st));
    if (st.single) return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
  return {
    from: (t) => builder(t),
    __reset() { store = blankStore(); idc = 0; },
    __store() { return store; },
  };
}
