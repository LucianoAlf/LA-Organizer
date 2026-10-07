// CONFLITO-SO-DO-DONO (Alf 06/10 17:52 BRT): criou "Reuniao semana da crianças" 07/10 15:30–16:30
// (e9d192a4) por cima de "Jornada de Cordas" 07/10 13:00–17:00 (41a6e5af — dona: Quintela; Alf é
// participante confirmado) e nenhum aviso saiu: todo checador de conflito só olhava
// events.collaborator_id = eu.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./agenda-conflitos');

const ALF = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';
const QUINTELA = 'bfd77b2c-3303-47fe-abe1-e73a2d8da0e1';

// Linhas REAIS do banco (07/10).
const JORNADA = {
  id: '41a6e5af-1de6-4ae1-be11-f041a2af412d', title: 'Jornada de Cordas',
  start_at: '2026-10-07T16:00:00+00:00', end_at: '2026-10-07T20:00:00+00:00',
  status: 'scheduled', collaborator_id: QUINTELA,
};
const REUNIAO = {
  id: 'e9d192a4-06dc-4ed6-acf4-a92c4f453b50', title: 'Reuniao semana da crianças',
  start_at: '2026-10-07T18:30:00+00:00', end_at: '2026-10-07T19:30:00+00:00',
  status: 'scheduled', collaborator_id: ALF,
};
const MENTORIA = {
  id: 'd898903f-0c00-4bc1-8bed-2f75fbdb7cc3', title: 'Mentoria Levi',
  start_at: '2026-10-07T12:00:00+00:00', end_at: '2026-10-07T13:00:00+00:00',
  status: 'scheduled', collaborator_id: ALF,
};
// event_participants REAL do Alf na Jornada (f8934ef2): confirmed.
const PART_ALF_JORNADA = { status: 'confirmed', event: JORNADA };

test('sobrepoe: caso real — a reunião cai dentro da Jornada', () => {
  assert.equal(c.sobrepoe(REUNIAO, JORNADA), true);
  assert.equal(c.sobrepoe(JORNADA, REUNIAO), true);
});

test('sobrepoe: encostar (fim de um = início do outro) não é conflito', () => {
  const a = { start_at: '2026-10-07T12:00:00Z', end_at: '2026-10-07T13:00:00Z' };
  const b = { start_at: '2026-10-07T13:00:00Z', end_at: '2026-10-07T14:00:00Z' };
  assert.equal(c.sobrepoe(a, b), false);
});

test('unirCompromissos: participação conta; recusa e cancelado não', () => {
  const u = c.unirCompromissos([REUNIAO], [PART_ALF_JORNADA]);
  assert.deepEqual(u.map((e) => e.id), [JORNADA.id, REUNIAO.id]);
  assert.equal(u[0]._participante, true);
  assert.equal(c.unirCompromissos([], [{ status: 'declined', event: JORNADA }]).length, 0);
  assert.equal(c.unirCompromissos([], [{ status: 'confirmed', event: { ...JORNADA, status: 'cancelled' } }]).length, 0);
  assert.equal(c.unirCompromissos([{ ...REUNIAO, status: 'cancelled' }], []).length, 0);
  // dono E participante do mesmo evento: aparece uma vez só
  assert.equal(c.unirCompromissos([JORNADA], [PART_ALF_JORNADA]).length, 1);
});

// Supabase falso: grava a cadeia de cada consulta e devolve o que a tabela "tem".
function fakeSupabase(porTabela) {
  const chamadas = [];
  return {
    chamadas,
    from(tabela) {
      const q = { tabela, ops: [] };
      chamadas.push(q);
      const chain = new Proxy({}, {
        get(_, op) {
          if (op === 'then') {
            return (res, rej) => Promise.resolve({ data: porTabela[tabela] || [], error: null }).then(res, rej);
          }
          return (...args) => { q.ops.push([op, ...args]); return chain; };
        },
      });
      return chain;
    },
  };
}

