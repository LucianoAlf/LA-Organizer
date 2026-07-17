// src/rituals/leader-cards.test.js
// Trava o card por líder (§10 da spec 2026-07-16). Rodar:
//   node --test src/rituals/leader-cards.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildLeaderCards } = require('./leader-cards');
const { groupLeaderIdsFor } = require('../services/leader-routing');

// ── Fixtures — espelham o org real (mesmas de leader-routing.test.js) ────────
const CEO      = { id: 'ceo',      full_name: 'Luciano Alf', role: 'director',     function_role: null,         unit: 'all',     is_ceo: true,  is_active: true };
const CLAYTON  = { id: 'clayton',  full_name: 'Clayton',     role: 'manager',      function_role: null,         unit: 'recreio', is_ceo: false, is_active: true };
const JULIANA  = { id: 'juliana',  full_name: 'Juliana',     role: 'coordinator',  function_role: 'pedagogico', unit: 'all',     is_ceo: false, is_active: true };
const QUINTELA = { id: 'quintela', full_name: 'Quintela',    role: 'coordinator',  function_role: 'pedagogico', unit: 'all',     is_ceo: false, is_active: true };
const PETERSON = { id: 'peterson', full_name: 'Peterson',    role: 'collaborator', function_role: 'pedagogico', unit: null,      is_ceo: false, is_active: true };
const DAIANA   = { id: 'daiana',   full_name: 'Daiana',      role: 'collaborator', function_role: 'farmer',     unit: 'recreio', is_ceo: false, is_active: true };
const FABI     = { id: 'fabi',     full_name: 'Fabi',        role: 'collaborator', function_role: 'farmer',     unit: 'all',     is_ceo: false, is_active: true };

const GROUP_LEADERS = [
  { group_key: 'pedagogico', unit: 'all', leader_id: 'juliana' },
  { group_key: 'pedagogico', unit: 'all', leader_id: 'quintela' },
];

function mkCollabs() {
  const all = [CEO, CLAYTON, JULIANA, QUINTELA, PETERSON, DAIANA, FABI].map((c) => ({ ...c }));
  for (const c of all) {
    c.group_leader_ids = groupLeaderIdsFor(c, GROUP_LEADERS);
    c.explicit_leader_ids = [];
  }
  return all;
}

const TODAY = '2026-07-17';
// due_date → days: 16/07 = 1d (🆕), 15/07 = 2d, 02/06 = 45d
const task = (id, assigned_to, due_date, extra = {}) =>
  ({ id, title: `T-${id}`, due_date, assigned_to, governance_owner_id: null,
     coordination_request_count: 0, ...extra });

const build = (tasks, opts = {}) => buildLeaderCards({
  tasks, events: [], collabs: mkCollabs(), scorecards: new Map(), today: TODAY, ...opts,
});

// ── §10.1 Conservação — o guardião do zero-regressão ────────────────────────
test('CONSERVAÇÃO: nenhuma tarefa some no agrupamento', () => {
  const tasks = [
    task('a', 'peterson', '2026-06-02'), task('b', 'peterson', '2026-07-16'),
    task('c', 'daiana',   '2026-07-15'), task('d', 'clayton',  '2026-07-15'),
    task('e', 'juliana',  '2026-07-16'), task('f', 'fabi',     '2026-07-15'),
    // dono que não existe em `collabs` (assigned_to órfão/removido) — tem que cair no
    // balde `unassigned`, não sumir. Sem isto o guardião tinha o MESMO ponto cego do bug.
    task('g', 'fantasma', '2026-07-15'),
  ];
  const { cards, unassigned } = build(tasks);
  const seen = [];
  for (const c of cards) for (const p of c.people) seen.push(...p.novo, ...p.arrastando);
  for (const p of unassigned) seen.push(...p.novo, ...p.arrastando);
  assert.strictEqual(seen.length, tasks.length, 'sumiu ou duplicou tarefa');
  assert.deepStrictEqual([...new Set(seen.map((i) => i.id))].sort(), ['a','b','c','d','e','f','g']);
});

// ── §10.1b SEM DONO NÃO SOME — o guardião de conservação tinha o mesmo ponto cego
// do bug: fixtures só com gente ativa nunca exercitavam assigned_to órfão/inativo. ──
test('SEM DONO NÃO SOME: tarefa de dono inativo/removido cai no balde, não evapora', () => {
  // 11 casos reais em produção (assigned_to nulo ou apontando pra quem saiu). O loader
  // só carrega is_active=true, então o dono não resolve — mas o CEO precisa ver.
  const { cards, unassigned } = build([task('x', 'fantasma', '2026-07-15')]);
  const todos = [];
  for (const c of cards) for (const p of c.people) todos.push(...p.novo, ...p.arrastando);
  for (const p of unassigned) todos.push(...p.novo, ...p.arrastando);
  assert.strictEqual(todos.length, 1, 'a tarefa sumiu');
  assert.strictEqual(unassigned.length, 1);
  assert.strictEqual(unassigned[0].person.name, 'Sem dono');
});

