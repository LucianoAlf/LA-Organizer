'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildGroupPoolLines, buildGroupTaskReminderText, groupAuthorDescSuffix, firstNameOf, truncDesc, packagePrefix } = require('./group-task-relay');

const fmt = (ymd) => (ymd === '2026-06-25' ? 'hoje' : ymd);

test('firstNameOf: preferred_name > full_name > vazio', () => {
  assert.strictEqual(firstNameOf({ preferred_name: 'Vi', full_name: 'Vitoria Souza' }), 'Vi');
  assert.strictEqual(firstNameOf({ full_name: 'Vitoria Souza' }), 'Vitoria');
  assert.strictEqual(firstNameOf(null), '');
});

test('truncDesc: colapsa espaços + corta com reticências', () => {
  assert.strictEqual(truncDesc('  a   b \n c ', 100), 'a b c');
  assert.strictEqual(truncDesc('x'.repeat(250), 240).length, 241);
  assert.strictEqual(truncDesc('', 100), '');
});

test('pool: tarefa com criador + descrição vira 2 linhas', () => {
  const tasks = [{ id: 'abcd1234', title: 'Ligar para aluno', due_date: '2026-06-25', assigned_group_id: 'g1', description: 'Aluno: Leandro\nAssunto: trancamento', creator: { full_name: 'Vitoria Souza' } }];
  const lines = buildGroupPoolLines(tasks, [{ id: 'g1', name: 'ADM CG' }], '2026-06-25', fmt);
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /👥\[ADM CG\] Ligar para aluno — hoje · criada por Vitoria/);
  assert.match(lines[1], /↳ Aluno: Leandro Assunto: trancamento/);
});

test('pool: sem descrição/criador → 1 linha só, grupo "grupo" quando não acha', () => {
  const lines = buildGroupPoolLines([{ id: 'ef56', title: 'X', assigned_group_id: 'g9' }], [], '2026-06-25', fmt);
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /👥\[grupo\] X/);
  assert.doesNotMatch(lines[0], /criada por/);
});

test('lembrete: descrição + criador', () => {
  const txt = buildGroupTaskReminderText({ label: null, title: 'Ligar para aluno', when: 'hoje', creatorFirstName: 'Vitoria', description: 'Aluno: Leandro, trancamento' });
  assert.match(txt, /^⏰ Lembrete: \*Ligar para aluno\* \(grupo\) — hoje/);
  assert.match(txt, /_criada por Vitoria:_ Aluno: Leandro, trancamento/);
});

test('lembrete: sem descrição nem criador = formato atual intacto', () => {
  const txt = buildGroupTaskReminderText({ label: null, title: 'X', when: 'hoje', creatorFirstName: '', description: '' });
  assert.strictEqual(txt, '⏰ Lembrete: *X* (grupo) — hoje');
});

test('lembrete: packageTitle prefixa o pacote dentro do bold; sem ele fica intacto (regressão)', () => {
  const comPkg = buildGroupTaskReminderText({ label: null, title: 'Venc 05 (prazo dia 06)', when: 'amanhã', packageTitle: 'Depósito de Cheques' });
  assert.strictEqual(comPkg, '⏰ Lembrete: *Depósito de Cheques: Venc 05 (prazo dia 06)* (grupo) — amanhã');
  const semPkg = buildGroupTaskReminderText({ label: null, title: 'X', when: 'hoje' });
  assert.strictEqual(semPkg, '⏰ Lembrete: *X* (grupo) — hoje');
});

test('groupAuthorDescSuffix: vazio quando sem autor nem descrição', () => {
  assert.strictEqual(groupAuthorDescSuffix({ creatorFirstName: '', description: '' }), '');
  assert.strictEqual(groupAuthorDescSuffix(), '');
});

test('groupAuthorDescSuffix: só autor / só descrição', () => {
  assert.strictEqual(groupAuthorDescSuffix({ creatorFirstName: 'Vi', description: '' }), '\n_criada por Vi_');
  assert.strictEqual(groupAuthorDescSuffix({ creatorFirstName: '', description: 'faz X' }), '\nfaz X');
});

test('lembrete: descrição longa ganha "abre no app"', () => {
  const txt = buildGroupTaskReminderText({ label: 'Bom dia', title: 'X', when: '', creatorFirstName: 'Vi', description: 'y'.repeat(250) });
  assert.match(txt, /abre no app pra ver tudo/);
  assert.match(txt, /^⏰ Bom dia: \*X\* \(grupo\)/);
});

// ── packagePrefix (compartilhado com group-report-builder) — GROUPREPORT-PACKAGE-TITLE-MISSING ──
test('packagePrefix: retorna "Pacote: " quando há título; guard anti-redundância; vazio sem pacote', () => {
  assert.strictEqual(packagePrefix('Depósito de Cheques', 'Venc 05 (prazo dia 06)'), 'Depósito de Cheques: ');
  assert.strictEqual(packagePrefix('Venc 20', 'Venc 20'), '');       // já cita → não vira "X: X"
  assert.strictEqual(packagePrefix(null, 'Boleto X'), '');           // sem pacote
  assert.strictEqual(packagePrefix('', 'Boleto X'), '');
});

test('pool: prefixa o PACOTE pai quando parentTitleById resolve o parent_task_id', () => {
  const tasks = [{ id: 'filha01', title: 'Venc 05 (prazo dia 06)', due_date: '2026-07-06', assigned_group_id: 'g1', parent_task_id: 'cont1', creator: { preferred_name: 'Rose' } }];
  const parents = new Map([['cont1', 'Depósito de Cheques']]);
  const lines = buildGroupPoolLines(tasks, [{ id: 'g1', name: 'Financeiro' }], '2026-07-06', (y) => y, parents);
  assert.match(lines[0], /👥\[Financeiro\] Depósito de Cheques: Venc 05 \(prazo dia 06\)/);
});

test('pool: SEM parentTitleById → sem prefixo (regressão — chamadores antigos)', () => {
  const tasks = [{ id: 'filha01', title: 'Venc 05 (prazo dia 06)', assigned_group_id: 'g1', parent_task_id: 'cont1' }];
  const lines = buildGroupPoolLines(tasks, [{ id: 'g1', name: 'Financeiro' }], '2026-07-06', (y) => y);
  assert.match(lines[0], /👥\[Financeiro\] Venc 05 \(prazo dia 06\)/);
  assert.doesNotMatch(lines[0], /:/);
});
