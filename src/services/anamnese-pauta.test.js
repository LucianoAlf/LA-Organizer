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

// Resíduo 1: como o degrau 3 agora FICA na pauta, ele precisa de marca própria — sem ela se lê
// idêntico a quem está na 1ª vez, e a equipe repete a abordagem que já falhou duas vezes. Quem
// lê é a secretaria: o texto diz o que mudou (o caminho agora é o link, não lembrar na aula).
test('título da filha: 3ª vez fica na pauta, marcada, dizendo pra mandar o link', () => {
  const item = { pessoa: { nome: 'Alice Cagnin' }, hora: '14:00', curso: 'Canto' };
  assert.strictEqual(tituloDaFilha(item, 2),
    '14:00 Anamnese — Alice Cagnin (Canto) ⚠️ 3ª semana sem preencher — mande o link da anamnese');
  assert.strictEqual(tituloDaFilha(item, 4),
    '14:00 Anamnese — Alice Cagnin (Canto) ⚠️ 5ª semana sem preencher — mande o link da anamnese',
    'o número acompanha o histórico: `falhas` é o que já foi gravado ANTES da aparição de hoje');
});

// Os dois leitores de título (_extrairNomeDaFilha em rituals/anamnese-pauta.js e o bloco da fala
// no dispatcher) cortam o nome no primeiro ' (' ou ' ⚠'. Se a marca do degrau 3 não começasse
// por ' ⚠', o nome vazaria sujo pro zap das 07:30 e pro fechamento da noite — que decide
// done/cancelled comparando NOME. Trava aqui, no ponto onde o texto nasce.
test('a marca do degrau 3 começa por " ⚠" — é o que os leitores de título cortam', () => {
  const semCurso = { pessoa: { nome: 'Alice Cagnin' }, hora: '14:00', curso: null };
  const t = tituloDaFilha(semCurso, 2);
  assert.ok(t.startsWith('14:00 Anamnese — Alice Cagnin ⚠'), `título inesperado: ${t}`);
});

test('título da escalada diz quantas semanas', () => {
  assert.strictEqual(tituloDaEscalada({ nome: 'Alice Cagnin' }, 2),
    'Mandar link da anamnese — Alice Cagnin (2 semanas sem preencher)');
  assert.strictEqual(tituloDaEscalada({ nome: 'Alice Cagnin' }, 4),
    'Mandar link da anamnese — Alice Cagnin (4 semanas sem preencher)');
});

// A pauta do dia é descartável; a escalada é dívida. Mas separar SÓ vale quando existe pra onde
// mandar quem sai — e não existe.
//
// CORREÇÃO 04/09 (resíduo 1): a expectativa deste teste era `pauta: ['Ana','Bia']`, travando um
// comportamento errado. A tarefa "Mandar link da anamnese" que tomaria o lugar do Cid é a FATIA
// 2: `tituloDaEscalada` só aparece em teste e `escaladosItens` não é consumido por ninguém.
// Então, na prática, a partir da 3ª aparição o aluno simplesmente DESAPARECIA da pauta, sem
// substituto — é o "12 de 43" que a spec proíbe. A expectativa mudou; nenhum assert foi
// enfraquecido (este teste ganhou asserts, não perdeu).
test('degrau 3 CONTINUA na pauta e também sai em escalados — ninguém some sem substituto', () => {
  const itens = [
    { pessoa: { nome: 'Ana', pessoa_chave: 'pk1' }, hora: '09:00', curso: 'Canto' },
    { pessoa: { nome: 'Bia', pessoa_chave: 'pk2' }, hora: '10:00', curso: 'Canto' },
    { pessoa: { nome: 'Cid', pessoa_chave: 'pk3' }, hora: '11:00', curso: 'Canto' },
  ];
  const mapa = new Map([['pk1', 0], ['pk2', 1], ['pk3', 2]]);
  const r = separarPorDegrau(itens, mapa);
  assert.deepStrictEqual(r.pauta.map((x) => x.pessoa.nome), ['Ana', 'Bia', 'Cid'],
    'enquanto a fatia 2 não existe, tirar da pauta é fazer sumir justamente quem mais precisa');
  assert.deepStrictEqual(r.escalados.map((x) => x.pessoa.nome), ['Cid'],
    'a lista da fatia 2 continua pronta — ela não vai precisar mudar comportamento de novo');
  assert.strictEqual(r.escalados[0].falhas, 2, 'a escalada leva o número junto pro título');
  assert.deepStrictEqual(r.pauta.map((x) => x.falhas), [0, 1, 2], 'cada item leva o próprio histórico');
});