// ── §10.2 O caso que HOJE falha ────────────────────────────────────────────
test('PETERSON: as 9 atrasadas de um collaborator entram no card da Juliana', () => {
  const tasks = Array.from({ length: 9 }, (_, i) => task(`p${i}`, 'peterson', '2026-07-15'));
  const { cards } = build(tasks);
  const jul = cards.find((c) => c.leader.id === 'juliana');
  assert.ok(jul, 'Juliana não ganhou card');
  assert.strictEqual(jul.totals.team, 9);
  assert.strictEqual(jul.totals.own, 0);
});

// ── §10.3 Sem duplicata mesmo com N líderes ────────────────────────────────
test('SEM DUPLICATA: Peterson tem 2 líderes e aparece em EXATAMENTE 1 card', () => {
  const { cards } = build([task('a', 'peterson', '2026-07-15')]);
  const comPeterson = cards.filter((c) => c.people.some((p) => p.person.id === 'peterson'));
  assert.strictEqual(comPeterson.length, 1);
  assert.strictEqual(comPeterson[0].leader.id, 'juliana');
});

// ── §5.1 co-líderes ────────────────────────────────────────────────────────
test('coLeaders: o card da Juliana nomeia o Quintela com o rótulo do vínculo', () => {
  const { cards } = build([task('a', 'peterson', '2026-07-15')]);
  const jul = cards.find((c) => c.leader.id === 'juliana');
  assert.deepStrictEqual(jul.coLeaders, [{ id: 'quintela', name: 'Quintela', label: 'pedagógico' }]);
});

// ── §7.6 / §10.10 / §10.11 quem cai onde ───────────────────────────────────
test('DIRETO COM VOCÊ: não-líder cujo único líder é o CEO cai no balde', () => {
  const { cards, unassigned } = build([task('a', 'fabi', '2026-07-15')]);
  assert.strictEqual(cards.some((c) => c.people.some((p) => p.person.id === 'fabi')), false);
  assert.strictEqual(unassigned.length, 1);
  assert.strictEqual(unassigned[0].person.id, 'fabi');
});

test('LÍDER NÃO CAI NO BALDE: as tarefas do Clayton vão pro isSelf do card dele', () => {
  const { cards, unassigned } = build([task('a', 'clayton', '2026-07-15')]);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  assert.ok(cl, 'Clayton não ganhou card');
  assert.strictEqual(cl.totals.own, 1);
  assert.strictEqual(unassigned.length, 0);
});

test('isSelf POR ÚLTIMO: o bloco "Dele/Dela" fecha o card', () => {
  const tasks = [task('a', 'clayton', '2026-07-15'), task('b', 'daiana', '2026-07-15')];
  const { cards } = build(tasks);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  assert.strictEqual(cl.people[cl.people.length - 1].isSelf, true);
  assert.strictEqual(cl.people[0].person.id, 'daiana');
});

// ── §7.4 faixas ────────────────────────────────────────────────────────────
test('FAIXAS: 1d cai em novo, 2d+ cai em arrastando (desc por days)', () => {
  const tasks = [
    task('novo', 'peterson', '2026-07-16'),
    task('velho', 'peterson', '2026-06-02'),
    task('medio', 'peterson', '2026-07-15'),
  ];
  const { cards } = build(tasks);
  const p = cards.find((c) => c.leader.id === 'juliana').people[0];
  assert.deepStrictEqual(p.novo.map((i) => i.id), ['novo']);
  assert.deepStrictEqual(p.arrastando.map((i) => i.id), ['velho', 'medio']);
  assert.strictEqual(p.arrastando[0].days, 45);
});

// ── §10.4 determinismo ponta a ponta ───────────────────────────────────────
test('DETERMINISMO: embaralhar a entrada produz a MESMA saída', () => {
  const tasks = [task('a', 'peterson', '2026-07-15'), task('b', 'daiana', '2026-07-16')];
  const a = buildLeaderCards({ tasks, events: [], collabs: mkCollabs(), scorecards: new Map(), today: TODAY });
  const b = buildLeaderCards({ tasks: [...tasks].reverse(), events: [], collabs: mkCollabs().reverse(), scorecards: new Map(), today: TODAY });
  assert.deepStrictEqual(JSON.stringify(a), JSON.stringify(b));
});

// ── FIX 1 — determinismo do balde `unassigned` ─────────────────────────────
// `unassigned` saía na ordem de inserção do Map = ordem do array de entrada = ordem do
// heap do Postgres (o loader não tem ORDER BY em query nenhuma). O bloco "Direto com
// você" reordenava sozinho no zap do CEO sem nenhum dado ter mudado.
test('DETERMINISMO: o balde "Direto com você" não embaralha com a ordem da entrada', () => {
  // fabi -> cai direto no balde (único líder é o CEO, mesmo caminho do teste "DIRETO COM
  // VOCÊ" acima). fantasma -> dono órfão vira SEM_DONO (id fixo '__sem_dono__', mesmo
  // caminho do teste "SEM DONO NÃO SOME") — 2ª pessoa no balde, com id diferente de 'fabi'.
  const t1 = task('a', 'fabi', '2026-07-15');
  const t2 = task('b', 'fantasma', '2026-07-15');
  const a = build([t1, t2]).unassigned.map((p) => p.person.id);
  const b = build([t2, t1]).unassigned.map((p) => p.person.id);
  assert.deepStrictEqual(a, b, 'a ordem do balde vazou da entrada');
});

