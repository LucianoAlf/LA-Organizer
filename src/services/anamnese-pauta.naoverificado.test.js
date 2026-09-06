'use strict';
// O BLOCO DE CONTRATO PRECISA DIZER QUEM ELE NAO CONSEGUIU CONFERIR (06/09).
const { test } = require('node:test');
const assert = require('node:assert');
const { mensagemDoGrupo } = require('./anamnese-pauta');

const it = (nome, hora) => ({ pessoa: { nome }, hora, curso: 'Teclado' });
const BASE = { itens: [it('Ana', '08:00')], unidadeNome: 'Barra', dataBr: 'ter 08/09', comContrato: true };

test('com pendencia E nao conferido: os dois numeros aparecem, separados', () => {
  const m = mensagemDoGrupo({ ...BASE, contrato: [it('Bento', '09:00')], contratoNaoConferidos: 2 });
  assert.match(m, /1 aluno com aula hoje ainda sem contrato assinado/);
  assert.match(m, /2 .*não consegui conferir/i);
});

test('ZERO pendencia mas alguem nao conferido: o bloco SAI mesmo assim', () => {
  const m = mensagemDoGrupo({ ...BASE, contrato: [], contratoNaoConferidos: 2 });
  assert.match(m, /Contrato/, 'o bloco sumiu — ausencia se le como "todo mundo assinou"');
  assert.match(m, /2 .*não consegui conferir/i);
  assert.doesNotMatch(m, /ainda sem contrato assinado/, 'nao ha pendente: nao invente numero');
});

test('zero pendencia e zero nao conferido continua silencio', () => {
  const m = mensagemDoGrupo({ ...BASE, contrato: [], contratoNaoConferidos: 0 });
  assert.doesNotMatch(m, /Contrato/);
});

test('o aviso NAO acusa: nao diz que estao sem contrato, diz que nao conferiu', () => {
  const m = mensagemDoGrupo({ ...BASE, contrato: [], contratoNaoConferidos: 1 });
  assert.doesNotMatch(m, /1 aluno com aula hoje ainda sem contrato/);
  assert.match(m, /não consegui conferir/i);
});

test('erro na leitura continua tendo precedencia sobre o aviso de nao conferido', () => {
  const m = mensagemDoGrupo({ ...BASE, contrato: [], contratoErro: 'timeout', contratoNaoConferidos: 5 });
  assert.match(m, /Não consegui conferir contrato agora/);
  assert.doesNotMatch(m, /5 /, 'com a fonte fora do ar o numero de nao conferidos nao significa nada');
});
