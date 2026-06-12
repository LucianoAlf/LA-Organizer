'use strict';
// Testes do handler DETERMINÍSTICO de consulta de tarefas (TASK-QUERY-NO-FULL-LIST).
// Roda com: node --test src/utils/task-query.test.js
//
// Caso Alf 12/06: TOM tinha 15 abertas, contexto do LLM cortava em maxDaily(3) +
// só carregava due_date<=+7d → ao pedir "lista minhas pendentes / atrasadas / o que
// tenho esse mês" o LLM via parcial, chutava e mandava "abre o app". Este módulo é a
// camada determinística: detecta a intenção, filtra por escopo e renderiza a lista
// COMPLETA com contagem exata. NUNCA responde "abre o app".

const test = require('node:test');
const assert = require('node:assert');
const {
  detectTaskQuery,
  endOfWeekBRT,
  endOfMonthBRT,
  addDaysYMD,
  filterTasksByScope,
  renderTaskQueryReply,
} = require('./task-query');

// ───────────────────────────── detectTaskQuery ─────────────────────────────

test('detecta ATRASADAS', () => {
  for (const t of [
    'tarefas atrasadas',
    'quais minhas atrasadas?',
    'o que eu tenho atrasado',
    'o que tá atrasado',
    'minhas tarefas atrasadas',
    'tarefas vencidas',
    'o que passou do prazo',
  ]) {
    assert.deepStrictEqual(detectTaskQuery(t), { scope: 'overdue' }, `falhou: "${t}"`);
  }
});

test('detecta SEMANA', () => {
  for (const t of [
    'o que tenho pra fazer essa semana',
    'o que eu tenho essa semana?',
    'minhas tarefas dessa semana',
    'tarefas da semana',
    'o que preciso fazer esta semana',
    'o que tem pra essa semana',
  ]) {
    assert.deepStrictEqual(detectTaskQuery(t), { scope: 'week' }, `falhou: "${t}"`);
  }
});

test('detecta MÊS', () => {
  for (const t of [
    'o que tenho pra fazer esse mês',
    'o que eu tenho esse mes?',
    'minhas tarefas desse mês',
    'tarefas do mês',
    'o que preciso fazer este mês',
  ]) {
    assert.deepStrictEqual(detectTaskQuery(t), { scope: 'month' }, `falhou: "${t}"`);
  }
});

test('detecta ABERTAS / pendentes (open_all)', () => {
  for (const t of [
    'minhas pendentes',
    'tarefas pendentes',
    'lista minhas pendentes',
    'lista minhas tarefas',
    'o que tá em aberto',
    'o que ta aberto',
    'minhas tarefas em aberto',
    'o que falta fazer',
    'o que falta',
    'quais as minhas tarefas',
    'o que eu tenho pra fazer',
    'tarefas abertas',
    'o que eu tenho que fazer?',
  ]) {
    assert.deepStrictEqual(detectTaskQuery(t), { scope: 'open_all' }, `falhou: "${t}"`);
  }
});

test('aceita ruído de polidez/saudação no início', () => {
  assert.deepStrictEqual(detectTaskQuery('oi tom, quais minhas tarefas atrasadas?'), { scope: 'overdue' });
  assert.deepStrictEqual(detectTaskQuery('me mostra o que eu tenho pra fazer esse mês'), { scope: 'month' });
});

test('NÃO casa criação/atualização de tarefa nem fala específica', () => {
  for (const t of [
    'tenho que fazer o relatório do mês',          // statement com objeto → criação
    'cria uma tarefa pra mim',
    'lembra de comprar pão',
    'conclui a tarefa do banner',
    'marca a tarefa X como feita',
    'reagenda a tarefa pra semana que vem',
    'fiz tudo essa semana',                          // fechamento, não consulta
  ]) {
    assert.strictEqual(detectTaskQuery(t), null, `não devia casar: "${t}"`);
  }
});

test('NÃO casa consulta financeira (deixa pro roteador de finanças)', () => {
  for (const t of [
    'o que tenho pra pagar esse mês',
    'quanto eu gastei essa semana',
    'minhas contas a pagar',
  ]) {
    assert.strictEqual(detectTaskQuery(t), null, `não devia casar: "${t}"`);
  }
});

test('entrada vazia / lixo → null', () => {
  assert.strictEqual(detectTaskQuery(''), null);
  assert.strictEqual(detectTaskQuery(null), null);
  assert.strictEqual(detectTaskQuery('kkk'), null);
  assert.strictEqual(detectTaskQuery('a'.repeat(300)), null);
});

// ───────────────────────────── helpers de data ─────────────────────────────

