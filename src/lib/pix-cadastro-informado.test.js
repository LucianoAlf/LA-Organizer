'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const c = require('./pix-cadastro-informado');

test('reconhece o aviso de cadastro no automático', () => {
  assert.deepStrictEqual(c.detectarCadastroInformado('cadastrei a Ana Lima no pix automático'), { nome: 'Ana Lima' });
  assert.deepStrictEqual(c.detectarCadastroInformado('coloquei o Bruno Sá no PIX automático'), { nome: 'Bruno Sá' });
});

test('verbos com e sem acento continuam casando (nenhum dos cinco tem acento, mas o "automático" aceita os dois jeitos)', () => {
  assert.deepStrictEqual(c.detectarCadastroInformado('passei a Carla no automatico'), { nome: 'Carla' });
  assert.deepStrictEqual(c.detectarCadastroInformado('passei a Carla no automático'), { nome: 'Carla' });
});

test('reconhece "pro automático" e "no pix automático"', () => {
  assert.deepStrictEqual(c.detectarCadastroInformado('cadastrei o Davi pro automático'), { nome: 'Davi' });
  assert.deepStrictEqual(c.detectarCadastroInformado('botei a Elis no pix automático'), { nome: 'Elis' });
  assert.deepStrictEqual(c.detectarCadastroInformado('migrei o Fabio para o automático'), { nome: 'Fabio' });
});

test('caixa livre: reconhece tudo maiúsculo', () => {
  assert.deepStrictEqual(c.detectarCadastroInformado('CADASTREI A ANA LIMA NO PIX AUTOMÁTICO'), { nome: 'ANA LIMA' });
});

test('não casa: menção solta ao pix automático, sem verbo de cadastro', () => {
  assert.strictEqual(c.detectarCadastroInformado('o pix automático é bom'), null);
});

test('não casa: cadastrou em outro lugar que não é o automático', () => {
  assert.strictEqual(c.detectarCadastroInformado('cadastrei a Ana no sistema'), null);
});

test('não casa: falta a palavra automático', () => {
  assert.strictEqual(c.detectarCadastroInformado('cadastrei a Ana'), null);
});

test('não casa: texto vazio ou nulo', () => {
  assert.strictEqual(c.detectarCadastroInformado(''), null);
  assert.strictEqual(c.detectarCadastroInformado(null), null);
  assert.strictEqual(c.detectarCadastroInformado(undefined), null);
});

test('não casa: fala longa demais (mais de 12 palavras) mesmo contendo a estrutura certa', () => {
  const longa = 'eu acho que ontem de manhã eu cadastrei a Ana Lima no pix automático depois do almoço';
  assert.ok(longa.split(/\s+/).length > 12, 'sanity check do próprio caso de teste');
  assert.strictEqual(c.detectarCadastroInformado(longa), null);
});

test('normalizarNome: minúsculas, sem acento, espaços colapsados', () => {
  assert.strictEqual(c.normalizarNome('  Ana   Líma  '), 'ana lima');
  assert.strictEqual(c.normalizarNome('BRUNO SÁ'), 'bruno sa');
  assert.strictEqual(c.normalizarNome(''), '');
});

test('o texto avisa que a confirmação vem da fonte', () => {
  const t = c.textoCadastroInformado('Ana Lima');
  assert.match(t, /Ana Lima/);
  assert.match(t, /confiro (na|no) (fonte|Emusys)/i);
  assert.match(t, /7 dias/);
});

test('texto de não achado pede pra conferir o nome', () => {
  const t = c.textoCadastroNaoAchado('Ana Lima');
  assert.match(t, /Ana Lima/);
  assert.match(t, /[Nn]ão achei/);
});

test('texto de ambiguidade lista os nomes achados separados por " · "', () => {
  const t = c.textoCadastroAmbiguo(['Ana Lima', 'Ana Souza']);
  assert.match(t, /Ana Lima · Ana Souza/);
  assert.match(t, /mais de um/);
});
