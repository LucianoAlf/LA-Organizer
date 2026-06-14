const { test } = require('node:test');
const assert = require('node:assert');
const { windowBounds, dueFlag, categorize, splitTasks, dedupeTasks, renderReportHtml, buildGroupReport } = require('./group-report-builder');

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

test('categorize: atrasada / hoje / semana / futura / sem_prazo', () => {
  const hoje = '2026-06-14';
  assert.equal(categorize('2026-06-10', hoje), 'atrasada');
  assert.equal(categorize('2026-06-14', hoje), 'hoje');
  assert.equal(categorize('2026-06-18', hoje), 'semana');
  assert.equal(categorize('2026-06-25', hoje), 'futura');
  assert.equal(categorize(null, hoje), 'sem_prazo');
  // lançamento retroativo: criada DEPOIS do prazo não é atraso real
  assert.equal(categorize('2026-06-10', hoje, '2026-06-13'), 'retroativa');
  assert.equal(categorize('2026-06-10', hoje, '2026-06-05'), 'atrasada'); // criada antes do prazo = atrasada de verdade
});

test('dedupeTasks remove gêmeas (mesmo título+data+responsável), mantém dias/itens distintos', () => {
  const r = dedupeTasks([
    { title: 'Cartão 8641', due_date: '2026-06-17', responsavel: 'Rose' },
    { title: 'Cartão 8641', due_date: '2026-06-17', responsavel: 'Rose' }, // gêmea → cai
    { title: 'Cartão 8641', due_date: '2026-06-18', responsavel: 'Rose' }, // outro dia → fica
    { title: 'Barra', due_date: '2026-06-17', responsavel: 'Rose' },       // outro título → fica
  ]);
  assert.equal(r.length, 3);
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

test('renderReportHtml: blocos com contagem, <hr> entre eles, seção vazia some', () => {
  const html = renderReportHtml({
    groupName: 'Financeiro', windowLabel: 'junho', heading: '🗓️ Mês do Financeiro',
    sections: [
      { emoji: '🔴', title: 'Atrasadas', items: ['01/06 — Pagar boleto (Rose)'] },
      { emoji: '⏰', title: 'Esta semana', items: ['15/06 — Ligar contador (Ana)'] },
      { emoji: '📝', title: 'Sem prazo definido', items: [] }, // vazia → não aparece
    ],
  });
  assert.match(html, /🔴 Atrasadas · 1/);
  assert.match(html, /⏰ Esta semana · 1/);
  assert.match(html, /<hr>/);
  assert.match(html, /<li>01\/06 — Pagar boleto \(Rose\)<\/li>/);
  assert.ok(!/Sem prazo definido/.test(html)); // bloco vazio sumiu
  assert.ok(!/undefined/.test(html));
});
test('renderReportHtml: tudo vazio → "Tudo limpo" e sem <hr>', () => {
  const html = renderReportHtml({ groupName: 'Financeiro', sections: [], heading: '🗓️ Mês do Financeiro' });
  assert.match(html, /Tudo limpo/);
  assert.ok(!/<hr>/.test(html));
});

// ── buildGroupReport — supabase fake (chain .select().eq().neq().is().order()) ──
function fakeSupabase(tasks) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    neq() { return chain; },
    is() { return chain; },
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

test('buildGroupReport: vazio com emptyMessage usa a mensagem calorosa (não o genérico)', async () => {
  const sb = fakeSupabase([]);
  const { html, isEmpty } = await buildGroupReport({
    supabase: sb, groupId: 'g1', scope: 'agenda', window: 'hoje',
    heading: '☀️ Bom dia!', emptyMessage: '☀️ Bom dia, pessoal!<br>🎉 Tudo limpo<br>manda aqui que eu organizo 🚀',
    now: new Date('2026-06-14T12:00:00-03:00'),
  });
  assert.strictEqual(isEmpty, true);
  assert.ok(html.includes('manda aqui que eu organizo'));
  assert.ok(!html.includes('Tudo limpo por aqui — nada pendente'));
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

test('buildGroupReport: mensal separa em blocos por urgência, com contagem e sem flag na linha', async () => {
  const sb = fakeSupabase([
    { title: 'Atrasada A', due_date: '2026-06-01', status: 'pending', creator: { preferred_name: 'Rose' } },
    { title: 'Hoje B', due_date: '2026-06-14', status: 'pending', creator: { preferred_name: 'Ana' } },
    { title: 'Semana C', due_date: '2026-06-18', status: 'pending', creator: { preferred_name: 'Rose' } },
    { title: 'Futura D', due_date: '2026-06-25', status: 'pending', creator: { preferred_name: 'Ana' } },
    { title: 'Julho fora', due_date: '2026-07-10', status: 'pending', creator: { preferred_name: 'Ana' } },
    { title: 'SemPrazo E', due_date: null, status: 'pending', creator: { preferred_name: 'Rose' } },
  ]);
  const { html } = await buildGroupReport({
    supabase: sb, groupId: 'g1', scope: 'tudo', window: 'mes',
    heading: '🗓️ Mês do Financeiro', now: new Date('2026-06-14T12:00:00-03:00'),
  });
  assert.match(html, /🔴 Atrasadas · 1/);
  assert.match(html, /📌 Para hoje · 1/);
  assert.match(html, /⏰ Esta semana · 1/);
  assert.match(html, /📅 Mais pra frente · 1/);
  assert.match(html, /📝 Sem prazo definido · 1/);
  assert.match(html, /<hr>/);
  assert.ok(!html.includes('Julho fora'));     // tarefa de julho não vaza pro mês de junho
  assert.ok(!/<li>[^<]*🔴/.test(html));        // flag não se repete nas linhas (só no título do bloco)
});

test('buildGroupReport: tarefa lançada retroativa (criada após o prazo) NÃO vira atrasada', async () => {
  const sb = fakeSupabase([
    { title: 'Retroativa', due_date: '2026-06-01', status: 'pending', created_at: '2026-06-13T10:00:00Z', creator: { preferred_name: 'Rose' } },
    { title: 'Atrasada real', due_date: '2026-06-01', status: 'pending', created_at: '2026-05-20T10:00:00Z', creator: { preferred_name: 'Rose' } },
  ]);
  const { html } = await buildGroupReport({
    supabase: sb, groupId: 'g1', scope: 'tudo', window: 'mes',
    heading: '🗓️ Mês', now: new Date('2026-06-14T12:00:00-03:00'),
  });
  assert.ok(html.includes('Atrasada real'));   // criada antes do prazo → aparece
  assert.ok(!html.includes('Retroativa'));      // lançada já vencida → some
  assert.match(html, /🔴 Atrasadas · 1/);
});

test('buildGroupReport: diário (window=hoje) mostra só Atrasadas + Para hoje', async () => {
  const sb = fakeSupabase([
    { title: 'Atrasada A', due_date: '2026-06-01', status: 'pending', creator: { preferred_name: 'Rose' } },
    { title: 'Hoje B', due_date: '2026-06-14', status: 'pending', creator: { preferred_name: 'Ana' } },
    { title: 'Semana C', due_date: '2026-06-18', status: 'pending', creator: { preferred_name: 'Rose' } },
  ]);
  const { html } = await buildGroupReport({
    supabase: sb, groupId: 'g1', scope: 'agenda', window: 'hoje',
    heading: '☀️ Bom dia!', now: new Date('2026-06-14T12:00:00-03:00'),
  });
  assert.match(html, /🔴 Atrasadas · 1/);
  assert.match(html, /📌 Para hoje · 1/);
  assert.ok(!/Esta semana/.test(html));
  assert.ok(!html.includes('Semana C'));
});
