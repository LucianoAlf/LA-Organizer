'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildBoletoName, isPolicyLike } = require('./boleto-name');

test('veículo presente (não policy-like) vira "Seguro <veículo>", ignora nome completo do veículo', () => {
  const r = buildBoletoName({
    beneficiario: 'HDI Seguros',
    descricao: 'Apólice 145.431.000-12',
    veiculo: 'BYD Dolphin',
  });
  assert.equal(r, 'Seguro BYD Dolphin');
});

test('veículo presente curto também vira "Seguro <veículo>"', () => {
  const r = buildBoletoName({
    beneficiario: 'HDI Seguros',
    descricao: 'Apólice 145.431.000-12',
    veiculo: 'BYD',
  });
  assert.equal(r, 'Seguro BYD');
});

test('sem veículo, descrição menciona "Auto" → "Seguro do carro"', () => {
  const r = buildBoletoName({
    beneficiario: 'HDI Seguros',
    descricao: 'Seguro Auto - Apólice 145',
    veiculo: null,
  });
  assert.equal(r, 'Seguro do carro');
});

test('sem veículo, sem palavra-chave de categoria → cai no insurerShort ("Seguro HDI"), NÃO chuta "do carro"', () => {
  const r = buildBoletoName({
    beneficiario: 'HDI Seguros',
    descricao: 'Apólice 145.431.000-12',
    veiculo: null,
  });
  assert.equal(r, 'Seguro HDI');
});

test('GUARD veículo-apólice: veiculo que é só número de apólice conta como AUSENTE', () => {
  const r = buildBoletoName({
    beneficiario: 'HDI Seguros',
    descricao: 'Apólice 145',
    veiculo: '145431000',
  });
  assert.equal(r, 'Seguro HDI');
});

test('"auto" DENTRO de outra palavra (autorização) NÃO vira "Seguro do carro"', () => {
  const r = buildBoletoName({
    beneficiario: 'Bradesco Seguros',
    descricao: 'Autorização de débito - mensalidade',
    veiculo: null,
  });
  assert.notEqual(r, 'Seguro do carro');
});

test('palavra "vida" isolada → "Seguro de vida"', () => {
  const r = buildBoletoName({
    beneficiario: 'MetLife Seguros',
    descricao: 'Seguro de vida em grupo',
    veiculo: null,
  });
  assert.equal(r, 'Seguro de vida');
});

test('não-seguro com descrição limpa → usa a descrição', () => {
  const r = buildBoletoName({
    beneficiario: 'Enel Distribuição',
    descricao: 'Conta de energia',
    veiculo: null,
  });
  assert.equal(r, 'Conta de energia');
});

test('não-seguro com descrição que É número (policy-like) → cai pro beneficiário', () => {
  const r = buildBoletoName({
    beneficiario: 'Condomínio Ed. Sol',
    descricao: '000123456789012345',
    veiculo: null,
  });
  assert.equal(r, 'Condomínio Ed. Sol');
});

test('tudo vazio/ausente → "Conta a pagar"', () => {
  assert.equal(buildBoletoName({}), 'Conta a pagar');
});

test('GUARD FINAL: nenhum resultado, em nenhum dos casos acima, é policy-like', () => {
  const casos = [
    { beneficiario: 'HDI Seguros', descricao: 'Apólice 145.431.000-12', veiculo: 'BYD Dolphin' },
    { beneficiario: 'HDI Seguros', descricao: 'Apólice 145.431.000-12', veiculo: 'BYD' },
    { beneficiario: 'HDI Seguros', descricao: 'Seguro Auto - Apólice 145', veiculo: null },
    { beneficiario: 'HDI Seguros', descricao: 'Apólice 145.431.000-12', veiculo: null },
    { beneficiario: 'HDI Seguros', descricao: 'Apólice 145', veiculo: '145431000' },
    { beneficiario: 'MetLife Seguros', descricao: 'Seguro de vida em grupo', veiculo: null },
    { beneficiario: 'Enel Distribuição', descricao: 'Conta de energia', veiculo: null },
    { beneficiario: 'Condomínio Ed. Sol', descricao: '000123456789012345', veiculo: null },
    {},
  ];
  for (const c of casos) {
    const r = buildBoletoName(c);
    assert.equal(isPolicyLike(r), false, `resultado "${r}" pareceu apólice pro input ${JSON.stringify(c)}`);
  }

  // Caso adversarial: beneficiário concatena a palavra "Apólice" ANTES de "Seguros".
  // insurerShort só remove a família "seguro/seguros/seguradora" — sozinho isso deixaria
  // "Seguro Apólice 12345" escapar como nome. É exatamente pra isso que existe o guard final.
  const adversarial = buildBoletoName({
    beneficiario: 'Apólice 12345 Seguros',
    descricao: 'seguro',
    veiculo: null,
  });
  assert.equal(adversarial, 'Conta a pagar');
});
