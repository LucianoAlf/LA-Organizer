// CARDS-CONTRADITORIOS (30/09): 09:00 o Alf leu "0 líderes precisam de você" com Krissya,
// Jereh, Juliana e Quintela "no ritmo"; 14:00 os quatro receberam o próprio card 🔴.
// Trava: visão do CEO e card do líder leem o MESMO veredito — nunca discordam no mesmo dia.
// Rodar: node --test src/rituals/leader-verdict.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildLeaderCards, renderLeaderCard } = require('./leader-cards');
const { montarVisaoDoCeo, montarCardDoLider, vereditoDosLideres, lideresDoTime } = require('./leader-verdict');
const { groupLeaderIdsFor } = require('../services/leader-routing');
const { businessDaysOverdue } = require('../utils/dates');

// Org espelhando 30/09 (só a forma — nomes como no digest real).
const P = (id, full_name, role, function_role, unit, extra = {}) =>
  ({ id, full_name, role, function_role, unit, is_ceo: false, is_active: true, ...extra });
const BASE = [
  P('alf', 'Luciano Alf', 'director', null, 'all', { is_ceo: true, preferred_name: 'Alf' }),
  P('krissya', 'Krissya', 'manager', null, 'barra'),
  P('duda', 'Duda', 'collaborator', 'farmer', 'barra'),
  P('juliana', 'Juliana', 'coordinator', 'pedagogico', 'all'),
  P('quintela', 'Quintela', 'coordinator', 'pedagogico', 'all'),
  P('ramon', 'Ramon', 'collaborator', 'pedagogico', null),
  P('jereh', 'Jereh', 'coordinator', 'ops_tecnicas', 'all'),
  P('jhonatan', 'Jhonatan', 'collaborator', 'ops_tecnicas', null),
  P('clayton', 'Clayton', 'manager', null, 'recreio'),
  P('daiana', 'Daiana', 'collaborator', 'farmer', 'recreio'),
];
const GROUP_LEADERS = [
  { group_key: 'pedagogico', unit: 'all', leader_id: 'juliana' },
  { group_key: 'pedagogico', unit: 'all', leader_id: 'quintela' },
  { group_key: 'ops_tecnicas', unit: 'all', leader_id: 'jereh' },
];
function collabs() {
  return BASE.map((c) => ({ ...c, group_leader_ids: groupLeaderIdsFor(c, GROUP_LEADERS), explicit_leader_ids: [] }));
}
const TODAY = '2026-09-30'; // quarta
const T = (id, assigned_to, due_date, cobr = 0, extra = {}) => ({ id, title: `T-${id}`, due_date, assigned_to,
  governance_owner_id: null, coordination_request_count: cobr, category: 'operacional', ...extra });
const TASKS_3009 = [
  ...Array.from({ length: 8 }, (_, i) => T(`duda${i}`, 'duda', '2026-09-24', 4)),   // 6d corridos = 5 úteis
  ...Array.from({ length: 4 }, (_, i) => T(`ramon${i}`, 'ramon', '2026-09-25', 4)), // 5d = 4 úteis
  T('jh1', 'jhonatan', '2026-09-24'), T('jh2', 'jhonatan', '2026-09-25', 3), T('jh3', 'jhonatan', '2026-09-26', 3),
  T('visita', 'fantasma', '2026-08-31'), // "Sem dono" (30d) — segue no balde do CEO
];
const SC = new Map([
  ['krissya', { closure_rate: 0.40 }], ['jereh', { closure_rate: 0.25 }],
  ['juliana', { closure_rate: 0.67 }], ['clayton', { closure_rate: 0.90 }],
]);