test('addDaysYMD soma dias sem UTC shift (vira mês/ano)', () => {
  assert.strictEqual(addDaysYMD('2026-06-12', 0), '2026-06-12');
  assert.strictEqual(addDaysYMD('2026-06-30', 1), '2026-07-01');
  assert.strictEqual(addDaysYMD('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(addDaysYMD('2026-06-12', -1), '2026-06-11');
});

test('endOfWeekBRT devolve o domingo da semana (seg–dom)', () => {
  // 2026-06-12 é uma SEXTA → domingo = 2026-06-14
  assert.strictEqual(endOfWeekBRT('2026-06-12'), '2026-06-14');
  // domingo permanece o próprio dia
  assert.strictEqual(endOfWeekBRT('2026-06-14'), '2026-06-14');
  // segunda → domingo seguinte
  assert.strictEqual(endOfWeekBRT('2026-06-08'), '2026-06-14');
});

test('endOfMonthBRT devolve o último dia do mês', () => {
  assert.strictEqual(endOfMonthBRT('2026-06-12'), '2026-06-30');
  assert.strictEqual(endOfMonthBRT('2026-02-10'), '2026-02-28'); // 2026 não bissexto
  assert.strictEqual(endOfMonthBRT('2026-12-01'), '2026-12-31');
});

// ───────────────────────────── filterTasksByScope ─────────────────────────────

const TODAY = '2026-06-12'; // sexta
const TASKS = [
  { id: '1', title: 'Atrasada A', due_date: '2026-06-05' },
  { id: '2', title: 'Atrasada B', due_date: '2026-06-11' },
  { id: '3', title: 'Hoje',       due_date: '2026-06-12' },
  { id: '4', title: 'Dom (semana)', due_date: '2026-06-14' },
  { id: '5', title: 'Próx semana', due_date: '2026-06-18' },
  { id: '6', title: 'Fim do mês',  due_date: '2026-06-29' },
  { id: '7', title: 'Mês que vem', due_date: '2026-07-10' },
  { id: '8', title: 'Sem prazo',   due_date: null },
];

test('filtro overdue = só due < hoje', () => {
  const r = filterTasksByScope(TASKS, 'overdue', TODAY).map((t) => t.id);
  assert.deepStrictEqual(r.sort(), ['1', '2']);
});

test('filtro week = due <= domingo (inclui atrasadas, exclui sem prazo)', () => {
  const r = filterTasksByScope(TASKS, 'week', TODAY).map((t) => t.id);
  assert.deepStrictEqual(r.sort(), ['1', '2', '3', '4']);
});

test('filtro month = due <= fim do mês (inclui atrasadas, exclui sem prazo e mês seguinte)', () => {
  const r = filterTasksByScope(TASKS, 'month', TODAY).map((t) => t.id);
  assert.deepStrictEqual(r.sort(), ['1', '2', '3', '4', '5', '6']);
});

test('filtro open_all = todas as abertas (inclui sem prazo e futuras)', () => {
  const r = filterTasksByScope(TASKS, 'open_all', TODAY).map((t) => t.id);
  assert.deepStrictEqual(r.sort(), ['1', '2', '3', '4', '5', '6', '7', '8']);
});

// ───────────────────────────── renderTaskQueryReply ─────────────────────────────

test('render NUNCA diz "abre o app" e lista TODAS as tarefas do escopo', () => {
  const reply = renderTaskQueryReply(TASKS, 'open_all', { today: TODAY, firstName: 'Alf' });
  assert.doesNotMatch(reply.toLowerCase(), /abre? o app|abrir o app|no app|filtra por/);
  // todas as 8 aparecem
  for (const t of TASKS) assert.ok(reply.includes(t.title), `faltou "${t.title}"`);
  // contagem total no cabeçalho
  assert.match(reply, /\b8\b/);
});

test('render agrupa atrasadas / com prazo / sem prazo', () => {
  const reply = renderTaskQueryReply(TASKS, 'open_all', { today: TODAY, firstName: 'Alf' });
  assert.match(reply, /atrasad/i);
  assert.match(reply, /sem prazo/i);
});

test('render overdue mostra contagem exata das atrasadas', () => {
  const overdue = filterTasksByScope(TASKS, 'overdue', TODAY);
  const reply = renderTaskQueryReply(overdue, 'overdue', { today: TODAY, firstName: 'Alf' });
  assert.match(reply, /atrasad/i);
  assert.match(reply, /\b2\b/);
  assert.ok(reply.includes('Atrasada A') && reply.includes('Atrasada B'));
  assert.ok(!reply.includes('Sem prazo'));
});

test('render escopo vazio → mensagem positiva, sem "abre o app"', () => {
  const reply = renderTaskQueryReply([], 'overdue', { today: TODAY, firstName: 'Alf' });
  assert.doesNotMatch(reply.toLowerCase(), /abre? o app|no app/);
  assert.match(reply, /atrasad/i);
  assert.ok(reply.length > 0);
});

test('render é determinístico (mesma entrada → mesma saída)', () => {
  const a = renderTaskQueryReply(TASKS, 'month', { today: TODAY, firstName: 'Alf' });
  const b = renderTaskQueryReply(TASKS, 'month', { today: TODAY, firstName: 'Alf' });
  assert.strictEqual(a, b);
});
