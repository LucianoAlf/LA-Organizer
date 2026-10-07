'use strict';
// CONFLITO-DO-CONVIDADO (07/10, aprovado pelo Alf) — caso REAL do replay de 30 dias: o Yuri tem
// "Ensaio banda Rosário" 07/10 15:00–17:00 (be2ac27b, dele) e foi convidado pelo Alf pra "Reuniao
// semana da crianças" 15:30–16:30 (e9d192a4). Ninguém avisou o Alf. Agora quem convida fica sabendo
// no mesmo turno — informativo, não trava. applyEventActions de verdade, banco trocado por dublê.
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ALF = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';
const YURI = '5bb97642-bbc1-44c5-a3dc-bdab74347011';
const ENSAIO = {
  id: 'be2ac27b-5b15-4ea3-93e2-755c9d58bb8a', title: 'Ensaio banda Rosário', status: 'scheduled', context: 'work',
  start_at: '2026-10-07T18:00:00+00:00', end_at: '2026-10-07T20:00:00+00:00', collaborator_id: YURI,
};
const AGORA = Date.parse('2026-10-06T20:52:13Z'); // created_at real da reunião

let DB;
let seq = 0;
function reset() {
  DB = {
    events: [{ ...ENSAIO }],
    event_participants: [],
    event_categories: [{ id: 'cat-la', slug: 'la_music', label: 'LA Music', context: 'work', collaborator_id: null, is_system: true }],
    collaborators: [
      { id: ALF, full_name: 'Luciano Alf', preferred_name: 'Alf', is_active: true, phone: '0000' },
      { id: YURI, full_name: 'Yuri', preferred_name: null, is_active: true, phone: null },
    ],
    pending_intents: [],
  };
}
const pega = (r, col) => col.split('.').reduce((o, k) => (o == null ? undefined : o[k]), r);
function consulta(tabela) {
  const preds = [];
  let op = 'select', valor = null, embedEvent = false, lim = null;
  const base = () => (DB[tabela] || []).map((r) => (embedEvent ? { ...r, event: (DB.events || []).find((e) => e.id === r.event_id) || null } : r));
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
    return { data: base().filter((r) => preds.every((p) => p(r))).slice(0, lim == null ? undefined : lim), error: null };
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
const ac = require('./lib/agenda-conflitos');

const ALF_COLLAB = { id: ALF, phone: '0000', full_name: 'Luciano Alf', preferred_name: 'Alf' };
const REUNIAO = {
  title: 'Reuniao semana da crianças', start_at: '2026-10-07T15:30:00-03:00', end_at: '2026-10-07T16:30:00-03:00',
  modality: 'presencial', category: 'la_music', context: 'work', attendees: ['Yuri'],
};

test('caso real: convidar o Yuri pra reunião 15:30 → cria e avisa quem convidou do ensaio dele', async () => {
  reset();
  const r = await engine.applyEventActions(ALF_COLLAB, [{ ...REUNIAO }], { agoraMs: AGORA, suppressNotify: true });
  assert.strictEqual(r.okCount, 1, 'informativo: não trava a criação');
  assert.ok(DB.event_participants.some((p) => p.collaborator_id === YURI), 'Yuri entrou como participante');
  assert.deepStrictEqual(r.avisosConvidados, ['⚠️ Yuri já tem *Ensaio banda Rosário* (15:00–17:00) nesse horário.']);
});

test('convidado livre: nenhum aviso', async () => {
  reset();
  const r = await engine.applyEventActions(ALF_COLLAB, [{ ...REUNIAO, start_at: '2026-10-07T10:00:00-03:00', end_at: '2026-10-07T11:00:00-03:00' }], { agoraMs: AGORA, suppressNotify: true });
  assert.strictEqual(r.okCount, 1);
  assert.deepStrictEqual(r.avisosConvidados, []);
});

test('evento PESSOAL do convidado não expõe o título', () => {
  assert.strictEqual(
    ac.linhaConflitoDoConvidado('Yuri', [{ ...ENSAIO, title: 'Consulta', context: 'personal' }]),
    '⚠️ Yuri já tem um compromisso pessoal (15:00–17:00) nesse horário.',
  );
  assert.strictEqual(ac.linhaConflitoDoConvidado('Yuri', []), null);
});

test('bloco de vários dias (real: pessoal 06/10 11:00 → 13/10 12:00) mostra as datas', () => {
  assert.strictEqual(
    ac.linhaConflitoDoConvidado('Anne', [{ id: '8f40da20', title: 'x', context: 'personal', start_at: '2026-10-06T14:00:00+00:00', end_at: '2026-10-13T15:00:00+00:00' }]),
    '⚠️ Anne já tem um compromisso pessoal (06/10 11:00 → 13/10 12:00) nesse horário.',
  );
});

test('bom dia do CONVIDADO: já participante, a linha de conflito sai pra ele (dono ∪ participante)', () => {
  const reuniao = { id: 'e9d192a4-06dc-4ed6-acf4-a92c4f453b50', title: 'Reuniao semana da crianças', status: 'scheduled', start_at: '2026-10-07T18:30:00+00:00', end_at: '2026-10-07T19:30:00+00:00', collaborator_id: ALF };
  // participação REAL do Yuri na reunião (b893a1a9, confirmed)
  const agendaDoYuri = ac.unirCompromissos([ENSAIO], [{ status: 'confirmed', event: reuniao }]);
  assert.deepStrictEqual(ac.linhasDeConflitoDoDia(agendaDoYuri, '2026-10-07'), [
    '⚠️ Conflito: *Reuniao semana da crianças* (15:30–16:30) cai dentro de *Ensaio banda Rosário* (15:00–17:00)',
  ]);
});

test('porta do app: avisa só quem está no evento (e não recusou), pelo backend', async () => {
  reset();
  const REU = { id: 'e9d192a4-06dc-4ed6-acf4-a92c4f453b50', title: 'Reuniao semana da crianças', status: 'scheduled', start_at: '2026-10-07T18:30:00+00:00', end_at: '2026-10-07T19:30:00+00:00', collaborator_id: ALF, context: 'work' };
  DB.events.push(REU);
  DB.event_participants.push({ id: 'b893a1a9', event_id: REU.id, collaborator_id: YURI, status: 'confirmed' });
  const sb = { from: (t) => consulta(t) };
  assert.deepStrictEqual(await ac.avisosDoEventoParaConvidados({ supabase: sb, eventId: REU.id, collaboratorIds: [YURI] }),
    ['⚠️ Yuri já tem *Ensaio banda Rosário* (15:00–17:00) nesse horário.']);
  // id que não está no evento não vira consulta da agenda alheia
  assert.deepStrictEqual(await ac.avisosDoEventoParaConvidados({ supabase: sb, eventId: REU.id, collaboratorIds: [ALF] }), []);
  DB.event_participants[0].status = 'declined';
  assert.deepStrictEqual(await ac.avisosDoEventoParaConvidados({ supabase: sb, eventId: REU.id, collaboratorIds: [YURI] }), []);
});

test('contrato: a rota do app existe e delega pra mesma definição', () => {
  const api = require('fs').readFileSync(path.join(__dirname, 'internal-api.js'), 'utf8');
  const i = api.indexOf("router.post('/internal/event-invitee-conflicts'");
  assert.ok(i > 0, 'rota ausente');
  assert.ok(/requireInternalSecret/.test(api.slice(i, i + 200)));
  assert.ok(/avisosDoEventoParaConvidados/.test(api.slice(i, i + 1500)));
});

test('contrato: o aviso chega na fala — EVENT_CREATE, resume do "sim" e add_participants', () => {
  const fonte = require('fs').readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
  const usos = fonte.match(/avisosConvidados|avisosDosConvidados/g) || [];
  assert.ok(usos.length >= 5, `poucos pontos ligados (${usos.length})`);
  assert.ok(/participant_edit[\s\S]{0,6000}avisosDosConvidados/.test(fonte), 'add_participants não avisa');
});
