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

// CORREÇÃO 04/09 (resíduo 1): a expectativa era `total: 1` ("só a Ana na pauta do dia") — ela
// travava o bug. O Cid saía da pauta e NADA tomava o lugar dele: a tarefa "Mandar link" é a
// fatia 2 e não existe. Expectativa mudada, nenhum assert enfraquecido — o teste ainda ganhou a
// checagem do TÍTULO, que é onde a equipe enxerga a diferença entre 1ª e 3ª semana.
test('quem já falhou 2x CONTINUA na pauta, marcado, e também conta como escalado', async () => {
  const d = deps({
    alunos: [aluno('Ana', '09:00', false), aluno('Cid', '10:00', false)],
    falhas: new Map([['pk-Cid', 2]]),
  });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.total, 2, 'ninguém sai da pauta enquanto não houver substituto');
  assert.strictEqual(r.escalados, 1, 'o Cid continua listado, pronto pra fatia 2');
  const titulos = d.criadas[0].input.subtasks.map((s) => s.title);
  assert.strictEqual(titulos.length, 2, 'as duas filhas nascem no painel do grupo');
  const doCid = titulos.find((t) => t.includes('Cid'));
  assert.match(doCid, /mande o link da anamnese/,
    'na tela o degrau 3 tem que dizer o que fazer, senão se lê igual a quem está na 1ª vez');
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

function depsNoite({
  rpcErro = null, alunos = [], daPauta = [],
  containerId = null, filhasPendentes = [], erroAcharContainer = null, erroListarFilhas = null,
} = {}) {
  const gravados = [];
  const filhasFechadas = [];
  const containerFechadoChamadas = [];
  const titulosChecados = [];
  return {
    gravados,
    filhasFechadas,
    containerFechadoChamadas,
    titulosChecados,
    laReport: { rpc: async () => ({ data: rpcErro ? null : alunos, error: rpcErro }) },
    repo: {
      pessoasDoDia: async () => daPauta,
      gravarResultado: async (_sb, arg) => { gravados.push(arg); return true; },
    },
    // Por padrão "não achei o container" — não quebra os testes que não ligam pro fechamento
    // do recado (é exatamente o `supabase: {}` deles: sem containerId configurado, nunca
    // chegaria a bater o `.from()` de verdade). `containerId`/`filhasPendentes` ligam o
    // caminho de fechamento completo.
    acharContainer: async (_sb, { titulo }) => {
      titulosChecados.push(titulo);
      if (erroAcharContainer) return { containerId: null, erro: erroAcharContainer };
      return { containerId, erro: null };
    },
    listarFilhasPendentes: async () => {
      if (erroListarFilhas) return { filhas: null, erro: erroListarFilhas };
      return { filhas: filhasPendentes, erro: null };
    },
    fecharFilha: async (_sb, arg) => { filhasFechadas.push(arg); return true; },
    fecharContainer: async (_sb, arg) => { containerFechadoChamadas.push(arg); return true; },
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
  // Correção 1/5 (ponto 2): só os caminhos de fechou:false estavam travados por teste — uma
  // regressão que derrubasse `fechou` no caminho de sucesso passaria calada.
  assert.strictEqual(r.fechou, true);
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

// ── TASK 6 · RODADA DE CORREÇÃO 1/5, PONTO 3: FECHAR O RECADO DO DIA ─────────────────────────
// O plano perdeu dois passos da spec 4.3: fechar as filhas (done/cancelled) e o container
// (done). "A pauta do dia é descartável, o backlog é a RPC" só é verdade se algo REALMENTE
// fecha — senão cada unidade acumula 43-80 tarefas abertas por dia, pra sempre. O nome no
// título não é chave (uma unidade tem dezenas de "Maria"): ambíguo ou sem correspondência
// nunca vira `done`.

test('fecha as filhas conforme a fonte, e o container como done', async () => {
  const d = depsNoite({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', false)],
    daPauta: ['pk-Ana', 'pk-Bia'],
    containerId: 'cont-1',
    filhasPendentes: [
      { id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' },
      { id: 'f-bia', title: '08:00 Anamnese — Bia (Canto)' },
    ],
  });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.fechou, true);
  const porId = Object.fromEntries(d.filhasFechadas.map((f) => [f.id, f.status]));
  assert.strictEqual(porId['f-ana'], 'done', 'Ana já preencheu — filha fecha como feita');
  assert.strictEqual(porId['f-bia'], 'cancelled', 'Bia ainda não preencheu — filha fecha como não-feita');
  assert.strictEqual(r.filhasFechadasComoFeitas, 1);
  assert.strictEqual(r.filhasFechadasComoNaoFeitas, 1);
  assert.strictEqual(d.containerFechadoChamadas.length, 1, 'container fecha uma vez');
  assert.strictEqual(r.containerFechado, true);
});

// Falha-fechada: sem a fonte não dá pra dizer quem preencheu — fechar no escuro marcaria
// `cancelled` em quem já tinha preenchido. O container fica pending pro dia seguinte tentar de novo.
test('RPC falha à noite → não fecha filha nem container, motivo diz por quê', async () => {
  const d = depsNoite({
    rpcErro: { message: 'timeout' }, daPauta: ['pk-Ana'],
    containerId: 'cont-1', filhasPendentes: [{ id: 'f-ana', title: '09:00 Anamnese — Ana' }],
  });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(d.filhasFechadas.length, 0, 'sem fonte, fechar arriscaria marcar cancelled em quem preencheu');
  assert.strictEqual(d.containerFechadoChamadas.length, 0, 'container segue pending pro dia seguinte tentar de novo');
  assert.strictEqual(r.containerFechado, false);
  assert.match(r.motivo, /fechamento|container/i);
});

test('nome ambíguo entre duas filhas → cancelled com nota, nunca done', async () => {
  const ana1 = aluno('Ana', '09:00', false);
  const ana2 = { ...aluno('Ana', '09:30', false), pessoa_chave: 'pk-Ana2' }; // homônima, pk diferente
  const d = depsNoite({
    alunos: [ana1, ana2],
    daPauta: ['pk-Ana', 'pk-Ana2'],
    containerId: 'cont-1',
    filhasPendentes: [{ id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' }],
  });
  await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: d,
  });
  const filha = d.filhasFechadas.find((f) => f.id === 'f-ana');
  assert.strictEqual(filha.status, 'cancelled', 'duas Anas ainda sem anamnese — não dá pra saber qual é');
  assert.match(filha.notes, /ambígu/i);
});

test('filha sem correspondência na fonte → cancelled com nota, nunca deixada aberta', async () => {
  const d = depsNoite({
    alunos: [aluno('Ana', '09:00', false)],
    daPauta: ['pk-Ana'],
    containerId: 'cont-1',
    filhasPendentes: [{ id: 'f-fantasma', title: '09:00 Anamnese — Alguém Que Sumiu' }],
  });
  await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: d,
  });
  const filha = d.filhasFechadas.find((f) => f.id === 'f-fantasma');
  assert.strictEqual(filha.status, 'cancelled', 'nunca fica pending/aberta');
  assert.match(filha.notes, /sem correspondência/i);
});

// Reusa os dois helpers de deps (manhã `deps()` e noite `depsNoite()`) num único cenário: os
// dois lados chamam a MESMA função privada de título — se um dia divergirem, este teste quebra.
test('o título consultado pra achar o container à noite é o MESMO que a manhã usa pra criar', async () => {
  const manha = deps({ alunos: [aluno('Ana', '09:00', false)] });
  await montarPautaDaUnidade({
    supabase: {}, laReport: manha.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: manha,
  });
  const noite = depsNoite({ alunos: [aluno('Ana', '09:00', false)], daPauta: ['pk-Ana'] });
  await fecharPautaDaUnidade({
    supabase: {}, laReport: noite.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: noite,
  });
  assert.strictEqual(noite.titulosChecados[0], manha.criadas[0].input.title,
    'se os dois textos puderem divergir, a noite não acha o container que a manhã criou');
});

// ── RODADA FINAL: OS ACHADOS DE COSTURA (revisão de 04/09) ───────────────────────────────────
// Seis achados que vivem ENTRE tasks — nenhuma revisão de task isolada podia vê-los. Os testes
// abaixo travam os que moram no ritual; os dois que moram no dispatcher (aviso no grupo quando a
// fonte cai, e o mapeamento do marcador) não têm teste unitário — é a natureza daquele arquivo.
const { VARREDURA_DIAS, VARREDURA_MAX_CONTAINERS } = require('./anamnese-pauta');

// CRITICAL 2 — registrarAparicoes NÃO lança em erro do Supabase (anamnese-pauta-repo.js:14-17):
// loga e devolve {gravadas:0, erro}. O ritual embrulhava a chamada num try/catch e DESCARTAVA o
// retorno — ninguém ligava os dois. O caminho que isso abria: as filhas SÃO criadas no painel,
// anamnese_pauta fica com ZERO linhas, o marcador da manhã diz `executed total=48`, e às 23:00
// pessoasDoDia devolve [] → ramo "zero por saúde" → o marcador da noite diz `executed ok=0
// falta=0 semver=0`. Os DOIS passos dizem sucesso, o dia some da escada, e 48 filhas + o
// container nunca fecham. É a mesma falha que gravarResultado já corrigiu um andar abaixo (não
// podia dizer "gravei" com UPDATE de zero linhas) — sobreviveu na escrita que alimenta aquela.
test('registrarAparicoes devolvendo {erro} (sem lançar) → NÃO cria o pacote e o motivo diz por quê', async () => {
  const d = deps({ alunos: [aluno('Ana', '09:00', false)] });
  d.repo.registrarAparicoes = async () => ({ gravadas: 0, erro: 'permission denied for table anamnese_pauta' });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.match(r.motivo, /registrar aparições|permission denied/i);
  assert.strictEqual(d.criadas.length, 0,
    'filhas no painel sem linha em anamnese_pauta = dia que some da escada e nunca fecha');
});

// IMPORTANT 1 — contarFalhas devolve null em erro (certo) e separarPorDegrau trata null como
// "ninguém escala" (certo), mas o ritual passava adiante SEM SENSOR: ninguém escalava, ninguém
// ganhava o ⚠️ no título, e o marcador dizia `executed escalados=0` — idêntico a um dia saudável
// em que ninguém está no 2º ou 3º degrau. Não escalar no escuro continua sendo o comportamento
// certo; o que muda é o marcador passar a dizer a verdade.
test('erro ao ler a escada entra no motivo (marcador vira fallback) — mas a pauta AINDA é criada', async () => {
  const d = deps({ alunos: [aluno('Cid', '10:00', false)] });
  d.repo.contarFalhas = async () => null;
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, true, 'a pauta do dia não some porque a escada não pôde ser lida');
  assert.strictEqual(r.escalados, 0, 'sem histórico confiável, ninguém é escalado');
  assert.ok(r.motivo, 'sem motivo o marcador diz executed e o dia fica idêntico a um dia saudável');
  assert.match(r.motivo, /escada|histórico/i);
});

