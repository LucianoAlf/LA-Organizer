'use strict';
// pix-numeros-contexto.test.js — bateria em sombra de 28/09 (27 perguntas, todos os membros dos 4
// grupos). Dois defeitos reais:
//  1. No grupo "PIX AUTOMÁTICO L.A" (sem unidade), "Tom, quantas faltam?" e "essas informações
//     aqui estão certas?" — logo depois do relatório de segunda — NÃO liam a fonte: a fala não
//     traz "pix", então o gate barato fechava e o TOM respondia sem os números das unidades.
//     Agora: se a conversa RECENTE do grupo é sobre PIX automático, pergunta de quantidade ou de
//     conferência abre a leitura. Sem esse contexto, continua fechado (boleto da excursão etc.).
//  2. O bloco de números dizia "213 clientes na fonte" (Barra) e o TOM repetia — mas o relatório
//     diz 53: o resto é quem NÃO entra na migração (não mexe, inadimplente…). Agora o total do bloco
//     é a MESMA base do relatório (já migraram + faltam), e o de fora é dito como fora.
const { test } = require('node:test');
const assert = require('node:assert');
const c = require('./pix-consulta');
const f = require('./pix-consulta-fontes');

test('sem contexto de PIX: "quantas faltam?" e "está certo?" continuam SEM ler a fonte', () => {
  assert.strictEqual(c.precisaDeNumeros('Tom, quantas faltam?'), false);
  assert.strictEqual(c.precisaDeNumeros('essas informações aqui estão certas?'), false);
  assert.strictEqual(c.precisaDeNumeros('Tom, quantas faltam?', { assuntoPixRecente: false }), false);
});
test('com PIX na conversa recente: quantidade e conferência abrem a leitura', () => {
  for (const fala of ['Tom, quantas faltam?', 'essas informações aqui estão certas?', 'Tom, isso tá certo?', 'confere esse número?', 'quanto falta?']) {
    assert.strictEqual(c.precisaDeNumeros(fala, { assuntoPixRecente: true }), true, fala);
  }
});
test('com PIX na conversa recente, conversa comum continua sem ler a fonte', () => {
  for (const fala of ['bom dia, time', 'cria uma tarefa pra Rose amanhã', 'obrigado Tom']) {
    assert.strictEqual(c.precisaDeNumeros(fala, { assuntoPixRecente: true }), false, fala);
  }
});
test('assuntoPixRecente(history): olha só as últimas mensagens', () => {
  assert.strictEqual(c.assuntoPixRecente([{ content: '💠 *PIX automático — semana de 21 a 27/09*' }, { content: 'Esse relatório está certo?' }]), true);
  assert.strictEqual(c.assuntoPixRecente([{ content: 'bom dia' }]), false);
  const velho = [{ content: 'PIX automático' }, ...Array.from({ length: 12 }, () => ({ content: 'outra coisa' }))];
  assert.strictEqual(c.assuntoPixRecente(velho), false);
  assert.strictEqual(c.assuntoPixRecente(null), false);
});

test('grupo sem unidade + PIX recente: "quantas faltam?" lê as três unidades e não intercepta', async () => {
  let leu = 0;
  const r = await f.atenderPedidoNoGrupo({
    unidadeId: null, unidadeNome: 'PIX AUTOMÁTICO L.A', text: 'Tom, quantas faltam?', hoje: '2026-09-28',
    postar: async () => { throw new Error('não posta'); }, assuntoPixRecente: true,
    deps: { numerosDeTodasUnidades: async () => { leu++; return [{ unidadeNome: 'Barra', pix: { total: 213, ja_migrou: 10, faltam: 43, bloqueado_emusys: 10 }, anamnese: { pendentes: 1, base: 2 }, contrato: { pendentes: 1, base: 2 } }]; } },
  });
  assert.strictEqual(leu, 1);
  assert.strictEqual(r.tratou, false);
  assert.match(r.numerosContext, /Barra — PIX autom[áa]tico: 53 na migração · já migraram 10 · faltam migrar 43/);
});

const PIX = { total: 213, ja_migrou: 10, faltam: 43, migrar: 37, autorizacao_pendente: 6, bloqueado_emusys: 10, fatias: {}, nao_mexe: 155, inadimplente: 1, nao_pagante: 3, excecao: 1, outras: 0 };
test('bloco de uma unidade: total = base do relatório (53), nunca o total cru da fonte (213)', () => {
  const b = c.blocoDeNumeros({ unidadeNome: 'Barra', pix: PIX, anamnese: { pendentes: 1, base: 2 }, contrato: { pendentes: 1, base: 2 } });
  assert.match(b, /PIX automático: 53 clientes na migração \(a mesma base do relatório de segunda\) · já migraram 10 · faltam migrar 43/);
  assert.ok(!/213/.test(b), b);
  assert.match(b, /Fora da migração \(NÃO entram em nenhuma conta\)/);
});
test('bloco das três: total geral pela base da migração e pedido de resposta organizada por unidade', () => {
  const b = c.blocoDeNumerosTodasUnidades({ unidades: [
    { unidadeNome: 'Campo Grande', pix: { ...PIX, total: 372, ja_migrou: 14, faltam: 224 }, anamnese: { pendentes: 0, base: 1 }, contrato: { pendentes: 0, base: 1 } },
    { unidadeNome: 'Barra', pix: PIX, anamnese: { pendentes: 0, base: 1 }, contrato: { pendentes: 0, base: 1 } },
  ] });
  assert.match(b, /Campo Grande — PIX automático: 238 na migração · já migraram 14 · faltam migrar 224/);
  assert.match(b, /TOTAL — PIX automático: 291 na migração · já migraram 24 · faltam migrar 267/);
  assert.ok(!/372|213/.test(b), b);
  assert.match(b, /uma linha por unidade/);
});