// ── FIX 2 — coLeaders sob delegação não pode descartar o líder natural ─────
test('coLeaders sob DELEGAÇÃO: o líder natural não some da nota do card', () => {
  // Tarefa do Peterson (líderes naturais: Juliana + Quintela) delegada pro Clayton.
  // governanceViewerIdsOf curto-circuita no delegador → o card é do Clayton. Juliana e
  // Quintela seguem sendo co-líderes legítimos — `.slice(1)` matava a Juliana sem motivo.
  const t = task('d', 'peterson', '2026-07-15', { governance_owner_id: 'clayton' });
  const { cards } = build([t]);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  assert.ok(cl, 'o card do delegador não existe');
  assert.deepStrictEqual(cl.coLeaders.map((c) => c.id).sort(), ['juliana', 'quintela']);
});

// ── §7.2 régua de cor + §7.3 percentual ────────────────────────────────────
const { classifyCard } = require('./leader-cards');

test('GUARD DE NULL: sem nota e sem pendência → 🟢, NUNCA 🔴 (null < 0.60 é true em JS)', () => {
  assert.strictEqual(
    classifyCard({ closureRate: null, overdueLive: 0, stuckLive: 0 }), '🟢');
});

test('GUARD DE NULL: sem nota mas COM pendência ao vivo → não usa o % pra decidir', () => {
  // 2 atrasadas e sem nota: 🟡 por overdueLive >= 1 — não 🔴 por "null < 0.60".
  assert.strictEqual(
    classifyCard({ closureRate: null, overdueLive: 2, stuckLive: 0 }), '🟡');
});

test('100% DE ZERO: líder com conjunto vazio vai pro ritmo — não vira card 🟢-100%', () => {
  // Atenção: com a §7.6 o 🟢 SAI de `cards`. Procurar o Clayton em `cards` aqui daria
  // undefined. É o caso Rose (🟢 100% liderando 4 pessoas, sem ter fechado nada).
  const { cards, ritmo } = build([]);
  assert.ok(ritmo.some((r) => r.id === 'clayton'), 'líder limpo não entrou no ritmo');
  assert.strictEqual(cards.some((c) => c.leader.id === 'clayton'), false, '🟢 vazou pros cards');
});

test('SEM NOTA: líder COM pendência e sem scorecard tem closurePct null (nunca 100%)', () => {
  const { cards } = build([task('a', 'daiana', '2026-07-15')]);
  assert.strictEqual(cards.find((c) => c.leader.id === 'clayton').closurePct, null);
});

test('LÍDER AFOGADO: 8 próprias e time limpo → 🔴 (o buraco da opção A recusada)', () => {
  const tasks = Array.from({ length: 8 }, (_, i) => task(`c${i}`, 'clayton', '2026-07-15'));
  const { cards } = build(tasks);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  assert.strictEqual(cl.totals.own, 8);
  assert.strictEqual(cl.totals.team, 0);
  assert.strictEqual(cl.dot, '🔴');
});

test('RELÓGIOS: noTasks vem do AO VIVO, não do snapshot semanal', () => {
  // Snapshot diz "semana perfeita" (closed=0, rate null); ao vivo tem 3 atrasadas.
  // Se noTasks saísse do snapshot, isto viraria 🟢 com 3 pendências listadas.
  const sc = new Map([['clayton', { closure_rate: null, tasks_closed: 0 }]]);
  const tasks = Array.from({ length: 3 }, (_, i) => task(`c${i}`, 'clayton', '2026-07-15'));
  const { cards } = build(tasks, { scorecards: sc });
  assert.strictEqual(cards.find((c) => c.leader.id === 'clayton').dot, '🔴');
});

test('PERCENTUAL: closure_rate 0.4 do scorecard vira closurePct 40', () => {
  const sc = new Map([['clayton', { closure_rate: 0.4, tasks_closed: 2 }]]);
  const { cards } = build([task('a', 'clayton', '2026-07-15')], { scorecards: sc });
  assert.strictEqual(cards.find((c) => c.leader.id === 'clayton').closurePct, 40);
});

test('STUCK: 2 tarefas cobradas 3x pintam 🔴 e a flag chega no item', () => {
  const tasks = [
    task('s1', 'daiana', '2026-07-15', { coordination_request_count: 3 }),
    task('s2', 'daiana', '2026-07-15', { coordination_request_count: 4 }),
  ];
  const { cards } = build(tasks);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  assert.strictEqual(cl.dot, '🔴');
  assert.strictEqual(cl.people[0].arrastando.every((i) => i.stuck), true);
});

