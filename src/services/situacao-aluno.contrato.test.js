'use strict';
// O RECORTE 'contrato' PASSOU A MEDIR ASSINATURA (06/09/2026).
//
// Ate 05/09 o criterio era `!tem_data_contrato` — data DERIVADA da primeira aula, que nasce com
// a matricula e nao sabe nada sobre assinatura. Medido na RPC com a reconciliacao do dia: no
// Recreio o criterio velho apontava 79 pessoas e o certo aponta 7. Seriam 72 acusacoes indevidas
// no primeiro dia. Na Barra ele errava pro outro lado: 90 contra 109 pendencias reais.
//
// O caso 'assinado sem data' abaixo e o guarda dessas 72: se alguem reintroduzir
// `tem_data_contrato` no criterio, ele fica vermelho.
const { test } = require('node:test');
const assert = require('node:assert');
const { filtrarPorRecorte } = require('./situacao-aluno');

const P = (nome, extra = {}) => Object.assign({
  nome, classificacao: 'EMLA', anamnese_preenchida: true, tem_instagram: true,
  instagram_nao_possui: false, comunidade_status: 'na_comunidade',
  tem_data_contrato: true, tem_foto: true, tem_telefone: true,
  contrato_assinatura_status: 'assinado', contrato_dado_fresco: true,
}, extra);

const nomes = (arr) => filtrarPorRecorte(arr, 'contrato').map((p) => p.nome);

test('contrato: cobra nao_assinado e sem_contrato, com dado fresco', () => {
  const pessoas = [
    P('Assinado'),
    P('Nao assinado', { contrato_assinatura_status: 'nao_assinado' }),
    P('Sem contrato', { contrato_assinatura_status: 'sem_contrato' }),
  ];
  assert.deepStrictEqual(nomes(pessoas), ['Nao assinado', 'Sem contrato']);
});

test('contrato: nao_verificado e dispensado NUNCA sao cobrados', () => {
  const pessoas = [
    P('Nao verificado', { contrato_assinatura_status: 'nao_verificado' }),
    P('Dispensado', { contrato_assinatura_status: 'dispensado' }),
  ];
  assert.deepStrictEqual(nomes(pessoas), []);
});

test('contrato: sem reconciliacao fresca do dia, ninguem e cobrado', () => {
  const pessoas = [
    P('Nao assinado hoje nao conferido', {
      contrato_assinatura_status: 'nao_assinado', contrato_dado_fresco: false,
    }),
    P('Sem contrato hoje nao conferido', {
      contrato_assinatura_status: 'sem_contrato', contrato_dado_fresco: false,
    }),
  ];
  assert.deepStrictEqual(nomes(pessoas), []);
});

test('contrato: assinado SEM data de contrato nao e cobrado (as 72 do Recreio)', () => {
  const pessoas = [P('Assinado sem data', { tem_data_contrato: false })];
  assert.deepStrictEqual(nomes(pessoas), []);
});

test('contrato: nao assinado COM data de contrato e cobrado', () => {
  const pessoas = [P('Nao assinado com data', {
    tem_data_contrato: true, contrato_assinatura_status: 'nao_assinado',
  })];
  assert.deepStrictEqual(nomes(pessoas), ['Nao assinado com data']);
});

test('contrato: status ausente no payload nao vira cobranca', () => {
  const pessoas = [P('Sem o campo', { contrato_assinatura_status: undefined })];
  assert.deepStrictEqual(nomes(pessoas), []);
});
