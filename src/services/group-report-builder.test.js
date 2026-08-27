const { test } = require('node:test');
const assert = require('node:assert');
const { windowBounds, dueFlag, categorize, splitTasks, dedupeTasks, dropOpenWithDoneTwin, shapeOpenTasks, queryGroupTasks, renderReportHtml, buildGroupReport, taskLineItem } = require('./group-report-builder');

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

test('dropOpenWithDoneTwin: pendente com gêmea CONCLUÍDA (mesmo título+due) some (sobra de churn); só-cancelada fica', () => {
  const rows = [
    { title: 'Cartão 8516 (Barra)', due_date: '2026-06-12', status: 'pending' },
    { title: 'Cartão 8516 (Barra)', due_date: '2026-06-12', status: 'done' },      // gêmea concluída → suprime a pendente
    { title: 'Cartão 8641 (Recreio)', due_date: '2026-06-17', status: 'pending' },  // sem gêmea done → fica
    { title: 'Boleto Y', due_date: '2026-06-10', status: 'pending' },               // só tem gêmea CANCELADA → fica
    { title: 'Boleto Y', due_date: '2026-06-10', status: 'cancelled' },
  ];
  const out = dropOpenWithDoneTwin(rows).map((t) => t.title);
  assert.deepEqual(out, ['Cartão 8641 (Recreio)', 'Boleto Y']);
});