test('QUEM APARECE: 🟢 sai de cards e entra em ritmo', () => {
  const { cards, ritmo } = build([task('a', 'peterson', '2026-07-15')]);
  assert.strictEqual(cards.every((c) => c.dot !== '🟢'), true, '🟢 vazou pros cards');
  assert.ok(ritmo.some((r) => r.id === 'clayton'), 'Clayton (limpo) não entrou no ritmo');
});

// ── FIX 1 (relógios) / FIX 2 (fronteira) — revisão pós-implementação ───────
// FIX 1: noTasks misturava AO VIVO (overdueLive/stuckLive) com SNAPSHOT (closedLastWeek).
// FIX 2: closurePct arredondado era comparado a 60/85 — Math.round(59.5)=60 escapava do 🔴.
test('RELÓGIOS: rate 0% real da semana passada NÃO vira 🟢 por quadro limpo hoje', () => {
  // closedLastWeek===0 no noTasks fazia o 0% real (fechou zero de 5) sumir como "no ritmo".
  assert.strictEqual(
    classifyCard({ closureRate: 0, overdueLive: 0, stuckLive: 0 }), '🟢',
    'sem pendência viva o card seria VAZIO — 🟢 é o certo, mas por AUSÊNCIA de item, não por closed=0',
  );
  // e com pendência viva, o 0% tem que pesar:
  assert.strictEqual(classifyCard({ closureRate: 0, overdueLive: 1, stuckLive: 0 }), '🔴');
});

test('SEM CARD VAZIO: quadro limpo hoje nunca vira card, qualquer que seja o % da semana', () => {
  // Antes: closed=2 + rate=0.30 + quadro limpo → 🔴 com 0 pendências pra mostrar.
  assert.strictEqual(classifyCard({ closureRate: 0.30, overdueLive: 0, stuckLive: 0 }), '🟢');
  assert.strictEqual(classifyCard({ closureRate: 0.70, overdueLive: 0, stuckLive: 0 }), '🟢');
  // ── A CAMADA QUE DISCRIMINA ────────────────────────────────────────────────
  // Os 2 asserts de unidade acima passam ATÉ contra o código velho — não porque a régua
  // velha estivesse certa, mas porque eles chamam classifyCard já com a interface NOVA
  // (`closureRate`), e o velho desestrutura `closurePct`/`closedLastWeek`: as chaves não
  // batem, viram `undefined`, `undefined < 60` é false, e o resultado cai no fallback 🟢
  // por ACIDENTE. Via buildLeaderCards (API pública) não existe esse confound: o velho
  // montava closedLastWeek=2 (snapshot) → noTasks=false → badPct(30<60) → card 🔴 com
  // totals.all=0. É este assert que prova o fix, não os de cima.
  const sc = new Map([['clayton', { closure_rate: 0.30, tasks_closed: 2 }]]);
  const { cards, ritmo } = build([], { scorecards: sc });
  assert.strictEqual(cards.some((c) => c.leader.id === 'clayton'), false,
    'card VAZIO: o % da semana passada criou card pra quem não tem pendência viva hoje');
  assert.ok(ritmo.some((r) => r.id === 'clayton'), 'líder de quadro limpo tem que cair no ritmo');
});

test('FRONTEIRA: compara o rate BRUTO, não o arredondado (59,5% é ruim, não 60%)', () => {
  // Math.round(59.5)=60 → 60<60 falso → o líder escapava do 🔴. A régua de hoje
  // (scorecard-builder.js:203) compara 0.595 < 0.60 = true.
  assert.strictEqual(classifyCard({ closureRate: 0.595, overdueLive: 1, stuckLive: 0 }), '🔴');
  assert.strictEqual(classifyCard({ closureRate: 0.845, overdueLive: 1, stuckLive: 0 }), '🟡');
});

test('GUARD DE NULL sobrevive ao rate bruto: sem nota + pendência viva → 🟡, nunca 🔴', () => {
  // `null < 0.60` é true em JS. Sem o guard, todo líder sem nota viraria 🔴.
  assert.strictEqual(classifyCard({ closureRate: null, overdueLive: 2, stuckLive: 0 }), '🟡');
  // Camada de integração via buildLeaderCards (sem scorecard → rate null → closurePct null).
  // ATENÇÃO a quem for mexer aqui: este teste NÃO discrimina velho-vs-novo, e isso é
  // esperado — o código velho tem o MESMO guard, só na escala 0-100 (`closurePct !== null`).
  // Ele é guarda de SOBREVIVÊNCIA (o guard não pode morrer no refactor pra rate bruto),
  // não teste de bug. Se um dia ele ficar vermelho, o guard morreu — não é falso-positivo.
  const tasks = [task('n1', 'daiana', '2026-07-15'), task('n2', 'daiana', '2026-07-16')];
  const { cards } = build(tasks);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  assert.strictEqual(cl.closurePct, null, 'sem scorecard o % tem que ser null, nunca 0');
  assert.strictEqual(cl.dot, '🟡', 'null coagido pra 0 pintaria 🔴 — o guard morreu');
});

