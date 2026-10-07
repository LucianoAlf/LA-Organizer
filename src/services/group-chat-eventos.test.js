'use strict';
// EVENTO-NO-GRUPO-HONESTO (07/10, aprovado pelo Alf) — o grupo dizia "ok" pra todo evento sem ler o
// resultado e não tinha confirmação. Linhas REAIS: Alf (participante confirmado da Jornada de Cordas
// do Quintela, 07/10 13–17) cria no grupo "Reuniao semana da crianças" 15:30–16:30. applyEventActions
// de verdade; banco trocado por um dublê (inclui group_chat_pending_confirms).
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ALF = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';
const QUINTELA = 'bfd77b2c-3303-47fe-abe1-e73a2d8da0e1';
const OUTRO = '945ed9cf-7e2e-451f-b96b-28895ab3fe08'; // Rodrigo (outro membro)
const GRUPO = '11111111-2222-3333-4444-555555555555';
const JORNADA = {
  id: '41a6e5af-1de6-4ae1-be11-f041a2af412d', title: 'Jornada de Cordas', status: 'scheduled', context: 'work',
  start_at: '2026-10-07T16:00:00+00:00', end_at: '2026-10-07T20:00:00+00:00', collaborator_id: QUINTELA,
};

let DB;
let seq = 0;
function reset() {
  DB = {
    events: [{ ...JORNADA }],
    event_participants: [{ id: 'f8934ef2', event_id: JORNADA.id, collaborator_id: ALF, status: 'confirmed' }],
    event_categories: [{ id: 'cat-la', slug: 'la_music', label: 'LA Music', context: 'work', collaborator_id: null, is_system: true }],
    collaborators: [
      { id: ALF, full_name: 'Luciano Alf', preferred_name: 'Alf', is_active: true, phone: '0000' },
      { id: OUTRO, full_name: 'Rodrigo', preferred_name: null, is_active: true, phone: null },
    ],
    pending_intents: [],
    group_chat_pending_confirms: [],
  };
}
const pega = (r, col) => col.split('.').reduce((o, k) => (o == null ? undefined : o[k]), r);
function consulta(tabela) {
  const preds = [];
  let op = 'select', valor = null, embedEvent = false, lim = null, conflito = null;
  const base = () => (DB[tabela] || []).map((r) => (embedEvent ? { ...r, event: (DB.events || []).find((e) => e.id === r.event_id) || null } : r));
  const fim = () => {
    if (op === 'insert' || op === 'upsert') {
      let rows = (Array.isArray(valor) ? valor : [valor]).map((r) => ({ id: r.id || `fake-${++seq}`, ...r }));
      if (op === 'upsert' && conflito) {
        const cols = conflito.split(',');
        DB[tabela] = (DB[tabela] || []).filter((x) => !rows.some((n) => cols.every((c) => x[c] === n[c])));
      }
      DB[tabela] = (DB[tabela] || []).concat(rows);
      return { data: rows, error: null };
    }
    if (op === 'update') {
      const alvo = (DB[tabela] || []).filter((r) => preds.every((p) => p(r)));
      alvo.forEach((r) => Object.assign(r, valor));
      return { data: alvo, error: null };
    }
    if (op === 'delete') {
      const alvo = (DB[tabela] || []).filter((r) => preds.every((p) => p(r)));
      DB[tabela] = (DB[tabela] || []).filter((r) => !alvo.includes(r));
      return { data: alvo, error: null };
    }
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
    upsert(v, o) { op = 'upsert'; valor = v; conflito = o && o.onConflict; return q; },
    update(v) { op = 'update'; valor = v; return q; },
    delete() { op = 'delete'; return q; },
    maybeSingle() { const r = fim(); return Promise.resolve({ data: (r.data || [])[0] || null, error: null }); },
    single() { return q.maybeSingle(); },
    then(res, rej) { return Promise.resolve(fim()).then(res, rej); },
  };
  return q;
}
const clientPath = path.join(__dirname, '..', 'supabase', 'client.js');
const sb = { from: (t) => consulta(t), rpc: async () => ({ data: null, error: null }) };
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: sb };

const engine = require('../engine');
const ge = require('./group-chat-eventos');
const { decideConfirm } = require('./group-notes');
const { buildTomContent, ACTIONS_DELIM } = require('./group-chat-engine');

const ALF_COLLAB = { id: ALF, phone: '0000', full_name: 'Luciano Alf', preferred_name: 'Alf' };
// O grupo usa o relógio real (Date.now()); o caso é de 07/10 — rodando depois, a pergunta ganha
// também "esse horário já passou". As asserções valem nos dois casos (segura, pergunta UMA vez,
// "sim" do mesmo remetente cria UMA vez).
const REUNIAO = {
  title: 'Reuniao semana da crianças', start_at: '2026-10-07T15:30:00-03:00', end_at: '2026-10-07T16:30:00-03:00',
  modality: 'presencial', category: 'la_music', context: 'work',
};
const criados = () => DB.events.filter((e) => e.title === REUNIAO.title);
const resolver = (quem, text) => ge.resolverConfirmacaoDeEvento({ supabase: sb, engine, groupId: GRUPO, senderCollabId: quem, text, decideConfirm });

