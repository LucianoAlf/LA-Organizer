'use strict';
// pix-consulta.test.js — camada PURA da consulta de lista/números nos grupos.
// Caso real (Alf, 17/09): Campo Grande pediu no grupo a lista completa do PIX avulso e o TOM
// respondeu "consigo mandar só os que estão aparecendo aqui na lista de hoje". Estes testes
// prendem o contrário: a fala é reconhecida, o alvo é o certo, e a lista sai quebrada em partes.
const { test } = require('node:test');
const assert = require('node:assert');
const c = require('./pix-consulta');

// ── detectarPedido: frases reais ──────────────────────────────────────────────────────────────
test('frase real do caso: "me manda a lista completa do pix avulso" -> lista de pix_avulso', () => {
  assert.deepStrictEqual(c.detectarPedido('me manda a lista completa do pix avulso'),
    { tipo: 'lista', alvo: 'pix_avulso' });
});

test('"quantos faltam de contrato?" -> números de contrato', () => {
  assert.deepStrictEqual(c.detectarPedido('quantos faltam de contrato?'),
    { tipo: 'numeros', alvo: 'contrato' });
});

test('"manda o resto dos nomes" (sem assunto) -> lista, alvo padrão pix', () => {
  assert.deepStrictEqual(c.detectarPedido('manda o resto dos nomes'), { tipo: 'lista', alvo: 'pix' });
});

test('"quantos clientes de cheque a gente tem?" -> números de cheque', () => {
  assert.deepStrictEqual(c.detectarPedido('quantos clientes de cheque a gente tem?'),
    { tipo: 'numeros', alvo: 'cheque' });
});

test('"bom dia" -> null (o LLM atende normal)', () => {
  assert.strictEqual(c.detectarPedido('bom dia'), null);
  assert.strictEqual(c.detectarPedido(''), null);
  assert.strictEqual(c.detectarPedido(null), null);
});

test('assunto de outra natureza não vira pedido: "quem falta assinar o ponto hoje de manhã?" -> null', () => {
  assert.strictEqual(c.detectarPedido('quem falta assinar o ponto hoje de manha?'), null);
});

test('"quem falta?" curto e seco -> lista do pix (é a lista que o TOM publica no grupo)', () => {
  assert.deepStrictEqual(c.detectarPedido('quem falta?'), { tipo: 'lista', alvo: 'pix' });
});

test('citar o assunto sem pedir nada não vira pedido: "o pix automático tá indo bem" -> null', () => {
  assert.strictEqual(c.detectarPedido('o pix automatico ta indo bem'), null);
});

test('cada fatia tem o seu alvo, e "maquininha" não vira pix_avulso', () => {
  const alvo = (t) => (c.detectarPedido(t) || {}).alvo;
  assert.strictEqual(alvo('quantos de boleto?'), 'boleto');
  assert.strictEqual(alvo('quantos pagam em dinheiro?'), 'dinheiro');
  assert.strictEqual(alvo('lista completa de cartão falhando'), 'cartao_com_falha');
  assert.strictEqual(alvo('lista completa da maquininha'), 'cartao_avulso');
  // "cartão avulso" contém "avulso": sem a precedência, a mesma fala casaria pix_avulso também
  // e o alvo desandava pra 'pix' (lista errada no grupo).
  assert.strictEqual(alvo('lista completa de cartão avulso'), 'cartao_avulso');
  assert.strictEqual(alvo('quantos sem histórico?'), 'sem_historico');
  assert.strictEqual(alvo('quantos cadastrados sem cobrança?'), 'autorizacao_pendente');
  assert.strictEqual(alvo('quantos já migraram?'), 'ja_migrou');
  assert.strictEqual(alvo('quantos faltam de anamnese?'), 'anamnese');
  assert.strictEqual(alvo('me manda a lista de quem falta no pix'), 'pix');
});

test('fala que pede NOME e QUANTIDADE ao mesmo tempo vira lista (mandar os nomes já responde quantos são)', () => {
  assert.deepStrictEqual(c.detectarPedido('me manda a lista completa do pix avulso e quantos são no total'),
    { tipo: 'lista', alvo: 'pix_avulso' });
});

test('assuntos de famílias diferentes na mesma fala -> tudo', () => {
  assert.deepStrictEqual(c.detectarPedido('quantos faltam de anamnese e de contrato?'),
    { tipo: 'numeros', alvo: 'tudo' });
});

