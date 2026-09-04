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
//
// SEM contrato no dia, a mensagem tem que sair IDÊNTICA à que o dono aprovou em 04/09 — é esta
// asserção que prova que o bloco novo não mexeu no bloco antigo. Se algum dia ela quebrar junto
// com a de baixo, quem mexeu mudou o bloco de anamnese sem querer.
test('a mensagem trava a copy aprovada — string inteira, byte a byte', () => {
  const m = mensagemDoGrupo({ itens: ITENS, unidadeNome: 'Recreio', dataBr: 'qua 10/09' });
  assert.strictEqual(m,
    '📋 *Anamnese — hoje (qua 10/09)*\n'
    + '4 alunos com aula hoje ainda sem anamnese.\n'
    + 'Os primeiros: 08:00 Arthur Bezerra · 09:00 Maria Isabel · 09:00 Davi Reis\n'
    + 'A lista completa está no painel do grupo.\n'
    + '\n'
    + 'De hora em hora eu aviso aqui quem chega na hora seguinte.');
});

// ── O BLOCO DE CONTRATO (pedido do Alf, 04/09) ───────────────────────────────────────────────
// "anamnese e contrato sem assinar são duas demandas extremamente importantes que precisam ser
// colocadas ali de forma separada. Não pode vir dentro do mesmo bolo, tem que estar separadinho."
const CONTRATO = [
  { pessoa: { nome: 'Arthur Bezerra' }, hora: '08:00', curso: 'Bateria' },
  { pessoa: { nome: 'Bento Alves' }, hora: '11:00', curso: 'Violão' },
];

test('a copy dos DOIS blocos, byte a byte — separados por linha em branco', () => {
  const m = mensagemDoGrupo({
    itens: ITENS, contrato: CONTRATO, unidadeNome: 'Recreio', dataBr: 'qua 10/09',
  });
  assert.strictEqual(m,
    '📋 *Anamnese — hoje (qua 10/09)*\n'
    + '4 alunos com aula hoje ainda sem anamnese.\n'
    + 'Os primeiros: 08:00 Arthur Bezerra · 09:00 Maria Isabel · 09:00 Davi Reis\n'
    + 'A lista completa está no painel do grupo.\n'
    + '\n'
    + '✍️ *Contrato — hoje (qua 10/09)*\n'
    + '2 alunos com aula hoje ainda sem data de contrato.\n'
    + 'Hoje: 08:00 Arthur Bezerra · 11:00 Bento Alves\n'
    + '\n'
    + 'De hora em hora eu aviso aqui quem chega na hora seguinte.');
});

test('dia sem pendência de contrato NÃO imprime bloco de contrato', () => {
  const m = mensagemDoGrupo({ itens: ITENS, contrato: [], unidadeNome: 'Recreio', dataBr: 'qua 10/09' });
  assert.doesNotMatch(m, /Contrato/, 'bloco vazio não aparece');
  // e o que sobra é exatamente a mensagem de sempre
  assert.strictEqual(m, mensagemDoGrupo({ itens: ITENS, unidadeNome: 'Recreio', dataBr: 'qua 10/09' }));
});

// A regra da casa: nunca afirmar número que não foi medido. Bloco AUSENTE se lê como "hoje não
// tem ninguém sem contrato" — uma afirmação. Fonte fora tem que DIZER que está fora.
test('fonte de contrato fora NÃO vira zero — diz que não conseguiu conferir', () => {
  const m = mensagemDoGrupo({
    itens: ITENS, contrato: [], contratoErro: 'timeout', unidadeNome: 'Recreio', dataBr: 'qua 10/09',
  });
  assert.match(m, /✍️ \*Contrato — hoje \(qua 10\/09\)\*/, 'o bloco aparece mesmo sem lista');
  assert.match(m, /não consegui conferir/i);
  assert.doesNotMatch(m, /0 alunos/, 'nunca um zero que ninguém mediu');
});

