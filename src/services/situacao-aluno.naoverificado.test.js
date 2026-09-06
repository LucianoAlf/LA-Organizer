'use strict';
// QUEM NAO DEU PRA CONFERIR NAO PODE SUMIR (06/09).
//
// `nao_verificado` e `dispensado` nunca entram na cobranca — certo, dado incompleto nao vira
// acusacao. So que ate aqui eles tambem nao apareciam em lugar NENHUM: quem nao deu pra conferir
// ficava identico a quem nao existe. E a familia "zero por falha igual a zero por saude", agora
// no grao da pessoa.
//
// Caso real do dia: Davi Lima Queiroz (Recreio) e Ana Luiza Marques Paiva (Campo Grande) saem
// como `nao_verificado` na RPC — e as matriculas dos dois vieram `contrato_assinado=true` na
// reconciliacao das 05:00. Os dois tem cadastro local duplicado. Ninguem nunca ia descobrir isso
// olhando a mensagem do grupo, porque eles simplesmente nao estavam nela.
const { test } = require('node:test');
const assert = require('node:assert');
const { naoVerificadosDeContrato } = require('./situacao-aluno');

const P = (nome, status, fresco = true) => ({
  nome, contrato_assinatura_status: status, contrato_dado_fresco: fresco,
});

test('devolve so quem esta nao_verificado', () => {
  const r = naoVerificadosDeContrato([
    P('Assinado', 'assinado'), P('Davi', 'nao_verificado'),
    P('Nao assinado', 'nao_assinado'), P('Ana Luiza', 'nao_verificado'),
  ]);
  assert.deepStrictEqual(r.map((p) => p.nome), ['Davi', 'Ana Luiza']);
});

test('dispensado NAO entra: ele e uma resposta, nao uma duvida', () => {
  assert.deepStrictEqual(naoVerificadosDeContrato([P('Coral', 'dispensado')]), []);
});

test('status ausente conta como nao verificado — na duvida, aparece', () => {
  const r = naoVerificadosDeContrato([{ nome: 'Sem campo' }]);
  assert.deepStrictEqual(r.map((p) => p.nome), ['Sem campo']);
});

test('lista vazia ou nula nao explode', () => {
  assert.deepStrictEqual(naoVerificadosDeContrato([]), []);
  assert.deepStrictEqual(naoVerificadosDeContrato(null), []);
});
