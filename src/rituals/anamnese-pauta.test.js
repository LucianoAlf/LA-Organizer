'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { montarPautaDaUnidade, TETO_FILHAS } = require('./anamnese-pauta');

const aluno = (nome, hora, temAnamnese) => ({
  nome, pessoa_chave: 'pk-' + nome, classificacao: 'LA',
  aulas_resumo: [`Canto — Segunda-feira ${hora}`],
  anamnese_preenchida: !!temAnamnese, cadastro_faltando: temAnamnese ? [] : ['anamnese'],
});

function deps({
  rpcErro = null, alunos = [], falhas = new Map(), criar = null,
  existente = false, erroChecagem = null,
} = {}) {
  const criadas = [];
  const titulosChecados = [];
  const contadores = { rpc: 0 };
  return {
    criadas,
    titulosChecados,
    contadores,
    laReport: { rpc: async () => { contadores.rpc += 1; return { data: rpcErro ? null : alunos, error: rpcErro }; } },
    repo: {
      registrarAparicoes: async () => ({ gravadas: alunos.length, erro: null }),
      contarFalhas: async () => falhas,
    },
    // Fake da guarda de duplicata (correção 1/5): por padrão diz "não existe" pra não quebrar
    // os testes que já passavam. `existente`/`erroChecagem` ligam os dois novos caminhos.
    pacoteExiste: async (_supabase, { titulo }) => {
      titulosChecados.push(titulo);
      if (erroChecagem) return { existe: null, erro: erroChecagem };
      return { existe: existente, erro: null };
    },
    criarPacote: criar || (async (arg) => { criadas.push(arg); return { groupId: 'g-mae', childIds: [] }; }),
  };
}

// SEGUNDA-FEIRA = 2026-09-07
const SEGUNDA = '2026-09-07';

test('monta a pauta com quem tem aula hoje e está sem anamnese', async () => {
  const d = deps({ alunos: [aluno('Ana', '09:00', false), aluno('Bia', '08:00', false), aluno('Cid', '10:00', true)] });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, true);
  assert.strictEqual(r.total, 2, 'Cid já tem anamnese e fica de fora');
  const arg = d.criadas[0];
  assert.deepStrictEqual(arg.input.subtasks.map((s) => s.title.slice(0, 5)), ['08:00', '09:00'],
    'ordenado por horário');
});

// Meio pacote é pior que zero: o time confia na lista e quem faltar passa batido.
test('RPC falha → NÃO cria nada e diz o motivo', async () => {
  const d = deps({ rpcErro: { message: 'timeout' } });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.match(r.motivo, /timeout|consulta/i);
  assert.strictEqual(d.criadas.length, 0);
});

test('acima do teto de sanidade NÃO cria e avisa', async () => {
  const muitos = Array.from({ length: TETO_FILHAS + 1 }, (_, i) => aluno('A' + i, '09:00', false));
  const d = deps({ alunos: muitos });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.match(r.motivo, /teto/i);
  assert.strictEqual(d.criadas.length, 0);
});

test('pauta vazia não cria pacote', async () => {
  const d = deps({ alunos: [aluno('Cid', '10:00', true)] });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(d.criadas.length, 0);
});

test('quem já falhou 2x sai da pauta e vira escalada', async () => {
  const d = deps({
    alunos: [aluno('Ana', '09:00', false), aluno('Cid', '10:00', false)],
    falhas: new Map([['pk-Cid', 2]]),
  });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.total, 1, 'só a Ana na pauta do dia');
  assert.strictEqual(r.escalados, 1);
});

test('erro ao ler a escada não escala ninguém', async () => {
  const d = deps({ alunos: [aluno('Cid', '10:00', false)], falhas: null });
  d.repo.contarFalhas = async () => null;
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.escalados, 0, 'sem histórico confiável, ninguém é escalado');
  assert.strictEqual(r.total, 1);
});

// ── A ARMADILHA DO DIA DA SEMANA (LOCALYMD-UTC-SHIFT) ──────────────────────────────────────
// `hoje` chega em BRT já como "YYYY-MM-DD". Se o ritual derivar o dia da semana com
// `new Date(hoje).getDay()`, a string é lida como meia-noite UTC e o `.getDay()` devolve o dia
// em hora LOCAL do processo. Numa VPS rodando em UTC isso "acerta por sorte"; sob
// TZ=America/Sao_Paulo a mesma meia-noite UTC vira 21h do dia ANTERIOR e a pauta inteira sai
// no dia errado, em silêncio — é exatamente por isso que forçamos o TZ aqui: prova que o
// resultado NÃO depende do fuso do processo que roda o código.
test('dia da semana continua correto mesmo com o processo em America/Sao_Paulo', async () => {
  const tzOriginal = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
  try {
    const d = deps({ alunos: [aluno('Ana', '09:00', false)] });
    const r = await montarPautaDaUnidade({
      supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
      hoje: SEGUNDA, deps: d,
    });
    assert.strictEqual(r.criou, true);
    assert.strictEqual(r.total, 1, '2026-09-07 é segunda-feira; a aula de segunda tem que bater mesmo sob TZ BRT');
  } finally {
    process.env.TZ = tzOriginal;
  }
});

