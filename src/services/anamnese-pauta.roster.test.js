'use strict';
// QUEM TEM AULA HOJE VEM DO CALENDARIO, NAO DO DIA DA SEMANA (06/09/2026).
//
// Ate hoje `pautaDoDia` deduzia a pauta do horario FIXO do aluno (`aulas_resumo`: "Segunda-feira
// das 15:00..."). Isso ignora feriado, recesso, aula cancelada e reposicao. Medido no feriado de
// 07/09: pelo horario fixo entrariam 148 pessoas nas tres unidades; pelo calendario real, ZERO
// (as 3 aulas do Recreio eram 2 canceladas e 1 sem aluno ligado).
//
// O roster e um Map aluno_id -> {hora, curso}, montado da MESMA fonte que alimenta a Agenda do
// LA Report. A pessoa entra na pauta se QUALQUER um dos ids locais dela estiver no roster.
const { test } = require('node:test');
const assert = require('node:assert');
const { pautaDoDiaPeloRoster } = require('./anamnese-pauta');

const P = (nome, ids) => ({ nome, aluno_ids_locais: ids, aulas_resumo: ['Segunda-feira das 15:00 às 15:50'] });
const R = (pares) => new Map(pares);

test('roster: entra quem tem aula no dia, com a hora e o curso do calendario', () => {
  const r = pautaDoDiaPeloRoster(
    [P('Ana', [10]), P('Bento', [20])],
    R([[10, { hora: '09:00', curso: 'Canto' }]]),
  );
  assert.deepStrictEqual(r.map((x) => [x.pessoa.nome, x.hora, x.curso]), [['Ana', '09:00', 'Canto']]);
});

test('roster: dia sem aula nenhuma devolve lista vazia, mesmo com horario fixo batendo', () => {
  assert.deepStrictEqual(pautaDoDiaPeloRoster([P('Ana', [10]), P('Bento', [20])], R([])), []);
});

test('roster: qualquer um dos ids locais serve — a pessoa pode ter mais de um cadastro', () => {
  const r = pautaDoDiaPeloRoster([P('Ana', [10, 77])], R([[77, { hora: '14:00', curso: 'Bateria' }]]));
  assert.deepStrictEqual(r.map((x) => x.pessoa.nome), ['Ana']);
});

test('roster: sai ordenado por horario, nao pela ordem da consulta', () => {
  const r = pautaDoDiaPeloRoster(
    [P('Tarde', [1]), P('Cedo', [2]), P('Meio', [3])],
    R([[1, { hora: '19:00' }], [2, { hora: '08:00' }], [3, { hora: '13:00' }]]),
  );
  assert.deepStrictEqual(r.map((x) => x.pessoa.nome), ['Cedo', 'Meio', 'Tarde']);
});

test('roster: pessoa sem ids locais nao entra — e nao explode', () => {
  assert.deepStrictEqual(pautaDoDiaPeloRoster([{ nome: 'Sem ids' }], R([[1, { hora: '09:00' }]])), []);
});

test('roster: entrada do roster sem hora nao vira linha torta', () => {
  const r = pautaDoDiaPeloRoster([P('Ana', [10])], R([[10, { curso: 'Canto' }]]));
  assert.deepStrictEqual(r, []);
});

test('roster: roster nulo nao inventa pauta — falha-fechada', () => {
  assert.deepStrictEqual(pautaDoDiaPeloRoster([P('Ana', [10])], null), []);
  assert.deepStrictEqual(pautaDoDiaPeloRoster([P('Ana', [10])], undefined), []);
});
