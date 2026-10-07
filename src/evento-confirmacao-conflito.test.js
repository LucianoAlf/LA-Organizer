'use strict';
// CONFIRMACAO-DE-EVENTO (07/10) — o conflito "leve" perguntava "Crio assim mesmo?" sem guardar a
// ação: o "sim" re-emitia o marker e batia no mesmo conflito pra sempre. Turno REAL do Alf
// (06/10 17:52 BRT): criar "Reuniao semana da crianças" 07/10 15:30–16:30 com a Jornada de Cordas
// (13–17, dono Quintela, Alf participante confirmado) na agenda. Passa pelo applyEventActions de
// verdade, com o banco trocado por um dublê que tem as linhas reais.
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
const pendingIntents = require('./services/pending-intents');
const { _buildIntegrityConfirmText } = engine;

const ALF_COLLAB = { id: ALF, phone: '0000', full_name: 'Luciano Alf' };
const REUNIAO_MARKER = {
  title: 'Reuniao semana da crianças', start_at: '2026-10-07T15:30:00-03:00', end_at: '2026-10-07T16:30:00-03:00',
  modality: 'presencial', category: 'la_music', context: 'work',
};
const abertos = () => DB.pending_intents.filter((i) => i.kind === 'event_create_confirm' && !i.resolved_at);
const criados = (titulo) => DB.events.filter((e) => e.title === titulo);

test('caso real: conflito com a Jornada (participante) → pergunta, guarda; "sim" → cria UMA vez', async () => {
  reset();
  const r1 = await engine.applyEventActions(ALF_COLLAB, [{ ...REUNIAO_MARKER }], { agoraMs: AGORA });
  assert.strictEqual(r1.okCount, 0);
  assert.strictEqual(criados(REUNIAO_MARKER.title).length, 0, 'não cria antes do sim');
  assert.strictEqual(r1.integrityPayload.type, 'confirmar_evento');
  const pergunta = _buildIntegrityConfirmText(r1.integrityPayload);
  assert.ok(pergunta.includes('*Jornada de Cordas* (13:00–17:00)'), pergunta);
  assert.ok(/Marco assim mesmo\?/.test(pergunta), pergunta);
  assert.ok(!/já passou/.test(pergunta), pergunta);
  assert.strictEqual(abertos().length, 1);

  // o "sim" — o resume (engine ~10000) faz exatamente isto com o payload do intent
  assert.strictEqual(pendingIntents.detectUserConfirmation('sim'), 'yes');
  const guardados = abertos()[0].payload.events;
  const r2 = await engine.applyEventActions(ALF_COLLAB, guardados, { agoraMs: AGORA });
  assert.strictEqual(r2.okCount, 1);
  assert.strictEqual(r2.integrityPayload, null);
  assert.strictEqual(criados(REUNIAO_MARKER.title).length, 1, 'criado exatamente uma vez');
});

test('o LLM re-emitindo o MESMO marker (sem a flag) pergunta de novo e não cria — só o intent libera', async () => {
  reset();
  await engine.applyEventActions(ALF_COLLAB, [{ ...REUNIAO_MARKER }], { agoraMs: AGORA });
  const r = await engine.applyEventActions(ALF_COLLAB, [{ ...REUNIAO_MARKER }], { agoraMs: AGORA });
  assert.strictEqual(r.okCount, 0);
  assert.strictEqual(criados(REUNIAO_MARKER.title).length, 0);
});

test('a flag vinda do JSON do modelo é descartada no parse', () => {
  const txt = 'ok <<EVENT_CREATE>>' + JSON.stringify({ ...REUNIAO_MARKER, _conflito_confirmado: true, _passado_confirmado: true }) + '<<END>>';
  const p = engine.parseEventCreateMarker(txt);
  assert.ok(p && p.events && p.events.length === 1);
  assert.strictEqual('_conflito_confirmado' in p.events[0], false);
  assert.strictEqual('_passado_confirmado' in p.events[0], false);
});

test('passado + conflito: UMA pergunta com os dois; um "sim" cobre os dois', async () => {
  reset();
  const depois = Date.parse('2026-10-07T21:00:00Z'); // 07/10 18:00 BRT: 15:30 já passou
  const r1 = await engine.applyEventActions(ALF_COLLAB, [{ ...REUNIAO_MARKER }], { agoraMs: depois });
  const pergunta = _buildIntegrityConfirmText(r1.integrityPayload);
  assert.ok(/esse horário já passou/.test(pergunta), pergunta);
  assert.ok(/Jornada de Cordas/.test(pergunta), pergunta);
  assert.strictEqual((pergunta.match(/assim mesmo\?/g) || []).length, 1, pergunta);
  const r2 = await engine.applyEventActions(ALF_COLLAB, abertos()[0].payload.events, { agoraMs: depois });
  assert.strictEqual(r2.okCount, 1);
  assert.strictEqual(criados(REUNIAO_MARKER.title).length, 1);
});

test('sem conflito e no futuro: cria direto, sem intent', async () => {
  reset();
  const r = await engine.applyEventActions(ALF_COLLAB, [{ ...REUNIAO_MARKER, start_at: '2026-10-07T18:00:00-03:00', end_at: '2026-10-07T19:00:00-03:00' }], { agoraMs: AGORA });
  assert.strictEqual(r.okCount, 1);
  assert.strictEqual(abertos().length, 0);
});

test('chat de grupo (semIntentDeConfirmacao): não abre intent, conflito segue barrando como antes', async () => {
  reset();
  const r = await engine.applyEventActions(ALF_COLLAB, [{ ...REUNIAO_MARKER }], { agoraMs: AGORA, semIntentDeConfirmacao: true, suppressNotify: true });
  assert.strictEqual(r.okCount, 0);
  assert.strictEqual(abertos().length, 0);
  assert.strictEqual(r.integrityPayload.type, 'temporal_soft');
});