test('caso real no grupo: conflito → card "pendente" + pergunta única, nada criado', async () => {
  reset();
  const acts = await ge.aplicarEventosDoGrupo({ supabase: sb, engine, collab: ALF_COLLAB, groupId: GRUPO, senderCollabId: ALF, events: [{ ...REUNIAO }] });
  assert.strictEqual(acts.length, 1);
  assert.strictEqual(acts[0].status, 'pending');
  assert.ok(/Antes de marcar \*Reuniao semana da crianças\*/.test(acts[0].pergunta), acts[0].pergunta);
  assert.ok(/bate com \*Jornada de Cordas\* \(13:00–17:00\)/.test(acts[0].pergunta), acts[0].pergunta);
  assert.strictEqual((acts[0].pergunta.match(/assim mesmo\?/g) || []).length, 1);
  assert.strictEqual(criados().length, 0);
  assert.strictEqual(DB.group_chat_pending_confirms.length, 1);
  assert.strictEqual(DB.pending_intents.length, 0, 'não abre o intent do 1:1');
});

test('"sim" de OUTRO membro não cria; "sim" de quem pediu cria UMA vez; 2º "sim" não duplica', async () => {
  reset();
  await ge.aplicarEventosDoGrupo({ supabase: sb, engine, collab: ALF_COLLAB, groupId: GRUPO, senderCollabId: ALF, events: [{ ...REUNIAO }] });
  assert.strictEqual(await resolver(OUTRO, 'sim'), null);
  assert.strictEqual(criados().length, 0);
  const r = await resolver(ALF, 'sim');
  assert.strictEqual(r.texto, '✅ Marquei *Reuniao semana da crianças*.');
  assert.strictEqual(criados().length, 1);
  assert.strictEqual(await resolver(ALF, 'sim'), null);
  assert.strictEqual(criados().length, 1, 'criado exatamente uma vez');
});

test('"não" de quem pediu cancela e não cria', async () => {
  reset();
  await ge.aplicarEventosDoGrupo({ supabase: sb, engine, collab: ALF_COLLAB, groupId: GRUPO, senderCollabId: ALF, events: [{ ...REUNIAO }] });
  const r = await resolver(ALF, 'não');
  assert.ok(/não marquei \*Reuniao semana da crianças\*/.test(r.texto), r.texto);
  assert.strictEqual(criados().length, 0);
  assert.strictEqual(DB.group_chat_pending_confirms.length, 0);
});

test('card honesto: livre e futuro = ok; categoria inexistente = fail (antes saía "ok")', async () => {
  reset();
  const livre = { ...REUNIAO, title: 'Livre', start_at: '2099-01-10T10:00:00-03:00', end_at: '2099-01-10T11:00:00-03:00' };
  const quebrado = { ...REUNIAO, title: 'Sem categoria', category: 'nao_existe', start_at: '2099-01-11T10:00:00-03:00', end_at: '2099-01-11T11:00:00-03:00' };
  const acts = await ge.aplicarEventosDoGrupo({ supabase: sb, engine, collab: ALF_COLLAB, groupId: GRUPO, senderCollabId: ALF, events: [livre, quebrado] });
  assert.deepStrictEqual(acts.map((a) => [a.label, a.status]), [['Livre', 'ok'], ['Sem categoria', 'fail']]);
});

test('fala do grupo: prosa otimista do modelo sai, a pergunta entra', () => {
  const acts = [{ kind: 'event', status: 'pending', label: 'Reuniao semana da crianças', detail: '❓ confirma pra eu marcar', pergunta: 'Antes de marcar *X* (07/10 15:30–16:30):\n• bate com *Jornada de Cordas* (13:00–17:00)\n\nMarco assim mesmo? Se preferir outro horário, me diz qual.' }];
  const content = buildTomContent('Marcado! ✅ Reunião na agenda.', acts, {});
  const fala = content.split(ACTIONS_DELIM)[0];
  assert.ok(!/Marcado/.test(fala), fala);
  assert.ok(/Marco assim mesmo\?/.test(fala), fala);
});

test('contrato: o grupo não empurra mais "ok" cego e tem o pré-passo de evento', () => {
  const src = require('fs').readFileSync(path.join(__dirname, 'group-chat-engine.js'), 'utf8');
  assert.ok(!/parsed\.events\.forEach\(\(ev\) => actions\.push\(\{ kind: 'event', status: 'ok'/.test(src));
  assert.ok(/aplicarEventosDoGrupo/.test(src));
  assert.ok(/resolverConfirmacaoDeEvento/.test(src));
  assert.ok(!/semIntentDeConfirmacao/.test(src));
});