test('buildGroupReport: pendente com gêmea concluída NÃO conta como atrasada (caso Cartões da Rose)', async () => {
  const sb = fakeSupabase([
    { title: 'Cartão 8641 (Recreio)', due_date: '2026-06-17', status: 'pending', creator: { preferred_name: 'Rose' } },
    { title: 'Cartão 8641 (Recreio)', due_date: '2026-06-17', status: 'done', creator: { preferred_name: 'Rose' } },
  ]);
  const { html, isEmpty } = await buildGroupReport({
    supabase: sb, groupId: 'g1', scope: 'tarefas', onlyOverdue: true,
    heading: '⏰ atrasadas', now: new Date('2026-06-20T12:00:00-03:00'),
  });
  assert.strictEqual(isEmpty, true);            // trabalho feito na gêmea done → zero atrasada
  assert.ok(!html.includes('Cartão 8641'));
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

// ── shapeOpenTasks + queryGroupTasks: o card de FECHAMENTO usa queryGroupTasks DIRETO (sem
//    passar pelo categorize do buildGroupReport). A retroativa tem que sair JÁ aqui, senão
//    vira fantasma no card "Em aberto" (caso Rose 20/06, GROUPCHAT-CLOSING-RETRO-PHANTOM).
test('shapeOpenTasks: exclui RETROATIVA (criada após vencimento) — fantasma Conciliação 01/06', () => {
  const today = '2026-06-20';
  const out = shapeOpenTasks([
    { title: 'Conciliação de Cartões', due_date: '2026-06-01', status: 'pending', created_at: '2026-06-13T10:00:00Z', creator: { preferred_name: 'Rose' } },
    { title: 'Boleto X', due_date: '2026-06-10', status: 'pending', created_at: '2026-05-30T10:00:00Z', creator: { preferred_name: 'Rose' } }, // atraso real (criada antes)
    { title: 'Cartão 1074', due_date: '2026-06-25', status: 'pending', created_at: '2026-06-13T10:00:00Z', creator: { preferred_name: 'Rose' } }, // futura
  ], today).map((t) => t.title);
  assert.ok(!out.includes('Conciliação de Cartões')); // retroativa some
  assert.deepEqual(out.sort(), ['Boleto X', 'Cartão 1074']);
});

test('shapeOpenTasks: exclui CONTAINER de pacote (is_group) — não vira tarefa fantasma dia-1', () => {
  const out = shapeOpenTasks([
    { title: 'Conciliação de Cartões', due_date: '2026-07-01', status: 'pending', is_group: true, created_at: '2026-06-01T10:00:00Z' }, // container → FORA
    { title: 'Cartão 1074', due_date: '2026-06-25', status: 'pending', is_group: false, created_at: '2026-06-13T10:00:00Z' },           // filho → fica
    { title: 'Tarefa avulsa', due_date: '2026-06-22', status: 'pending', created_at: '2026-06-13T10:00:00Z' },                           // sem is_group → fica
  ], '2026-06-20').map((t) => t.title);
  assert.ok(!out.includes('Conciliação de Cartões'));
  assert.deepEqual(out.sort(), ['Cartão 1074', 'Tarefa avulsa']);
});

test('shapeOpenTasks: pendente-gêmea-de-concluída some (churn) + dedup exato', () => {
  const out = shapeOpenTasks([
    { title: 'Cartão 8516', due_date: '2026-06-17', status: 'done', created_at: '2026-06-10T10:00:00Z' },
    { title: 'Cartão 8516', due_date: '2026-06-17', status: 'pending', created_at: '2026-06-10T10:00:00Z' }, // gêmea da done → some
    { title: 'Cartão 9999', due_date: '2026-06-19', status: 'pending', created_at: '2026-06-10T10:00:00Z' },
    { title: 'Cartão 9999', due_date: '2026-06-19', status: 'pending', created_at: '2026-06-10T10:00:00Z' }, // dup exata → 1 só
  ], '2026-06-20').map((t) => t.title);
  assert.deepEqual(out, ['Cartão 9999']);
});

test('queryGroupTasks: card de fechamento NÃO recebe retroativa (regressão GROUPCHAT-CLOSING-RETRO-PHANTOM)', async () => {
  const sb = fakeSupabase([
    { title: 'Conciliação de Cartões', due_date: '2026-06-01', status: 'pending', created_at: '2026-06-13T10:00:00Z', creator: { preferred_name: 'Rose' } },
    { title: 'Cartão 1074 (Kids CG)', due_date: '2026-06-25', status: 'pending', created_at: '2026-06-13T10:00:00Z', creator: { preferred_name: 'Rose' } },
  ]);
  const titles = (await queryGroupTasks(sb, 'g1', new Date('2026-06-20T12:00:00-03:00'))).map((t) => t.title);
  assert.ok(!titles.includes('Conciliação de Cartões')); // fantasma fora
  assert.ok(titles.includes('Cartão 1074 (Kids CG)'));    // legítima fica
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

// ── GROUPREPORT-MOLDE-CICLO-TWIN (Modelo B): o relatório deve esconder a subtarefa-do-MOLDE
//    (parent = container template) e mostrar só a subtarefa-do-CICLO — igual ao app/contexto do
//    TOM (filterVisibleGroupTasks). Sem isso, molde@D + ciclo@D' (datas diferentes após reschedule)
//    escapam do dedup(título|data) e a tarefa aparece em DOBRO (caso Venc 20 da Rose 22/06).
test('queryGroupTasks: esconde a subtarefa-do-MOLDE, mostra só a do CICLO (Venc 20 uma vez)', async () => {
  const sb = fakeSupabase([
    { id: 'tpl', title: 'Venc 20', is_group: true, recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=21', recurrence_parent_id: null, parent_task_id: null, status: 'pending', due_date: '2026-06-21' },
    { id: 'molde', title: 'Venc 20', is_group: false, recurrence_rule: null, recurrence_parent_id: null, parent_task_id: 'tpl', status: 'pending', due_date: '2026-06-21', created_at: '2026-06-21T03:00:00Z', creator: { preferred_name: 'Rose' } },
    { id: 'cycleC', title: 'Venc 20', is_group: true, recurrence_rule: null, recurrence_parent_id: 'tpl', parent_task_id: null, status: 'pending', due_date: '2026-06-21' },
    { id: 'ciclo', title: 'Venc 20', is_group: false, recurrence_rule: null, recurrence_parent_id: 'molde', parent_task_id: 'cycleC', status: 'pending', due_date: '2026-06-22', created_at: '2026-06-21T03:00:00Z', creator: { preferred_name: 'Rose' } },
  ]);
  const out = await queryGroupTasks(sb, 'g1', new Date('2026-06-22T12:00:00-03:00'));
  assert.strictEqual(out.length, 1);                 // uma só (molde escondido, containers escondidos)
  assert.strictEqual(out[0].due_date, '2026-06-22'); // a do ciclo (a visível), não a do molde (21)
});

// ── Título do PACOTE na linha (GROUPREPORT-PACKAGE-TITLE-MISSING, caso Financeiro/Alf 07/07) ──
//    A filha de um pacote (parent_task_id → container is_group) ia pro digest e pro card de
//    fechamento como só "Venc 05 (prazo dia 06)" — ilegível ("prazo dia 06" de quê?). O pai
//    "Depósito de Cheques" existe no MESMO result set (mesmo assigned_group_id) → resolvido por
//    Map, sem query extra, e prefixado na linha: "Depósito de Cheques: Venc 05 (prazo dia 06)".
test('taskLineItem: prefixa o título do PACOTE quando há packageTitle', () => {
  assert.strictEqual(
    taskLineItem({ due_date: '2026-07-06', title: 'Venc 05 (prazo dia 06)', responsavel: 'Rose', packageTitle: 'Depósito de Cheques' }),
    '06/07 — Depósito de Cheques: Venc 05 (prazo dia 06) (Rose)');
});
test('taskLineItem: SEM packageTitle não muda (regressão — tarefa avulsa)', () => {
  assert.strictEqual(
    taskLineItem({ due_date: '2026-07-06', title: 'Boleto X', responsavel: 'Rose' }),
    '06/07 — Boleto X (Rose)');
});
test('taskLineItem: guard anti-redundância — title que já cita o pacote não vira "X: X"', () => {
  assert.strictEqual(
    taskLineItem({ due_date: '2026-06-21', title: 'Venc 20', responsavel: 'Rose', packageTitle: 'Venc 20' }),
    '21/06 — Venc 20 (Rose)');
});
test('shapeOpenTasks: propaga packageTitle da filha via Map de containers (parent_task_id)', () => {
  const parents = new Map([['cont-1', 'Depósito de Cheques']]);
  const out = shapeOpenTasks([
    { title: 'Venc 05 (prazo dia 06)', due_date: '2026-07-06', status: 'pending', is_group: false, parent_task_id: 'cont-1', created_at: '2026-07-01T10:00:00Z', creator: { preferred_name: 'Rose' } },
    { title: 'Tarefa avulsa', due_date: '2026-07-06', status: 'pending', created_at: '2026-07-01T10:00:00Z' }, // sem pai → null
  ], '2026-07-06', parents);
  const venc = out.find((t) => t.title.startsWith('Venc 05'));
  const avulsa = out.find((t) => t.title === 'Tarefa avulsa');
  assert.strictEqual(venc.packageTitle, 'Depósito de Cheques');
  assert.strictEqual(avulsa.packageTitle, null);
});
test('shapeOpenTasks: sem Map de containers → packageTitle null (regressão — chamadores antigos)', () => {
  const out = shapeOpenTasks([
    { title: 'Venc 05 (prazo dia 06)', due_date: '2026-07-06', status: 'pending', parent_task_id: 'cont-1', created_at: '2026-07-01T10:00:00Z' },
  ], '2026-07-06');
  assert.strictEqual(out[0].packageTitle, null);
});
test('queryGroupTasks: resolve o título do PACOTE pai (container is_group) na filha visível', async () => {
  const sb = fakeSupabase([
    { id: 'cont-jul', title: 'Depósito de Cheques', due_date: '2026-07-06', status: 'pending', is_group: true, recurrence_rule: null, recurrence_parent_id: 'tpl', parent_task_id: null, created_at: '2026-07-01T09:00:00Z' },
    { id: 'filha', title: 'Venc 05 (prazo dia 06)', due_date: '2026-07-06', status: 'pending', is_group: false, recurrence_rule: null, recurrence_parent_id: null, parent_task_id: 'cont-jul', created_at: '2026-07-01T09:00:00Z', creator: { preferred_name: 'Rose' } },
  ]);
  const out = await queryGroupTasks(sb, 'g1', new Date('2026-07-10T12:00:00-03:00'));
  const venc = out.find((t) => t.title.startsWith('Venc 05'));
  assert.ok(venc, 'a filha visível deve estar na lista');
  assert.strictEqual(venc.packageTitle, 'Depósito de Cheques');
  assert.strictEqual(venc.responsavel, 'Rose');
});

// CTX-READERS-DIVERGEM (27/08). `health-check` filtra data_classification='real' no eixo de grupo;
// este leitor não filtrava. Não era latente: "Vídeos de Boas Vindas" (08/08) aparecia como
// ATRASADA no grupo MKT há 19 dias, arquivada. Nos outros 12 grupos a saída fica idêntica.
test('queryGroupTasks filtra data_classification=real (invariante do health-check)', async () => {
  const filtros = {};
  const sb = {
    from() {
      return {
        select() { return this; },
        eq(col, val) { filtros[col] = val; return this; },
        neq(col, val) { filtros['neq:' + col] = val; return this; },
        in() { return this; },
        order: async () => ({ data: [] }),
      };
    },
  };
  await queryGroupTasks(sb, 'g1', new Date('2026-08-27T12:00:00Z'));
  assert.strictEqual(filtros.data_classification, 'real', 'sem isto, tarefa arquivada entra no relatório');
  assert.strictEqual(filtros.assigned_group_id, 'g1');
  assert.strictEqual(filtros['neq:status'], 'cancelled');
});