// ── §8 formato ─────────────────────────────────────────────────────────────
const { renderLeaderCard } = require('./leader-cards');

test('RENDER: cabeçalho traz dot, nome, % e a quebra time/próprias', () => {
  // 70% → midPct (70 < 85) e overdueLive=2 (< 3) → 🟡. Com 40% seria 🔴 (badPct),
  // então o % da fixture precisa casar com a régua da Task 3 — não é decorativo.
  const sc = new Map([['clayton', { closure_rate: 0.7, tasks_closed: 2 }]]);
  const tasks = [task('a', 'daiana', '2026-07-15'), task('b', 'clayton', '2026-07-16')];
  const { cards } = build(tasks, { scorecards: sc });
  const txt = renderLeaderCard(cards.find((c) => c.leader.id === 'clayton'));
  assert.match(txt, /^🟡 \*Clayton\* — 70% · 2 pendências$/m);
  // Singular: `own === 1` → "1 própria". O helper plural() decide — cravar "próprias"
  // fixo produzia "1 próprias" na mensagem que o CEO lê todo dia.
  assert.match(txt, /^_1 do time · 1 própria_$/m);
});

test('RENDER: sem nota, o cabeçalho NÃO imprime % (nunca "0%")', () => {
  const { cards } = build([task('a', 'daiana', '2026-07-15')]);
  const txt = renderLeaderCard(cards.find((c) => c.leader.id === 'clayton'));
  assert.match(txt, /^🟡 \*Clayton\* — 1 pendência$/m);
  assert.strictEqual(/%/.test(txt), false, 'imprimiu % sem ter nota');
});

test('RENDER: stuck vira ⚠️ cobrada 3x na linha do item', () => {
  const { cards } = build([task('a', 'daiana', '2026-07-15', { coordination_request_count: 3 })]);
  const txt = renderLeaderCard(cards.find((c) => c.leader.id === 'clayton'));
  assert.match(txt, /⚠️ cobrada 3x/);
});

test('RENDER: faixa única não imprime rótulo; as duas imprimem', () => {
  const so = build([task('a', 'daiana', '2026-07-15')]);
  const um = renderLeaderCard(so.cards.find((c) => c.leader.id === 'clayton'));
  assert.strictEqual(/Caiu hoje|Arrastando/.test(um), false, 'rótulo com faixa única');

  const duas = build([task('a', 'daiana', '2026-07-15'), task('b', 'daiana', '2026-07-16')]);
  const dois = renderLeaderCard(duas.cards.find((c) => c.leader.id === 'clayton'));
  assert.match(dois, /🆕 \*Caiu hoje\*/);
  assert.match(dois, /⏳ \*Arrastando\*/);
});

test('RENDER §7.5: corta em 3 por faixa, mas stuck e 30d+ FURAM a fila', () => {
  const tasks = [
    task('n1', 'daiana', '2026-07-14'), task('n2', 'daiana', '2026-07-14'),
    task('n3', 'daiana', '2026-07-14'), task('n4', 'daiana', '2026-07-14'),
    task('velha', 'daiana', '2026-06-02'),                                        // 45d
    task('presa', 'daiana', '2026-07-14', { coordination_request_count: 3 }),     // stuck
  ];
  const { cards } = build(tasks);
  const txt = renderLeaderCard(cards.find((c) => c.leader.id === 'clayton'));
  assert.match(txt, /T-velha/, '45d não furou a fila');
  assert.match(txt, /T-presa/, 'stuck não furou a fila');
  assert.match(txt, /_\+3_/, 'não colapsou o resto');
});

test('RENDER: co-líder vira nota; card sem co-líder não imprime a linha', () => {
  const comCo = build([task('a', 'peterson', '2026-07-15')]);
  // DEFEITO 2 (dry-run 17/07): SEM artigo de gênero. O "o" antes de "Quintela" estava
  // certo por ACASO (ele é homem) — mesmo código erra "com o Rose" (ela é mulher).
  // Não existe campo de gênero em `collaborators` pra decidir isso.
  assert.match(renderLeaderCard(comCo.cards.find((c) => c.leader.id === 'juliana')),
    /^_pedagógico dividido com Quintela_$/m);
  const semCo = build([task('a', 'daiana', '2026-07-15')]);
  assert.strictEqual(/dividido com/.test(
    renderLeaderCard(semCo.cards.find((c) => c.leader.id === 'clayton'))), false);
});

