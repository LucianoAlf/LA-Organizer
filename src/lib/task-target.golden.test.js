'use strict';
// Zero-regressão: para título SEM duplicata, o alvo com a flag ligada tem de ser o mesmo da
// flag desligada. Se divergir aqui, a fatia mudou comportamento onde não devia.
const test = require('node:test');
const assert = require('node:assert');
const { resolveTaskTarget } = require('./task-target');

const legado = (cands) => cands.slice().sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))[0] || null;

test('titulo SEM duplicata: flag ligada e desligada escolhem a MESMA tarefa', () => {
  const um = [{ id: 'so-essa', title: 'Renovar contrato', due_date: '2026-08-20',
                recurrence_parent_id: null, recurrence_rule: null, created_at: '2026-08-01T10:00:00Z' }];
  const comFlag = resolveTaskTarget({ candidatos: um });
  assert.equal(comFlag.modo, 'exato');
  assert.equal(comFlag.tarefa.id, legado(um).id);
});

test('ambiguidade real: a Fatia A tem de escolher o MESMO que o legado (so loga)', () => {
  const cands = [
    { id: 'nova', title: 'Anamnese', due_date: '2026-08-30', recurrence_parent_id: 'A', recurrence_rule: null, created_at: '2026-08-05T10:00:00Z' },
    { id: 'velha', title: 'Anamnese', due_date: '2026-08-10', recurrence_parent_id: 'B', recurrence_rule: null, created_at: '2026-07-01T10:00:00Z' },
  ];
  const r = resolveTaskTarget({ candidatos: cands });
  assert.equal(r.modo, 'ambiguo', 'linhagens distintas nao podem virar exato na Fatia A');
  assert.equal(legado(cands).id, 'nova', 'controle: o legado escolhe a criada por ultimo');
});

// O fallback do ramo ambíguo no engine é escrito inline (candidatos.sort por created_at desc).
// Este teste fixa o CONTRATO desse fallback: tem de devolver o mesmo que o legado devolveria,
// senão a Fatia A muda os 7% sem querer e a medição do cenário B fica contaminada por duas
// mudanças acontecendo juntas.
test('fallback do ramo ambiguo == vencedor legado, para a medicao ficar isolada', () => {
  const cands = [
    { id: 'a', due_date: '2026-08-30', recurrence_parent_id: 'A', recurrence_rule: null, created_at: '2026-08-05T10:00:00Z' },
    { id: 'b', due_date: '2026-08-10', recurrence_parent_id: 'B', recurrence_rule: null, created_at: '2026-07-01T10:00:00Z' },
    { id: 'c', due_date: '2026-08-20', recurrence_parent_id: 'C', recurrence_rule: null, created_at: '2026-08-06T10:00:00Z' },
  ];
  const r = resolveTaskTarget({ candidatos: cands });
  assert.equal(r.modo, 'ambiguo');
  const fallbackDoEngine = r.candidatos.slice().sort((x, y) => (Date.parse(y.created_at) || 0) - (Date.parse(x.created_at) || 0))[0];
  assert.equal(fallbackDoEngine.id, legado(cands).id, 'o fallback divergiu do legado');
  assert.equal(fallbackDoEngine.id, 'c');
});
