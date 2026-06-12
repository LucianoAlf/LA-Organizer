const { test } = require('node:test');
const assert = require('node:assert');
const { windowBounds, dueFlag, splitTasks, renderReportHtml, buildGroupReport } = require('./group-report-builder');

// 12/06/2026 é uma SEXTA. now = 2026-06-12 15:00 BRT = 18:00Z.
const NOW = new Date('2026-06-12T18:00:00Z');

test('windowBounds(mes) = 1º ao último dia do mês em SP', () => {
  const b = windowBounds('mes', NOW);
  assert.equal(b.start, '2026-06-01T00:00:00-03:00');
  assert.equal(b.end, '2026-06-30T23:59:59-03:00');
  assert.equal(b.label, 'junho');
});
test('windowBounds(hoje) = dia local SP (sexta 12/06), não desloca após 21h', () => {
  const lateNight = new Date('2026-06-13T01:00:00Z'); // 22h BRT de 12/06
  const b = windowBounds('hoje', lateNight);
  assert.equal(b.start, '2026-06-12T00:00:00-03:00');
  assert.equal(b.end, '2026-06-12T23:59:59-03:00');
});
test('windowBounds(semana) = segunda a domingo da semana corrente', () => {
  const b = windowBounds('semana', NOW); // sexta 12/06 → semana 08/06 (seg) a 14/06 (dom)
  assert.equal(b.start, '2026-06-08T00:00:00-03:00');
  assert.equal(b.end, '2026-06-14T23:59:59-03:00');
});
test('windowBounds inválido cai em mes', () => {
  assert.equal(windowBounds('xpto', NOW).label, 'junho');
});
test('dueFlag marca atrasada / esta semana / vazio', () => {
  assert.equal(dueFlag('2026-06-10', '2026-06-12'), '🔴 atrasada');
  assert.equal(dueFlag('2026-06-14', '2026-06-12'), '⏰ esta semana');
  assert.equal(dueFlag('2026-07-20', '2026-06-12'), '');
  assert.equal(dueFlag(null, '2026-06-12'), '');
});

test('splitTasks separa com prazo (ordenado) e sem prazo', () => {
  const tasks = [
    { title: 'B', due_date: '2026-06-20', responsavel: 'Rose' },
    { title: 'A', due_date: '2026-06-10', responsavel: null },
    { title: 'C', due_date: null, responsavel: 'Ana' },
  ];
  const r = splitTasks(tasks);
  assert.deepEqual(r.comPrazo.map((t) => t.title), ['A', 'B']);
  assert.deepEqual(r.semPrazo.map((t) => t.title), ['C']);
});
test('renderReportHtml monta card com h3+emoji e (nada) em seção vazia', () => {
  const html = renderReportHtml({
    groupName: 'Financeiro', windowLabel: 'junho',
    sections: [
      { emoji: '📅', title: 'Agenda', items: ['10/06 — Pagar boleto (Rose)'] },
      { emoji: '📝', title: 'Anotações', items: [] },
    ],
  });
  assert.match(html, /<h3>📅 Agenda/);
  assert.match(html, /<li>10\/06 — Pagar boleto \(Rose\)<\/li>/);
  assert.match(html, /<h3>📝 Anotações/);
  assert.match(html, /\(nada no período\)/);
  assert.ok(!/undefined/.test(html));
});

// ── B2: heading custom + onlyOverdue ──────────────────────────────────────────
// supabase fake: tasks fixas + work_groups.name. queryGroupTasks faz
// .select().eq().neq().order() e devolve {data}; work_groups faz .select().eq().maybeSingle().
function fakeSupabase(tasks) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    neq() { return chain; },
    order() { return Promise.resolve({ data: tasks }); },
    maybeSingle() { return Promise.resolve({ data: { name: 'Financeiro' } }); },
  };
  return { from() { return chain; } };
}

test('buildGroupReport: heading custom sobrescreve o título padrão', async () => {
  const sb = fakeSupabase([]);
  const { html } = await buildGroupReport({
    supabase: sb, groupId: 'g1', scope: 'agenda', window: 'hoje',
    heading: '☀️ Bom dia, Financeiro! Hoje vocês têm:', now: new Date('2026-06-15T12:00:00-03:00'),
  });
  assert.ok(html.includes('☀️ Bom dia, Financeiro! Hoje vocês têm:'));
  assert.ok(!html.includes('📊 Relatório do'));
});

test('buildGroupReport: onlyOverdue lista só atrasadas e isEmpty=false', async () => {
  const sb = fakeSupabase([
    { title: 'Conciliar cartões', due_date: '2026-06-01', status: 'pending', creator: { preferred_name: 'Rose' } },
    { title: 'Tarefa futura', due_date: '2026-12-31', status: 'pending', creator: { preferred_name: 'Alf' } },
  ]);
  const { html, isEmpty } = await buildGroupReport({
    supabase: sb, groupId: 'g1', scope: 'tarefas', onlyOverdue: true,
    heading: '⏰ Financeiro: tarefas atrasadas', now: new Date('2026-06-15T12:00:00-03:00'),
  });
  assert.strictEqual(isEmpty, false);
  assert.ok(html.includes('Conciliar cartões'));
  assert.ok(!html.includes('Tarefa futura'));
});

test('buildGroupReport: onlyOverdue sem atrasadas → isEmpty=true', async () => {
  const sb = fakeSupabase([
    { title: 'Tarefa futura', due_date: '2026-12-31', status: 'pending', creator: { preferred_name: 'Alf' } },
  ]);
  const { isEmpty } = await buildGroupReport({
    supabase: sb, groupId: 'g1', scope: 'tarefas', onlyOverdue: true, now: new Date('2026-06-15T12:00:00-03:00'),
  });
  assert.strictEqual(isEmpty, true);
});
