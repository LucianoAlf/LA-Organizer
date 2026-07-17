// src/services/scorecard-render.test.js
// Trava o guard de null do scorecard (§7.3 da spec 2026-07-16, Task 5): closure_rate
// virou nullable pra matar o "100% de zero" (denominador 0 não é mais 1.0). Sem guard,
// `null < 0.60` é `true` em JS (null coage pra 0) e `Math.round(null * 100)` é `0` —
// o bug OPOSTO ao que a Task 5 veio consertar (líder sem nota vira "0%"/"Atenção").
//
// scorecard-builder.js faz require('../supabase/client') no topo (gitignored, não
// existe local) — por isso as funções PURAS de render foram extraídas pra cá.
//
// Rodar: node --test src/services/scorecard-render.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { renderForDirector, renderForLeader, pctOf, CATEGORY_LABELS } = require('./scorecard-render');

// ── Fixtures ──────────────────────────────────────────────────────────────
const leader = (id, full_name, preferred_name = null) => ({ id, full_name, preferred_name });

const sc = (overrides = {}) => ({
  leader_id: 'x',
  closure_rate: null,
  tasks_closed: 0,
  tasks_overdue: 0,
  tasks_stuck: 0,
  top_bottlenecks: [],
  ...overrides,
});

// ── pctOf — helper isolado ───────────────────────────────────────────────
test('pctOf: null → null (sem nota não é 0%)', () => {
  assert.strictEqual(pctOf(null), null);
});

test('pctOf: undefined → null', () => {
  assert.strictEqual(pctOf(undefined), null);
});

test('pctOf: 0 legítimo → 0 (0 é falsy — ?? e || estragariam; guard tem que ser === null/undefined)', () => {
  assert.strictEqual(pctOf(0), 0);
});

test('pctOf: 0.4 → 40 (arredonda pra percentual inteiro)', () => {
  assert.strictEqual(pctOf(0.4), 40);
});

// ── renderForDirector — guard de null na CLASSIFICAÇÃO ───────────────────

// NOTA (transparência p/ o controlador): este é o teste literal do brief. Verifiquei
// rodando contra o código SEM o guard (scorecard-render.js recém-extraído, antes do
// Step 2): ele passa nos dois lados (não discrimina). Motivo: com tasks_closed=0 E
// tasks_overdue=0 E tasks_stuck=0, `hasNoTasks` já é `true` e o `!hasNoTasks &&` no
// código VELHO barra a entrada em Atenção/Olhar ANTES de qualquer comparação com
// closure_rate — o caminho que este fixture exercita nunca chega no `null < 0.60`.
// Mantido porque ainda trava um comportamento real (líder 100% vazio fica em Ritmo),
// mas quem prova o bug null<0.60 são os 2 testes seguintes (overdue=1 e stuck=2, onde
// hasNoTasks é false e o termo closure_rate ENTRA na conta).
test('GUARD DE NULL (regressão de "sem nada" — não discrimina old/new, ver nota acima): líder 100% vazio não é Atenção', () => {
  const leaders = new Map([['x', leader('x', 'Rose', null)]]);
  const txt = renderForDirector([sc()], leaders);
  assert.strictEqual(/Atenção/.test(txt), false, `líder sem nota caiu em Atenção:\n${txt}`);
});

test('GUARD DE NULL (discrimina): sem nota + 1 atrasada cai em Olhar pelo overdue, NÃO em Atenção pela nota ausente', () => {
  // hasNoTasks é FALSE aqui (overdue=1) -> o termo `closure_rate < 0.60` participa da
  // decisão. Sem o guard, `null < 0.60` (=true) faria isto cair em ATENÇÃO (checado
  // primeiro), quando o correto é OLHAR (só por causa do tasks_overdue>=1).
  const leaders = new Map([['x', leader('x', 'Rose', null)]]);
  const txt = renderForDirector([sc({ tasks_overdue: 1 })], leaders);
  assert.strictEqual(/🔴 \*Atenção/.test(txt), false, `sem nota + 1 atrasada foi pra Atenção (deveria ser Olhar):\n${txt}`);
  assert.strictEqual(/🟡 \*Olhar/.test(txt), true, `sem nota + 1 atrasada não caiu em Olhar:\n${txt}`);
});

test('NOTA REAL BAIXA continua indo pra Atenção (o guard é só pro null, não pode apagar sinal real)', () => {
  const leaders = new Map([['x', leader('x', 'Rose', null)]]);
  const txt = renderForDirector([sc({ closure_rate: 0.4, tasks_closed: 2, tasks_overdue: 3 })], leaders);
  assert.strictEqual(/🔴 \*Atenção/.test(txt), true, `nota real de 40% não classificou Atenção:\n${txt}`);
  assert.strictEqual(/40% fechamento/.test(txt), true, `não imprimiu a nota real de 40%:\n${txt}`);
});