test('compromissosQueSobrepoem: caso real — a Jornada (participação) aparece como conflito da reunião', async () => {
  // A consulta de dono não acha nada (a Jornada não é do Alf); a de participação acha.
  const sb = fakeSupabase({ events: [], event_participants: [PART_ALF_JORNADA] });
  const r = await c.compromissosQueSobrepoem({
    supabase: sb, collaboratorId: ALF, startIso: REUNIAO.start_at, endIso: REUNIAO.end_at,
  });
  assert.deepEqual(r.map((e) => e.title), ['Jornada de Cordas']);
  // as DUAS fontes foram consultadas, com a janela de sobreposição nas duas
  const tabelas = sb.chamadas.map((q) => q.tabela).sort();
  assert.deepEqual(tabelas, ['event_participants', 'events']);
  const part = sb.chamadas.find((q) => q.tabela === 'event_participants');
  assert.ok(part.ops.some(([op, col, v]) => op === 'eq' && col === 'collaborator_id' && v === ALF));
  assert.ok(part.ops.some(([op, col, v]) => op === 'neq' && col === 'status' && v === 'declined'));
  assert.ok(part.ops.some(([op, col]) => op === 'lt' && col === 'event.start_at'));
  assert.ok(part.ops.some(([op, col]) => op === 'gt' && col === 'event.end_at'));
});

test('compromissosQueSobrepoem: excluirId tira o próprio evento (edição)', async () => {
  const sb = fakeSupabase({ events: [REUNIAO], event_participants: [PART_ALF_JORNADA] });
  const r = await c.compromissosQueSobrepoem({
    supabase: sb, collaboratorId: ALF, startIso: REUNIAO.start_at, endIso: REUNIAO.end_at, excluirId: REUNIAO.id,
  });
  assert.deepEqual(r.map((e) => e.id), [JORNADA.id]);
});

test('compromissosQueSobrepoem: erro de consulta sobe (quem chama decide fail-open)', async () => {
  const sb = { from: () => new Proxy({}, { get: (_, op) => (op === 'then' ? (res) => res({ data: null, error: { message: 'boom' } }) : () => sb.from()) }) };
  await assert.rejects(() => c.compromissosQueSobrepoem({ supabase: sb, collaboratorId: ALF, startIso: REUNIAO.start_at, endIso: REUNIAO.end_at }));
});

test('linhasDeConflitoDoDia: caso real 07/10 — uma linha, a reunião cai dentro da Jornada', () => {
  const linhas = c.linhasDeConflitoDoDia([MENTORIA, JORNADA, REUNIAO], '2026-10-07');
  assert.deepEqual(linhas, [
    '⚠️ Conflito: *Reuniao semana da crianças* (15:30–16:30) cai dentro de *Jornada de Cordas* (13:00–17:00)',
  ]);
});

test('linhasDeConflitoDoDia: sobreposição parcial vira "bate com"; outro dia não entra', () => {
  const a = { id: 'a', title: 'A', start_at: '2026-10-07T13:00:00Z', end_at: '2026-10-07T14:00:00Z' }; // 10–11
  const b = { id: 'b', title: 'B', start_at: '2026-10-07T13:30:00Z', end_at: '2026-10-07T15:00:00Z' }; // 10:30–12
  const amanha = { id: 'x', title: 'X', start_at: '2026-10-08T13:00:00Z', end_at: '2026-10-08T14:00:00Z' };
  assert.deepEqual(c.linhasDeConflitoDoDia([b, a, amanha], '2026-10-07'), [
    '⚠️ Conflito: *A* (10:00–11:00) bate com *B* (10:30–12:00)',
  ]);
  assert.deepEqual(c.linhasDeConflitoDoDia([amanha], '2026-10-07'), []);
});

test('linhasDeConflitoDoDia: cancelado e "dia todo" (≥12h) não geram aviso', () => {
  const diaTodo = { id: 'd', title: 'Plantão', start_at: '2026-10-07T03:00:00Z', end_at: '2026-10-08T02:59:00Z' };
  assert.deepEqual(c.linhasDeConflitoDoDia([diaTodo, REUNIAO], '2026-10-07'), []);
  assert.deepEqual(c.linhasDeConflitoDoDia([{ ...JORNADA, status: 'cancelled' }, REUNIAO], '2026-10-07'), []);
});

test('anexarConflitosAoTexto: anexa a linha no fim, uma vez só', () => {
  const t = c.anexarConflitosAoTexto('Bom dia, Alf!', ['⚠️ Conflito: *A* (10:00–11:00) bate com *B* (10:30–12:00)']);
  assert.equal(t, 'Bom dia, Alf!\n\n⚠️ Conflito: *A* (10:00–11:00) bate com *B* (10:30–12:00)');
  assert.equal(c.anexarConflitosAoTexto(t, ['⚠️ Conflito: *A* (10:00–11:00) bate com *B* (10:30–12:00)']), t);
  assert.equal(c.anexarConflitosAoTexto('oi', []), 'oi');
});
