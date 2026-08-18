'use strict';
// Testes da visibilidade de tarefas-de-grupo no TOM — GROUP-RECUR-TEMPLATE-VISIBLE-TO-TOM.
// Roda com: node --test src/utils/group-task-visibility.test.js
//
// Caso Rose 12/06: "Conciliação de Cartões" mensal cria, POR DESIGN (taskGroups.ts createGroup),
// uma mãe-TEMPLATE recorrente + a mãe-INSTÂNCIA do ciclo corrente (mesma due), e idem p/ cada
// subcartão. O PWA esconde a mãe-template (fetchGroupsForDay: .is('recurrence_rule', null)), então
// a Rose vê 1; o TOM NÃO escondia → via 2 ("atrasadas duplicadas"). Este módulo dá ao TOM a MESMA
// visão do app: esconder mãe-template recorrente + filhas-template; manter instância + suas filhas.

const test = require('node:test');
const assert = require('node:assert');
const { filterVisibleGroupTasks, isRecurringTemplate, dropPackageContainers, idsDeMoldeDosPais } = require('./group-task-visibility');

test('isRecurringTemplate: só is_group + recurrence_rule', () => {
  assert.strictEqual(isRecurringTemplate({ is_group: true, recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=1' }), true);
  assert.strictEqual(isRecurringTemplate({ is_group: true, recurrence_rule: null }), false); // mãe-instância
  assert.strictEqual(isRecurringTemplate({ is_group: false, recurrence_rule: 'FREQ=DAILY' }), false); // task simples recorrente não é grupo
  assert.strictEqual(isRecurringTemplate({ is_group: false, recurrence_rule: null }), false);
  assert.strictEqual(isRecurringTemplate(null), false);
});

// Reproduz a estrutura real do caso Rose (mães + 1 subcartão), template+instância.
const ROSE = [
  // mãe-template (escondida no app)
  { id: 'tpl', title: 'Conciliação de Cartões', is_group: true, recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=1', recurrence_parent_id: null, parent_task_id: null, due_date: '2026-06-01' },
  // mãe-instância (visível no app)
  { id: 'inst', title: 'Conciliação de Cartões', is_group: true, recurrence_rule: null, recurrence_parent_id: 'tpl', parent_task_id: null, due_date: '2026-06-01' },
  // filha-template (pendura na mãe-template → escondida)
  { id: 'kid_tpl', title: 'Cartão 1074 (Kids CG)', is_group: false, recurrence_rule: null, recurrence_parent_id: null, parent_task_id: 'tpl', due_date: '2026-06-25' },
  // filha-instância (pendura na mãe-instância → visível)
  { id: 'kid_inst', title: 'Cartão 1074 (Kids CG)', is_group: false, recurrence_rule: null, recurrence_parent_id: 'kid_tpl', parent_task_id: 'inst', due_date: '2026-06-25' },
];

test('caso Rose: esconde mãe-template + filha-template, mantém instância + filha-instância', () => {
  const vis = filterVisibleGroupTasks(ROSE).map((t) => t.id);
  assert.deepStrictEqual(vis.sort(), ['inst', 'kid_inst']);
  // sem duplicata de título na visão do TOM
  const titles = filterVisibleGroupTasks(ROSE).map((t) => t.title);
  assert.strictEqual(new Set(titles).size, titles.length);
});

test('grupo SEM recorrência (mãe is_group + filhas, sem template) passa inteiro', () => {
  const simples = [
    { id: 'm', is_group: true, recurrence_rule: null, parent_task_id: null },
    { id: 'a', is_group: false, recurrence_rule: null, parent_task_id: 'm' },
    { id: 'b', is_group: false, recurrence_rule: null, parent_task_id: 'm' },
  ];
  assert.deepStrictEqual(filterVisibleGroupTasks(simples).map((t) => t.id), ['m', 'a', 'b']);
});

test('Fatia 2: marcador intrínseco esconde blueprint mesmo SEM idsDeMolde (molde off-page)', () => {
  // A borda que exigia o round-trip idsDeMoldeDosPais: molde fora do array (cancelado/off-page),
  // então a filha-blueprint não tinha pai denunciável. Com o flag, some por conta própria.
  const rows = [
    { id: 'bp', is_group: false, recurrence_rule: null, parent_task_id: 'molde-fora', is_recurrence_template: true },
    { id: 'inst', is_group: false, recurrence_rule: null, parent_task_id: 'inst-mae', is_recurrence_template: false },
  ];
  assert.deepStrictEqual(filterVisibleGroupTasks(rows).map((t) => t.id), ['inst']);
});

test('tarefas avulsas (não-grupo) passam', () => {
  const avulsas = [
    { id: 'x', is_group: false, recurrence_rule: null, parent_task_id: null },
    { id: 'y', is_group: false, recurrence_rule: null, parent_task_id: null },
  ];
  assert.deepStrictEqual(filterVisibleGroupTasks(avulsas).map((t) => t.id), ['x', 'y']);
});

test('entrada vazia / não-array → []', () => {
  assert.deepStrictEqual(filterVisibleGroupTasks([]), []);
  assert.deepStrictEqual(filterVisibleGroupTasks(null), []);
  assert.deepStrictEqual(filterVisibleGroupTasks(undefined), []);
});

test('não muta o array de entrada', () => {
  const input = ROSE.slice();
  const len = input.length;
  filterVisibleGroupTasks(input);
  assert.strictEqual(input.length, len);
});

// ---------------------------------------------------------------------------
// GROUPPKG-CONTAINER-COMPLETABLE-1TO1 (caso Rose 03/08/2026)
//
// O container do pacote (is_group=true, recurrence_rule=null) é uma PASTA, não
// tarefa. Os readers do chat de GRUPO (group-chat-engine.js) e do digest
// (group-report-builder.js shapeOpenTasks) já o excluem desde 20/06
// (GROUPPKG-CONTAINER-PHANTOM-FLATLIST). O reader do chat 1:1
// (prompts/system.js → myGroupTasks) ficou de fora da varredura.
//
// Consequência real: o container "Conciliação de Cartões" (due 01/08, herdada do
// BYMONTHDAY=1) entrou no bloco "Tarefas abertas dos SEUS grupos (você também
// pode concluir)" com id. O TOM listou como atrasada, a Rose confirmou "foram
// feitas sim" e o engine fechou a PASTA — as 6 filhas (due 12–27/08, trabalho
// que nem tinha vencido) ficaram pending. Fantasma dia-1, igual ao de 20/06.
// ---------------------------------------------------------------------------
const PACOTE_AGOSTO = [
  // container do ciclo de agosto — due dia 1 (BYMONTHDAY=1), sem recurrence_rule
  { id: '2fbbe3b6', title: 'Conciliação de Cartões', is_group: true, recurrence_rule: null, parent_task_id: null, due_date: '2026-08-01' },
  // as 6 filhas reais, que vencem DEPOIS do container
  { id: 'k8516', title: 'Cartão 8516 (Barra)', is_group: false, recurrence_rule: null, parent_task_id: '2fbbe3b6', due_date: '2026-08-12' },
  { id: 'k2270', title: 'Cartão 2270 (EMLA)', is_group: false, recurrence_rule: null, parent_task_id: '2fbbe3b6', due_date: '2026-08-12' },
  { id: 'k8641', title: 'Cartão 8641 (Recreio)', is_group: false, recurrence_rule: null, parent_task_id: '2fbbe3b6', due_date: '2026-08-17' },
  { id: 'k8434', title: 'Cartão 8434 (Kids CG)', is_group: false, recurrence_rule: null, parent_task_id: '2fbbe3b6', due_date: '2026-08-25' },
  { id: 'k1074', title: 'Cartão 1074 (Kids CG)', is_group: false, recurrence_rule: null, parent_task_id: '2fbbe3b6', due_date: '2026-08-25' },
  { id: 'kmp', title: 'Cartão Mercado Pago (Barra)', is_group: false, recurrence_rule: null, parent_task_id: '2fbbe3b6', due_date: '2026-08-27' },
  // tarefa avulsa do mesmo grupo — tem de continuar visível
  { id: 'avulsa', title: 'Dar baixa no prolabore', is_group: false, recurrence_rule: null, parent_task_id: null, due_date: '2026-08-01' },
];

test('caso Rose 03/08: container do pacote NÃO é tarefa — sai do pool do TOM', () => {
  const ids = dropPackageContainers(PACOTE_AGOSTO).map((t) => t.id);
  assert.ok(!ids.includes('2fbbe3b6'), 'container is_group não pode chegar ao TOM como tarefa concluível');
  // as 6 filhas e a avulsa continuam — o trabalho real não some
  assert.deepStrictEqual(ids, ['k8516', 'k2270', 'k8641', 'k8434', 'k1074', 'kmp', 'avulsa']);
});

test('composição com filterVisibleGroupTasks: some template E container, ficam as filhas', () => {
  const ids = dropPackageContainers(filterVisibleGroupTasks(ROSE)).map((t) => t.id);
  assert.deepStrictEqual(ids, ['kid_inst']);
});

test('dropPackageContainers: avulsas e filhas passam; entrada inválida → []', () => {
  const avulsas = [{ id: 'x', is_group: false }, { id: 'y' }];
  assert.deepStrictEqual(dropPackageContainers(avulsas).map((t) => t.id), ['x', 'y']);
  assert.deepStrictEqual(dropPackageContainers([]), []);
  assert.deepStrictEqual(dropPackageContainers(null), []);
  assert.deepStrictEqual(dropPackageContainers(undefined), []);
});

test('dropPackageContainers não muta a entrada', () => {
  const input = PACOTE_AGOSTO.slice();
  const len = input.length;
  dropPackageContainers(input);
  assert.strictEqual(input.length, len);
});

// ── GROUPCHAT-POOL-RECUR-TEMPLATE-INVISIBLE (caso Rose 06/08, 21h57) ──────────
// A Rose criou duas tarefas mensais de grupo ("Relatório Mensal Financeiro", venc. dia 5;
// "Faturamento Mensal", venc. dia 6). Elas aparecem no app e o TOM jurou que não existiam:
// "não tá na lista de tarefas do grupo — pode nunca ter sido criado aqui". Depois falhou ao
// concluir ("não achei essa tarefa no grupo").
//
// Duas causas somadas, as duas no caminho do pool:
//  1. a query fazia `.is('recurrence_rule', null)` — molde recorrente NUNCA entrava. A regra
//     existe desde 12/06 para o TOM não ver molde E instância e cobrar em dobro; só que ela
//     disparava mesmo quando NÃO HÁ instância, e aí esconde trabalho em vez de duplicata.
//     Nestes dois casos o materializeAll roda a cada 5min e cria zero: o ciclo corrente É o
//     próprio molde.
//  2. `categorize` marca como 'retroativa' (e some) toda tarefa criada DEPOIS do vencimento.
//     Num molde, `due_date` é a âncora do ciclo (BYMONTHDAY=5), não data de cadastro atrasado.
const { ehMoldeRecorrente, escondeMoldeComInstancia } = require('./group-task-visibility');

const molde = (id, extra = {}) => ({ id, recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=5', recurrence_parent_id: null, ...extra });
const instancia = (id, pai) => ({ id, recurrence_rule: null, recurrence_parent_id: pai });
const avulsa = (id) => ({ id, recurrence_rule: null, recurrence_parent_id: null });

test('ehMoldeRecorrente: regra preenchida + sem pai = molde', () => {
  assert.equal(ehMoldeRecorrente(molde('m')), true);
  assert.equal(ehMoldeRecorrente(instancia('i', 'm')), false, 'instancia nao e molde');
  assert.equal(ehMoldeRecorrente(avulsa('a')), false);
  assert.equal(ehMoldeRecorrente(null), false);
});

test('molde SEM instancia viva APARECE — era o buraco: trabalho real invisivel', () => {
  const r = escondeMoldeComInstancia([molde('relatorio'), avulsa('outra')], new Set());
  assert.deepEqual(r.map((t) => t.id), ['relatorio', 'outra']);
});

test('molde COM instancia viva continua ESCONDIDO — nao reintroduz a duplicata de 12/06', () => {
  const r = escondeMoldeComInstancia([molde('m'), instancia('i', 'm')], new Set(['m']));
  assert.deepEqual(r.map((t) => t.id), ['i'], 'o molde vazou junto com a instancia');
});

test('o conjunto de ids vem do BANCO, nao da pagina buscada', () => {
  // Se a instancia existir mas ficar fora do limite da pagina, decidir pela pagina
  // reintroduziria a duplicata. Por isso a funcao recebe o conjunto pronto.
  const r = escondeMoldeComInstancia([molde('m')], new Set(['m']));
  assert.deepEqual(r, [], 'decidiu pela pagina em vez do conjunto recebido');
});

test('nao mexe em tarefa nao-recorrente, e nao muta a entrada', () => {
  const entrada = [avulsa('a'), instancia('i', 'x')];
  const r = escondeMoldeComInstancia(entrada, new Set(['x']));
  assert.deepEqual(r.map((t) => t.id), ['a', 'i']);
  assert.equal(entrada.length, 2);
});

// ── GROUPPKG-FILHA-TEMPLATE-VAZA-MOLDE-CANCELADO (caso Rose 12/08/2026) ──────────────
// O molde "Conciliação de Cartões" (dia 30) foi CANCELADO em 09/08 15:54. Três dias depois
// a Rose pediu "Tom, conclui os dois" e o TOM concluiu 10 tarefas erradas antes de acertar.
//
// Por quê: as queries que alimentam este helper filtram `status != cancelled`. Molde cancelado
// não entra no array → `templateIds` não o contém → as filhas-template dele passam pelo filtro
// e aparecem como tarefas reais, com o MESMO título e a MESMA data da filha-instância. O TOM
// não tem como distinguir: filha-template não tem `recurrence_rule` próprio.
//
// Enquanto o molde estava vivo, o filtro funcionava — por isso o bug "aparece de vez em quando"
// e nunca reproduzia. Cancelar o molde é o gatilho.
//
// A correção é a MESMA lição que `escondeMoldeComInstancia` já documenta logo abaixo neste
// arquivo: o conjunto de exclusão vem do BANCO, não da página já filtrada.
test('filha de molde CANCELADO (fora do result set) some quando os ids vêm do banco', () => {
  // O molde 'tpl' NÃO está na lista — foi cancelado e a query o excluiu.
  const lista = [
    { id: 'inst', is_group: true, recurrence_rule: null, recurrence_parent_id: 'tpl' },
    { id: 'filha-real', is_group: false, recurrence_rule: null, parent_task_id: 'inst', title: 'Cartão 8516 (Barra)' },
    { id: 'filha-fantasma', is_group: false, recurrence_rule: null, parent_task_id: 'tpl', title: 'Cartão 8516 (Barra)' },
  ];

  // Sem os ids do banco, a fantasma vaza — é exatamente o estado que quebrou em produção.
  assert.deepStrictEqual(
    filterVisibleGroupTasks(lista).map((t) => t.id),
    ['inst', 'filha-real', 'filha-fantasma'],
    'comportamento legado preservado quando não se passa o conjunto'
  );

  // Com os ids vindos do banco (sem filtro de status), ela some.
  assert.deepStrictEqual(
    filterVisibleGroupTasks(lista, new Set(['tpl'])).map((t) => t.id),
    ['inst', 'filha-real']
  );
});

test('ids do banco COMPÕEM com os derivados da lista, não os substituem', () => {
  const lista = [
    { id: 'tpl-vivo', is_group: true, recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=1' },
    { id: 'f-vivo', is_group: false, parent_task_id: 'tpl-vivo' },
    { id: 'f-morto', is_group: false, parent_task_id: 'tpl-cancelado' },
    { id: 'ok', is_group: false, parent_task_id: 'inst' },
  ];
  assert.deepStrictEqual(
    filterVisibleGroupTasks(lista, new Set(['tpl-cancelado'])).map((t) => t.id),
    ['ok']
  );
});

test('conjunto aceita array e valores soltos sem quebrar (entrada defensiva)', () => {
  const lista = [{ id: 'f', is_group: false, parent_task_id: 'tpl' }];
  assert.deepStrictEqual(filterVisibleGroupTasks(lista, ['tpl']).map((t) => t.id), []);
  assert.deepStrictEqual(filterVisibleGroupTasks(lista, null).map((t) => t.id), ['f']);
  assert.deepStrictEqual(filterVisibleGroupTasks(lista, undefined).map((t) => t.id), ['f']);
});

// ── idsDeMoldeDosPais: o conjunto de exclusão vem do BANCO, sem filtro de status ──────
function fakeSb(linhas, espia) {
  return { from() { return {
    select() { return this; },
    in(col, vals) { if (espia) espia.ids = vals; return this; },
    not(col, op, val) { if (espia) espia.not = [col, op, val]; return this; },
    then(res) { return Promise.resolve({ data: linhas }).then(res); },
  }; } };
}

test('idsDeMoldeDosPais consulta os pais distintos e devolve só os que são molde', async () => {
  const espia = {};
  const sb = fakeSb([{ id: 'tpl-cancelado' }], espia);
  const tarefas = [
    { id: 'a', parent_task_id: 'tpl-cancelado' },
    { id: 'b', parent_task_id: 'inst' },
    { id: 'c', parent_task_id: 'inst' }, // repetido → não duplica na consulta
    { id: 'd' },                          // sem pai → ignorada
  ];
  const ids = await idsDeMoldeDosPais(sb, tarefas);
  assert.deepStrictEqual([...espia.ids].sort(), ['inst', 'tpl-cancelado']);
  assert.deepStrictEqual(espia.not, ['recurrence_rule', 'is', null]);
  assert.ok(ids.has('tpl-cancelado') && !ids.has('inst'));
});

test('idsDeMoldeDosPais: sem pais não consulta o banco', async () => {
  let consultou = false;
  const sb = { from() { consultou = true; return {}; } };
  assert.strictEqual((await idsDeMoldeDosPais(sb, [{ id: 'x' }])).size, 0);
  assert.strictEqual((await idsDeMoldeDosPais(sb, [])).size, 0);
  assert.strictEqual((await idsDeMoldeDosPais(sb, null)).size, 0);
  assert.strictEqual(consultou, false);
});

// Best-effort: o digest do grupo e o contexto do TOM não podem cair por causa disto.
// Falhar aqui degrada pro comportamento legado (a fantasma volta), nunca derruba o envio.
test('idsDeMoldeDosPais engole erro do banco e devolve conjunto vazio', async () => {
  const sb = { from() { throw new Error('boom'); } };
  assert.strictEqual((await idsDeMoldeDosPais(sb, [{ id: 'a', parent_task_id: 'p' }])).size, 0);
});