// Segundo ponto de dados pra não ser coincidência de segunda-feira especificamente
// (2026-09-09 é quarta-feira — dois dias depois de 2026-09-07).
test('dia da semana bate também pra quarta-feira, não só segunda', async () => {
  const QUARTA = '2026-09-09';
  const alunoQuarta = {
    nome: 'Deb', pessoa_chave: 'pk-Deb', classificacao: 'LA',
    aulas_resumo: ['Canto — Quarta-feira 09:00'],
    anamnese_preenchida: false, cadastro_faltando: ['anamnese'],
  };
  const d = deps({ alunos: [alunoQuarta] });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: QUARTA, deps: d,
  });
  assert.strictEqual(r.criou, true);
  assert.strictEqual(r.total, 1, 'quarta-feira 2026-09-09 tem que bater com aula de quarta-feira');
});

test('hoje malformado não derruba a pauta silenciosamente (diaSemana inválido é falha-fechada)', async () => {
  const d = deps({ alunos: [aluno('Ana', '09:00', false)] });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: '', deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.strictEqual(d.criadas.length, 0);
});

// ── RODADA DE CORREÇÃO 1/5 ──────────────────────────────────────────────────────────────────
// O buraco real: createTaskGroup (task-groups.js) insere linha a linha sem transação. Com
// 43-80 filhas, um insert que falhe no meio deixa mãe+filhas parciais JÁ COMMITADAS e lança; o
// throw subia até o catch genérico do dispatcher, que não grava marcador (o insert do marcador
// vem DEPOIS da chamada) — o cron de 5 min retentava e duplicava o container inteiro. A spec
// quer a retentativa; o que faltava era ela ser SEGURA. Os 5 testes abaixo cobrem isso.

test('container já existe pra (grupo, dia) → não cria de novo, motivo próprio, nem bate o LA Report', async () => {
  const d = deps({ alunos: [aluno('Ana', '09:00', false)], existente: true });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.match(r.motivo, /já montada|ja montada/i);
  assert.strictEqual(d.criadas.length, 0, 'não pode criar um segundo container pro mesmo dia');
  assert.strictEqual(d.contadores.rpc, 0, 'achar o container antes evita bater a RPC lenta do LA Report à toa');
});

test('consulta de container existente falha → NÃO cria (não dá pra afirmar que não existe)', async () => {
  const d = deps({ alunos: [aluno('Ana', '09:00', false)], erroChecagem: 'conexão caiu' });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.match(r.motivo, /não consegui checar|nao consegui checar|verificar/i);
  assert.strictEqual(d.criadas.length, 0);
  assert.strictEqual(d.contadores.rpc, 0, 'sem saber se já existe, nem chega a consultar o LA Report');
});

test('criarPacote lança → devolve {criou:false, motivo} em vez de propagar o throw', async () => {
  const d = deps({ alunos: [aluno('Ana', '09:00', false)] });
  d.criarPacote = async () => { throw new Error('insert task: constraint violation'); };
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.match(r.motivo, /constraint violation|falha ao criar/i);
});

test('registrarAparicoes lança → devolve {criou:false, motivo} em vez de propagar o throw', async () => {
  const d = deps({ alunos: [aluno('Ana', '09:00', false)] });
  d.repo.registrarAparicoes = async () => { throw new Error('upsert falhou'); };
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.match(r.motivo, /upsert falhou|falha ao registrar/i);
  assert.strictEqual(d.criadas.length, 0, 'se registrar já lançou, criarPacote nem chega a rodar');
});

test('o título consultado na checagem de duplicata é o MESMO título usado na criação', async () => {
  const d = deps({ alunos: [aluno('Ana', '09:00', false)] });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, true);
  assert.strictEqual(d.titulosChecados.length, 1);
  assert.strictEqual(d.titulosChecados[0], d.criadas[0].input.title,
    'se os dois textos puderem divergir, a guarda de duplicata fica cega pro próprio container');
});

// ── TASK 6: A PASSADA DA NOITE ──────────────────────────────────────────────────────────────
// De manhã o ritual MONTA a pauta (acima). À noite ele FECHA: lê a fonte de novo e carimba,
// pessoa por pessoa, quem preencheu e quem não. Dia que a NOSSA infra caiu não pode contar
// contra o aluno — grava sem_verificacao, nunca nao_preencheu, senão a 3ª aparição da escada
// chega por culpa nossa e a equipe cobra quem já tinha preenchido.
const { fecharPautaDaUnidade } = require('./anamnese-pauta');