// ── precisaDeNumeros: gate barato (não lê a fonte em toda mensagem) ───────────────────────────
test('precisaDeNumeros só liga quando a fala cita os assuntos ou quantidade', () => {
  assert.strictEqual(c.precisaDeNumeros('quantos faltam?'), true);
  assert.strictEqual(c.precisaDeNumeros('e a anamnese, como tá?'), true);
  assert.strictEqual(c.precisaDeNumeros('o contrato da Ana já voltou'), true);
  assert.strictEqual(c.precisaDeNumeros('bom dia, time'), false);
  assert.strictEqual(c.precisaDeNumeros('cria uma tarefa pra Rose amanhã'), false);
});

// ── mensagensDaLista: quebra em partes ────────────────────────────────────────────────────────
const itens = (n) => Array.from({ length: n }, (_, i) => ({ pagador: `Pagador ${i + 1}`, alunos: [`Aluno ${i + 1}`] }));
const base = { unidadeNome: 'Campo Grande', titulo: 'Pix avulso' };

test('0 itens: uma mensagem só, dizendo que não há ninguém (nunca silêncio)', () => {
  const ms = c.mensagensDaLista({ ...base, itens: [] });
  assert.strictEqual(ms.length, 1);
  assert.match(ms[0], /\(0 clientes\)/);
  assert.match(ms[0], /Ninguém/);
});

test('1 item: uma mensagem, cabeçalho com unidade e contagem, item no formato • Pagador — Alunos', () => {
  const ms = c.mensagensDaLista({ ...base, itens: [{ pagador: 'Ana Lima', alunos: ['Rafa', 'Bia'] }] });
  assert.strictEqual(ms.length, 1);
  assert.strictEqual(ms[0], '💠 *Pix avulso — Campo Grande* (1 clientes) — parte 1/1\n• Ana Lima — Rafa, Bia');
});

test('item sem aluno não deixa travessão solto', () => {
  const ms = c.mensagensDaLista({ ...base, itens: [{ pagador: 'Ana Lima', alunos: [] }] });
  assert.ok(ms[0].endsWith('• Ana Lima'), ms[0]);
});

test('45 itens cabem em UMA mensagem; 46 viram DUAS (45 + 1)', () => {
  const a = c.mensagensDaLista({ ...base, itens: itens(45) });
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].split('\n• ').length - 1, 45);
  const b = c.mensagensDaLista({ ...base, itens: itens(46) });
  assert.strictEqual(b.length, 2);
  assert.strictEqual(b[0].split('\n• ').length - 1, 45);
  assert.strictEqual(b[1].split('\n• ').length - 1, 1);
  assert.match(b[0], /parte 1\/2/);
  assert.match(b[1], /parte 2\/2/);
  assert.match(b[0], /\(46 clientes\)/);
});

test('400 itens: teto de 8 mensagens, e a última DIZ quantos ficaram de fora', () => {
  const ms = c.mensagensDaLista({ ...base, itens: itens(400) });
  assert.strictEqual(ms.length, 8);
  const mostrados = ms.reduce((s, m) => s + (m.split('\n• ').length - 1), 0);
  assert.strictEqual(mostrados, 360);
  assert.match(ms[7], /40 de fora/);
  assert.match(ms[7], /painel/);
  assert.ok(!/de fora/.test(ms[0]), 'só a última fala do que ficou de fora');
});

test('sem sobra, nenhuma mensagem fala em "de fora"', () => {
  for (const m of c.mensagensDaLista({ ...base, itens: itens(90) })) assert.ok(!/de fora/.test(m));
});

test('limitePorMensagem é injetável (o teste não depende do default)', () => {
  const ms = c.mensagensDaLista({ ...base, itens: itens(5), limitePorMensagem: 2 });
  assert.strictEqual(ms.length, 3);
  assert.match(ms[2], /parte 3\/3/);
});

// ── blocoDeNumeros ────────────────────────────────────────────────────────────────────────────
const PIX_ZERO = {
  total: 0, migrar: 0, autorizacao_pendente: 0, ja_migrou: 0, aguardando_cobranca: 0,
  nao_mexe: 0, inadimplente: 0, nao_pagante: 0, excecao: 0, outras: 0, faltam: 0,
  fatias: { pix_avulso: 0, cheque: 0, boleto: 0, dinheiro: 0, cartao_com_falha: 0, cartao_avulso: 0, sem_historico: 0, autorizacao_pendente: 0 },
};

