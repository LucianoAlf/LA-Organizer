'use strict';
// pix-cartao-cadastrado.test.js — 💳 na pauta, na lista e no painel (Alf, 28/09).
// 💳 = cartão recorrente cadastrado no Emusys, mas a última mensalidade foi por PIX (29 em 28/09,
// fora os 🔒). A equipe corria atrás de quem talvez já esteja no cartão. Mesma regra dos 🔒: vão pro
// FIM da fila (depois dos livres, antes dos 🔒), NINGUÉM SOME, e cada lugar diz o que fazer: conferir
// no Emusys.
const { test } = require('node:test');
const assert = require('node:assert');
const p = require('./pix-migracao');
const f = require('./pix-consulta-fontes');
const c = require('./pix-consulta');
const painel = require('./pix-painel');
const { resolverUnidade } = require('./situacao-aluno');
const { buildGroupChatPrompt } = require('./group-chat-prompt');

const BARRA = resolverUnidade('barra');
const L = (o) => ({ pagador_chave: `k-${o.pagador_nome}`, alunos: [], matriculas: [1], categoria: 'migrar', fatia: 'pix_avulso', forma_ultima_mensalidade: 'Pix', cobranca_automatica_cadastrada: null, dado_atualizado_em: '2026-09-28T09:00:00Z', ...o });
const livre = (n) => L({ pagador_nome: n });
const cartao = (n) => L({ pagador_nome: n, cobranca_automatica_cadastrada: 'Cartão de Crédito' });
const preso = (n) => L({ pagador_nome: n, matriculas: [1, 2] });
const semInterruptor = async (fn) => {
  const antes = process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  delete process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  try { return await fn(); } finally { if (antes !== undefined) process.env.TOM_PIX_BLOQUEIO_EMUSYS = antes; }
};

test('fila: livres, depois 💳, depois 🔒', () => semInterruptor(() => {
  const o = p.ordenarPorPrioridade([preso('A Presa'), cartao('B Cartão'), livre('C Livre')]).map((l) => l.pagador_nome);
  assert.deepStrictEqual(o, ['C Livre', 'B Cartão', 'A Presa']);
}));
test('lote do dia: com livres sobrando, nenhum 💳 entra', () => semInterruptor(() => {
  const lote = p.loteDoDia([cartao('Z Cartão'), ...Array.from({ length: 12 }, (_, i) => livre(`L${i}`))]);
  assert.ok(!lote.some((l) => l.pagador_nome === 'Z Cartão'));
}));
test('nomeComMarca: 💳 no nome (🔒 tem precedência)', () => semInterruptor(() => {
  assert.strictEqual(p.nomeComMarca(cartao('Ana')), 'Ana 💳');
  assert.strictEqual(p.nomeComMarca(L({ pagador_nome: 'Bia', matriculas: [1, 2], cobranca_automatica_cadastrada: 'Cartão de Crédito' })), 'Bia 🔒');
}));

test('pauta: linha 💳 diz quantos e o que fazer; sem 💳 nada muda', () => semInterruptor(() => {
  const todas = [livre('Ana'), cartao('Bia'), cartao('Caio')];
  const t = p.mensagemDaUnidade({ unidadeNome: 'Barra', linhas: todas, lote: p.loteDoDia(todas) });
  assert.match(t, /💳 Cartão cadastrado, pagando PIX \(2\) — conferir no Emusys: se já está no cartão, sai da lista quando a cobrança passar\. Vão pro fim da fila\./);
  assert.match(t, /faltam 3/, '💳 continua contado');
  const sem = p.mensagemDaUnidade({ unidadeNome: 'Barra', linhas: [livre('Ana')], lote: [livre('Ana')] });
  assert.ok(!/💳/.test(sem));
}));

const deps = { rpcPix: async () => ({ data: [livre('Ana'), cartao('Bia'), preso('Caio')], error: null }), rpcSituacao: async () => ({ data: [], error: null }), retry: (fn) => fn(), hoje: '2026-09-28' };
test('lista: seção 💳 própria entre os livres e os 🔒; a forma diz os dois', () => semInterruptor(async () => {
  const r = await f.mensagensDaListaPix({ unidadeId: BARRA, unidadeNome: 'Barra', alvos: ['pix'], deps });
  const t = r.msgs.join('\n');
  assert.match(t, /\n🔴 \*Pix avulso\* \(1\) · \+1 💳 \+1 🔒 no fim\n   • Ana\n\n💳 \*Cartão cadastrado, pagando PIX\* \(1\) — conferir no Emusys[^\n]*\n   • Bia\n\n🔒 \*Aguardando o Emusys\* \(1\)/);
  assert.strictEqual(r.total, 3);
}));
test('painel: seção 💳 com nota, e a forma conta os 💳 e os 🔒 dela', () => semInterruptor(() => {
  const d = painel.montarPainel([livre('Ana'), cartao('Bia'), preso('Caio')], { unidadeNome: 'Barra' });
  assert.deepStrictEqual(d.faltamSecoes.map((s) => [s.chave, s.n]), [['pix_avulso', 1], ['cartao_cadastrado', 1], ['bloqueio_emusys', 1]]);
  assert.match(d.faltamSecoes[1].nota, /conferir no Emusys/);
  assert.strictEqual(d.faltamSecoes[0].cartao, 1);
  assert.match(d.faltamSecoes[0].nota, /mais 1 em 💳/);
  assert.match(d.faltamSecoes[0].nota, /mais 1 em 🔒/);
  assert.strictEqual(d.cartaoCadastrado, 1);
}));
test('números pro TOM: diz quantos 💳 e o que significam', () => {
  const b = c.blocoDeNumeros({ unidadeNome: 'Barra', pix: { total: 3, ja_migrou: 0, faltam: 3, migrar: 3, autorizacao_pendente: 0, bloqueado_emusys: 1, cartao_cadastrado: 1, fatias: {} }, anamnese: { pendentes: 0, base: 1 }, contrato: { pendentes: 0, base: 1 } });
  assert.match(b, /1 têm cartão recorrente cadastrado mas pagaram por PIX \(💳\) — conferir no Emusys/);
});
test('prompt do grupo explica o 💳 (o LLM não inventa)', () => {
  const pr = buildGroupChatPrompt({ soulText: '', groupName: 'X', members: [], pool: [], history: [], senderName: 'Y' });
  assert.match(pr, /💳 = cartão recorrente cadastrado no Emusys/);
});