// O contador da mensagem das 07:30 (mensagemDoGrupo, abaixo) conta `pauta`. Com o degrau 3 fora
// dela, a partir da 2ª semana o zap subnotificava o total do dia — número mentindo pra equipe.
test('a pauta conta TODO mundo do dia — o total do zap das 07:30 volta a bater', () => {
  const itens = [
    { pessoa: { nome: 'Ana', pessoa_chave: 'pk1' }, hora: '09:00', curso: 'Canto' },
    { pessoa: { nome: 'Bia', pessoa_chave: 'pk2' }, hora: '10:00', curso: 'Canto' },
    { pessoa: { nome: 'Cid', pessoa_chave: 'pk3' }, hora: '11:00', curso: 'Canto' },
  ];
  const mapa = new Map([['pk1', 5], ['pk2', 9], ['pk3', 2]]);   // todo mundo no degrau 3
  const r = separarPorDegrau(itens, mapa);
  assert.strictEqual(r.pauta.length, itens.length, 'unidade inteira no degrau 3 não pode virar pauta vazia');
  assert.strictEqual(r.escalados.length, itens.length);
});

test('sem mapa de falhas, todo mundo é 1ª vez — nunca escala no escuro', () => {
  const itens = [{ pessoa: { nome: 'Ana', pessoa_chave: 'pk1' }, hora: '09:00', curso: 'Canto' }];
  const r = separarPorDegrau(itens, null);
  assert.strictEqual(r.pauta.length, 1);
  assert.strictEqual(r.escalados.length, 0);
});

// ── A mensagem do grupo (Task 4) ────────────────────────────────────────────────────────────
const { mensagemDoGrupo } = require('./anamnese-pauta');

const ITENS = [
  { pessoa: { nome: 'Arthur Bezerra' }, hora: '08:00', curso: 'Bateria' },
  { pessoa: { nome: 'Maria Isabel' }, hora: '09:00', curso: 'Canto' },
  { pessoa: { nome: 'Davi Reis' }, hora: '09:00', curso: 'Canto' },
  { pessoa: { nome: 'Alice Cagnin' }, hora: '14:00', curso: 'Canto' },
];

test('a mensagem diz o número e SÓ os primeiros horários', () => {
  const m = mensagemDoGrupo({ itens: ITENS, unidadeNome: 'Recreio', dataBr: 'qua 10/09' });
  assert.match(m, /4 alunos/);
  assert.match(m, /qua 10\/09/);
  assert.match(m, /08:00 Arthur Bezerra/);
  // quem tem aula às 14h não precisa aparecer às 7h30
  assert.doesNotMatch(m, /Alice Cagnin/, 'só os 3 primeiros — 43 nomes ninguém lê num zap');
  assert.match(m, /painel/, 'aponta pro painel, onde a lista inteira está');
});

test('singular quando é um só', () => {
  const m = mensagemDoGrupo({ itens: [ITENS[0]], unidadeNome: 'Barra', dataBr: 'sáb 13/09' });
  assert.match(m, /1 aluno com aula hoje/);
  assert.doesNotMatch(m, /alunos/);
});

test('pauta vazia não gera mensagem — dia limpo é silêncio, não spam', () => {
  assert.strictEqual(mensagemDoGrupo({ itens: [], unidadeNome: 'Recreio', dataBr: 'dom 14/09' }), null);
});

// A copy foi desenhada e aprovada com o dono do produto — só um assert.match em fragmento
// deixaria passar uma edição futura que trocasse o '·' por vírgula ou derrubasse o emoji.
// Trava a string INTEIRA do caso de 4 itens do brief, byte a byte.
test('a mensagem trava a copy aprovada — string inteira, byte a byte', () => {
  const m = mensagemDoGrupo({ itens: ITENS, unidadeNome: 'Recreio', dataBr: 'qua 10/09' });
  assert.strictEqual(m,
    '📋 *Anamnese — hoje (qua 10/09)*\n'
    + '4 alunos com aula hoje ainda sem anamnese.\n'
    + 'Os primeiros: 08:00 Arthur Bezerra · 09:00 Maria Isabel · 09:00 Davi Reis\n'
    + 'A lista completa está no painel do grupo.');
});

test('item torto (sem pessoa ou sem hora) não derruba a mensagem nem vaza "undefined"', () => {
  const itens = [
    { hora: '08:00', curso: 'Bateria' }, // sem pessoa — não pode lançar TypeError
    { pessoa: { nome: 'Sem Hora' }, curso: 'Canto' }, // sem hora — não pode virar "undefined" no texto
  ];
  assert.doesNotThrow(() => mensagemDoGrupo({ itens, unidadeNome: 'Recreio', dataBr: 'qua 10/09' }));
  const m = mensagemDoGrupo({ itens, unidadeNome: 'Recreio', dataBr: 'qua 10/09' });
  assert.doesNotMatch(m, /undefined/);
});