function depsNoite({ rpcErro = null, alunos = [], daPauta = [] } = {}) {
  const gravados = [];
  return {
    gravados,
    laReport: { rpc: async () => ({ data: rpcErro ? null : alunos, error: rpcErro }) },
    repo: {
      pessoasDoDia: async () => daPauta,
      gravarResultado: async (_sb, arg) => { gravados.push(arg); return true; },
    },
  };
}

test('à noite grava preencheu/nao_preencheu lendo a fonte', async () => {
  const d = depsNoite({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', false)],
    daPauta: ['pk-Ana', 'pk-Bia'],
  });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.preencheu, 1);
  assert.strictEqual(r.naoPreencheu, 1);
  assert.deepStrictEqual(
    d.gravados.map((g) => [g.pessoaChave, g.resultado]).sort(),
    [['pk-Ana', 'preencheu'], ['pk-Bia', 'nao_preencheu']],
  );
});

// Dia que a nossa infra derrubou NÃO pode contar contra o aluno: senão a 3ª vez chega por
// culpa nossa e a equipe cobra quem já tinha preenchido.
test('RPC falha à noite → grava sem_verificacao, nunca nao_preencheu', async () => {
  const d = depsNoite({ rpcErro: { message: 'timeout' }, daPauta: ['pk-Ana', 'pk-Bia'] });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.semVerificacao, 2);
  assert.strictEqual(r.naoPreencheu, 0);
  assert.ok(d.gravados.every((g) => g.resultado === 'sem_verificacao'));
});

test('aluno que sumiu da base entra como sem_verificacao, não como falha', async () => {
  const d = depsNoite({ alunos: [aluno('Ana', '09:00', true)], daPauta: ['pk-Ana', 'pk-Sumiu'] });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', hoje: SEGUNDA, deps: d,
  });
  const sumiu = d.gravados.find((g) => g.pessoaChave === 'pk-Sumiu');
  assert.strictEqual(sumiu.resultado, 'sem_verificacao', 'não está mais na base — não dá pra afirmar que falhou');
});

test('pauta vazia à noite não grava nada', async () => {
  const d = depsNoite({ alunos: [], daPauta: [] });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.fechou, false);
  assert.strictEqual(d.gravados.length, 0);
});

// Contexto além do brief: pessoasDoDia (repo, novo nesta task) pode devolver `null` quando a
// LEITURA falha (ex.: coluna errada — o mesmo "zero linhas silencioso" que já custou dois
// diagnósticos errados nesta casa em 03/09), e `[]` quando LEGITIMAMENTE ninguém entrou na
// pauta hoje. Os dois não podem sair com o mesmo motivo null, senão uma leitura que falhou
// parece uma noite tranquila.
test('não consegui ler quem entrou na pauta hoje não é tratado como "pauta vazia por saúde"', async () => {
  const d = depsNoite({ daPauta: [] });
  d.repo.pessoasDoDia = async () => null; // leitura falhou — diferente de "ninguém na pauta"
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.fechou, false);
  assert.ok(r.motivo, 'leitura que falhou não pode sair com o mesmo motivo null de "não tinha pauta hoje"');
  assert.strictEqual(d.gravados.length, 0);
});

// Contexto além do brief (Alf, 03/09): gravarResultado (Task 1) devolve `false` quando o UPDATE
// não casa NENHUMA linha, mesmo sem erro do banco — foi corrigido assim bem por isso, pra não
// mentir sucesso. Se esta função contasse a TENTATIVA em vez da ESCRITA real, o relatório da
// noite viraria ficção (contaria gente como "preencheu" sem a linha ter sido de fato gravada).
// A divergência entre o que tentou e o que gravou precisa aparecer em algum lugar — não pode
// ser engolida em silêncio.
test('gravação que não casa linha nenhuma não entra em nenhum contador, e a divergência aparece no motivo', async () => {
  const d = depsNoite({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', false)],
    daPauta: ['pk-Ana', 'pk-Bia'],
  });
  // Bia grava normal; a escrita da Ana "não acha a linha" (Task 1: devolve false sem error).
  d.repo.gravarResultado = async (_sb, arg) => {
    d.gravados.push(arg);
    return arg.pessoaChave !== 'pk-Ana';
  };
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.preencheu, 0, 'a escrita da Ana falhou — não pode contar como preenchido sem ter gravado');
  assert.strictEqual(r.naoPreencheu, 1, 'só a Bia realmente entrou no banco');
  assert.ok(r.motivo && /grava/i.test(r.motivo),
    'a divergência entre o que tentou e o que gravou precisa aparecer em algum lugar, não sumir');
});