test('bloco com ZERO em tudo: todos os assuntos aparecem com 0, nada some', () => {
  const b = c.blocoDeNumeros({
    unidadeNome: 'Barra', pix: PIX_ZERO,
    anamnese: { pendentes: 0, base: 0 }, contrato: { pendentes: 0, base: 0 },
    dadoEm: '2026-09-17T09:00:00Z',
  });
  assert.match(b, /Barra/);
  assert.match(b, /PIX autom[áa]tico: 0 clientes/);
  assert.match(b, /faltam migrar 0/);
  assert.match(b, /Anamnese: 0 pendentes de 0/);
  assert.match(b, /Contrato: 0 pendentes de 0/);
  // Fatia com zero NÃO entra na linha: "🟡 Boleto 0 · 🟡 Dinheiro 0 · …" é ruído que empurra o
  // bloco pra fora do teto de linhas e esconde a fatia que tem gente.
  assert.match(b, /Fatias de quem falta: nenhuma/);
  assert.ok(b.split('\n').filter((l) => l.trim()).length <= 12, 'no máximo ~12 linhas');
  assert.match(b, /Nunca estime/);
});

test('bloco com números reais traz TODAS as fatias com gente, em ordem de prioridade', () => {
  const b = c.blocoDeNumeros({
    unidadeNome: 'Campo Grande',
    pix: { ...PIX_ZERO, total: 373, migrar: 225, autorizacao_pendente: 6, ja_migrou: 7, nao_mexe: 113, nao_pagante: 14, inadimplente: 8, faltam: 231,
      fatias: { ...PIX_ZERO.fatias, autorizacao_pendente: 6, pix_avulso: 161, cheque: 15, boleto: 8, cartao_com_falha: 13, cartao_avulso: 9, dinheiro: 1, sem_historico: 18 } },
    anamnese: { pendentes: 40, base: 344 }, contrato: { pendentes: 12, base: 344 },
    dadoEm: '2026-09-17T09:00:00Z',
  });
  assert.match(b, /faltam migrar 231/);
  assert.match(b, /Pix avulso 161/);
  assert.match(b, /Anamnese: 40 pendentes de 344/);
  assert.match(b, /Contrato: 12 pendentes de 344/);
  const fatiasLinha = b.split('\n').find((l) => l.startsWith('Fatias'));
  assert.ok(fatiasLinha.indexOf('Pix avulso') < fatiasLinha.indexOf('Cheque'), 'ordem de prioridade das FATIAS');
  assert.ok(!/Boleto 0|Dinheiro 0/.test(fatiasLinha), 'fatia zerada não entra na linha');
});

test('fonte do PIX fora: o bloco DIZ que não leu e proíbe número — nunca inventa', () => {
  const b = c.blocoDeNumeros({
    unidadeNome: 'Barra', pix: null,
    anamnese: { pendentes: 3, base: 10 }, contrato: { pendentes: 1, base: 10 },
    dadoEm: null, motivo: 'PIX: timeout',
  });
  assert.match(b, /não consegui ler/i);
  assert.ok(!/faltam migrar/.test(b), 'sem número de PIX inventado');
  assert.match(b, /Anamnese: 3 pendentes de 10/);
});

test('situação dos alunos fora: anamnese e contrato dizem que não leram', () => {
  const b = c.blocoDeNumeros({ unidadeNome: 'Barra', pix: PIX_ZERO, anamnese: null, contrato: null, dadoEm: null });
  assert.ok(!/Anamnese: \d/.test(b));
  assert.ok(!/Contrato: \d/.test(b));
  assert.match(b, /não consegui ler/i);
});

// ── tituloDoAlvo ──────────────────────────────────────────────────────────────────────────────
test('tituloDoAlvo usa o rótulo já existente de cada fatia', () => {
  assert.strictEqual(c.tituloDoAlvo('pix_avulso'), 'Pix avulso');
  assert.strictEqual(c.tituloDoAlvo('cartao_avulso'), 'Maquininha');
  assert.strictEqual(c.tituloDoAlvo('anamnese'), 'Anamnese pendente');
  assert.strictEqual(c.tituloDoAlvo('contrato'), 'Contrato pendente');
  assert.strictEqual(c.tituloDoAlvo('ja_migrou'), 'Já migraram');
  assert.match(c.tituloDoAlvo('pix'), /PIX autom/);
  assert.match(c.tituloDoAlvo('tudo'), /PIX autom/);
});

test('textos fixos existem e não são vazios (o TOM nunca responde com silêncio)', () => {
  assert.ok(c.TEXTO_SEM_UNIDADE.length > 10);
  assert.match(c.TEXTO_SEM_UNIDADE, /unidade/i);
  assert.ok(c.TEXTO_FONTE_FORA.length > 10);
  assert.match(c.TEXTO_FONTE_FORA, /LA Report/);
});
