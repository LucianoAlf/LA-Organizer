'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ancorarEvidencia } = require('./conversation-audit');
const { extrairFalasDoUsuario } = require('../governance/shadow-reproducibility');

// AUDIT-EVIDENCE-ANCORA-NA-FALA-DO-TOM (27/08). O auditor grava no `evidence` a linha do TOM —
// normalmente a de SUCESSO — em vez do turno do usuário que falhou. Dois estragos:
//   1. a sonda não consegue encenar (91 de 240 findings corrigidos não têm fala do usuário) e
//      caía no replay do resumo, que era verde vácuo (ver shadow-vacuidade.test.js);
//   2. quem re-verifica lendo só o evidence vê o TOM funcionando e fecha como falso positivo.
// Caso real 62d4dc1c (Rafinha 26/08): evidence = "✅ Rafinha, registrei pra quinta, 27/08:" — a
// fala de sucesso. A pergunta que falhou ("O que eu tenho pra quinta feira tom") não estava lá.
//
// Fix determinístico: o auditor já acerta QUAL mensagem do TOM é (é o que ancora o incident_at);
// o CÓDIGO usa isso pra recuperar o turno do usuário imediatamente anterior. LLM diz onde, código
// busca o quê. Se não achar, devolve null — nunca fabrica.

function sbCom(msgs) {
  return {
    from() {
      return {
        select() { return this; }, eq() { return this; }, gte() { return this; },
        order() { return this; },
        limit: async () => ({ data: msgs }),
      };
    },
  };
}
// A query real ordena created_at DESC — índice 0 é a mais nova.
const CONVERSA = [
  { created_at: '2026-08-26T15:48:00Z', direction: 'outbound', content: 'pra quinta 27/08 não vejo nada cadastrado' },
  { created_at: '2026-08-26T15:47:00Z', direction: 'inbound', content: 'O que eu tenho pra quinta feira tom' },
  { created_at: '2026-08-26T14:31:00Z', direction: 'outbound', content: '✅ Rafinha, registrei pra quinta, 27/08: Carlinho, Charles, Léo' },
  { created_at: '2026-08-26T14:30:00Z', direction: 'inbound', content: 'Quinta feira tom: Carlinho eletricista, Charles led, Léo marcenaria' },
];

test('CASO 62d4dc1c: evidence na fala do TOM recupera o turno do USUÁRIO anterior', async () => {
  const out = await ancorarEvidencia(sbCom(CONVERSA), 'c1', '✅ Rafinha, registrei pra quinta, 27/08: Carlinho, Charles, Léo', '2026-08-25T00:00:00Z');
  assert.ok(out, 'devia ancorar');
  assert.match(out, /^USUÁRIO: Quinta feira tom/m);
  assert.match(out, /^TOM: ✅ Rafinha, registrei/m);
});

test('a evidência ancorada é encenável pela sonda (é o objetivo do fix)', async () => {
  const out = await ancorarEvidencia(sbCom(CONVERSA), 'c1', 'pra quinta 27/08 não vejo nada cadastrado', '2026-08-25T00:00:00Z');
  const falas = extrairFalasDoUsuario({ evidence: out });
  assert.deepStrictEqual(falas, ['O que eu tenho pra quinta feira tom']);
});

test('evidence que JÁ tem fala do usuário não é tocada (cirúrgico: só os 91)', async () => {
  const ok = 'USUÁRIO: cria X\nTOM: ✅ criei';
  assert.strictEqual(await ancorarEvidencia(sbCom(CONVERSA), 'c1', ok, '2026-08-25T00:00:00Z'), null);
});

test('se a âncora é o próprio turno do usuário, pega a resposta do TOM em seguida', async () => {
  const out = await ancorarEvidencia(sbCom(CONVERSA), 'c1', 'O que eu tenho pra quinta feira tom', '2026-08-25T00:00:00Z');
  assert.match(out, /^USUÁRIO: O que eu tenho pra quinta feira tom/m);
  assert.match(out, /^TOM: pra quinta 27\/08 não vejo nada/m);
});

test('NÃO fabrica: sem casar a âncora, ou sem turno de usuário antes, devolve null', async () => {
  assert.strictEqual(await ancorarEvidencia(sbCom(CONVERSA), 'c1', 'texto que não existe na conversa xyzw', '2026-08-25T00:00:00Z'), null);
  const soTom = [{ created_at: '2026-08-26T10:00:00Z', direction: 'outbound', content: 'mensagem proativa do TOM sozinha' }];
  assert.strictEqual(await ancorarEvidencia(sbCom(soTom), 'c1', 'mensagem proativa do TOM sozinha', '2026-08-25T00:00:00Z'), null);
});

test('PROATIVA: turno do usuário distante no tempo NÃO vira evidência (achado no dry-run)', async () => {
  // O achado `e4a434b2` (proactive_overreach) ancorou numa fala de 5h antes, sobre outro assunto:
  // mensagem proativa não TEM turno que a disparou. Colar o inbound anterior fabrica um nexo.
  const proativa = [
    { created_at: '2026-08-26T14:00:00Z', direction: 'outbound', content: '👻 Higiene de tarefas: encontrei 4 tarefas paradas' },
    { created_at: '2026-08-26T09:00:00Z', direction: 'inbound', content: 'Haha, pai brabo é pai orgulhoso' },
  ];
  assert.strictEqual(await ancorarEvidencia(sbCom(proativa), 'c1', '👻 Higiene de tarefas: encontrei 4 tarefas paradas', '2026-08-25T00:00:00Z'), null);
});

test('PROATIVA: turno próximo (mesma troca) continua ancorando', async () => {
  const perto = [
    { created_at: '2026-08-26T14:00:00Z', direction: 'outbound', content: 'não vejo nada cadastrado pra quinta' },
    { created_at: '2026-08-26T13:52:00Z', direction: 'inbound', content: 'o que eu tenho pra quinta' },
  ];
  const out = await ancorarEvidencia(sbCom(perto), 'c1', 'não vejo nada cadastrado pra quinta', '2026-08-25T00:00:00Z');
  assert.match(String(out), /^USUÁRIO: o que eu tenho pra quinta/m);
});

test('entrada lixo / banco vazio não quebra', async () => {
  assert.strictEqual(await ancorarEvidencia(sbCom([]), 'c1', 'qualquer coisa aqui', '2026-08-25T00:00:00Z'), null);
  assert.strictEqual(await ancorarEvidencia(sbCom(CONVERSA), 'c1', '', '2026-08-25T00:00:00Z'), null);
  assert.strictEqual(await ancorarEvidencia(sbCom(CONVERSA), 'c1', null, '2026-08-25T00:00:00Z'), null);
  const quebrado = { from() { return { select() { return this; }, eq() { return this; }, gte() { return this; }, order() { return this; }, limit: async () => { throw new Error('boom'); } }; } };
  assert.strictEqual(await ancorarEvidencia(quebrado, 'c1', 'qualquer coisa aqui', '2026-08-25T00:00:00Z'), null);
});