// ── SEM GÊNERO — o card é printado e encaminhado PRA PESSOA ────────────────
test('SEM GÊNERO: o card de uma líder mulher não diz "dele"', () => {
  // O card é printado e encaminhado PRA PESSOA. Não há campo de gênero em collaborators,
  // e heurística por nome erra com gente real. Juliana lidera o Peterson.
  const { cards } = build([task('a', 'peterson', '2026-07-15'), task('b', 'juliana', '2026-07-15')]);
  const txt = renderLeaderCard(cards.find((c) => c.leader.id === 'juliana'));
  assert.strictEqual(/\bdele\b/i.test(txt), false, `vazou gênero masculino:\n${txt}`);
  // Case-insensitive e sem o 's': o cabeçalho flexiona ("1 própria") e o bloco é "*Próprias*".
  assert.match(txt, /própria/i);
});

// ── Hotfix pós-Task 6 — forLeaderId: o digest do LÍDER ganha card próprio ──────
// dispatcher.js tem DOIS call-sites de ceoTeamUnclosedTasksReport: o do CEO (sem
// leaderId) e o do LÍDER (com leaderId + groupByOwner:true). O leaderId sobreviveu
// (escopo: quais tarefas ele vê), mas groupByOwner virou no-op — o card seguia
// roteado pelo líder-PRINCIPAL do dono, não pelo destinatário. Concreto: Peterson
// tem a Juliana como principal, então a mensagem do Quintela ("Seu time, Quintela")
// vinha com um card da JULIANA — líder errado na própria mensagem dele.
test('forLeaderId: o digest do líder traz UM card, o DELE, com o time dentro', () => {
  const { cards, ritmo, unassigned } = build(
    [task('a', 'peterson', '2026-07-15'), task('b', 'quintela', '2026-07-16')],
    { forLeaderId: 'quintela' },
  );
  assert.strictEqual(cards.length, 1, 'tem que ser UM card só');
  assert.strictEqual(cards[0].leader.id, 'quintela', 'o card é do DESTINATÁRIO');
  assert.strictEqual(cards[0].totals.team, 1);
  assert.strictEqual(cards[0].totals.own, 1);
  assert.deepStrictEqual(ritmo, []);
  assert.deepStrictEqual(unassigned, []);
  const nomes = cards[0].people.map((p) => p.person.id);
  assert.ok(nomes.includes('peterson'), 'o Peterson tem que estar no card do Quintela');
});

test('forLeaderId: conservação — nada some no modo do líder', () => {
  const tasks = [task('a', 'peterson', '2026-07-15'), task('b', 'quintela', '2026-07-16'), task('c', 'dai', '2026-07-15')];
  const { cards } = build(tasks, { forLeaderId: 'quintela' });
  const n = cards[0].people.reduce((s, p) => s + p.novo.length + p.arrastando.length, 0);
  assert.strictEqual(n, tasks.length, 'sumiu tarefa no modo forLeaderId');
});

test('forLeaderId: sem co-líderes (a nota "dividido com" é pro CEO, não pro próprio líder)', () => {
  const { cards } = build([task('a', 'peterson', '2026-07-15')], { forLeaderId: 'quintela' });
  assert.deepStrictEqual(cards[0].coLeaders, []);
});

test('forLeaderId: nada a mostrar → nenhum card (o digest não é enviado)', () => {
  assert.deepStrictEqual(build([], { forLeaderId: 'quintela' }).cards, []);
});

test('SEM forLeaderId: a visão do CEO continua idêntica (não-regressão)', () => {
  const { cards, ritmo } = build([task('a', 'peterson', '2026-07-15')]);
  assert.ok(cards.find((c) => c.leader.id === 'juliana'), 'a visão do CEO agrupa por principal');
  assert.ok(ritmo.length > 0, 'o ritmo continua existindo');
});

// ═══ Dry-run 17/07 — 3 defeitos achados contra dado real de produção ═══════

// ── DEFEITO 1 — o 💡 escapa do card ─────────────────────────────────────────
// analyzePersonBacklog (governance-analyzer.js) devolve uma SEÇÃO SOLTA, pensada
// pra fechar a mensagem inteira: "🔍 *Nome:* {diag}\n\n💡 *Recomendação:* {ação}".
// Encaixado cru dentro do bloco da pessoa (`💡 _${b.diagnostic}_`), o \n\n embutido
// furava a indentação (a linha da Recomendação nascia na coluna zero) e o nome
// duplicava ("💡 _🔍 *Nome:* ...", emoji dentro de emoji — o bloco já diz de quem é).
// fmtDiagnostic conserta o ENCAIXE sem tocar nas palavras (a voz é do analyzer,
// intocável) — ver leader-cards.js.
const { fmtDiagnostic } = require('./leader-cards');

test('fmtDiagnostic: tira o prefixo "🔍 *Nome:*" e indenta a Recomendação pra dentro', () => {
  const diag = '🔍 *Juliana:* 3 paradas em pedagógico.\n\n💡 *Recomendação:* Marca 1:1 hoje.';
  assert.deepStrictEqual(fmtDiagnostic(diag), [
    '   💡 _3 paradas em pedagógico._',
    '      _Recomendação: Marca 1:1 hoje._',
  ]);
});

