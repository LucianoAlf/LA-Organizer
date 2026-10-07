'use strict';
// CONVITE-SO-NA-PRIMEIRA-VEZ (achado 07/10): /internal/event-invites deduplicava por EVENTO — quem
// era adicionado depois (EditEventSheet) caía em "already_notified" e nunca recebia convite. Linhas
// REAIS da "Reuniao semana da crianças" (e9d192a4): convites do app saíram em 06/10 20:52:15 e o
// marcador EVENT_INVITES do evento existe. Banco dublê; nenhum WhatsApp é enviado aqui (a lib só
// decide QUEM — o envio fica na rota).
const test = require('node:test');
const assert = require('node:assert');
const { reivindicarConvidados } = require('./event-invites');

const EV = 'e9d192a4-06dc-4ed6-acf4-a92c4f453b50';
const YURI = '5bb97642-bbc1-44c5-a3dc-bdab74347011';
const QUINTELA = 'bfd77b2c-3303-47fe-abe1-e73a2d8da0e1'; // adicionado DEPOIS (cenário do defeito)
const DO_TOM = 'e75929c3-6ec0-47a5-9d8f-9793e251263a'; // entrou por outro caminho, notified_at nulo

let DB;
function reset() {
  DB = {
    marker_logs: [{ id: 'm1', marker_type: 'EVENT_INVITES', raw_excerpt: `event-invites:${EV}` }],
    event_participants: [
      { id: 'b893a1a9', event_id: EV, collaborator_id: YURI, status: 'confirmed', notified_at: '2026-10-06T20:52:15.175Z' },
      { id: 'novo-q', event_id: EV, collaborator_id: QUINTELA, status: 'invited', notified_at: null },
      { id: 'tom-x', event_id: EV, collaborator_id: DO_TOM, status: 'invited', notified_at: null },
    ],
    collaborators: [
      { id: YURI, full_name: 'Yuri', phone: '1', is_active: true },
      { id: QUINTELA, full_name: 'Quintela', phone: '2', is_active: true },
      { id: DO_TOM, full_name: 'Levi', phone: '3', is_active: true },
    ],
  };
}
function consulta(tabela) {
  const preds = [];
  let op = 'select', valor = null, lim = null;
  const fim = () => {
    const alvo = (DB[tabela] || []).filter((r) => preds.every((p) => p(r)));
    if (op === 'update') { alvo.forEach((r) => Object.assign(r, valor)); return { data: alvo.map((r) => ({ ...r })), error: null }; }
    return { data: alvo.slice(0, lim == null ? undefined : lim), error: null };
  };
  const q = {
    select() { return q; }, limit(n) { lim = n; return q; },
    eq(c, v) { preds.push((r) => r[c] === v); return q; },
    in(c, vs) { preds.push((r) => vs.includes(r[c])); return q; },
    is(c, v) { preds.push((r) => (r[c] ?? null) === v); return q; },
    update(v) { op = 'update'; valor = v; return q; },
    then(res, rej) { return Promise.resolve(fim()).then(res, rej); },
  };
  return q;
}
const sb = { from: (t) => consulta(t) };

test('o defeito: adicionado depois recebe o convite mesmo com o marcador do evento existindo', async () => {
  reset();
  const r = await reivindicarConvidados({ supabase: sb, eventId: EV, collaboratorIds: [QUINTELA] });
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(r.recipients.map((x) => x.name), ['Quintela']);
  assert.ok(DB.event_participants.find((p) => p.id === 'novo-q').notified_at, 'marcou notified_at');
});

test('dedupe por (evento, participante): segunda chamada pro mesmo não reenvia', async () => {
  reset();
  await reivindicarConvidados({ supabase: sb, eventId: EV, collaboratorIds: [QUINTELA] });
  const r2 = await reivindicarConvidados({ supabase: sb, eventId: EV, collaboratorIds: [QUINTELA] });
  assert.strictEqual(r2.status, 'no_recipients');
  assert.deepStrictEqual(r2.recipients, []);
});

test('quem já foi convidado (Yuri, 06/10) não recebe de novo; quem entrou por outro caminho não vai de carona', async () => {
  reset();
  const r = await reivindicarConvidados({ supabase: sb, eventId: EV, collaboratorIds: [YURI, QUINTELA] });
  assert.deepStrictEqual(r.recipients.map((x) => x.name), ['Quintela']);
  assert.strictEqual(DB.event_participants.find((p) => p.id === 'tom-x').notified_at, null);
});

test('cliente antigo (sem collaborator_ids): comportamento de antes — marcador do evento vale', async () => {
  reset();
  const r = await reivindicarConvidados({ supabase: sb, eventId: EV });
  assert.strictEqual(r.status, 'already_notified');
  DB.marker_logs = [];
  const r2 = await reivindicarConvidados({ supabase: sb, eventId: EV });
  assert.deepStrictEqual(r2.recipients.map((x) => x.name).sort(), ['Levi', 'Quintela']);
});

test('recusou: não convida', async () => {
  reset();
  DB.event_participants.find((p) => p.id === 'novo-q').status = 'declined';
  const r = await reivindicarConvidados({ supabase: sb, eventId: EV, collaboratorIds: [QUINTELA] });
  assert.strictEqual(r.status, 'no_recipients');
});

test('contrato: a rota usa a reivindicação por participante e o app manda quem entrou', () => {
  const fs = require('fs');
  const path = require('path');
  const api = fs.readFileSync(path.join(__dirname, '..', 'internal-api.js'), 'utf8');
  const i = api.indexOf("router.post('/internal/event-invites'");
  const bloco = api.slice(i, api.indexOf('[InternalAPI] event-invites ${eventId}', i));
  assert.ok(/reivindicarConvidados/.test(bloco), 'rota não usa a reivindicação por participante');
  assert.ok(!/status: 'already_notified'[\s\S]{0,40}\}\);\s*\}\s*\n\s*const \{ data: event \}/.test(bloco), 'early-return por evento ainda na rota');
  const web = path.join(__dirname, '..', '..', 'web', 'src');
  const qc = fs.readFileSync(path.join(web, 'components', 'QuickCreateSheet.tsx'), 'utf8');
  const ed = fs.readFileSync(path.join(web, 'components', 'EditEventSheet.tsx'), 'utf8');
  assert.ok(/notifyEventInvites\(inserted\.id as string, participantIds\)/.test(qc));
  assert.ok(/notifyEventInvites\(event\.id, toAdd\)/.test(ed));
});
