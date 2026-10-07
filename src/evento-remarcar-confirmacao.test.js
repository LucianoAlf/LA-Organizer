'use strict';
// CONFIRMACAO-DE-EVENTO (remarcação, 07/10) — EVENT_UPDATE reschedule ia direto pro banco mesmo
// caindo em cima de outro compromisso (dono ∪ participante) ou no passado. Linhas REAIS: Mentoria
// Levi (Alf) e Jornada de Cordas (Quintela, Alf participante). applyEventUpdates de verdade, banco
// trocado por um dublê.
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ALF = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';
const QUINTELA = 'bfd77b2c-3303-47fe-abe1-e73a2d8da0e1';
const JORNADA = {
  id: '41a6e5af-1de6-4ae1-be11-f041a2af412d', title: 'Jornada de Cordas', status: 'scheduled',
  start_at: '2026-10-07T16:00:00+00:00', end_at: '2026-10-07T20:00:00+00:00', collaborator_id: QUINTELA,
  modality: 'presencial', location_text: null, category: 'la_music',
};
const MENTORIA = {
  id: 'd898903f-0c00-4bc1-8bed-2f75fbdb7cc3', title: 'Mentoria Levi', status: 'scheduled',
  start_at: '2026-10-07T12:00:00+00:00', end_at: '2026-10-07T13:00:00+00:00', collaborator_id: ALF,
  modality: 'presencial', location_text: null, category: 'mentoria',
};
// created_at REAL da reunião: 2026-10-06T20:52:13Z.
const AGORA = Date.parse('2026-10-06T20:52:13Z');

let DB;
let seq = 0;
function reset() {
  DB = {
    events: [{ ...JORNADA }, { ...MENTORIA }],
    event_participants: [{ id: 'p1', event_id: JORNADA.id, collaborator_id: ALF, status: 'confirmed' }],
    event_categories: [{ id: 'cat-la', slug: 'la_music', label: 'LA Music', context: 'work', collaborator_id: null, is_system: true }],
    pending_intents: [],
  };
}

const pega = (r, col) => col.split('.').reduce((o, k) => (o == null ? undefined : o[k]), r);
function consulta(tabela) {
  const preds = [];
  let op = 'select', valor = null, embedEvent = false, lim = null;
  const base = () => (DB[tabela] || []).map((r) => (embedEvent ? { ...r, event: (DB.events || []).find((e) => e.id === r.event_id) || null } : r));
  const linhas = () => base().filter((r) => preds.every((p) => p(r))).slice(0, lim == null ? undefined : lim);
  const fim = () => {
    if (op === 'insert') {
      const rows = (Array.isArray(valor) ? valor : [valor]).map((r) => ({ id: r.id || `fake-${++seq}`, ...r }));
      DB[tabela] = (DB[tabela] || []).concat(rows);
      return { data: rows, error: null };
    }
    if (op === 'update') {
      const alvo = (DB[tabela] || []).filter((r) => preds.every((p) => p(r)));
      alvo.forEach((r) => Object.assign(r, valor));
      return { data: alvo, error: null };
    }
    if (op === 'delete') return { data: [], error: null };
    return { data: linhas(), error: null };
  };
  const q = {
    select(cols) { if (op === 'select' && /event:events/.test(String(cols || ''))) embedEvent = true; return q; },
    order() { return q; }, not() { return q; }, or() { return q; }, ilike() { return q; },
    limit(n) { lim = n; return q; },
    eq(c, v) { preds.push((r) => pega(r, c) === v); return q; },
    neq(c, v) { preds.push((r) => pega(r, c) !== v); return q; },
    lt(c, v) { preds.push((r) => Date.parse(pega(r, c)) < Date.parse(v)); return q; },
    gt(c, v) { preds.push((r) => Date.parse(pega(r, c)) > Date.parse(v)); return q; },
    lte(c, v) { preds.push((r) => Date.parse(pega(r, c)) <= Date.parse(v)); return q; },
    gte(c, v) { preds.push((r) => Date.parse(pega(r, c)) >= Date.parse(v)); return q; },
    in(c, vs) { preds.push((r) => vs.includes(pega(r, c))); return q; },
    is(c, v) { preds.push((r) => (pega(r, c) ?? null) === v); return q; },
    insert(v) { op = 'insert'; valor = v; return q; },
    upsert(v) { op = 'insert'; valor = v; return q; },
    update(v) { op = 'update'; valor = v; return q; },
    delete() { op = 'delete'; return q; },
    maybeSingle() { const r = fim(); return Promise.resolve({ data: (r.data || [])[0] || null, error: null }); },
    single() { return q.maybeSingle(); },
    then(res, rej) { return Promise.resolve(fim()).then(res, rej); },
  };
  return q;
}
const clientPath = path.join(__dirname, 'supabase', 'client.js');
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { from: (t) => consulta(t), rpc: async () => ({ data: null, error: null }) } };