test('fmtDiagnostic: tolera variação de espaço/quebra ao redor da Recomendação', () => {
  // sem linha em branco dupla, com espaços extras — o prompt PEDE \n\n, mas o LLM
  // pode entregar só \n. Não pode deixar de casar por causa disso.
  const diag = '🔍 *Clayton:*  8 tarefas próprias sem avanço.\n💡 *Recomendação:*   Redistribui hoje.';
  assert.deepStrictEqual(fmtDiagnostic(diag), [
    '   💡 _8 tarefas próprias sem avanço._',
    '      _Recomendação: Redistribui hoje._',
  ]);
});

test('fmtDiagnostic: formato inesperado do LLM — nunca perde texto, só a formatação', () => {
  // O analyzer tem fallback determinístico, mas o LLM (ou o próprio fallback, num dia
  // futuro) pode fugir do formato pedido. Perder a frase é pior que ficar feio.
  const livre = 'Situação atípica sem seguir o formato pedido pelo prompt.';
  const linhas = fmtDiagnostic(livre);
  assert.ok(linhas.length > 0, 'não pode devolver vazio havendo texto');
  assert.ok(linhas.join(' ').includes(livre), 'perdeu texto no fallback');
  for (const l of linhas) assert.ok(/^\s/.test(l), `linha sem indentação: "${l}"`);
});

test('fmtDiagnostic: multi-linha sem o marcador de Recomendação — indenta tudo, nada some', () => {
  const multi = '🔍 *Clayton:* linha 1 do diagnóstico.\nlinha 2 sem o marcador certo.\nlinha 3 final.';
  const junto = fmtDiagnostic(multi).join(' ');
  assert.ok(junto.includes('linha 1 do diagnóstico.'));
  assert.ok(junto.includes('linha 2 sem o marcador certo.'));
  assert.ok(junto.includes('linha 3 final.'));
  assert.strictEqual(junto.includes('🔍'), false, 'o prefixo deveria ter sido removido');
});

test('fmtDiagnostic: vazio/null não quebra e devolve nada pra renderizar', () => {
  assert.deepStrictEqual(fmtDiagnostic(null), []);
  assert.deepStrictEqual(fmtDiagnostic(''), []);
  assert.deepStrictEqual(fmtDiagnostic('   '), []);
});

test('RENDER: 💡 não escapa do card — diagnóstico multi-linha fica DENTRO do bloco', () => {
  // b.diagnostic é setado manualmente aqui simulando o que o dispatcher faz DEPOIS de
  // buildLeaderCards (a função é pura — o 💡 do LLM é injeção externa, não interna).
  const tasks = [
    task('a', 'daiana', '2026-07-15'), task('b', 'daiana', '2026-07-15'), task('c', 'daiana', '2026-07-15'),
  ];
  const { cards } = build(tasks);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  const bloco = cl.people.find((p) => p.person.id === 'daiana');
  bloco.diagnostic = '🔍 *Daiana:* 3 paradas em pedagógico.\n\n💡 *Recomendação:* Marca 1:1 hoje.';
  const txt = renderLeaderCard(cl);

  assert.strictEqual(txt.includes('🔍'), false, 'o prefixo 🔍 *Nome:* vazou pro card');
  assert.match(txt, /Marca 1:1 hoje/, 'perdeu a frase da recomendação');
  assert.strictEqual(/^💡/m.test(txt), false, '💡 nasceu na coluna zero (furou a indentação)');
  const recLine = txt.split('\n').find((l) => l.includes('Recomendação'));
  assert.ok(recLine && /^\s+_Recomendação:/.test(recLine), `linha da Recomendação sem indentação: "${recLine}"`);
});

// ── DEFEITO 2 — gênero e duplicação na nota de co-líder ────────────────────
// "_farmers dividido com o Rose_" (Rose é mulher) + 2 linhas pro MESMO rótulo
// (Fabi e Rose dividem "farmers", caso Krissya real). fmtCoLeaderLines tira o
// artigo (sem campo de gênero em `collaborators`) e agrupa por rótulo numa linha só.
const { fmtCoLeaderLines } = require('./leader-cards');

test('fmtCoLeaderLines: 1 co-líder — sem artigo de gênero', () => {
  assert.deepStrictEqual(
    fmtCoLeaderLines([{ id: 'quintela', name: 'Quintela', label: 'pedagógico' }]),
    ['_pedagógico dividido com Quintela_'],
  );
});

test('fmtCoLeaderLines: 2 co-líderes no MESMO rótulo — 1 linha só, junta com "e"', () => {
  const linhas = fmtCoLeaderLines([
    { id: 'fabi', name: 'Fabi', label: 'farmers' },
    { id: 'rose', name: 'Rose', label: 'farmers' },
  ]);
  assert.deepStrictEqual(linhas, ['_farmers dividido com Fabi e Rose_']);
});

