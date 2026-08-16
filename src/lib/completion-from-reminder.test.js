// src/lib/completion-from-reminder.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { resolverConclusaoDeLembrete } = require('./completion-from-reminder');

const AGORA = Date.parse('2026-08-16T18:00:00Z');
const ref = (task_id, title, hAtras) => ({ task_id, title, reminded_at: new Date(AGORA - hAtras*3600*1000).toISOString() });

// Caso central: 1 tarefa lembrada há 3h + "feito" solto → resolve exato por id.
test('1 lembrada na janela + "feito" → exato', () => {
  const r = resolverConclusaoDeLembrete({ reply: 'feito', refsRecentes: [ref('t1','Remédios',3)], agoraMs: AGORA });
  assert.strictEqual(r.modo, 'exato');
  assert.strictEqual(r.taskId, 't1');
});

// FREIO 2 (obrigatório): 2 tarefas DISTINTAS lembradas → pergunta, NUNCA por recência.
test('2 tarefas distintas na janela → ambiguo (nunca a mais recente)', () => {
  const r = resolverConclusaoDeLembrete({
    reply: 'feito',
    refsRecentes: [ref('t1','Remédios',1), ref('t2','Bombinha',5)],
    agoraMs: AGORA,
  });
  assert.strictEqual(r.modo, 'ambiguo');
  assert.strictEqual(r.candidatos.length, 2);
});

// Dedup do MESMO id (lembrete repetido) NÃO é ambiguidade.
test('mesmo task_id lembrado 2x → exato (dedup, não ambiguo)', () => {
  const r = resolverConclusaoDeLembrete({
    reply: 'pronto', refsRecentes: [ref('t1','Remédios',1), ref('t1','Remédios',10)], agoraMs: AGORA,
  });
  assert.strictEqual(r.modo, 'exato');
  assert.strictEqual(r.taskId, 't1');
});

test('negação "não fiz" → nenhum (jamais completa contra negação)', () => {
  const r = resolverConclusaoDeLembrete({ reply: 'não fiz ainda', refsRecentes: [ref('t1','x',1)], agoraMs: AGORA });
  assert.strictEqual(r.modo, 'nenhum');
});

test('pergunta "feito?" → nenhum', () => {
  const r = resolverConclusaoDeLembrete({ reply: 'já era pra estar feito?', refsRecentes: [ref('t1','x',1)], agoraMs: AGORA });
  assert.strictEqual(r.modo, 'nenhum');
});

test('fora da janela de 24h → nenhum', () => {
  const r = resolverConclusaoDeLembrete({ reply: 'feito', refsRecentes: [ref('t1','x',30)], agoraMs: AGORA });
  assert.strictEqual(r.modo, 'nenhum');
});

test('sem refs → nenhum', () => {
  assert.strictEqual(resolverConclusaoDeLembrete({ reply: 'feito', refsRecentes: [], agoraMs: AGORA }).modo, 'nenhum');
});

test('reply que não é conclusão ("valeu") → nenhum', () => {
  assert.strictEqual(resolverConclusaoDeLembrete({ reply: 'valeu, tom', refsRecentes: [ref('t1','x',1)], agoraMs: AGORA }).modo, 'nenhum');
});

test('entrada degenerada não quebra', () => {
  assert.strictEqual(resolverConclusaoDeLembrete({}).modo, 'nenhum');
  assert.strictEqual(resolverConclusaoDeLembrete({ reply: 'feito', refsRecentes: null, agoraMs: AGORA }).modo, 'nenhum');
});