// Status de cada líder em cada visão: cor + nº de pendências (quando não-🟢).
function statusNoCeo(ceo, id) {
  const card = ceo.cards.find((c) => c.leader.id === id);
  if (card) return card.dot === '🟢' ? '🟢' : `${card.dot}${card.totals.all}`;
  assert.ok(ceo.ritmo.some((r) => r.id === id), `${id} sumiu da visão do CEO (nem card nem ritmo)`);
  return '🟢';
}
function statusNoLider(args, id) {
  const { cards } = montarCardDoLider({ ...args, leaderId: id });
  if (!cards.length) return '🟢';
  return cards[0].dot === '🟢' ? '🟢' : `${cards[0].dot}${cards[0].totals.all}`;
}
function assertConcordam(args, mostrarPct = true) {
  const ceo = montarVisaoDoCeo({ ...args, mostrarPct });
  for (const id of lideresDoTime(args.collabs)) {
    assert.equal(statusNoCeo(ceo, id), statusNoLider(args, id), `CEO × líder discordam para ${id}`);
  }
  return ceo;
}

test('REPRO 30/09: o caminho ANTIGO do CEO (corte em 6 dias úteis + roteamento pelo principal) punha os 4 no ritmo', () => {
  const antigo = buildLeaderCards({ tasks: TASKS_3009.filter((t) => businessDaysOverdue(t.due_date, TODAY) >= 6),
    events: [], collabs: collabs(), scorecards: SC, today: TODAY });
  assert.equal(antigo.cards.length, 0); // "_0 líderes precisam de você_"
  for (const n of ['Krissya', 'Jereh', 'Juliana', 'Quintela']) assert.ok(antigo.ritmo.some((r) => r.name === n), n);
  // ...e o card do próprio líder (degrau de 3 dias úteis) saía 🔴 — a contradição.
  for (const id of ['krissya', 'jereh', 'juliana', 'quintela']) {
    const doLider = buildLeaderCards({ tasks: TASKS_3009.filter((t) => businessDaysOverdue(t.due_date, TODAY) >= 3),
      events: [], collabs: collabs(), scorecards: SC, today: TODAY, forLeaderId: id });
    // (o antigo não filtrava por posse aqui, mas o card é do destinatário — a cor já dava 🔴)
    assert.equal(doLider.cards[0].dot, '🔴', id);
  }
});

test('30/09 com o veredito único: os 4 aparecem 🔴 para o CEO, com o MESMO nº do card deles; ninguém no ritmo por engano', () => {
  const args = { tasks: TASKS_3009, collabs: collabs(), scorecards: SC, today: TODAY };
  const ceo = assertConcordam(args);
  assert.equal(ceo.precisam, 4);
  const esperado = { krissya: '🔴8', juliana: '🔴4', quintela: '🔴4', jereh: '🔴3' };
  for (const [id, st] of Object.entries(esperado)) {
    assert.equal(statusNoCeo(ceo, id), st, id);
    assert.equal(statusNoLider(args, id), st, id);
  }
  assert.deepEqual(ceo.ritmo.map((r) => r.id), ['clayton']);
  // escada da Fase 8 preservada: nenhum item de < 6 dias úteis no DETALHE do CEO
  for (const c of ceo.cards) for (const b of c.people) {
    for (const i of [...b.novo, ...b.arrastando]) assert.ok(businessDaysOverdue(TASKS_3009.find((t) => t.id === i.id).due_date, TODAY) >= 6);
  }
  // "Sem dono" segue no balde do CEO
  assert.equal(ceo.unassigned.length, 1);
});

test('cabeçalho renderizado do CEO == cabeçalho do card do líder (mesma cor, %, pendências)', () => {
  const args = { tasks: TASKS_3009, collabs: collabs(), scorecards: SC, today: TODAY };
  const ceo = montarVisaoDoCeo(args);
  for (const id of ['krissya', 'juliana', 'quintela', 'jereh']) {
    const lider = montarCardDoLider({ ...args, leaderId: id }).cards[0];
    const cardCeo = ceo.cards.find((c) => c.leader.id === id);
    assert.equal(renderLeaderCard(cardCeo).split('\n')[0], renderLeaderCard(lider).split('\n')[0], id);
    assert.equal(renderLeaderCard(cardCeo).split('\n')[1], renderLeaderCard(lider).split('\n')[1], id);
  }
});