test('contrato longo corta nos primeiros e ensina a pedir a lista inteira', () => {
  const muitos = ['Ana', 'Bia', 'Caio', 'Duda', 'Elis'].map((nome, i) => ({
    pessoa: { nome }, hora: `${String(9 + i).padStart(2, '0')}:00`, curso: 'Canto',
  }));
  const m = mensagemDoGrupo({ itens: ITENS, contrato: muitos, unidadeNome: 'Recreio', dataBr: 'qua 10/09' });
  assert.match(m, /5 alunos com aula hoje ainda sem data de contrato/);
  assert.match(m, /Os primeiros: 09:00 Ana · 10:00 Bia · 11:00 Caio/);
  assert.doesNotMatch(m, /Duda/, 'contrato usa o mesmo teto do bloco de anamnese');
  // Contrato NÃO tem painel (a pauta não cria tarefa de contrato — spec §8), então o único
  // caminho pra lista inteira é pedir pro TOM. Se a mensagem não ensinar, ninguém descobre.
  assert.match(m, /me peça|me pede|pedir/i, 'quando corta, tem que dizer como ver o resto');
});

test('item torto no bloco de contrato não vaza "undefined" nem derruba a mensagem', () => {
  const tortos = [{ hora: '08:00' }, { pessoa: { nome: 'Sem Hora' } }];
  assert.doesNotThrow(() => mensagemDoGrupo({ itens: ITENS, contrato: tortos, dataBr: 'qua 10/09' }));
  const m = mensagemDoGrupo({ itens: ITENS, contrato: tortos, dataBr: 'qua 10/09' });
  assert.doesNotMatch(m, /undefined/);
});

