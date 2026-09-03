'use strict';
// A sonda rodava e não provava nada: "sem fala literal do usuário no evidence (resumo do finding
// NÃO é fala)" — 0 aprovados, 0 reprovados, 3 inconclusivos em 03/09. O evidence é prosa do
// AUDITOR e parafraseia: em 08/08 ele dizia USUÁRIO: "Confirmado" e o literal em
// conversation_history era "Siim" — detectUserConfirmation dava yes pro primeiro e null pro
// segundo, e essa diferença ERA o bug inteiro. Encenar paráfrase testa o caminho errado.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  falasDoIncidente, resolverFalas, avaliarReprodutibilidade, isReproducible,
} = require('./shadow-reproducibility');

// supabase de mentira, encadeável, que devolve o que a gente mandar
function fakeSb(porTabela) {
  return {
    from(tabela) {
      const api = {};
      ['select', 'eq', 'gte', 'lte', 'order', 'limit'].forEach((m) => { api[m] = () => api; });
      api.then = (res) => Promise.resolve(porTabela[tabela] || { data: [], error: null }).then(res);
      return api;
    },
  };
}

const F11 = {
  category: 'confabulation', collaborator_id: 'c1', incident_at: '2026-09-02T22:42:00Z',
  evidence: '[02/09 19:42] USUÁRIO: Confirmado\nTOM: ✅ Concluí',
};

test('falasDoIncidente busca o inbound da janela no 1:1', async () => {
  const sb = fakeSb({
    conversation_history: { data: [{ content: 'Siim' }, { content: 'Foi' }], error: null },
  });
  assert.deepStrictEqual(await falasDoIncidente({ supabase: sb, finding: F11 }), ['Siim', 'Foi']);
});

// O caso de 08/08, que é a razão de existir deste fix.
test('o LITERAL do banco vence a PARÁFRASE do evidence', async () => {
  const sb = fakeSb({ conversation_history: { data: [{ content: 'Siim' }], error: null } });
  const r = await resolverFalas({ supabase: sb, finding: F11 });
  assert.deepStrictEqual(r.falas, ['Siim'], 'o evidence dizia "Confirmado" — encenar isso testa outro caminho');
  assert.strictEqual(r.fonte, 'conversation_history');
});

test('sem nada no banco, cai no evidence (não se perde o que já funcionava)', async () => {
  const sb = fakeSb({ conversation_history: { data: [], error: null } });
  const r = await resolverFalas({ supabase: sb, finding: F11 });
  assert.deepStrictEqual(r.falas, ['Confirmado']);
  assert.strictEqual(r.fonte, 'evidence');
});

// Fail-closed: erro de leitura NÃO pode virar fala inventada nem verde vazio.
test('erro de leitura no banco não inventa fala — cai no evidence', async () => {
  const sb = fakeSb({ conversation_history: { data: null, error: { message: 'boom' } } });
  assert.deepStrictEqual((await resolverFalas({ supabase: sb, finding: F11 })).falas, ['Confirmado']);
});

test('sem banco E sem fala no evidence continua inconclusivo', async () => {
  const sb = fakeSb({ conversation_history: { data: [], error: null } });
  const f = { ...F11, evidence: 'O TOM afirmou conclusão sem executar.' }; // prosa pura do auditor
  const r = await avaliarReprodutibilidade({ supabase: sb, finding: f });
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /sem fala literal/);
  assert.deepStrictEqual(r.falas, []);
});

test('finding de GRUPO busca em group_chat_messages', async () => {
  const sb = fakeSb({ group_chat_messages: { data: [{ content: 'Tom, conclui as 3' }], error: null } });
  const f = { ...F11, collaborator_id: null, group_id: 'g1' };
  assert.deepStrictEqual(await falasDoIncidente({ supabase: sb, finding: f }), ['Tom, conclui as 3']);
});

test('teto de 3 falas: fica com as ÚLTIMAS, que é onde o bug mora', async () => {
  const sb = fakeSb({
    conversation_history: { data: [1, 2, 3, 4, 5].map((n) => ({ content: 'fala ' + n })), error: null },
  });
  assert.deepStrictEqual(await falasDoIncidente({ supabase: sb, finding: F11 }),
    ['fala 3', 'fala 4', 'fala 5']);
});

test('sem instante ou sem supabase devolve vazio, nunca chute', async () => {
  assert.deepStrictEqual(await falasDoIncidente({ supabase: null, finding: F11 }), []);
  assert.deepStrictEqual(await falasDoIncidente({
    supabase: fakeSb({}), finding: { collaborator_id: 'c1', category: 'confabulation' },
  }), []);
});

// As travas que já existiam continuam de pé — o portão não foi afrouxado.
test('categoria fora do escopo e cenário multi-turno seguem recusados', async () => {
  const sb = fakeSb({ conversation_history: { data: [{ content: 'Siim' }], error: null } });
  const fora = await avaliarReprodutibilidade({ supabase: sb, finding: { ...F11, category: 'frustration' } });
  assert.strictEqual(fora.ok, false);
  assert.match(fora.motivo, /fora do escopo/);

  const multi = await avaliarReprodutibilidade({
    supabase: sb, finding: { ...F11, evidence: 'USUÁRIO: manda a fatura em lote' },
  });
  assert.strictEqual(multi.ok, false);
  assert.match(multi.motivo, /multi-turno/);
});

test('o gate síncrono antigo continua exportado e intacto', () => {
  assert.strictEqual(typeof isReproducible, 'function');
  assert.strictEqual(isReproducible({ category: 'confabulation', evidence: 'prosa sem fala' }).ok, false);
  assert.strictEqual(isReproducible(F11).ok, true);
});

test('gate async devolve as falas pro runner encenar as MESMAS', async () => {
  const sb = fakeSb({ conversation_history: { data: [{ content: 'Siim' }], error: null } });
  const r = await avaliarReprodutibilidade({ supabase: sb, finding: F11 });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.falas, ['Siim']);
  assert.match(r.motivo, /conversation_history/);
});