// ── renderForDirector — guard de null na IMPRESSÃO do % ──────────────────
test('SEM NOTA NÃO IMPRIME 0% (discrimina): 2 atrasadas + closure_rate null não vira "0% fechamento"', () => {
  const leaders = new Map([['x', leader('x', 'Rose', null)]]);
  const txt = renderForDirector([sc({ tasks_overdue: 2 })], leaders);
  assert.strictEqual(/0%/.test(txt), false, `imprimiu 0% pra quem não tem nota:\n${txt}`);
});

test('SEM NOTA NÃO IMPRIME 0% (discrimina, via tasks_stuck): 2 travadas + closure_rate null classifica Atenção mas não imprime %', () => {
  // Este caso JÁ cai em Atenção no código velho (por tasks_stuck>=2, sem precisar do
  // termo closure_rate) — então a CLASSIFICAÇÃO não discrimina aqui, mas a IMPRESSÃO
  // do "0%" sim: Math.round(null*100) é 0 no código velho.
  const leaders = new Map([['x', leader('x', 'Rose', null)]]);
  const txt = renderForDirector([sc({ tasks_stuck: 2 })], leaders);
  assert.strictEqual(/🔴 \*Atenção/.test(txt), true, '2 travadas deveria classificar Atenção');
  assert.strictEqual(/0%/.test(txt), false, `imprimiu 0% na linha de Atenção:\n${txt}`);
});

// ── renderForLeader — guard de null ──────────────────────────────────────
test('renderForLeader: sem nota não diz "0% de fechamento" (discrimina)', () => {
  const scorecard = sc({ tasks_overdue: 2, delta_vs_prev: {} });
  const txt = renderForLeader(scorecard, leader('x', 'Rose Silva'));
  assert.strictEqual(/0%/.test(txt), false, `imprimiu 0%:\n${txt}`);
  assert.strictEqual(/de fechamento/.test(txt), false, `imprimiu "de fechamento" sem ter nota:\n${txt}`);
});

test('renderForLeader: nota real (0.75) continua imprimindo "75% de fechamento"', () => {
  const scorecard = sc({ closure_rate: 0.75, tasks_closed: 3, delta_vs_prev: {} });
  const txt = renderForLeader(scorecard, leader('x', 'Rose Silva'));
  assert.strictEqual(/75% de fechamento/.test(txt), true, `não imprimiu a nota real:\n${txt}`);
});

test('renderForLeader: nota 0% REAL (denominador>0, resultado zero) ainda imprime "0% de fechamento" — 0 não é "sem nota"', () => {
  const scorecard = sc({ closure_rate: 0, tasks_closed: 0, tasks_overdue: 3, delta_vs_prev: {} });
  const txt = renderForLeader(scorecard, leader('x', 'Rose Silva'));
  assert.strictEqual(/0% de fechamento/.test(txt), true, `engoliu o 0% real:\n${txt}`);
});

test('renderForLeader: hasNoTasks (0/0/0) continua com a mensagem de "nenhuma tarefa", nunca chega no guard', () => {
  const scorecard = sc({ delta_vs_prev: {} });
  const txt = renderForLeader(scorecard, leader('x', 'Rose Silva'));
  assert.strictEqual(/Nenhuma tarefa registrada/.test(txt), true, `não caiu no early-return de hasNoTasks:\n${txt}`);
});

// ── FIX 3 — ORDEM: "sem nota" e "0% real" são opostos, não podem empatar ─────────
test('SORT: "sem nota" vem DEPOIS de "0% real" no bloco Atenção (null coage pra 0 e empatava os dois)', () => {
  // 0% real = fechou 0 de 3, o pior desempenho possível. Sem nota = não houve o que medir.
  // Com `a.sc.closure_rate - b.sc.closure_rate`, null vira 0 e os dois empatam: o sort
  // (estável) então preserva a ordem de ENTRADA, que é a do heap do Postgres.
  const leaders = new Map([
    ['semnota',  leader('semnota',  'Rose')],
    ['zeroreal', leader('zeroreal', 'Carla')],
  ]);
  const rows = [
    sc({ leader_id: 'semnota',  closure_rate: null, tasks_stuck: 2 }),                  // Atenção via stuck
    sc({ leader_id: 'zeroreal', closure_rate: 0, tasks_closed: 0, tasks_overdue: 3 }),  // Atenção via 0% real
  ];
  const txt = renderForDirector(rows, leaders);
  const iZero = txt.indexOf('Carla');
  const iNull = txt.indexOf('Rose');
  assert.notStrictEqual(iZero, -1, `o líder com 0% real sumiu:\n${txt}`);
  assert.notStrictEqual(iNull, -1, `o líder sem nota sumiu:\n${txt}`);
  assert.ok(iZero < iNull, `"sem nota" (Rose) veio antes do "0% real" (Carla):\n${txt}`);
});