const engine = require('./engine');

const ALF_COLLAB = { id: ALF, phone: '0000', full_name: 'Luciano Alf' };
const abertos = () => DB.pending_intents.filter((i) => i.kind === 'event_create_confirm' && !i.resolved_at);

// ── EVENT_UPDATE reschedule ────────────────────────────────────────────────
test('remarcar a Mentoria pra dentro da Jornada: pergunta e guarda; "sim" remarca; o próprio evento não conta', async () => {
  reset();
  const acao = { action: 'reschedule', id: 'd898903f', new_start_at: '2026-10-07T14:00:00-03:00', new_end_at: '2026-10-07T15:00:00-03:00' };
  const r1 = await engine.applyEventUpdates(ALF_COLLAB, [{ ...acao }], { agoraMs: AGORA });
  assert.strictEqual(r1.okCount, 0);
  assert.strictEqual(r1.awaitingConfirm, true);
  const msg = r1.failMessages.join('\n');
  assert.ok(/Antes de remarcar \*Mentoria Levi\*/.test(msg), msg);
  assert.ok(/Jornada de Cordas/.test(msg), msg);
  assert.ok(!/bate com \*Mentoria Levi\*/.test(msg), 'o próprio evento não é conflito dele mesmo');
  assert.strictEqual(DB.events.find((e) => e.id === MENTORIA.id).start_at, MENTORIA.start_at, 'não mexe antes do sim');
  const ups = abertos()[0].payload.updates;
  assert.strictEqual(ups.length, 1);
  const r2 = await engine.applyEventUpdates(ALF_COLLAB, ups, { agoraMs: AGORA });
  assert.strictEqual(r2.okCount, 1);
  assert.strictEqual(DB.events.find((e) => e.id === MENTORIA.id).start_at, acao.new_start_at);
});

test('remarcar por cima do PRÓPRIO horário antigo (09:30–10:30) não é conflito: remarca direto', async () => {
  reset();
  const r = await engine.applyEventUpdates(ALF_COLLAB, [{ action: 'reschedule', id: 'd898903f', new_start_at: '2026-10-07T09:30:00-03:00', new_end_at: '2026-10-07T10:30:00-03:00' }], { agoraMs: AGORA });
  assert.strictEqual(r.okCount, 1);
  assert.strictEqual(abertos().length, 0);
});

test('remarcar pro passado pergunta', async () => {
  reset();
  const r = await engine.applyEventUpdates(ALF_COLLAB, [{ action: 'reschedule', id: 'd898903f', new_start_at: '2026-10-05T09:00:00-03:00', new_end_at: '2026-10-05T10:00:00-03:00' }], { agoraMs: AGORA });
  assert.strictEqual(r.okCount, 0);
  assert.ok(/esse horário já passou/.test(r.failMessages.join('\n')));
});

test('flags vindas do JSON do EVENT_UPDATE são descartadas', () => {
  const txt = '<<EVENT_UPDATE>>' + JSON.stringify({ action: 'reschedule', id: 'd898903f', new_start_at: '2026-10-07T14:00:00-03:00', new_end_at: '2026-10-07T15:00:00-03:00', _conflito_confirmado: true }) + '<<END>>';
  const p = engine.parseEventUpdateMarker(txt);
  assert.strictEqual('_conflito_confirmado' in p.actions[0], false);
});