// IMPORTANT 3 — o acerto da guarda de duplicata era carimbado como `fallback`, que nesta casa
// significa "deu errado, tenta de novo". Duas consequências: quem lê marker_logs vê falha onde
// nada falhou, e como fallback NÃO trava a chave do dia, a unidade re-rodava em todo tick
// restante do slot. `jaExistia` é o sinal que o dispatcher mapeia pra `skipped`.
test('"pauta já montada hoje" devolve jaExistia:true — desfecho RESOLVIDO, não falha', async () => {
  const d = deps({ alunos: [aluno('Ana', '09:00', false)], existente: true });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.jaExistia, true);
  assert.match(r.motivo, /já montada|ja montada/i,
    'o motivo textual continua sendo o sensor de quem lê o retorno');
});

test('caminhos de FALHA não carimbam jaExistia (senão o dispatcher mapearia falha pra skipped)', async () => {
  const rpc = deps({ rpcErro: { message: 'timeout' } });
  const rRpc = await montarPautaDaUnidade({
    supabase: {}, laReport: rpc.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: rpc,
  });
  assert.notStrictEqual(rRpc.jaExistia, true, 'RPC fora do ar tem que continuar destravando a retentativa');
  const chk = deps({ alunos: [aluno('Ana', '09:00', false)], erroChecagem: 'conexão caiu' });
  const rChk = await montarPautaDaUnidade({
    supabase: {}, laReport: chk.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: chk,
  });
  assert.notStrictEqual(rChk.jaExistia, true, '"não sei se existe" nunca pode virar "já existe"');
});