test('show_scorecard=false no CEO esconde o % mas NÃO muda a cor', () => {
  const args = { tasks: TASKS_3009, collabs: collabs(), scorecards: SC, today: TODAY };
  const ceo = assertConcordam(args, false);
  assert.ok(ceo.cards.every((c) => c.closurePct === null));
  // 1 atrasada + taxa 40% é 🔴 pela régua; sem a taxa seria 🟡 — o veredito usa a taxa real.
  const um = { ...args, tasks: [T('d1', 'duda', '2026-09-24')] };
  const ceo1 = montarVisaoDoCeo({ ...um, mostrarPct: false });
  assert.equal(statusNoCeo(ceo1, 'krissya'), '🔴1');
  assert.equal(statusNoLider(um, 'krissya'), '🔴1');
});

test('escalada de verdade (>= 6 dias úteis) aparece no detalhe do CEO E no card do líder, com a mesma cor', () => {
  const tasks = [...TASKS_3009, T('dai1', 'daiana', '2026-09-20'), T('clay1', 'clayton', '2026-09-22')];
  const args = { tasks, collabs: collabs(), scorecards: SC, today: TODAY };
  const ceo = assertConcordam(args);
  const cl = ceo.cards.find((c) => c.leader.id === 'clayton');
  assert.equal(cl.dot, '🟡'); // 2 atrasadas, taxa 90%
  assert.equal(cl.totals.all, 2);
  assert.ok(!ceo.ritmo.some((r) => r.id === 'clayton'));
});

test('PROPRIEDADE: em cenários variados (dias, cobranças, taxas, delegação), CEO e líder nunca discordam', () => {
  const dias = ['2026-09-29', '2026-09-28', '2026-09-26', '2026-09-25', '2026-09-24', '2026-09-22', '2026-09-10'];
  const donos = ['duda', 'ramon', 'jhonatan', 'daiana', 'krissya', 'juliana', 'clayton', 'fantasma'];
  const taxas = [null, 0.2, 0.7, 0.95];
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 200; k++) {
    const tasks = Array.from({ length: rnd(12) }, (_, i) => T(`k${k}-${i}`, donos[rnd(donos.length)], dias[rnd(dias.length)],
      rnd(5), rnd(6) === 0 ? { governance_owner_id: ['krissya', 'jereh', 'clayton'][rnd(3)] } : {}));
    const sc = new Map(['krissya', 'juliana', 'quintela', 'jereh', 'clayton'].map((id) => [id, { closure_rate: taxas[rnd(4)] }]));
    assertConcordam({ tasks, collabs: collabs(), scorecards: sc, today: TODAY }, rnd(2) === 0);
  }
});

test('veredito ignora tarefa sem due_date e com < 3 dias úteis (degrau do líder)', () => {
  const v = vereditoDosLideres({ tasks: [T('a', 'duda', '2026-09-29'), T('b', 'duda', null), T('c', 'duda', '2026-09-26')],
    collabs: collabs(), scorecards: new Map(), today: TODAY });
  assert.deepEqual(v.get('krissya').tarefas.map((t) => t.id), ['c']); // 26/09 = 3 úteis; 29/09 = 1
});

test('FIAÇÃO: ceoTeamUnclosedTasksReport lê o veredito nos DOIS caminhos (sem degrau/escopo próprios)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'dispatcher.js'), 'utf8');
  const ini = src.indexOf('async function ceoTeamUnclosedTasksReport(');
  const corpo = src.slice(ini, src.indexOf('\nasync function ', ini + 10));
  assert.match(corpo, /montarVisaoDoCeo\(\{ tasks: staleOpen/);
  assert.match(corpo, /montarCardDoLider\(\{ tasks: staleOpen/);
  assert.doesNotMatch(corpo, /limiarDias/);          // o degrau não é mais decidido aqui
  assert.doesNotMatch(corpo, /\bstale\.filter\(/);    // líder não parte mais da lista sem guard de gêmea
  assert.doesNotMatch(corpo, /buildLeaderCards\(/);   // ninguém monta card por fora do veredito
  assert.match(corpo, /built\.precisam/);             // "N líderes precisam de você" vem do veredito
});
