'use strict';
// saveReturnComment NUNCA GRAVOU NADA (achado do gov-agent, 06/09; raiz medida no mesmo dia).
//
// Dois defeitos empilhados, e o segundo escondeu o primeiro por meses:
//   1. o CHECK de task_comments.comment_type nao aceitava 'return' — o banco recusava toda
//      insercao (1.236 linhas na tabela, TODAS 'agent_note', zero devolutiva na historia);
//   2. `await supabase.from().insert()` do PostgREST NAO LANCA: devolve {error}. O codigo so
//      tinha try/catch, entao o catch nunca foi acionado e nada foi logado. Erro nao lido e
//      erro que nao existe.
// A constraint foi corrigida por migration; este teste trava o lado do codigo — se o banco
// recusar de novo (valor novo, coluna nova), tem que APARECER.
const { test } = require('node:test');
const assert = require('node:assert');
const { saveReturnComment } = require('./task-return');

function fakeSupabase(resposta) {
  const inseridos = [];
  return {
    inseridos,
    from: () => ({ insert: async (dados) => { inseridos.push(dados); return resposta; } }),
  };
}
// async de verdade: restaurar o console no `finally` SINCRONO devolveria o console antes de a
// promessa resolver, e o teste ficaria verde sem ter capturado nada.
async function semBarulho(fn) {
  const avisos = [];
  const antes = console.warn;
  console.warn = (...a) => avisos.push(a.join(' '));
  try { const r = await fn(); return { r, avisos }; } finally { console.warn = antes; }
}

test('devolutiva grava com comment_type return', async () => {
  const sb = fakeSupabase({ error: null });
  await saveReturnComment({ supabase: sb, taskId: 't1', authorId: 'c1', note: 'feito' });
  assert.strictEqual(sb.inseridos.length, 1);
  assert.strictEqual(sb.inseridos[0].comment_type, 'return');
  assert.strictEqual(sb.inseridos[0].content, 'feito');
});

test('erro do banco NAO passa calado — ele vem em {error}, nao por excecao', async () => {
  const sb = fakeSupabase({ error: { message: 'violates check constraint' } });
  const { avisos } = await semBarulho(() => saveReturnComment({
    supabase: sb, taskId: 't1', authorId: 'c1', note: 'feito',
  }));
  assert.ok(avisos.some((a) => /check constraint/.test(a)),
    `o erro do banco sumiu; avisos=${JSON.stringify(avisos)}`);
});

test('excecao de rede continua sendo nao-fatal, mas tambem aparece', async () => {
  const sb = { from: () => ({ insert: async () => { throw new Error('rede caiu'); } }) };
  const { avisos } = await semBarulho(() => saveReturnComment({
    supabase: sb, taskId: 't1', authorId: 'c1', note: 'feito',
  }));
  assert.ok(avisos.some((a) => /rede caiu/.test(a)));
});

test('nota vazia nao vira linha', async () => {
  const sb = fakeSupabase({ error: null });
  await saveReturnComment({ supabase: sb, taskId: 't1', authorId: 'c1', note: '   ' });
  assert.strictEqual(sb.inseridos.length, 0);
});
