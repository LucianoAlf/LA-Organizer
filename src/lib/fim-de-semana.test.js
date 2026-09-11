'use strict';
// FIM-DE-SEMANA-EMPURRA-SEGUNDA (decisão do Alf 11/09 — aaf37e2b).
const { test } = require('node:test');
const assert = require('node:assert');
const { empurraFimDeSemana, ehRegraMensal } = require('./fim-de-semana');

test('as datas REAIS do pacote da Rose: sábado e domingo vão pra segunda', () => {
  assert.strictEqual(empurraFimDeSemana('2026-08-01'), '2026-08-03'); // sáb → seg
  assert.strictEqual(empurraFimDeSemana('2026-08-29'), '2026-08-31'); // sáb → seg
  assert.strictEqual(empurraFimDeSemana('2026-09-20'), '2026-09-21'); // dom → seg
});
test('dia útil fica; virada de mês funciona; entrada inválida volta igual', () => {
  assert.strictEqual(empurraFimDeSemana('2026-08-14'), '2026-08-14');
  assert.strictEqual(empurraFimDeSemana('2026-05-30'), '2026-06-01');
  assert.strictEqual(empurraFimDeSemana('ontem'), 'ontem');
  assert.strictEqual(empurraFimDeSemana(null), null);
});
test('só regra mensal/anual empurra; diária e semanal dizem o dia de propósito', () => {
  assert.strictEqual(ehRegraMensal('FREQ=MONTHLY;BYMONTHDAY=1'), true);
  assert.strictEqual(ehRegraMensal('RRULE:FREQ=YEARLY;BYMONTH=3'), true);
  assert.strictEqual(ehRegraMensal('FREQ=DAILY'), false);
  assert.strictEqual(ehRegraMensal('FREQ=WEEKLY;BYDAY=SA'), false);
  assert.strictEqual(ehRegraMensal(null), false);
});

const { buildGroupChildRow } = require('../services/recurrence-engine');
const FILHA = { id: 'tpl-barra', title: 'Pedir fatura Barra 8516', due_date: '2026-07-29', status: 'pending', assigned_group_id: 'g', recurrence_rule: null, recurrence_parent_id: null };
const MAE_AGO = { id: 'mae-ago', due_date: '2026-08-01' };
test('filha de pacote MENSAL: o dia 29 que cai no sábado vira segunda 31/08', () => {
  assert.strictEqual(buildGroupChildRow(FILHA, MAE_AGO, { empurrarFimDeSemana: true }).due_date, '2026-08-31');
});
test('sem o flag (pacote não mensal) a filha fica no dia calculado', () => {
  assert.strictEqual(buildGroupChildRow(FILHA, MAE_AGO).due_date, '2026-08-29');
});

const REC = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'services', 'recurrence-engine.js'), 'utf8');
test('motor: ocorrência mensal empurrada e dedup aceita a data original OU a empurrada', () => {
  assert.match(REC, /if \(existingDays\.has\(dayKey\) \|\| existingDays\.has\(diaFinal\)\) \{ skipped\+\+; continue; \}/);
  assert.match(REC, /buildGroupChildRow\(childTpl, mother, \{ empurrarFimDeSemana: _pacoteMensal \}\)/);
});