// IMPORTANT 2 — _fecharFilha devolve false e loga, mas a falha nunca entrava em `avisos`: o
// motivo ficava null, o marcador dizia `executed`, e a filha ficava pending PRA SEMPRE — virando
// exatamente o entulho do Critical 3.
test('filha que não fecha entra no motivo, nomeada (senão o marcador diz executed e ela fica pending pra sempre)', async () => {
  const d = depsNoite({
    alunos: [aluno('Bia', '08:00', false)], daPauta: ['pk-Bia'],
    containerId: 'cont-1', filhasPendentes: [{ id: 'f-bia', title: '08:00 Anamnese — Bia (Canto)' }],
  });
  d.fecharFilha = async () => false;
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.filhasFechadasComoNaoFeitas, 0, 'contador conta o que REALMENTE fechou, nunca a tentativa');
  assert.ok(r.motivo, 'falha muda faz o marcador dizer executed em cima de uma filha que não fechou');
  assert.match(r.motivo, /Bia/, 'o aviso precisa nomear a filha — "alguma coisa falhou" não dá pra investigar');
});

// ── CRITICAL 3: A VARREDURA DOS DIAS VELHOS ─────────────────────────────────────────────────
// A passada da noite só consultava `dia = hoje` / `due_date = hoje`: NADA, em lugar nenhum,
// revisitava um dia anterior — e o comentário que dizia "o container fica aberto e o dia
// seguinte tenta de novo" era falso. Como os slots são de 15 min, uma queda de 15 minutos
// custava o dia inteiro, pra sempre. E o estrago não fica no painel da pauta: createTaskGroup
// carimba toda filha com context 'work', data_classification 'real', status 'pending' e
// assigned_to null — exatamente o WHERE dos relatórios de atrasadas (CEO limit 80, líderes
// limit 200, ordenados por due_date crescente). Uma noite ruim = até 102 filhas que envelhecem,
// viram as atrasadas MAIS ANTIGAS do sistema e expulsam trabalho real do digest.
function comVarredura(d, { containers = [], filhasPorContainer = {}, erroLista = null } = {}) {
  const pedidos = [];
  d.listarContainersVelhos = async (_sb, args) => {
    pedidos.push(args);
    if (erroLista) return { containers: null, erro: erroLista };
    return { containers, erro: null };
  };
  const listarOriginal = d.listarFilhasPendentes;
  d.listarFilhasPendentes = async (sb, args) => {
    if (Object.prototype.hasOwnProperty.call(filhasPorContainer, args.containerId)) {
      return { filhas: filhasPorContainer[args.containerId], erro: null };
    }
    return listarOriginal(sb, args);
  };
  return pedidos;
}