// O cabeçalho da mensagem é a CHAVE da guarda de duplicata do dispatcher
// (`texto.split('\n')[0]` + `like('content', cabecalho%)`). Se o bloco de contrato mudasse a
// primeira linha, a guarda ficaria cega e a mensagem poderia sair duas vezes num grupo real.
test('o bloco de contrato NÃO muda a primeira linha — a guarda de duplicata depende dela', () => {
  const semC = mensagemDoGrupo({ itens: ITENS, dataBr: 'qua 10/09' }).split('\n')[0];
  const comC = mensagemDoGrupo({ itens: ITENS, contrato: CONTRATO, dataBr: 'qua 10/09' }).split('\n')[0];
  const comErro = mensagemDoGrupo({ itens: ITENS, contratoErro: 'x', dataBr: 'qua 10/09' }).split('\n')[0];
  assert.strictEqual(comC, semC);
  assert.strictEqual(comErro, semC);
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

// ── O RELATÓRIO DE FIM DE DIA (pedido do Alf, 04/09) ─────────────────────────────────────────
// "no final do dia ele manda uma lista do que foi feito ali no dia. Alunos que tiveram na escola
// e não preencheram a anamnese. 'Semana que vem eu vou lembrar de novo.'"
const { mensagemDeFimDeDia } = require('./anamnese-pauta');

const FALTOU = (nome, hora) => ({ pessoa: { nome }, hora });

test('a copy do fim de dia com as duas metades — string inteira, byte a byte', () => {
  const m = mensagemDeFimDeDia({
    preencheram: 9,
    faltaram: [FALTOU('Maria Isabel', '09:00'), FALTOU('Davi Reis', '11:00'),
      FALTOU('Alice Cagnin', '14:00'), FALTOU('Bento Alves', '18:00')],
    dataBr: 'sex 04/09',
  });
  assert.strictEqual(m,
    '🌙 *Anamnese — como foi hoje (sex 04/09)*\n'
    + 'Hoje 9 dos 13 alunos da pauta preencheram a anamnese.\n'
    + 'Faltaram 4, começando por: 09:00 Maria Isabel · 11:00 Davi Reis · 14:00 Alice Cagnin\n'
    + 'A lista de hoje ainda está no painel do grupo.\n'
    + 'Semana que vem eu lembro de novo — eles voltam na pauta no próximo dia de aula deles.');
});

test('lista curta de faltantes sai INTEIRA, sem apontar pro painel', () => {
  const m = mensagemDeFimDeDia({
    preencheram: 9, faltaram: [FALTOU('Maria Isabel', '09:00'), FALTOU('Davi Reis', '11:00')],
    dataBr: 'sex 04/09',
  });
  assert.match(m, /Faltaram 2: 09:00 Maria Isabel · 11:00 Davi Reis/);
  assert.doesNotMatch(m, /começando por/);
  assert.doesNotMatch(m, /painel/, 'com todo mundo na tela, apontar pro painel é ruído');
  assert.match(m, /Semana que vem eu lembro de novo/);
});

test('dia bom é dito como dia bom — ninguém faltou', () => {
  const m = mensagemDeFimDeDia({ preencheram: 23, faltaram: [], dataBr: 'sex 04/09' });
  assert.match(m, /Dia bom/);
  assert.match(m, /os 23 alunos da pauta preencheram/);
  // Sem faltante não existe promessa de semana que vem: não há a quem prometer.
  assert.doesNotMatch(m, /Semana que vem/);
});

test('ninguém preencheu — sem número inventado e sem falso ânimo', () => {
  const m = mensagemDeFimDeDia({
    preencheram: 0, faltaram: [FALTOU('Ana', '09:00'), FALTOU('Bia', '10:00')], dataBr: 'sex 04/09',
  });
  assert.match(m, /nenhum dos 2 alunos da pauta preencheu/);
  assert.doesNotMatch(m, /Dia bom/);
  assert.match(m, /Semana que vem eu lembro de novo/);
});

// A regra que vale em toda a casa: número que não foi medido não sai. Fonte fora tem que virar
// "não consegui apurar", nunca um relatório de zeros fingindo saúde.
test('fonte fora NÃO vira relatório de zeros — diz que não apurou', () => {
  const m = mensagemDeFimDeDia({ preencheram: 0, faltaram: [], erro: 'timeout', dataBr: 'sex 04/09' });
  assert.match(m, /não consegui/i);
  assert.doesNotMatch(m, /0 /, 'zero nenhum na cara da equipe quando não se mediu nada');
  assert.doesNotMatch(m, /Dia bom/);
});

test('pauta vazia hoje é silêncio, não relatório', () => {
  assert.strictEqual(mensagemDeFimDeDia({ preencheram: 0, faltaram: [], dataBr: 'dom 06/09' }), null);
});

// sem_verificacao é o terceiro desfecho de fecharPautaDaUnidade (aluno que sumiu da base ativa).
// Somar ele em "preencheu" inflaria a vitória; somar em "faltou" acusaria quem talvez tenha
// preenchido. Ele tem que aparecer como o que é: não sei.
test('quem não deu pra conferir aparece separado — nem vitória nem falta', () => {
  const m = mensagemDeFimDeDia({
    preencheram: 5, faltaram: [FALTOU('Ana', '09:00')], semVerificacao: 2, dataBr: 'sex 04/09',
  });
  assert.match(m, /5 dos 8 alunos/, 'o total soma os três desfechos');
  assert.match(m, /2 eu não consegui conferir/);
});

test('singular do fim de dia não sai "1 alunos" nem "Faltaram 1"', () => {
  const m = mensagemDeFimDeDia({ preencheram: 1, faltaram: [], dataBr: 'sex 04/09' });
  assert.doesNotMatch(m, /1 alunos/);
  const m2 = mensagemDeFimDeDia({ preencheram: 0, faltaram: [FALTOU('Ana', '09:00')], dataBr: 'sex 04/09' });
  assert.doesNotMatch(m2, /1 alunos/);
  // Quem lê é a secretaria, não um parser: "Faltaram 1" é o tipo de erro que faz a mensagem
  // inteira parecer automática demais pra merecer confiança.
  assert.doesNotMatch(m2, /Faltaram 1/);
  assert.match(m2, /Faltou 1: 09:00 Ana/);
});

test('faltante torto não vaza "undefined" no relatório da noite', () => {
  const m = mensagemDeFimDeDia({
    preencheram: 1, faltaram: [{ hora: '08:00' }, { pessoa: { nome: 'Sem Hora' } }], dataBr: 'sex 04/09',
  });
  assert.doesNotMatch(m, /undefined/);
});

// O relatório LÊ o dia; quem fecha é o ritual das 23:00. Se um dia alguém fizer esta função
// devolver ação em vez de texto, este teste é o que avisa.
test('o relatório é só texto — função pura, sem efeito nenhum', () => {
  const faltaram = [FALTOU('Ana', '09:00')];
  const antes = JSON.stringify(faltaram);
  mensagemDeFimDeDia({ preencheram: 1, faltaram, dataBr: 'sex 04/09' });
  assert.strictEqual(JSON.stringify(faltaram), antes, 'não pode mutar o que recebeu');
});

// ── O LEMBRETE DE HORA EM HORA (pedido do Alf, 04/09) ────────────────────────────────────────
// "a lista inteira repetida 11 vezes vira ruído: a equipe para de ler. O que serve é quem está
// CHEGANDO agora." Medido: 2 a 7 alunos por horário de aula.
const { alunosDaHora, lembreteDaProximaHora, LINHA_LEMBRETE_HORA } = require('./anamnese-pauta');

const ITEM = (nome, hora, curso) => ({ pessoa: { nome, pessoa_chave: 'pk-' + nome }, hora, curso });

test('a linha do lembrete é a ÚLTIMA da mensagem da manhã — e não toca a primeira', () => {
  const m = mensagemDoGrupo({ itens: ITENS, contrato: CONTRATO, dataBr: 'qua 10/09' });
  const linhas = m.split('\n');
  assert.strictEqual(linhas[linhas.length - 1], LINHA_LEMBRETE_HORA);
  // A primeira linha é a chave da guarda de duplicata do dispatcher — a linha nova não pode
  // encostar nela, senão a guarda fica cega e a mensagem sai duas vezes num grupo real.
  assert.strictEqual(linhas[0], '📋 *Anamnese — hoje (qua 10/09)*');
});

test('alunosDaHora só devolve quem chega NAQUELA hora', () => {
  const r = alunosDaHora({
    anamnese: [ITEM('Arthur Bezerra', '15:00', 'Teclado'), ITEM('Bento Alves', '16:00', 'Violão')],
    contrato: [],
    hora: '15:00',
  });
  assert.strictEqual(r.length, 1, 'a lista do dia inteiro é o ruído que este lembrete existe pra matar');
  assert.strictEqual(r[0].pessoa.nome, 'Arthur Bezerra');
  assert.deepStrictEqual(r[0].pendencias, ['anamnese']);
});

test('quem tem as DUAS pendências vira UMA linha com rótulo combinado', () => {
  const r = alunosDaHora({
    anamnese: [ITEM('Levi Freire', '15:00', 'Bateria')],
    contrato: [ITEM('Levi Freire', '15:00', 'Bateria')],
    hora: '15:00',
  });
  assert.strictEqual(r.length, 1, 'é a mesma pessoa chegando na mesma hora — duas linhas confundem');
  assert.deepStrictEqual(r[0].pendencias, ['anamnese', 'contrato']);
});

test('o mesmo NOME em pessoas diferentes não colapsa numa linha só', () => {
  const r = alunosDaHora({
    anamnese: [{ pessoa: { nome: 'Maria', pessoa_chave: 'pk-1' }, hora: '15:00', curso: 'Canto' }],
    contrato: [{ pessoa: { nome: 'Maria', pessoa_chave: 'pk-2' }, hora: '15:00', curso: 'Violão' }],
    hora: '15:00',
  });
  assert.strictEqual(r.length, 2, 'uma unidade tem dezenas de "Maria" — quem é chave é pessoa_chave');
});

test('o lembrete trava a copy aprovada — string inteira, byte a byte', () => {
  const itens = alunosDaHora({
    anamnese: [ITEM('Arthur Bezerra', '15:00', 'Teclado'), ITEM('Levi Freire', '15:00', 'Bateria')],
    contrato: [ITEM('Gabriela da Silva', '15:00', 'Contrabaixo'), ITEM('Levi Freire', '15:00', 'Bateria')],
    hora: '15:00',
  });
  assert.strictEqual(lembreteDaProximaHora({ itens, hora: '15:00' }),
    '⏰ *Próxima hora — 15:00*\n'
    + '· Arthur Bezerra (Teclado) — anamnese\n'
    + '· Gabriela da Silva (Contrabaixo) — contrato\n'
    + '· Levi Freire (Bateria) — anamnese e contrato');
});

test('hora sem ninguém pendente NÃO vira mensagem — silêncio ali é notícia boa', () => {
  assert.strictEqual(lembreteDaProximaHora({ itens: [], hora: '15:00' }), null);
  assert.strictEqual(lembreteDaProximaHora({ itens: alunosDaHora({ anamnese: [], contrato: [], hora: '15:00' }), hora: '15:00' }), null);
});

test('sem hora não monta lembrete nenhum — nunca um "undefined" no grupo real', () => {
  assert.strictEqual(lembreteDaProximaHora({ itens: [ITEM('Ana', '15:00', 'Canto')] }), null);
  assert.deepStrictEqual(alunosDaHora({ anamnese: [ITEM('Ana', '15:00', 'Canto')], contrato: [] }), []);
});

// A primeira linha é a chave da guarda de duplicata (like('content', cabeçalho%)). Sem a HORA
// dentro dela, o lembrete das 16:00 casaria o cabeçalho do das 15:00 e nunca sairia.
test('o cabeçalho carrega a HORA — é o que separa um slot do outro na guarda de duplicata', () => {
  const itens = alunosDaHora({ anamnese: [ITEM('Ana', '15:00', 'Canto')], contrato: [], hora: '15:00' });
  const a = lembreteDaProximaHora({ itens, hora: '15:00' }).split('\n')[0];
  const b = lembreteDaProximaHora({ itens, hora: '16:00' }).split('\n')[0];
  assert.notStrictEqual(a, b);
  assert.ok(a.includes('15:00'));
});

test('aluno sem curso não vira parêntese vazio, e item torto não vaza "undefined"', () => {
  const itens = alunosDaHora({
    anamnese: [{ pessoa: { nome: 'Sem Curso', pessoa_chave: 'pk-x' }, hora: '15:00' }, { hora: '15:00' }],
    contrato: [],
    hora: '15:00',
  });
  const m = lembreteDaProximaHora({ itens, hora: '15:00' });
  assert.strictEqual(m, '⏰ *Próxima hora — 15:00*\n· Sem Curso — anamnese');
  assert.doesNotMatch(m, /undefined|\(\)/);
});

test('o lembrete não muta o que recebeu', () => {
  const itens = alunosDaHora({ anamnese: [ITEM('Ana', '15:00', 'Canto')], contrato: [], hora: '15:00' });
  const antes = JSON.stringify(itens);
  lembreteDaProximaHora({ itens, hora: '15:00' });
  assert.strictEqual(JSON.stringify(itens), antes);
});

// ── O HORÁRIO DE ABERTURA DE CADA UNIDADE (correção 04/09) ───────────────────────────────────
// O dono informou os horários REAIS em que a equipe chega. Sábado é um conjunto próprio: a
// equipe inteira abre às 08:00. O mapa fixo de dia útil fazia a Barra receber a pauta do sábado
// às 09:00 e o Campo Grande às 10:00 — com gente em pé desde as 08:00 e aula acontecendo.
const {
  diaSemanaBrt, horaDeAberturaDaUnidade, horariosDeAberturaDoDia,
} = require('./anamnese-pauta');

test('abertura: dia útil segue exatamente como antes (Recreio 08, Barra 09, Campo Grande 10)', () => {
  for (const dia of [1, 2, 3, 4, 5]) {
    assert.strictEqual(horaDeAberturaDaUnidade('Recreio', dia), '08:00', `dia ${dia}`);
    assert.strictEqual(horaDeAberturaDaUnidade('Barra', dia), '09:00', `dia ${dia}`);
    assert.strictEqual(horaDeAberturaDaUnidade('Campo Grande', dia), '10:00', `dia ${dia}`);
  }
});

test('abertura: no SÁBADO as três unidades abrem às 08:00', () => {
  assert.strictEqual(horaDeAberturaDaUnidade('Recreio', 6), '08:00');
  assert.strictEqual(horaDeAberturaDaUnidade('Barra', 6), '08:00');
  assert.strictEqual(horaDeAberturaDaUnidade('Campo Grande', 6), '08:00');
  assert.deepStrictEqual(horariosDeAberturaDoDia(6), ['08:00'],
    'as três no mesmo slot — o bloco abre uma vez só e as três falam nele');
});

// Medido na fonte em 04/09: zero aulas em domingo nas três unidades (todas as pessoas, com ou
// sem pendência). Não é "a gente acha que não tem": foi conferido antes de virar código.
test('abertura: DOMINGO não existe — nenhuma unidade abre, e o bloco nem chega a rodar', () => {
  for (const u of ['Recreio', 'Barra', 'Campo Grande']) {
    assert.strictEqual(horaDeAberturaDaUnidade(u, 0), null, `${u} não abre domingo`);
  }
  assert.deepStrictEqual(horariosDeAberturaDoDia(0), [],
    'lista vazia é o que faz o `some()` do dispatcher ser falso o domingo inteiro');
});

test('abertura: unidade desconhecida devolve null — não chuto horário de escola que não conheço', () => {
  assert.strictEqual(horaDeAberturaDaUnidade('Unidade Nova', 1), null);
  assert.strictEqual(horaDeAberturaDaUnidade('Unidade Nova', 6), null);
});

test('abertura: dia da semana torto não vira horário de dia útil por descuido', () => {
  assert.strictEqual(horaDeAberturaDaUnidade('Barra', null), null);
  assert.strictEqual(horaDeAberturaDaUnidade('Barra', 7), null);
  assert.deepStrictEqual(horariosDeAberturaDoDia('sábado'), []);
});

test('abertura: os horários do dia saem ORDENADOS e sem repetição', () => {
  assert.deepStrictEqual(horariosDeAberturaDoDia(3), ['08:00', '09:00', '10:00']);
});

test('diaSemanaBrt lê o dia da string YYYY-MM-DD', () => {
  assert.strictEqual(diaSemanaBrt('2026-09-04'), 5, 'sexta');
  assert.strictEqual(diaSemanaBrt('2026-09-05'), 6, 'sábado');
  assert.strictEqual(diaSemanaBrt('2026-09-06'), 0, 'domingo');
});

// LOCALYMD-UTC-SHIFT: `new Date(ymd).getDay()` lê a data como meia-noite UTC e devolve o dia em
// hora LOCAL do processo. Numa VPS em UTC os dois coincidem POR SORTE. Este teste liga o fuso de
// São Paulo no meio da rodada e mostra a forma proibida errando o dia — é a diferença entre o
// sábado receber o horário de sábado e receber o de sexta.
test('diaSemanaBrt não depende do fuso do processo (LOCALYMD-UTC-SHIFT)', () => {
  const tzOriginal = process.env.TZ;
  try {
    process.env.TZ = 'America/Sao_Paulo';
    assert.strictEqual(new Date('2026-09-05').getDay(), 5,
      'a forma proibida devolve SEXTA para um sábado — é por isso que ela é proibida');
    assert.strictEqual(diaSemanaBrt('2026-09-05'), 6, 'a nossa continua devolvendo sábado');
    assert.strictEqual(horaDeAberturaDaUnidade('Barra', diaSemanaBrt('2026-09-05')), '08:00',
      'e é isso que faz a Barra abrir às 08:00 no sábado em vez de às 09:00');
  } finally {
    if (tzOriginal === undefined) delete process.env.TZ; else process.env.TZ = tzOriginal;
  }
});

test('diaSemanaBrt devolve NaN para data torta — quem chama tem que checar antes de usar', () => {
  assert.ok(Number.isNaN(diaSemanaBrt('ontem')));
  assert.ok(Number.isNaN(diaSemanaBrt(null)));
});

// ── O PRIMEIRO LEMBRETE DO DIA É DE RECUPERAÇÃO (correção 04/09) ─────────────────────────────
// O primeiro lembrete fala da hora SEGUINTE. Quem tem aula às 08:00 numa unidade que abre às
// 08:00 nunca aparecia em lembrete nenhum: 25 aulas por semana invisíveis (medido na fonte —
// Recreio 4, Barra 13, Campo Grande 8, com os horários de sábado já corrigidos). A recuperação
// varre do começo do dia até o fim da hora seguinte; do segundo lembrete em diante volta a ser
// só a próxima hora, senão a mesma gente sairia 11 vezes e a equipe pararia de ler.
test('recuperação: o primeiro lembrete pega TODO MUNDO desde o começo do dia até a hora seguinte', () => {
  const r = alunosDaHora({
    anamnese: [ITEM('Ana', '08:00', 'Canto'), ITEM('Bento', '09:00', 'Violão'), ITEM('Célia', '10:00', 'Piano')],
    contrato: [],
    hora: '10:00',
    recuperacao: true,
  });
  assert.deepStrictEqual(r.map((x) => `${x.hora} ${x.pessoa.nome}`), ['08:00 Ana', '09:00 Bento', '10:00 Célia']);
});

test('recuperação: quem chega DEPOIS da hora seguinte fica pro lembrete dele', () => {
  const r = alunosDaHora({
    anamnese: [ITEM('Ana', '08:00', 'Canto'), ITEM('Zeca', '15:00', 'Bateria')],
    contrato: [],
    hora: '10:00',
    recuperacao: true,
  });
  assert.deepStrictEqual(r.map((x) => x.pessoa.nome), ['Ana'],
    'a recuperação é uma FAIXA que termina na hora seguinte, não a lista do dia inteiro');
});

test('recuperação desligada: o segundo lembrete em diante NÃO repete quem já passou', () => {
  const anamnese = [ITEM('Ana', '08:00', 'Canto'), ITEM('Bento', '09:00', 'Violão'), ITEM('Célia', '10:00', 'Piano')];
  const r = alunosDaHora({ anamnese, contrato: [], hora: '10:00' });
  assert.deepStrictEqual(r.map((x) => x.pessoa.nome), ['Célia'],
    'sem o flag, o comportamento é exatamente o de hoje: só a próxima hora');
});

test('recuperação: a ordem é por HORÁRIO e o nome só desempata dentro da mesma hora', () => {
  const r = alunosDaHora({
    anamnese: [ITEM('Zeca', '08:00', 'Canto'), ITEM('Ana', '09:00', 'Violão'), ITEM('Bento', '09:00', 'Piano')],
    contrato: [], hora: '09:00', recuperacao: true,
  });
  assert.deepStrictEqual(r.map((x) => x.pessoa.nome), ['Zeca', 'Ana', 'Bento'],
    'quem já está na escola vem primeiro — a mensagem se lê na ordem em que o dia aconteceu');
});

// O CABEÇALHO NÃO PODE MENTIR. "Próxima hora — 10:00" numa mensagem que carrega gente das 08:00
// seria uma afirmação falsa, todo dia, em três grupos reais.
test('recuperação: o cabeçalho diz a FAIXA, e cada linha carrega a hora do aluno', () => {
  const itens = alunosDaHora({
    anamnese: [ITEM('Arthur Bezerra', '08:00', 'Teclado'), ITEM('Levi Freire', '10:00', 'Bateria')],
    contrato: [ITEM('Levi Freire', '10:00', 'Bateria'), ITEM('Gabriela da Silva', '09:00', 'Contrabaixo')],
    hora: '10:00', recuperacao: true,
  });
  assert.strictEqual(lembreteDaProximaHora({ itens, hora: '10:00', recuperacao: true }),
    '⏰ *Do começo do dia até as 10:00*\n'
    + '· 08:00 Arthur Bezerra (Teclado) — anamnese\n'
    + '· 09:00 Gabriela da Silva (Contrabaixo) — contrato\n'
    + '· 10:00 Levi Freire (Bateria) — anamnese e contrato');
});

test('recuperação: o lembrete normal NÃO ganhou hora na linha — lá ela já está no cabeçalho', () => {
  const itens = alunosDaHora({ anamnese: [ITEM('Ana', '15:00', 'Canto')], contrato: [], hora: '15:00' });
  assert.strictEqual(lembreteDaProximaHora({ itens, hora: '15:00' }),
    '⏰ *Próxima hora — 15:00*\n· Ana (Canto) — anamnese');
});

// A guarda de duplicata do dispatcher casa `like('content', primeiraLinha%)`. Se o cabeçalho da
// recuperação fosse prefixo do normal (ou vice-versa), a guarda ficaria cega justo na mensagem
// nova — e a recuperação sairia duas vezes num grupo real.
test('recuperação: o cabeçalho novo é COBERTO pela guarda de duplicata (distinto e com a hora)', () => {
  const itens = alunosDaHora({ anamnese: [ITEM('Ana', '10:00', 'Canto')], contrato: [], hora: '10:00', recuperacao: true });
  const recup = lembreteDaProximaHora({ itens, hora: '10:00', recuperacao: true }).split('\n')[0];
  const normal = lembreteDaProximaHora({ itens, hora: '10:00' }).split('\n')[0];
  assert.notStrictEqual(recup, normal);
  assert.ok(!recup.startsWith(normal) && !normal.startsWith(recup),
    'um não pode ser prefixo do outro: a guarda casa por PREFIXO de conteúdo');
  assert.ok(recup.includes('10:00'), 'sem a hora, a recuperação das 11:00 casaria o cabeçalho da das 10:00');
  const outraHora = lembreteDaProximaHora({
    itens: alunosDaHora({ anamnese: [ITEM('Ana', '11:00', 'Canto')], contrato: [], hora: '11:00', recuperacao: true }),
    hora: '11:00', recuperacao: true,
  }).split('\n')[0];
  assert.notStrictEqual(recup, outraHora);
});

test('recuperação: faixa sem ninguém pendente continua sendo SILÊNCIO, não mensagem vazia', () => {
  assert.strictEqual(lembreteDaProximaHora({ itens: [], hora: '10:00', recuperacao: true }), null);
});
