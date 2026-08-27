'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isReproducible, extrairFalasDoUsuario } = require('./shadow-reproducibility');
const { derivarCenario, runShadow } = require('./shadow-runner');

// SHADOW-VERDE-VACUO (27/08). A sonda encenava o REPLAY a partir do `summary` do finding quando o
// evidence não trazia "USUÁRIO:". O summary é PROSA DO AUDITOR sobre o bug — replayar isso faz o
// TOM conversar SOBRE o defeito em vez de repetir o caminho quebrado, e o juiz aprova um turno que
// nunca exercitou nada. Prova viva: finding 62d4dc1c (Rafinha 26/08) tinha evidence = a fala de
// SUCESSO do TOM ("✅ Rafinha, registrei pra quinta") → caiu no fallback → a sonda mandou
// "TOM respondeu errado ao pedido de listar quinta-feira..." como se fosse fala do Rafinha, o TOM
// respondeu "Entendido — e esse é um bug real de comportamento" e o ciclo contabilizou VERIFICADO.
// 91 dos 240 findings corrigidos cairiam nesse fallback. Verde que não prova nada é pior que
// vermelho: mascara. Sem fala literal → inconclusivo, NUNCA aprovado.

const comFala = { category: 'dropped_request', summary: 'TOM respondeu errado ao pedido', evidence: 'USUÁRIO: o que eu tenho pra quinta feira tom\nTOM: não vejo nada' };
const soResumo = { category: 'dropped_request', summary: 'TOM respondeu errado ao pedido de listar quinta-feira, dizendo que não havia nada', evidence: '✅ Rafinha, registrei pra *quinta, 27/08*:\n\n• Carlinho eletricista' };

test('GATE: finding sem fala literal do usuário NÃO é reproduzível (resumo não é fala)', () => {
  const r = isReproducible(soResumo);
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /fala literal/i);
});

test('GATE: com fala literal segue reproduzível (não estreitei demais)', () => {
  assert.strictEqual(isReproducible(comFala).ok, true);
});

test('extrairFalasDoUsuario pega USUÁRIO: e Pessoa:, ignora a fala do TOM', () => {
  const falas = extrairFalasDoUsuario({ evidence: 'USUÁRIO: cria X\nTOM: ✅ criei\nPessoa: e o Y?' });
  assert.deepStrictEqual(falas, ['cria X', 'e o Y?']);
  assert.deepStrictEqual(extrairFalasDoUsuario({ evidence: 'TOM: ✅ registrei' }), []);
  assert.deepStrictEqual(extrairFalasDoUsuario({ evidence: 'USUÁRIO:   ' }), []);
  assert.deepStrictEqual(extrairFalasDoUsuario(null), []);
});

// AUDIT-PROBE-CARIMBO-CEGA-ANCORA bateu de novo, agora no MEU extrator (27/08, achado no dry-run
// do backfill): a evidência real vem carimbada — "[14/08 (sex) 19:56] USUÁRIO: Confirma". O ^ do
// regex fazia o rótulo nunca casar, então findings que TÊM a fala do usuário eram recusados como
// se não tivessem. Mesma armadilha que o pickProbe já tinha levado em 19/08.
test('CARIMBO: "[14/08 (sex) 19:56] USUÁRIO: ..." conta como fala do usuário', () => {
  const ev = '[14/08 (sex) 19:56] USUÁRIO: Confirma\n[14/08 (sex) 19:56] TOM: Opa, perdi o fio aqui';
  assert.deepStrictEqual(extrairFalasDoUsuario({ evidence: ev }), ['Confirma']);
  assert.strictEqual(isReproducible({ category: 'dropped_request', evidence: ev }).ok, true);
});

test('CARIMBO: colchete no MEIO do texto continua sendo conteúdo, não carimbo', () => {
  assert.deepStrictEqual(
    extrairFalasDoUsuario({ evidence: 'USUÁRIO: manda o [relatório] hoje' }),
    ['manda o [relatório] hoje'],
  );
});

test('RUNNER: derivarCenario NUNCA inventa turno a partir do summary', () => {
  assert.strictEqual(derivarCenario(soResumo).turns.length, 0);
  assert.strictEqual(derivarCenario(comFala).turns.length, 1);
  assert.match(derivarCenario(comFala).turns[0].userText, /quinta feira tom/);
});

test('RUNNER: recusa encenar sem fala literal (2ª trava, se o gate for burlado)', async () => {
  const deps = {
    qaPhone: '5500000000001',
    supabase: { from() { return { select() { return this; }, eq() { return this; }, gte() { return this; }, delete() { return this; }, maybeSingle: async () => ({ data: { id: 'qa1', phone: '5500000000001' } }) }; } },
    engine: { processMessage: async () => { throw new Error('o engine NÃO pode ser chamado sem fala real'); } },
    whatsapp: { sendMessage: async () => ({}) },
    turnClaim: { runInTurn: async (_m, fn) => fn() },
  };
  const r = await runShadow(soResumo, deps);
  assert.strictEqual(r.transcript.turns.length, 0);
  assert.match(String(r.erro), /fala literal/i);
});