// `daPauta: []` de propósito: hoje NÃO tem pauta nenhuma (domingo, ou a montagem falhou de
// manhã). Se a varredura morasse depois desse retorno antecipado, o entulho de ontem ficaria
// esperando um dia que talvez não venha.
test('varre containers de dias anteriores: filhas velhas viram cancelled e o container fecha', async () => {
  const d = depsNoite({ alunos: [], daPauta: [] });
  comVarredura(d, {
    containers: [{ id: 'c-ontem', due_date: '2026-09-06' }],
    filhasPorContainer: { 'c-ontem': [{ id: 'f-velha', title: '08:00 Anamnese — Zé (Canto)' }] },
  });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: d,
  });
  const velha = d.filhasFechadas.find((f) => f.id === 'f-velha');
  assert.strictEqual(velha.status, 'cancelled',
    'não dá pra afirmar quem preencheu num dia que já passou lendo a fonte de HOJE — nunca inventar done');
  assert.match(velha.notes, /sem verificação/i);
  assert.ok(d.containerFechadoChamadas.some((c) => c.containerId === 'c-ontem'));
  assert.strictEqual(r.containersVelhosFechados, 1);
  assert.strictEqual(r.filhasVelhasFechadas, 1);
  assert.strictEqual(d.gravados.length, 0,
    'dia sem medição NÃO conta na escada: varrer o painel nunca pode gravar resultado retroativo');
});

test('a varredura tem teto: no máximo VARREDURA_MAX_CONTAINERS containers e VARREDURA_DIAS dias pra trás', async () => {
  const d = depsNoite({ alunos: [], daPauta: [] });
  const pedidos = comVarredura(d, { containers: [] });
  await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(pedidos.length, 1);
  assert.strictEqual(pedidos[0].limite, VARREDURA_MAX_CONTAINERS,
    'sem teto, uma volta de férias vira uma varredura gigante dentro de um tick de 5 minutos');
  assert.strictEqual(pedidos[0].hoje, SEGUNDA);
  assert.strictEqual(pedidos[0].desde, '2026-08-31', `${VARREDURA_DIAS} dias antes de ${SEGUNDA}`);
});

