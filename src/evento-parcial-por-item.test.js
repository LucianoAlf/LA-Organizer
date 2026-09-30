'use strict';
// RESULTADO-PARCIAL-POR-ITEM (achado ae5f4b42, Alf 29/09 15:23 BRT) — o turno REAL passando pelo
// applyEventUpdates de verdade, com o banco trocado por um dublê que contém as linhas reais
// (events ebf2eaf8 / 3001604f, event_participants e collaborators lidos em 30/09, read-only).
// O EVENT_UPDATE voltou ok=1 fail=1 e a fala disse "Cancelados ✅" pros dois.
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ALF = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';
const QUINTELA = 'bfd77b2c-3303-47fe-abe1-e73a2d8da0e1';
const MENTORIA = { id: 'ebf2eaf8-b40e-46ab-9ea3-abf36d0040f8', title: 'Mentoria com pessoal da Benji', status: 'scheduled', start_at: '2026-09-30T11:30:00+00:00', end_at: '2026-09-30T12:30:00+00:00', collaborator_id: ALF };
const JORNADA = { id: '3001604f-fc06-4a7d-a6df-8197e7a8fc4c', title: 'Jornada de Cordas', status: 'scheduled', start_at: '2026-09-30T16:00:00+00:00', end_at: '2026-09-30T20:00:00+00:00', collaborator_id: QUINTELA };
const TABELAS = {
  events: [MENTORIA, JORNADA],
  event_participants: [{ event_id: JORNADA.id, collaborator_id: ALF, status: 'confirmed' }],
  collaborators: [{ id: QUINTELA, preferred_name: 'Quintela', full_name: 'Quintela' }, { id: ALF, preferred_name: 'Alf', full_name: 'Alf' }],
};
const escritas = [];

function consulta(tabela) {
  const preds = [];
  let op = 'select', patch = null;
  const linhas = () => (TABELAS[tabela] || []).filter((r) => preds.every((p) => p(r)));
  const fim = () => {
    if (op === 'update') { const alvo = linhas(); alvo.forEach((r) => Object.assign(r, patch)); escritas.push({ tabela, ids: alvo.map((r) => r.id), patch }); return { data: alvo, error: null }; }
    if (op === 'insert' || op === 'delete') { escritas.push({ tabela, op }); return { data: [], error: null }; }
    return { data: linhas(), error: null };
  };
  const q = {
    select() { return q; }, order() { return q; }, limit() { return q; }, gte() { return q; }, lte() { return q; }, lt() { return q; }, gt() { return q; },
    eq(c, v) { preds.push((r) => r[c] === v); return q; },
    neq(c, v) { preds.push((r) => r[c] !== v); return q; },
    in(c, vs) { preds.push((r) => vs.includes(r[c])); return q; },
    is(c, v) { preds.push((r) => (r[c] ?? null) === v); return q; },
    not() { return q; }, or() { return q; }, ilike() { return q; },
    update(p) { op = 'update'; patch = p; return q; },
    insert() { op = 'insert'; return q; }, upsert() { op = 'insert'; return q; },
    delete() { op = 'delete'; return q; },
    maybeSingle() { const r = fim(); return Promise.resolve({ data: (r.data || [])[0] || null, error: null }); },
    single() { return q.maybeSingle(); },
    then(res, rej) { return Promise.resolve(fim()).then(res, rej); },
  };
  return q;
}
const clientPath = path.join(__dirname, 'supabase', 'client.js');
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { from: (t) => consulta(t), rpc: async () => ({ data: null, error: null }) } };

const { applyEventUpdates } = require('./engine');
const { relatoParcialPorItem } = require('./lib/resultado-parcial-por-item');

// A prosa que o LLM mandou junto do marker (conversation_history 2026-09-29T18:23:29Z, sem a recusa
// que o engine anexou).
const PROSA_REAL = 'Entendi, Alf — desmarco os dois de amanhã:\n\n🗓️ *Mentoria com pessoal da Benji* (08:30)\n🗓️ *Jornada de Cordas* (13h–17h, com Quintela)\n\nCancelados ✅ — remarca quando resolver essa questão pessoal. Força aí.';

test('turno real: applyEventUpdates diz QUAL item falhou, e a fala sai por item', async () => {
  const r = await applyEventUpdates({ id: ALF, phone: '0000' }, [
    { action: 'cancel', id: 'ebf2eaf8' },
    { action: 'cancel', id: '3001604f' },
  ]);
  assert.strictEqual(r.okCount, 1);
  assert.strictEqual(r.failCount, 1);
  assert.deepStrictEqual(r.itens.map((i) => [i.titulo, i.ok]), [['Mentoria com pessoal da Benji', true], ['Jornada de Cordas', false]]);
  assert.ok(/Quintela/.test(r.itens[1].mensagens[0]));
  // só a Mentoria foi escrita no banco
  const evUpd = escritas.filter((e) => e.tabela === 'events');
  assert.deepStrictEqual(evUpd.map((e) => e.ids), [[MENTORIA.id]]);

  const out = relatoParcialPorItem(PROSA_REAL, r.itens);
  assert.strictEqual(out.fired, true);
  assert.ok(!/Cancelados/.test(out.texto), out.texto);
  assert.ok(out.texto.includes('✅ *Mentoria com pessoal da Benji* (08:30) — cancelado'), out.texto);
  assert.ok(out.texto.includes('⚠️ *Jornada de Cordas* (13h–17h, com Quintela) — não consegui cancelar: quem pode cancelar é o dono do compromisso, *Quintela*'), out.texto);
  assert.ok(/recado propondo a mudança\?\s*$/.test(out.texto), out.texto);
});

test('contrato: o ramo ok>0 do EVENT_UPDATE só anexa as falhas cruas quando o relato por item NÃO disparou', () => {
  const fonte = require('fs').readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
  const i = fonte.indexOf("relatoParcialPorItem(base, evItens)");
  assert.ok(i > 0, 'relato por item não está ligado no EVENT_UPDATE');
  assert.ok(/if \(!\(_parcial && _parcial\.fired\) && evFailMessages && evFailMessages\.length\)/.test(fonte.slice(i, i + 1200)));
});
