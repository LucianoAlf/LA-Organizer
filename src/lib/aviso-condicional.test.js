'use strict';
// AVISO-CONDICIONAL-NAO-E-CONCLUSAO (Rafinha 03/10 15:13 UTC, marker_logs CHOKEPOINT confab:unknown).
// Ela disse "Avisa agora não tom"; o TOM respondeu certo e a porta de baixo trocou tudo por
// "Na real não consegui registrar isso agora". Texto byte a byte do raw_excerpt.
const test = require('node:test');
const assert = require('node:assert');
const { soAvisoCondicional, liberaAvisoCondicional, buscarLastroDeAviso } = require('./aviso-condicional');
const { enforceNoMarkerHonesty, NO_MARKER_HONEST_NOTE } = require('./optimistic-confirm');

const REAL = 'Boa, deixo quieto então — só te aviso quando o Luciano aprovar a obra do teto. 👍';

const trava = (reply, lastro) => enforceNoMarkerHonesty(reply, {
  nothingPersisted: true, markerAttempted: false, reportedState: liberaAvisoCondicional(reply, { lastro }),
}, { meta: true });

test('prova do defeito: sem o veto, a fala real de 03/10 vira "não consegui registrar"', () => {
  const h = enforceNoMarkerHonesty(REAL, { nothingPersisted: true }, { meta: true });
  assert.strictEqual(h.fired, true);
  assert.ok(h.reply.includes(NO_MARKER_HONEST_NOTE));
});

test('fala real + aviso COM lastro (pedido de aprovação aberto) passa intacta', () => {
  assert.strictEqual(soAvisoCondicional(REAL), true);
  const h = trava(REAL, true);
  assert.strictEqual(h.fired, false);
  assert.strictEqual(h.reply, REAL);
});

test('NEGATIVO: a mesma fala SEM lastro segue acusada — a promessa seria falsa', () => {
  const h = trava(REAL, false);
  assert.strictEqual(h.fired, true);
  assert.ok(h.reply.includes(NO_MARKER_HONEST_NOTE));
});

test('variações do aviso condicional que a trava FORTE acusa', () => {
  for (const r of [
    'Pode deixar — te aviso quando o Luciano decidir.',
    'Tranquilo.\n\nTe aviso quando ele responder o pedido da compra dos pads. 👍',
    'Deixo quieto, só te aviso quando aprovarem!',
  ]) {
    assert.strictEqual(soAvisoCondicional(r), true, r);
    assert.strictEqual(trava(r, true).fired, false, r);
    assert.strictEqual(trava(r, false).fired, true, r);
  }
  // "Fechado." sozinho já é afirmação de conclusão pra trava — o aviso não lava a frase vizinha.
  assert.strictEqual(soAvisoCondicional('Fechado. Te aviso assim que o Luciano responder.'), false);
});

test('controle: escrita afirmada ao lado do aviso continua acusada mesmo com lastro', () => {
  for (const r of [
    'Registrei a obra do teto e te aviso quando o Luciano aprovar.',
    '✅ Anotado! Te aviso quando o Luciano aprovar.',
    'Criei a tarefa. Te aviso quando aprovarem.',
  ]) {
    assert.strictEqual(soAvisoCondicional(r), false, r);
    assert.strictEqual(trava(r, true).fired, true, r);
  }
});

test('controle: claim sem aviso condicional não é assunto deste veto', () => {
  assert.strictEqual(soAvisoCondicional('✅ Registrado!'), false);
  assert.strictEqual(soAvisoCondicional('Te lembro quando chegar a hora.'), false); // lembrete ≠ aviso de evento
  assert.strictEqual(soAvisoCondicional(''), false);
});

function fakeSupabase(tables) {
  const get = (row, col) => {
    if (col.includes('->>')) { const [a, b] = col.split('->>'); const v = row[a] ? row[a][b] : undefined; return v == null ? null : String(v); }
    return row[col];
  };
  return {
    from(name) {
      const f = [];
      let lim = null;
      const q = {
        select() { return q; },
        eq(c, v) { f.push((r) => get(r, c) === v); return q; },
        is(c, v) { f.push((r) => (get(r, c) ?? null) === v); return q; },
        gte(c, v) { f.push((r) => String(get(r, c)) >= v); return q; },
        in(c, vs) { f.push((r) => vs.includes(get(r, c))); return q; },
        limit(n) { lim = n; return q; },
        then(res, rej) {
          let rows = (tables[name] || []).filter((r) => f.every((x) => x(r)));
          if (lim) rows = rows.slice(0, lim);
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
}

const RAFINHA = 'c9e72a40-0000-4000-8000-000000000001';
const AGORA = Date.parse('2026-10-05T12:00:00Z');
const recente = '2026-10-03T15:00:00Z';

test('lastro: pedido de aprovação aberto em que ELA é a solicitante', async () => {
  const sb = fakeSupabase({ pending_intents: [{ kind: 'approval_pending', collaborator_id: 'luciano', resolved_at: null, asked_at: recente, payload: { domain: 'task', requester_id: RAFINHA } }] });
  assert.strictEqual(await buscarLastroDeAviso(sb, RAFINHA, { agora: AGORA }), true);
});

test('lastro: recado de coordenação dela que espera resposta', async () => {
  const sb = fakeSupabase({ coordination_requests: [{ requester_id: RAFINHA, status: 'sent', expects_response: true, created_at: recente }] });
  assert.strictEqual(await buscarLastroDeAviso(sb, RAFINHA, { agora: AGORA }), true);
});

test('sem lastro: estado real de 03/10 — tarefa parada em awaiting_confirmation SEM pedido aberto', async () => {
  const sb = fakeSupabase({
    tasks: [{ id: 'c2a87b2f', created_by: RAFINHA, status: 'awaiting_confirmation', created_at: recente }],
    pending_intents: [
      { kind: 'approval_pending', collaborator_id: 'luciano', resolved_at: '2026-10-04T00:00:00Z', asked_at: recente, payload: { requester_id: RAFINHA } },
      { kind: 'approval_pending', collaborator_id: 'luciano', resolved_at: null, asked_at: '2026-09-01T00:00:00Z', payload: { requester_id: RAFINHA } },
    ],
    coordination_requests: [{ requester_id: RAFINHA, status: 'responded', expects_response: true, created_at: recente }],
  });
  assert.strictEqual(await buscarLastroDeAviso(sb, RAFINHA, { agora: AGORA }), false);
});

test('lastro nunca lança: erro de banco vira false (a trava continua valendo)', async () => {
  const sb = { from() { throw new Error('boom'); } };
  assert.strictEqual(await buscarLastroDeAviso(sb, RAFINHA, { agora: AGORA }), false);
});

// ── ligação (âncora de código) ────────────────────────────────────────────────────────────
test('1:1: ligado na porta reportedState com o lastro buscado no turno; optimistic-confirm.js intocado', () => {
  const fs = require('fs');
  const path = require('path');
  const engine = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  assert.match(engine, /\n\s*\|\| liberaAvisoCondicional\(reply, \{ lastro: _avisoCondLastro \}\),\n/);
  assert.match(engine, /_avisoCondLastro = await buscarLastroDeAviso\(supabase, collab\.id\);/);
  assert.ok(!fs.readFileSync(path.join(__dirname, 'optimistic-confirm.js'), 'utf8').includes('aviso-condicional'));
});