// A varredura é serviço de limpeza: se ela cair, o fechamento de HOJE (que é o que alimenta a
// escada) não pode cair junto.
test('falha ao listar as pautas velhas vira aviso no motivo, sem derrubar o fechamento de hoje', async () => {
  const d = depsNoite({
    alunos: [aluno('Ana', '09:00', true)], daPauta: ['pk-Ana'],
    containerId: 'cont-hoje', filhasPendentes: [{ id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' }],
  });
  comVarredura(d, { erroLista: 'conexão caiu' });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.preencheu, 1, 'o fechamento de hoje não depende da varredura dos dias velhos');
  assert.strictEqual(r.containerFechado, true);
  assert.strictEqual(r.containersVelhosFechados, 0);
  assert.match(r.motivo, /dias anteriores|varr/i);
});

// Fechar o container em cima de uma filha que não fechou esconderia a órfã pra sempre: a
// varredura acha CONTAINERS, não filhas soltas. Deixar aberto é o que faz a noite seguinte
// tentar de novo.
test('filha velha que não fecha deixa o container aberto pra varredura da noite seguinte', async () => {
  const d = depsNoite({ alunos: [], daPauta: [] });
  comVarredura(d, {
    containers: [{ id: 'c-ontem', due_date: '2026-09-06' }],
    filhasPorContainer: { 'c-ontem': [{ id: 'f-velha', title: '08:00 Anamnese — Zé' }] },
  });
  d.fecharFilha = async () => false;
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(d.containerFechadoChamadas.length, 0);
  assert.strictEqual(r.containersVelhosFechados, 0);
  assert.ok(r.motivo, 'entulho que sobrou tem que aparecer no motivo, não sumir');
});

// ── RESÍDUO 2: A MESMA VARREDURA, TAMBÉM DE MANHÃ ───────────────────────────────────────────
// A varredura só era chamada dentro do fechamento das 23:00 — uma passada ATRASADA. A spec §7 é
// explícita: "na manhã seguinte o pacote velho é arquivado e sai do caminho". Numa noite em que
// a RPC cai, o ritual grava sem_verificacao (certo) e NÃO fecha nada: as até 102 filhas ficam
// `pending` carimbadas com context 'work', data_classification 'real' e assigned_to null — o
// WHERE exato dos relatórios de atrasadas (CEO limit 80, líderes limit 200, ordenados por
// due_date CRESCENTE). Sendo as MAIS ANTIGAS, comem a janela inteira e expulsam trabalho real do
// digest do CEO por um DIA ÚTIL inteiro, até a varredura da noite seguinte.
// A função é EXTRAÍDA, não copiada: duas implementações da mesma limpeza divergem e uma delas
// fica cega — e essa é justamente a que ninguém percebe que parou de limpar.
const { varrerPautasVelhas } = require('./anamnese-pauta');

test('varrerPautasVelhas roda sozinha — a manhã chama a MESMA limpeza da noite', async () => {
  const d = depsNoite({});
  comVarredura(d, {
    containers: [{ id: 'c-ontem', due_date: '2026-09-06' }],
    filhasPorContainer: { 'c-ontem': [{ id: 'f-velha', title: '08:00 Anamnese — Zé (Canto)' }] },
  });
  const v = await varrerPautasVelhas({ supabase: {}, groupId: 'grp', hoje: SEGUNDA, deps: d });
  assert.strictEqual(v.filhasVelhasFechadas, 1);
  assert.strictEqual(v.containersVelhosFechados, 1);
  assert.deepStrictEqual(v.avisos, [], 'varredura limpa não inventa aviso');
  assert.strictEqual(d.filhasFechadas[0].status, 'cancelled',
    'não dá pra afirmar quem preencheu num dia que já passou lendo a fonte de HOJE');
  assert.match(d.filhasFechadas[0].notes, /sem verificação/i);
  assert.strictEqual(d.gravados.length, 0,
    'dia sem medição NÃO conta na escada — nem quando a limpeza roda de manhã');
});

// A varredura da manhã roda ANTES da montagem do dia. Se ela alcançasse `due_date = hoje`,
// arquivaria o container que a montagem cria no mesmo tick e a equipe abriria o painel vazio. A
// trava é estrutural, no filtro da consulta: `lt('due_date', hoje)`, estritamente menor.
test('a varredura NUNCA alcança o container de hoje — o filtro é estritamente menor que hoje', async () => {
  const chamadas = [];
  const q = {
    select: () => q,
    eq: (c, v) => { chamadas.push(['eq', c, v]); return q; },
    like: (c, v) => { chamadas.push(['like', c, v]); return q; },
    lt: (c, v) => { chamadas.push(['lt', c, v]); return q; },
    gte: (c, v) => { chamadas.push(['gte', c, v]); return q; },
    order: () => q,
    limit: async () => ({ data: [], error: null }),
  };
  // `deps` vazio de propósito: exercita a consulta REAL (_listarContainersVelhosAbertos), não um
  // fake — o filtro é o que está sendo testado, e um fake o esconderia.
  const v = await varrerPautasVelhas({ supabase: { from: () => q }, groupId: 'grp', hoje: SEGUNDA, deps: {} });
  assert.deepStrictEqual(v.avisos, []);
  assert.ok(chamadas.some(([op, col, val]) => op === 'lt' && col === 'due_date' && val === SEGUNDA),
    'sem o `lt` a varredura da manhã arquivaria a pauta que acabou de nascer');
  assert.ok(!chamadas.some(([op, col, val]) => op === 'eq' && col === 'due_date' && val === SEGUNDA),
    'o container de HOJE é assunto do fechamento das 23:00, nunca da limpeza');
});

// Serviço de limpeza não pode derrubar quem chama: de manhã, quem vem depois é a MONTAGEM da
// pauta do dia — o trabalho de verdade. A varredura devolve o problema em `avisos`, não por throw.
test('varredura que falha devolve aviso em vez de lançar — a montagem da manhã não pode cair junto', async () => {
  const d = depsNoite({});
  comVarredura(d, { erroLista: 'conexão caiu' });
  const v = await varrerPautasVelhas({ supabase: {}, groupId: 'grp', hoje: SEGUNDA, deps: d });
  assert.strictEqual(v.containersVelhosFechados, 0);
  assert.strictEqual(v.avisos.length, 1);
  assert.match(v.avisos[0], /dias anteriores|varr/i);
});

// ── RESÍDUO 3: FILHA DE HOJE QUE NÃO FECHA DEIXA O CONTAINER ABERTO ─────────────────────────
// O fechamento de HOJE chamava fecharContainer INCONDICIONALMENTE depois do laço: bastava uma
// filha não fechar pra sobrar uma `pending` pendurada num container `done`. A varredura procura
// CONTAINERS abertos, nunca filhas soltas — essa órfã não é achada por ninguém, some do painel do
// grupo e fica envelhecendo nos relatórios de atrasadas pra sempre. A varredura dos dias velhos
// já fazia o certo (teste logo acima); o fechamento de hoje estava inconsistente com ela.
test('filha de HOJE que não fecha deixa o container aberto — órfã invisível não é achada por ninguém', async () => {
  const d = depsNoite({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', false)],
    daPauta: ['pk-Ana', 'pk-Bia'],
    containerId: 'cont-hoje',
    filhasPendentes: [
      { id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' },
      { id: 'f-bia', title: '08:00 Anamnese — Bia (Canto)' },
    ],
  });
  comVarredura(d, { containers: [] });   // varredura fora do caminho: o assunto aqui é HOJE
  d.fecharFilha = async (_sb, arg) => { d.filhasFechadas.push(arg); return arg.id !== 'f-bia'; };
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(d.containerFechadoChamadas.length, 0,
    'container done em cima de filha pending esconde a órfã pra sempre');
  assert.strictEqual(r.containerFechado, false, 'o resultado precisa DIZER que o container ficou aberto');
  assert.strictEqual(r.filhasFechadasComoFeitas, 1, 'a filha que fechou continua contada');
  assert.match(r.motivo, /Bia/, 'o aviso que já existe é quem explica o motivo');
});

// O caminho feliz não pode ter sido quebrado pela condição acima: com todas as filhas fechando,
// o container FECHA — é a aposta central do desenho (nada se acumula no painel).
test('todas as filhas de hoje fecharam → o container fecha, como sempre', async () => {
  const d = depsNoite({
    alunos: [aluno('Ana', '09:00', true)], daPauta: ['pk-Ana'],
    containerId: 'cont-hoje', filhasPendentes: [{ id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' }],
  });
  comVarredura(d, { containers: [] });
  const r = await fecharPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.containerFechado, true);
  assert.strictEqual(d.containerFechadoChamadas.length, 1);
  assert.strictEqual(r.motivo, null, 'noite limpa não inventa motivo');
});
