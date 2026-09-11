'use strict';
// SERIE-ANTIGAS-UMA-PERGUNTA (decisão do Alf 11/09 — 8071e4f3, 4ce2d1ec).
const { test } = require('node:test');
const assert = require('node:assert');
const { antigasDaMesmaSerie, perguntaAntigas } = require('./serie-antigas');

// As ocorrências REAIS da série do Clayton em julho (datas do marker_logs/banco).
const IRMAS = [
  { id: 'a22', due_date: '2026-07-22', status: 'pending' },
  { id: 'a15', due_date: '2026-07-15', status: 'pending' },
  { id: 'a17', due_date: '2026-07-17', status: 'done' },
  { id: 'a18', due_date: '2026-07-18', status: 'pending' },
  { id: 'a25', due_date: '2026-07-25', status: 'pending' },
];

test('Clayton 24/07: antigas = abertas vencidas ANTES de hoje, em ordem de data', () => {
  assert.deepStrictEqual(antigasDaMesmaSerie(IRMAS, { hojeYmd: '2026-07-24' }).map((x) => x.id), ['a15', 'a18', 'a22']);
});
test('futura, fechada, cancelada ou sem data não entram; hoje inválido → nada', () => {
  assert.deepStrictEqual(antigasDaMesmaSerie([{ id: 'x', due_date: null, status: 'pending' }, { id: 'c', due_date: '2026-07-01', status: 'cancelled' }], { hojeYmd: '2026-07-24' }), []);
  assert.deepStrictEqual(antigasDaMesmaSerie(IRMAS, { hojeYmd: 'ontem' }), []);
});
test('uma pergunta só, com as datas; singular e plural', () => {
  const antigas = antigasDaMesmaSerie(IRMAS, { hojeYmd: '2026-07-24' });
  assert.strictEqual(perguntaAntigas('Criar tarefas para as meninas da ADM', antigas),
    'Ainda tem 3 ocorrências antigas de *Criar tarefas para as meninas da ADM* em aberto (15/07, 18/07, 22/07). Fecho todas também?');
  assert.strictEqual(perguntaAntigas('X', antigas.slice(0, 1)), 'Ainda tem 1 ocorrência antiga de *X* em aberto (15/07). Fecho ela também?');
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: conclusão de ocorrência pergunta pelas antigas via batch_complete (executor determinístico)', () => {
  assert.match(ENG, /SERIE-ANTIGAS-UMA-PERGUNTA/);
  assert.match(ENG, /\{ batch_complete: _antigas\.map\(\(x\) => String\(x\.id\)\.replace\(\/-\/g, ''\)\.slice\(0, 8\)\) \}/);
  assert.match(ENG, /if \(_iid\) \{ groupNotices\.push\(_pergunta\); _perguntouConfirmacao = true; \}/);
});