test('SORT: dois SEM NOTA não reembaralham entre execuções (empate novo criado pelo próprio fix)', () => {
  // Mandar os sem-nota pro fim cria um bloco onde TODOS empatam entre si. Sem tiebreak,
  // a ordem vira a de entrada = heap do Postgres (o loader não tem ORDER BY) e o card
  // troca de lugar sozinho — a mesma doença que as Tasks 1 e 2 curaram.
  const leaders = new Map([
    ['a', leader('a', 'Amanda')],
    ['b', leader('b', 'Krissya')],
  ]);
  const rowA = sc({ leader_id: 'a', closure_rate: null, tasks_stuck: 2 });
  const rowB = sc({ leader_id: 'b', closure_rate: null, tasks_stuck: 2 });
  const txt1 = renderForDirector([rowA, rowB], leaders);
  const txt2 = renderForDirector([rowB, rowA], leaders);
  assert.strictEqual(txt1, txt2, `a ordem de entrada vazou pro relatório:\n--- 1 ---\n${txt1}\n--- 2 ---\n${txt2}`);
});

test('SORT ritmo: empate em tasks_closed não reembaralha o bloco 🟢 (3ª aparição da #9)', () => {
  // `b.sc.tasks_closed - a.sc.tasks_closed` sem tiebreak: empate (comum — vários líderes
  // com o mesmo número de fechadas) cai no `.sort()` estável, que preserva a ordem de
  // ENTRADA = ordem do heap do Postgres (loader sem ORDER BY), que muda sozinha após
  // UPDATE/VACUUM. O bloco 🟢 imprime os nomes em linha → reembaralha na cara do CEO
  // sem nenhum dado ter mudado.
  const leaders = new Map([
    ['a', leader('a', 'Amanda')],
    ['b', leader('b', 'Krissya')],
  ]);
  const rowA = sc({ leader_id: 'a', closure_rate: 0.9, tasks_closed: 2 });
  const rowB = sc({ leader_id: 'b', closure_rate: 0.9, tasks_closed: 2 });
  const txt1 = renderForDirector([rowA, rowB], leaders);
  const txt2 = renderForDirector([rowB, rowA], leaders);
  assert.strictEqual(txt1, txt2, `a ordem de entrada vazou pro bloco 🟢:\n--- 1 ---\n${txt1}\n--- 2 ---\n${txt2}`);
});

test('SORT ritmo: quem fechou MAIS continua primeiro (o tiebreak não pode virar ordem alfabética)', () => {
  const leaders = new Map([
    ['muitas', leader('muitas', 'Zelia')],   // alfabeticamente última, mas fechou mais
    ['poucas', leader('poucas', 'Amanda')],
  ]);
  const rows = [
    sc({ leader_id: 'poucas', closure_rate: 0.9, tasks_closed: 1 }),
    sc({ leader_id: 'muitas', closure_rate: 0.9, tasks_closed: 7 }),
  ];
  const txt = renderForDirector(rows, leaders);
  assert.ok(txt.indexOf('Zelia') < txt.indexOf('Amanda'), `quem fechou 7 não veio antes de quem fechou 1:\n${txt}`);
});

test('SORT: notas reais continuam pior-primeiro (o fix não pode inverter a régua de hoje)', () => {
  const leaders = new Map([
    ['pior',  leader('pior',  'Carla')],
    ['menos', leader('menos', 'Bruna')],
  ]);
  const rows = [
    sc({ leader_id: 'menos', closure_rate: 0.5, tasks_closed: 2, tasks_overdue: 2 }),
    sc({ leader_id: 'pior',  closure_rate: 0.1, tasks_closed: 1, tasks_overdue: 9 }),
  ];
  const txt = renderForDirector(rows, leaders);
  assert.ok(txt.indexOf('Carla') < txt.indexOf('Bruna'), `10% não veio antes de 50%:\n${txt}`);
});

// ── PETERSON/JULIANA — smoke: renderForDirector não quebra com dado misto (nota real
// + nota null no mesmo array), já que closure_rate agora pode ser null OU number no
// mesmo `scorecards[]` vindo de monday-scorecard.js. Não trava ORDEM (fora do escopo
// do Step 2 do brief), só garante que não lança/produz "NaN%" na tela. ────────────
test('renderForDirector: mistura de líder com nota e líder sem nota no mesmo relatório não quebra nem imprime NaN%', () => {
  const leaders = new Map([
    ['juliana', leader('juliana', 'Juliana')],
    ['clayton', leader('clayton', 'Clayton')],
  ]);
  const rows = [
    sc({ leader_id: 'juliana', closure_rate: null, tasks_overdue: 9 }),   // Peterson-like: 9 atrasadas, sem fechamento
    sc({ leader_id: 'clayton', closure_rate: 0.9, tasks_closed: 5 }),
  ];
  assert.doesNotThrow(() => renderForDirector(rows, leaders));
  const txt = renderForDirector(rows, leaders);
  assert.strictEqual(/NaN/.test(txt), false, `produziu NaN%:\n${txt}`);
  assert.strictEqual(/9 atrasadas/.test(txt), true, 'não mostrou as 9 atrasadas do conjunto');
});