test('fmtCoLeaderLines: 3+ no mesmo rótulo — vírgulas e "e" só antes do último', () => {
  const linhas = fmtCoLeaderLines([
    { id: 'a', name: 'Ana', label: 'farmers' },
    { id: 'b', name: 'Bia', label: 'farmers' },
    { id: 'c', name: 'Caio', label: 'farmers' },
  ]);
  assert.deepStrictEqual(linhas, ['_farmers dividido com Ana, Bia e Caio_']);
});

test('fmtCoLeaderLines: rótulos diferentes seguem em linhas separadas', () => {
  const linhas = fmtCoLeaderLines([
    { id: 'fabi', name: 'Fabi', label: 'farmers' },
    { id: 'quintela', name: 'Quintela', label: 'pedagógico' },
  ]);
  assert.strictEqual(linhas.length, 2);
  assert.ok(linhas.includes('_farmers dividido com Fabi_'));
  assert.ok(linhas.includes('_pedagógico dividido com Quintela_'));
});

test('RENDER caso Krissya: 2 co-líderes no mesmo rótulo viram 1 linha, sem "com o/a"', () => {
  // Bug real: card da Krissya trazia "farmers dividido com o Fabi" E "farmers
  // dividido com o Rose" em 2 linhas — Rose é mulher, e o rótulo é o MESMO vínculo.
  const { groupLeaderIdsFor } = require('../services/leader-routing');
  const groupLeadersFarmer = [
    { group_key: 'farmer', unit: 'all', leader_id: 'fabi2' },
    { group_key: 'farmer', unit: 'all', leader_id: 'rose' },
  ];
  const base = [
    { id: 'krissya', full_name: 'Krissya', role: 'manager',     function_role: null,     unit: 'campo_grande', is_ceo: false, is_active: true },
    { id: 'fabi2',   full_name: 'Fabi',    role: 'collaborator', function_role: 'farmer', unit: 'all',          is_ceo: false, is_active: true },
    { id: 'rose',    full_name: 'Rose',    role: 'collaborator', function_role: 'farmer', unit: 'all',          is_ceo: false, is_active: true },
    { id: 'ceo2',    full_name: 'CEO',     role: 'director',     function_role: null,     unit: 'all',          is_ceo: true,  is_active: true },
    { id: 'daiana2', full_name: 'Daiana',  role: 'collaborator', function_role: 'farmer', unit: 'campo_grande', is_ceo: false, is_active: true },
  ].map((c) => ({ ...c }));
  for (const c of base) {
    c.group_leader_ids = groupLeaderIdsFor(c, groupLeadersFarmer);
    c.explicit_leader_ids = [];
  }
  const tasks = [task('t1', 'daiana2', '2026-07-15')];
  const { cards } = buildLeaderCards({ tasks, events: [], collabs: base, scorecards: new Map(), today: TODAY });
  const kr = cards.find((c) => c.leader.id === 'krissya');
  assert.ok(kr, 'Krissya não ganhou card');
  assert.deepStrictEqual(kr.coLeaders.map((c) => c.name).sort(), ['Fabi', 'Rose'],
    'fixture não reproduziu o cenário (2 co-líderes, mesmo rótulo)');

  const txt = renderLeaderCard(kr);
  assert.match(txt, /_farmers dividido com Fabi e Rose_/);
  assert.strictEqual(/dividido com o |dividido com a /.test(txt), false, 'vazou artigo de gênero');
  const linhasFarmers = txt.split('\n').filter((l) => l.includes('farmers dividido'));
  assert.strictEqual(linhasFarmers.length, 1, 'duas linhas pro mesmo rótulo em vez de uma');
});

// ── DEFEITO 3 — o 💡 fica pior porque a gente joga fora category/coordRequests ──
// dispatcher.js montava os items pro analyzer com `category: null` fixo e
// `coordination_request_count: i.stuck ? 3 : 0` — mas a query TEM `category` real e
// o `coordination_request_count` real também. O item (aqui, na função pura) precisa
// carregar os dois pra o dispatcher poder repassar o valor verdadeiro.
test('DEFEITO 3: item carrega category e coordRequests reais (não null / não 3-ou-0)', () => {
  const t = task('a', 'daiana', '2026-07-15', { category: 'operacional', coordination_request_count: 5 });
  const { cards } = build([t]);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  const item = cl.people[0].arrastando[0];
  assert.strictEqual(item.category, 'operacional', 'category não chegou no item');
  assert.strictEqual(item.coordRequests, 5, 'coordRequests não é o número real');
  assert.strictEqual(item.stuck, true, 'a régua do stuck (>=3) não pode mudar');
});

test('DEFEITO 3: category null (task sem categoria de verdade) segue null, sem virar 3-ou-0 fixo', () => {
  const t = task('a', 'daiana', '2026-07-15', { category: null, coordination_request_count: 1 });
  const { cards } = build([t]);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  const item = cl.people[0].arrastando[0];
  assert.strictEqual(item.category, null);
  assert.strictEqual(item.coordRequests, 1);
  assert.strictEqual(item.stuck, false);
});
