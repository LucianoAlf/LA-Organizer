'use strict';
// A regra que este módulo protege: quando o título casa com VÁRIAS instâncias da mesma
// série recorrente, o alvo é o CICLO CORRENTE — a de menor due_date. O código legado usava
// `order('created_at' desc).limit(1)`, que numa série materializada devolve a instância mais
// FUTURA. Medido em 06/08 na série "Presença Emusys": legado escolhia 04/09, corrente era 01/08.
const test = require('node:test');
const assert = require('node:assert');
const { resolveTaskTarget, serieDe } = require('./task-target');

// Helper: instância de série. `serie` é o recurrence_parent_id.
const inst = (id, due, serie, created = '2026-08-01T12:00:00Z') =>
  ({ id, title: 'Presença Emusys', due_date: due, recurrence_parent_id: serie,
     recurrence_rule: null, created_at: created });
// Helper: tarefa avulsa, sem recorrência nenhuma.
const avulsa = (id, due, created = '2026-08-01T12:00:00Z') =>
  ({ id, title: 'Presença Emusys', due_date: due, recurrence_parent_id: null,
     recurrence_rule: null, created_at: created });

test('sem candidato → nenhum', () => {
  assert.deepEqual(resolveTaskTarget({ candidatos: [] }), { modo: 'nenhum', motivo: 'sem_candidato' });
  assert.equal(resolveTaskTarget({}).modo, 'nenhum');
  assert.equal(resolveTaskTarget({ candidatos: null }).modo, 'nenhum');
});

test('um candidato → exato, sem precisar de regra', () => {
  const t = avulsa('a', '2026-08-20');
  const r = resolveTaskTarget({ candidatos: [t] });
  assert.equal(r.modo, 'exato');
  assert.equal(r.motivo, 'unico');
  assert.equal(r.tarefa.id, 'a');
});

test('série com uma ATRASADA → escolhe a atrasada, não a criada por último', () => {
  // Reproduz "Presença Emusys": a de setembro foi criada depois, o legado pegava ela.
  const candidatos = [
    inst('set', '2026-09-04', 'S1', '2026-08-05T12:00:00Z'),
    inst('ago', '2026-08-01', 'S1', '2026-07-01T12:00:00Z'),
    inst('meio', '2026-08-15', 'S1', '2026-07-20T12:00:00Z'),
  ];
  const r = resolveTaskTarget({ candidatos });
  assert.equal(r.modo, 'exato');
  assert.equal(r.motivo, 'serie');
  assert.equal(r.tarefa.id, 'ago', 'pegou a instância errada da série');
});

test('série TODA no futuro → a mais próxima', () => {
  const candidatos = [
    inst('longe', '2026-09-04', 'S1'),
    inst('perto', '2026-08-10', 'S1'),
  ];
  assert.equal(resolveTaskTarget({ candidatos }).tarefa.id, 'perto');
});

test('linhagens DISTINTAS → ambiguo (é Fatia B, não chuta)', () => {
  const r = resolveTaskTarget({ candidatos: [inst('a', '2026-08-10', 'S1'), inst('b', '2026-08-12', 'S2')] });
  assert.equal(r.modo, 'ambiguo');
  assert.equal(r.motivo, 'linhagens_distintas');
  assert.equal(r.candidatos.length, 2);
});

test('série + UMA avulsa de mesmo nome → ambiguo (avulsa não é "a série")', () => {
  const r = resolveTaskTarget({ candidatos: [inst('a', '2026-08-10', 'S1'), avulsa('x', '2026-08-11')] });
  assert.equal(r.modo, 'ambiguo');
  assert.equal(r.motivo, 'linhagens_distintas');
});

test('série inteira SEM due_date → ambiguo: não dá para ordenar sem chutar', () => {
  const r = resolveTaskTarget({ candidatos: [inst('a', null, 'S1'), inst('b', null, 'S1')] });
  assert.equal(r.modo, 'ambiguo');
  assert.equal(r.motivo, 'serie_sem_data');
});

test('série com data PARCIAL → escolhe entre as que têm data; nula nunca é o ciclo', () => {
  const r = resolveTaskTarget({ candidatos: [inst('semdata', null, 'S1'), inst('comdata', '2026-08-10', 'S1')] });
  assert.equal(r.modo, 'exato');
  assert.equal(r.tarefa.id, 'comdata');
});

test('empate de due_date → created_at mais antigo, e a ordem de entrada não muda o resultado', () => {
  const a = inst('velha', '2026-08-10', 'S1', '2026-07-01T00:00:00Z');
  const b = inst('nova', '2026-08-10', 'S1', '2026-07-09T00:00:00Z');
  assert.equal(resolveTaskTarget({ candidatos: [a, b] }).tarefa.id, 'velha');
  assert.equal(resolveTaskTarget({ candidatos: [b, a] }).tarefa.id, 'velha', 'resultado dependeu da ordem de entrada');
});

test('serieDe: parent_id manda; molde usa o próprio id; avulsa é null', () => {
  assert.equal(serieDe({ id: 'x', recurrence_parent_id: 'P', recurrence_rule: 'FREQ=DAILY' }), 'P');
  assert.equal(serieDe({ id: 'molde', recurrence_parent_id: null, recurrence_rule: 'FREQ=DAILY' }), 'molde');
  assert.equal(serieDe({ id: 'y', recurrence_parent_id: null, recurrence_rule: null }), null);
  assert.equal(serieDe(null), null);
});
