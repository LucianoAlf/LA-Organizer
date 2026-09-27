'use strict';
// Achado da44ab45 (Clayton → Vitoria, 25/09): "delegar" tarefa que não existe + recorrência em
// atalho. Ver src/lib/acao-de-tarefa.js.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { normalizarAcaoDeTarefa, rruleDoAtalho } = require('./acao-de-tarefa');

// Forma REAL do bloco recusado 4× (marker_logs 25/09 13:03–13:05).
const CLAYTON = { action: 'delegate', title: 'Conferir as pendências do dia', to_name: 'Vitoria', recurrence: 'weekdays', due_date: '2026-09-26' };

test('caso Clayton: delegate SEM id vira create PRA Vitoria, de segunda a sexta de verdade', () => {
  const r = normalizarAcaoDeTarefa(CLAYTON);
  assert.strictEqual(r.action, 'create');
  assert.strictEqual(r.to_name, 'Vitoria');
  assert.strictEqual(r.title, CLAYTON.title);
  assert.strictEqual(r.recurrence_rule, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  assert.ok(!('recurrence' in r) && !('id' in r));
  assert.strictEqual(r.due_date, '2026-09-26');
});

test('delegate COM id (tarefa que existe) continua delegate, intocado', () => {
  const a = { action: 'delegate', id: 'abcd1234', to_name: 'Vitoria' };
  assert.deepStrictEqual(normalizarAcaoDeTarefa(a), a);
});

test('delegate sem id e sem título ou sem destinatário não vira nada (a recusa segue)', () => {
  const a = { action: 'delegate', to_name: 'Vitoria' };
  assert.deepStrictEqual(normalizarAcaoDeTarefa(a), a);
  const b = { action: 'delegate', title: 'x' };
  assert.deepStrictEqual(normalizarAcaoDeTarefa(b), b);
});

test('recorrência que não sei ler: NÃO converte (criar única prometendo repetição seria mentira)', () => {
  const a = { ...CLAYTON, recurrence: 'a cada lua cheia' };
  assert.deepStrictEqual(normalizarAcaoDeTarefa(a), a);
});

test('delegate sem id e SEM recorrência vira create simples', () => {
  const r = normalizarAcaoDeTarefa({ action: 'delegate', title: 'Mandar mensagem pro cara da Solez', to_name: 'Luciano' });
  assert.strictEqual(r.action, 'create');
  assert.ok(!('recurrence_rule' in r));
});

test('create com atalho no campo errado ganha o RRULE; create com recurrence_rule fica como está', () => {
  assert.strictEqual(normalizarAcaoDeTarefa({ action: 'create', title: 'x', recurrence: 'diária' }).recurrence_rule, 'FREQ=DAILY');
  const c = { action: 'create', title: 'x', recurrence: 'weekdays', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO' };
  assert.deepStrictEqual(normalizarAcaoDeTarefa(c), c);
});

test('rruleDoAtalho: pt e en; RRULE pronta passa; desconhecido = undefined; vazio = null', () => {
  assert.strictEqual(rruleDoAtalho('dias úteis'), 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  assert.strictEqual(rruleDoAtalho('segunda a sexta'), 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  assert.strictEqual(rruleDoAtalho('mensal'), 'FREQ=MONTHLY');
  assert.strictEqual(rruleDoAtalho('RRULE:FREQ=DAILY'), 'FREQ=DAILY');
  assert.strictEqual(rruleDoAtalho('sei lá'), undefined);
  assert.strictEqual(rruleDoAtalho(''), null);
});

test('lixo não quebra', () => {
  assert.strictEqual(normalizarAcaoDeTarefa(null), null);
  assert.strictEqual(normalizarAcaoDeTarefa('x'), 'x');
});

const engine = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
test('engine normaliza CADA ação do TASK_UPDATE antes de validar', () => {
  assert.match(engine, /const a = normalizarAcaoDeTarefa\(rawActions\[i\]\);\s*\n\s*const why = validateTaskAction\(a\);/);
});
