'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { diaDaAula, horaDaAula, pautaDoDia } = require('./anamnese-pauta');

const P = (nome, aulas) => ({ nome, pessoa_chave: 'pk-' + nome, aulas_resumo: aulas });

test('diaDaAula lê o dia da semana do texto da RPC', () => {
  assert.strictEqual(diaDaAula('Canto — Segunda-feira 19:00'), 1);
  assert.strictEqual(diaDaAula('Bateria — Terça 17:00'), 2);
  assert.strictEqual(diaDaAula('Canto — Sábado 11:00'), 6);
  assert.strictEqual(diaDaAula('Violão — 19:00'), null, 'sem dia no texto não chuta');
});

test('horaDaAula lê o horário', () => {
  assert.strictEqual(horaDaAula('Canto — Segunda-feira 19:00'), '19:00');
  assert.strictEqual(horaDaAula('Bateria — Sábado 09:00'), '09:00');
  assert.strictEqual(horaDaAula('Canto — Segunda'), null);
});

test('pautaDoDia traz só quem tem aula NAQUELE dia', () => {
  const r = pautaDoDia([
    P('Alice', ['Canto — Segunda-feira 19:00']),
    P('Bento', ['Bateria — Terça 17:00']),
  ], 1);
  assert.deepStrictEqual(r.map((x) => x.pessoa.nome), ['Alice']);
});

// A lista se lê na ordem em que o dia acontece — é o que a transforma em roteiro.
test('pautaDoDia ordena por horário, não por nome', () => {
  const r = pautaDoDia([
    P('Zeca', ['Canto — Quarta 20:00']),
    P('Ana', ['Canto — Quarta 08:00']),
    P('Bia', ['Canto — Quarta 14:00']),
  ], 3);
  assert.deepStrictEqual(r.map((x) => x.pessoa.nome), ['Ana', 'Bia', 'Zeca']);
  assert.deepStrictEqual(r.map((x) => x.hora), ['08:00', '14:00', '20:00']);
});

test('aluno com aula em dois dias aparece nos dois — são duas chances', () => {
  const p = P('Duda', ['Canto — Segunda 10:00', 'Bateria — Quinta 16:00']);
  assert.strictEqual(pautaDoDia([p], 1).length, 1);
  assert.strictEqual(pautaDoDia([p], 4).length, 1);
  assert.strictEqual(pautaDoDia([p], 2).length, 0);
});

test('duas aulas no MESMO dia viram uma entrada, na primeira hora', () => {
  const p = P('Ravi', ['Canto — Terça 09:00', 'Bateria — Terça 15:00']);
  const r = pautaDoDia([p], 2);
  assert.strictEqual(r.length, 1, 'uma linha por aluno por dia, não uma por aula');
  assert.strictEqual(r[0].hora, '09:00', 'a primeira aula é quando ele chega na escola');
});

test('sem aulas ou sem horário legível fica de fora, sem quebrar', () => {
  assert.deepStrictEqual(pautaDoDia([P('X', [])], 1), []);
  assert.deepStrictEqual(pautaDoDia([P('Y', ['Canto — Segunda'])], 1), []);
  assert.deepStrictEqual(pautaDoDia(null, 1), []);
});

test('o curso viaja junto, pra aparecer no título da filha', () => {
  const r = pautaDoDia([P('Alice', ['Canto — Segunda-feira 19:00'])], 1);
  assert.strictEqual(r[0].curso, 'Canto');
});

// ── A escada e os títulos (Task 3) ──────────────────────────────────────────────────────────
const { degrau, tituloDaFilha, tituloDaEscalada, separarPorDegrau } = require('./anamnese-pauta');

test('degrau: 0 falhas é 1ª vez, 1 falha é 2ª, 2+ é escalada', () => {
  assert.strictEqual(degrau(0), 1);
  assert.strictEqual(degrau(1), 2);
  assert.strictEqual(degrau(2), 3);
  assert.strictEqual(degrau(9), 3);
  assert.strictEqual(degrau(undefined), 1, 'sem histórico é 1ª vez');
});

test('título da filha: 1ª vez é limpo, 2ª carrega a marca', () => {
  const item = { pessoa: { nome: 'Alice Cagnin' }, hora: '14:00', curso: 'Canto' };
  assert.strictEqual(tituloDaFilha(item, 0), '14:00 Anamnese — Alice Cagnin (Canto)');
  assert.strictEqual(tituloDaFilha(item, 1),
    '14:00 Anamnese — Alice Cagnin (Canto) ⚠️ 2ª semana — não preencheu na anterior');
});

test('título da escalada diz quantas semanas', () => {
  assert.strictEqual(tituloDaEscalada({ nome: 'Alice Cagnin' }, 2),
    'Mandar link da anamnese — Alice Cagnin (2 semanas sem preencher)');
  assert.strictEqual(tituloDaEscalada({ nome: 'Alice Cagnin' }, 4),
    'Mandar link da anamnese — Alice Cagnin (4 semanas sem preencher)');
});

// A pauta do dia é descartável; a escalada é dívida. Elas não podem se misturar.
test('separarPorDegrau tira o degrau 3 da pauta', () => {
  const itens = [
    { pessoa: { nome: 'Ana', pessoa_chave: 'pk1' }, hora: '09:00', curso: 'Canto' },
    { pessoa: { nome: 'Bia', pessoa_chave: 'pk2' }, hora: '10:00', curso: 'Canto' },
    { pessoa: { nome: 'Cid', pessoa_chave: 'pk3' }, hora: '11:00', curso: 'Canto' },
  ];
  const mapa = new Map([['pk1', 0], ['pk2', 1], ['pk3', 2]]);
  const r = separarPorDegrau(itens, mapa);
  assert.deepStrictEqual(r.pauta.map((x) => x.pessoa.nome), ['Ana', 'Bia']);
  assert.deepStrictEqual(r.escalados.map((x) => x.pessoa.nome), ['Cid']);
  assert.strictEqual(r.escalados[0].falhas, 2, 'a escalada leva o número junto pro título');
});

test('sem mapa de falhas, todo mundo é 1ª vez — nunca escala no escuro', () => {
  const itens = [{ pessoa: { nome: 'Ana', pessoa_chave: 'pk1' }, hora: '09:00', curso: 'Canto' }];
  const r = separarPorDegrau(itens, null);
  assert.strictEqual(r.pauta.length, 1);
  assert.strictEqual(r.escalados.length, 0);
});
