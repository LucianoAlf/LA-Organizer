// SCORECARD-CONTRADIZ-CARD (30/09): Clayton e Rafinha receberam "🏆 Seu scorecard — 🔴 90% ·
// 4 atras." (retrato da SEMANA PASSADA) enquanto o veredito do dia os punha "no ritmo" (sem card,
// e no digest do Alf). Um número/cor só: a cor do dia é do leader-verdict; a linha do scorecard
// é rotulada "semana passada" e não carrega cor nem contagem própria — não tem como contradizer.
// Rodar: node --test src/rituals/seu-scorecard.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatSeuScorecard, formatScorecardSection } = require('./governance-digest');
const { montarCardDoLider, montarVisaoDoCeo } = require('./leader-verdict');
const { renderLeaderCard } = require('./leader-cards');

const CORES = /[🔴🟡🟢]/u;
// Scorecards REAIS de 30/09 (semana 21/09) dos dois casos.
const CLAYTON_SC = { leader_name: 'Clayton', closure_rate: 0.90, tasks_overdue: 4, tasks_stuck: 0, tasks_closed: 36 };
const RAFINHA_SC = { leader_name: 'Rafinha', closure_rate: 0.89, tasks_overdue: 2, tasks_stuck: 0, tasks_closed: 16 };

test('REPRO 30/09: o formato antigo pintava 🔴 o Clayton que o veredito do dia põe no ritmo', () => {
  assert.match(formatScorecardSection([CLAYTON_SC]), /^🏆 \*Scorecard da semana\*\n🔴 \*Clayton\* — 90% · 4 atras\./);
});

test('linha nova: rótulo "semana passada", só a taxa, sem cor e sem contagem de atrasadas', () => {
  for (const sc of [CLAYTON_SC, RAFINHA_SC]) {
    const s = formatSeuScorecard(sc);
    assert.match(s, /semana passada/);
    assert.match(s, new RegExp(`\\*${sc.leader_name}\\* — ${Math.round(sc.closure_rate * 100)}% das tarefas fechadas`));
    assert.doesNotMatch(s, CORES);
    assert.doesNotMatch(s, /atras|🥇/);
  }
  assert.equal(formatSeuScorecard(null), '');
  assert.equal(formatSeuScorecard({ leader_name: 'X', closure_rate: null }), '');
});

test('PROPRIEDADE: a linha do scorecard nunca traz cor (qualquer taxa/atraso/travadas) — a única cor do digest é a do veredito', () => {
  for (const r of [0, 0.2, 0.59, 0.6, 0.84, 0.85, 1]) for (const od of [0, 1, 3, 9]) for (const st of [0, 2]) {
    assert.doesNotMatch(formatSeuScorecard({ leader_name: 'L', closure_rate: r, tasks_overdue: od, tasks_stuck: st, tasks_closed: 5 }), CORES);
  }
});

test('CONCORDÂNCIA 30/09: digest do Clayton (scorecard + card) × visão do Alf — mesma cor do dia', () => {
  const collabs = [
    { id: 'alf', full_name: 'Luciano Alf', role: 'director', unit: 'all', is_ceo: true, is_active: true, group_leader_ids: [], explicit_leader_ids: [] },
    { id: 'clayton', full_name: 'Clayton', role: 'manager', unit: 'recreio', is_ceo: false, is_active: true, group_leader_ids: [], explicit_leader_ids: [] },
    { id: 'daiana', full_name: 'Daiana', role: 'collaborator', function_role: 'farmer', unit: 'recreio', is_ceo: false, is_active: true, group_leader_ids: [], explicit_leader_ids: [] },
  ];
  const scorecards = new Map([['clayton', { closure_rate: 0.90 }]]);
  // 30/09: nada do time do Clayton com >= 3 dias úteis (só 1 de ontem).
  const tasks = [{ id: 't', title: 'x', due_date: '2026-09-29', assigned_to: 'daiana', governance_owner_id: null, coordination_request_count: 0 }];
  const args = { tasks, collabs, scorecards, today: '2026-09-30' };
  const ceo = montarVisaoDoCeo(args);
  assert.ok(ceo.ritmo.some((r) => r.id === 'clayton'));                       // Alf: no ritmo
  const card = montarCardDoLider({ ...args, leaderId: 'clayton' }).cards;
  const digestDoLider = [formatSeuScorecard(CLAYTON_SC), ...card.map(renderLeaderCard)].join('\n');
  assert.doesNotMatch(digestDoLider, /[🔴🟡]/u);                            // nenhum vermelho/amarelo pro Clayton
  // e quando o veredito é 🔴, a cor 🔴 aparece no digest SÓ pelo card (a mesma que o Alf vê)
  const ruim = { ...args, tasks: [{ ...tasks[0], due_date: '2026-09-20' }], scorecards: new Map([['clayton', { closure_rate: 0.4 }]]) };
  const cardRuim = montarCardDoLider({ ...ruim, leaderId: 'clayton' }).cards[0];
  const ceoRuim = montarVisaoDoCeo(ruim).cards.find((c) => c.leader.id === 'clayton');
  assert.equal(cardRuim.dot, ceoRuim.dot);
  assert.doesNotMatch(formatSeuScorecard({ ...CLAYTON_SC, closure_rate: 0.4 }), CORES);
});

test('FIAÇÃO: sendLeaderGovernanceDigest usa formatSeuScorecard (não o semáforo semanal)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'dispatcher.js'), 'utf8');
  const ini = src.indexOf('async function sendLeaderGovernanceDigest(');
  const corpo = src.slice(ini, src.indexOf('\nasync function ', ini + 10));
  assert.match(corpo, /formatSeuScorecard\(/);
  assert.doesNotMatch(corpo, /formatScorecardSection\(/);
});
