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

// ── PASSADA DE ATUALIZAÇÃO DO MEIO DO DIA (04/09) ────────────────────────────────────────────
// Hoje a lista do dia fica CONGELADA: o aluno preenche a anamnese no tablet às 10h e a tarefa
// continua na tela até as 23:00. A passada de atualização faz a lista ENCOLHER ao longo do dia.
//
// Ela é um SUBCONJUNTO ESTRITO do fechamento das 23:00 — a diferença não é de implementação, é
// de EPISTEMOLOGIA: às 23:00 o dia acabou e é preciso decidir sobre todo mundo; às 14:00 o dia
// ainda está correndo e quem não preencheu ainda pode preencher às 19:00. Por isso a única
// escrita permitida é `done`, e "não sei ainda" é sempre "não mexe" — nunca uma decisão.
const {
  atualizarPautaDaUnidade, REFRESH_LOTE_MAXIMO, REFRESH_FRACAO_MAXIMA,
} = require('./anamnese-pauta');

function depsRefresh({
  rpcErro = null, alunos = [],
  containerId = 'cont-1', filhasPendentes = [], erroAcharContainer = null, erroListarFilhas = null,
  fecharFilhaOk = () => true,
} = {}) {
  const filhasFechadas = [];
  const containerFechadoChamadas = [];
  const titulosChecados = [];
  // Um repo que EXPLODE, não um espião silencioso. Tocar anamnese_pauta no meio do dia não é
  // "detalhe a revisar depois": a escada é gravada UMA vez, às 23:00 — gravar às 14h faz o aluno
  // levar `nao_preencheu` por um dia que ainda não acabou. Se um dia alguém "aproveitar" esta
  // passada pra adiantar a gravação, o teste tem que quebrar ALTO, não devolver um motivo bonito.
  const repoProibido = {
    registrarAparicoes: async () => { throw new Error('PROIBIDO: a atualização tocou anamnese_pauta'); },
    contarFalhas: async () => { throw new Error('PROIBIDO: a atualização tocou anamnese_pauta'); },
    pessoasDoDia: async () => { throw new Error('PROIBIDO: a atualização tocou anamnese_pauta'); },
    gravarResultado: async () => { throw new Error('PROIBIDO: a atualização tocou anamnese_pauta'); },
  };

  // ── O DUBLÊ DESCEU UMA CAMADA (lacuna 3, 04/09) ────────────────────────────────────────────
  // Antes, `fecharFilha` era dublado e o teste guardava o ARGUMENTO ({id, status, notes}). Só que
  // a regra desta feature é "fecha como done E carimba `completed_at`", e o `completed_at` nasce
  // DENTRO do _fecharFilha real — nunca chegava ao argumento, e por isso não era asserido em
  // lugar nenhum da suíte. Um dia em que o carimbo se perdesse (refatoração do helper, ou um
  // fecho por outro caminho) a suíte continuaria verde, e a filha ficaria `done` sem hora — o
  // painel e os relatórios contam por `completed_at`.
  //
  // Agora o dublê é o CLIENTE, não o helper: o _fecharFilha REAL roda contra este supabase de
  // mentira e o teste guarda o payload que ele de fato monta. É o que a produção grava, não uma
  // cópia da regra reescrita aqui — que seria uma asserção vazia, sempre verde por construção.
  // `fecharFilhaOk` continua injetando falha, agora pela porta real: o UPDATE que não casa linha
  // nenhuma (o falso-sucesso do PostgREST) devolve `data: []`.
  const tabelasEscritas = [];
  const supabaseTasks = {
    from(tabela) {
      tabelasEscritas.push(tabela);
      let payload = null;
      const chain = {
        update(p) { payload = { ...p }; return chain; },
        eq(_coluna, valor) { payload = { ...payload, id: valor }; return chain; },
        select: async () => {
          filhasFechadas.push(payload);
          return { data: fecharFilhaOk(payload) ? [{ id: payload.id }] : [], error: null };
        },
      };
      return chain;
    },
  };

  return {
    filhasFechadas, containerFechadoChamadas, titulosChecados, tabelasEscritas, supabaseTasks,
    repo: repoProibido,
    laReport: { rpc: async () => ({ data: rpcErro ? null : alunos, error: rpcErro }) },
    acharContainer: async (_sb, { titulo }) => {
      titulosChecados.push(titulo);
      if (erroAcharContainer) return { containerId: null, erro: erroAcharContainer };
      return { containerId, erro: null };
    },
    listarFilhasPendentes: async () => {
      if (erroListarFilhas) return { filhas: null, erro: erroListarFilhas };
      return { filhas: filhasPendentes, erro: null };
    },
    // `fecharFilha` NÃO entra em deps de propósito: sem ele, atualizarPautaDaUnidade cai no
    // _fecharFilha real e é o payload dele que o supabaseTasks acima captura.
    fecharContainer: async (_sb, arg) => { containerFechadoChamadas.push(arg); return true; },
  };
}

const rodarRefresh = (d, extra = {}) => atualizarPautaDaUnidade({
  supabase: d.supabaseTasks, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', hoje: SEGUNDA, deps: d, ...extra,
});

// `completed_at` tem que ser hora de verdade, não um truthy qualquer: um `true` ou uma string
// vazia passariam num assert.ok e chegariam ao banco como lixo na coluna que o painel usa.
function assertFechouComoDone(payload, msg) {
  assert.strictEqual(payload.status, 'done', `${msg}: no meio do dia a única escrita permitida é done`);
  assert.ok(typeof payload.completed_at === 'string' && !Number.isNaN(Date.parse(payload.completed_at)),
    `${msg}: fechar é "done E completed_at" — sem o carimbo a filha some da tela sem hora (recebido: ${JSON.stringify(payload.completed_at)})`);
}

// O CASO CENTRAL. Ana preencheu no tablet às 10h; Bia ainda não. Às 11:00 a lista encolhe pela
// Ana — e a Bia CONTINUA lá, porque o dia dela não acabou. Fechar a Bia agora seria mentir.
test('atualização: quem preencheu fecha como done; quem não preencheu CONTINUA pending', async () => {
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', false)],
    filhasPendentes: [
      { id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' },
      { id: 'f-bia', title: '08:00 Anamnese — Bia (Canto)' },
    ],
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.atualizou, true);
  assert.strictEqual(d.filhasFechadas.length, 1, 'só a Ana pode ser tocada');
  assert.strictEqual(d.filhasFechadas[0].id, 'f-ana');
  assertFechouComoDone(d.filhasFechadas[0], 'a Ana saiu da tela');
  assert.strictEqual(r.fechadas, 1);
  assert.strictEqual(r.continuamPendentes, 1, 'a Bia segue na tela — ela ainda pode preencher às 19h');
  assert.strictEqual(r.motivo, null, 'dia saudável: motivo null é o sensor de "zero por saúde" desta casa');
});

// O CONTRÁRIO DA NOITE, de propósito. Às 23:00 duas "Ana" ainda pendentes viram `cancelled`
// porque o dia acabou e é preciso decidir. Às 14:00 ambíguo é "não sei AINDA" — a filha fica
// exatamente como está, pro fechamento resolver com a fonte da noite.
test('atualização: nome ambíguo NÃO é tocado (às 23:00 vira cancelled; no meio do dia, não)', async () => {
  const ana2 = { ...aluno('Ana', '09:30', false), pessoa_chave: 'pk-Ana2' }; // homônima, pk diferente
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', false), ana2],
    filhasPendentes: [{ id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' }],
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(d.filhasFechadas.length, 0, 'duas Anas pendentes — não dá pra saber qual é; não mexe');
  assert.strictEqual(r.fechadas, 0);
  assert.strictEqual(r.continuamPendentes, 1);
  assert.strictEqual(r.naoDecididas, 1, 'ambíguo tem contador próprio: não é o mesmo que "não preencheu ainda"');
  assert.strictEqual(r.motivo, null, 'ambíguo NÃO é falha — não pode virar fallback e re-rodar a RPC 3x no slot');
});

test('atualização: filha sem correspondência na fonte NÃO é tocada (nunca done no escuro)', async () => {
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', false)],
    filhasPendentes: [{ id: 'f-fantasma', title: '09:00 Anamnese — Alguém Que Sumiu' }],
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(d.filhasFechadas.length, 0, 'nome que não bate com ninguém não é prova de que preencheu');
  assert.strictEqual(r.naoDecididas, 1);
});

test('atualização: título que não casa o formato da filha NÃO é tocado', async () => {
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', true)],
    filhasPendentes: [{ id: 'f-torta', title: 'tarefa qualquer que alguém criou dentro do pacote' }],
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(d.filhasFechadas.length, 0, 'não deu pra extrair o nome — adivinhar aqui fecharia tarefa alheia');
  assert.strictEqual(r.naoDecididas, 1);
});

// FALHA-FECHADA: sem a fonte não dá pra AFIRMAR que alguém preencheu. Fechar no escuro marcaria
// `done` em quem não fez — e `done` no meio do dia some da tela, ou seja, some da cobrança.
test('atualização: RPC falha → não fecha NADA e o motivo diz por quê', async () => {
  const d = depsRefresh({
    rpcErro: { message: 'timeout' },
    filhasPendentes: [{ id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' }],
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(d.filhasFechadas.length, 0);
  assert.strictEqual(r.fechadas, 0);
  assert.ok(r.motivo && /atualiza/i.test(r.motivo),
    '"não fechei porque a fonte caiu" precisa de sensor próprio, distinto de "ninguém preencheu ainda" (motivo null)');
  assert.strictEqual(r.semPauta, undefined, 'fonte caída é FALHA (fallback), não desfecho resolvido');
});

// A regra sagrada da feature: a escada é gravada UMA vez, às 23:00. O repo injetado aqui EXPLODE
// em qualquer método — se o caminho feliz sobrevive, é porque nenhum deles foi chamado.
test('atualização: NENHUM caminho grava em anamnese_pauta', async () => {
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', false)],
    filhasPendentes: [
      { id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' },
      { id: 'f-bia', title: '08:00 Anamnese — Bia (Canto)' },
    ],
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.fechadas, 1, 'o caminho feliz rodou até o fim sem tocar no repo da escada');
  assert.strictEqual(r.motivo, null, 'se o repo tivesse sido chamado, o throw viraria motivo — e este assert quebraria');
  // Segunda tranca, agora pelo CLIENTE: o repo é a porta que a noite usa, mas quem escrevesse
  // direto em `anamnese_pauta` pelo supabase passaria por baixo dele. A única tabela que esta
  // passada pode tocar é `tasks`.
  assert.deepStrictEqual(d.tabelasEscritas, ['tasks'],
    'a atualização do meio do dia só pode escrever em tasks — anamnese_pauta é gravada UMA vez, às 23:00');
});

// LACUNA 3 (04/09): a regra é "fecha como done E carimba completed_at", e o carimbo não era
// asserido em canto nenhum da suíte. Ele é o que o painel e os relatórios usam pra saber QUANDO
// a filha saiu da tela; sem ele a linha vira `done` sem hora e some da contagem do dia.
test('atualização: fechar é done E completed_at — o carimbo de hora chega ao UPDATE', async () => {
  const antes = Date.now();
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', true)],
    filhasPendentes: [{ id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' }],
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.fechadas, 1);
  const payload = d.filhasFechadas[0];
  assertFechouComoDone(payload, 'o UPDATE que foi pro banco');
  const carimbo = Date.parse(payload.completed_at);
  assert.ok(carimbo >= antes && carimbo <= Date.now(),
    `completed_at tem que ser a hora do fecho, não uma data qualquer (recebido: ${payload.completed_at})`);
  assert.ok(!('notes' in payload),
    'sair da tela porque o aluno preencheu é o caminho normal — não leva bilhete de exceção');
});

test('atualização: NENHUMA filha é fechada como cancelled, em nenhum cenário', async () => {
  const ana2 = { ...aluno('Ana', '09:30', false), pessoa_chave: 'pk-Ana2' };
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', false), ana2, aluno('Bia', '08:00', false), aluno('Cid', '10:00', true)],
    filhasPendentes: [
      { id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' },       // ambígua
      { id: 'f-bia', title: '08:00 Anamnese — Bia (Canto)' },       // não preencheu
      { id: 'f-cid', title: '10:00 Anamnese — Cid (Canto)' },       // preencheu
      { id: 'f-x', title: '11:00 Anamnese — Ninguém' },             // sem correspondência
      { id: 'f-y', title: 'formato torto' },                        // sem nome
    ],
  });
  await rodarRefresh(d);
  assert.ok(d.filhasFechadas.every((f) => f.status === 'done'),
    'no meio do dia "não fez" é mentira — cancelled é decisão de fim de dia, e só a noite pode tomá-la');
  for (const f of d.filhasFechadas) assertFechouComoDone(f, `filha ${f.id}`);
  assert.deepStrictEqual(d.filhasFechadas.map((f) => f.id), ['f-cid']);
});

test('atualização: NUNCA fecha o container — o dia não terminou', async () => {
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', true)],
    filhasPendentes: [{ id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' }],
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.fechadas, 1, 'fechou TODAS as filhas pendentes — e mesmo assim o container fica aberto');
  assert.strictEqual(d.containerFechadoChamadas.length, 0,
    'fechar o container tiraria a pauta da tela antes da última aula (20:00)');
});

// Domingo, ou um dia em que a manhã não montou pauta: não existe container. Isso NÃO é falha —
// é desfecho resolvido. Sem `semPauta`, o dispatcher carimbaria `fallback` (que nesta casa
// significa "tenta de novo") e re-rodaria a unidade em todo tick restante do slot, 7 slots por
// dia. Mesmo par de sensores da manhã: motivo textual pra quem lê o RETORNO, flag pro MARCADOR.
test('atualização: sem container de hoje → não faz nada, motivo próprio, e semPauta:true (skipped, não fallback)', async () => {
  const d = depsRefresh({ containerId: null, alunos: [aluno('Ana', '09:00', true)] });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.atualizou, false);
  assert.strictEqual(r.semPauta, true);
  assert.ok(r.motivo, 'sem container tem motivo próprio — quem lê o retorno precisa saber por quê');
  assert.strictEqual(d.filhasFechadas.length, 0);
});

// A checagem do container vem ANTES da RPC de propósito: a consulta do LA Report leva 6-8s e num
// dia sem pauta o resultado seria descartado de qualquer jeito, 7 vezes por dia por unidade.
test('atualização: sem container, nem chega a bater o LA Report', async () => {
  let bateu = 0;
  const d = depsRefresh({ containerId: null });
  d.laReport = { rpc: async () => { bateu += 1; return { data: [], error: null }; } };
  await rodarRefresh(d);
  assert.strictEqual(bateu, 0, 'RPC de 6-8s não pode rodar num dia que nem tem pauta pra atualizar');
});

test('atualização: erro ao PROCURAR o container → não fecha nada, e não é confundido com "não tem pauta"', async () => {
  const d = depsRefresh({ erroAcharContainer: 'column tasks.due_dat does not exist' });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.atualizou, false);
  assert.strictEqual(d.filhasFechadas.length, 0);
  assert.ok(r.motivo && /column/.test(r.motivo), 'o erro real do banco tem que chegar em quem lê');
  assert.notStrictEqual(r.semPauta, true,
    'leitura que FALHOU não pode virar "não tem pauta hoje" — é o zero-linhas-silencioso que já custou dois diagnósticos aqui');
});

test('atualização: erro ao listar as filhas pendentes → não fecha nada e diz por quê', async () => {
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', true)],
    erroListarFilhas: 'column tasks.parent_task does not exist',
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(d.filhasFechadas.length, 0);
  assert.ok(r.motivo && /filha/i.test(r.motivo));
});

test('atualização: container sem filha pendente é saúde (motivo null), não falha', async () => {
  const d = depsRefresh({ alunos: [aluno('Ana', '09:00', true)], filhasPendentes: [] });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.atualizou, true);
  assert.strictEqual(r.fechadas, 0);
  assert.strictEqual(r.continuamPendentes, 0);
  assert.strictEqual(r.motivo, null);
});

// Sem este `else` a falha seria MUDA: o contador não sobe, motivo fica null, o marcador diz
// `executed` e trava o slot — a filha some do radar até as 23:00. Mesmo raciocínio do
// IMPORTANT 2 no fechamento da noite.
//
// EXPECTATIVA MUDADA (lacuna 4, 04/09): este teste exigia a filha NOMEADA no motivo. O nome não
// cabia — o reason do marcador tem 120 chars, a chave gasta 67, e com ` falha=N` na frente o
// motivo só tinha ~18: o banco guardava `erro=nenhuma filha fech`, sem nome E sem número. A
// exigência virou a CONTAGEM, que cabe; os nomes continuam saindo um a um no console.error de
// dentro do laço, que é onde a depuração precisa deles. O teste não afrouxou de escopo — mudou
// de canal: o que se cobra do marcador agora é o que o marcador consegue carregar.
test('atualização: filha que não fecha entra no motivo, CONTADA (o nome fica no console.error)', async () => {
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', true)],
    filhasPendentes: [{ id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' }],
    fecharFilhaOk: () => false, // UPDATE que não casa linha nenhuma (o falso-sucesso do PostgREST)
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.fechadas, 0, 'não gravou — não pode contar como fechada');
  assert.strictEqual(r.continuamPendentes, 1, 'ela continua na tela; o contador tem que dizer isso');
  assert.ok(r.motivo && /\b1 filha/.test(r.motivo),
    `"alguma coisa falhou" não dá pra investigar — o motivo precisa dizer QUANTAS: ${r.motivo}`);
});

test('atualização: sem groupId não sai procurando container no escuro', async () => {
  const d = depsRefresh({ alunos: [aluno('Ana', '09:00', true)] });
  const r = await rodarRefresh(d, { groupId: null });
  assert.strictEqual(r.atualizou, false);
  assert.strictEqual(d.titulosChecados.length, 0);
  assert.ok(r.motivo);
});

// Fonte única do título: se a atualização montasse a string por conta própria, ela procuraria um
// container que a manhã não cria — e a lista simplesmente nunca encolheria, em silêncio.
test('atualização: o título procurado é o MESMO que a manhã usa pra criar', async () => {
  const manha = deps({ alunos: [aluno('Ana', '09:00', false)] });
  await montarPautaDaUnidade({
    supabase: {}, laReport: manha.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: manha,
  });
  const d = depsRefresh({ alunos: [aluno('Ana', '09:00', false)] });
  await rodarRefresh(d);
  assert.strictEqual(d.titulosChecados[0], manha.criadas[0].input.title,
    'texto divergente = guarda cega: a atualização nunca acharia a pauta da manhã');
});

// Os motivos são SENSORES. Se dois desfechos diferentes saem com o mesmo texto, quem lê
// marker_logs não distingue "a fonte caiu" de "não tem pauta hoje" de "não consegui procurar".
test('atualização: cada desfecho tem motivo TEXTUALMENTE distinto', async () => {
  const filha = [{ id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' }];
  const motivos = [
    (await rodarRefresh(depsRefresh({ containerId: null }))).motivo,
    (await rodarRefresh(depsRefresh({ erroAcharContainer: 'boom' }))).motivo,
    (await rodarRefresh(depsRefresh({ rpcErro: { message: 'timeout' }, filhasPendentes: filha }))).motivo,
    (await rodarRefresh(depsRefresh({ erroListarFilhas: 'boom', alunos: [aluno('Ana', '09:00', true)] }))).motivo,
    (await rodarRefresh(depsRefresh({}), { groupId: null })).motivo,
    // Brecha 2: o disjuntor de fechamento em massa é uma GUARDA NOVA, e cada guarda desta casa
    // tem sensor próprio. 30 de 30 pendentes fechariam de uma vez — acima dos dois gatilhos.
    (await rodarRefresh(depsRefresh({
      alunos: Array.from({ length: 30 }, (_, i) => aluno(`P${i}`, '09:00', true)),
      filhasPendentes: Array.from({ length: 30 }, (_, i) => ({ id: `f-${i}`, title: `09:00 Anamnese — P${i}` })),
    }))).motivo,
    // Brecha 1: "nenhuma fechou E houve falha" também é desfecho próprio — não houve trabalho,
    // só erro. Não pode sair com o mesmo texto de nenhum dos outros.
    (await rodarRefresh(depsRefresh({
      alunos: [aluno('Ana', '09:00', true)], filhasPendentes: filha, fecharFilhaOk: () => false,
    }))).motivo,
  ];
  assert.ok(motivos.every((m) => typeof m === 'string' && m.length),
    'todo desfecho que NÃO é o caminho feliz precisa de motivo');
  assert.strictEqual(new Set(motivos).size, motivos.length, 'motivos repetidos = sensores cegos');
});

// ── BRECHA 1: filha travada não pode reabrir o slot inteiro ──────────────────────────────────
// O dispatcher mapeia QUALQUER `motivo` pra `fallback`, e `fallback` (por desenho) NÃO trava a
// chave de idempotência do slot. Enquanto a falha de UMA filha virava motivo, uma linha apagada
// entre o SELECT e o UPDATE — ou uma RLS, ou um trigger recusando — custava 3 RPCs de 6-8s por
// slot × 7 slots = 21 consultas por unidade por dia, em vez de 7. O trabalho ACONTECEU (as
// outras filhas fecharam); o desfecho é `executed` e a falha vira contador, não sensor de retry.
test('atualização: filha travada com outras fechando → executed (motivo null) e a falha vai pro CONTADOR', async () => {
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', true), aluno('Cid', '10:00', true)],
    filhasPendentes: [
      { id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' },
      { id: 'f-bia', title: '08:00 Anamnese — Bia (Canto)' },
      { id: 'f-cid', title: '10:00 Anamnese — Cid (Canto)' },
    ],
    fecharFilhaOk: (arg) => arg.id !== 'f-bia',   // a Bia está travada (linha some, RLS, trigger)
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.atualizou, true);
  assert.strictEqual(r.fechadas, 2, 'Ana e Cid saíram da tela — o trabalho do slot aconteceu');
  assert.strictEqual(r.falhasAoFechar, 1, 'a falha da Bia tem contador PRÓPRIO, e ele precisa existir');
  assert.strictEqual(r.continuamPendentes, 1, 'a Bia de fato continua na tela');
  assert.strictEqual(r.motivo, null,
    'motivo preenchido = fallback no dispatcher = chave do slot destravada = 21 RPCs por unidade por dia');
});

// O sinal não pode ser jogado fora junto com o ruído: se NENHUMA filha fechou e houve falha,
// não houve trabalho nenhum — só erro. Aí `fallback` é a verdade, e retentar é o certo.
test('atualização: NENHUMA fechou e houve falha → motivo (fallback), porque não houve trabalho', async () => {
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', true)],
    filhasPendentes: [
      { id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' },
      { id: 'f-bia', title: '08:00 Anamnese — Bia (Canto)' },
    ],
    fecharFilhaOk: () => false,
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.fechadas, 0);
  assert.strictEqual(r.falhasAoFechar, 2);
  assert.ok(r.motivo, 'zero trabalho + erro é FALHA: tem que voltar como fallback e retentar');
  // Mesma troca de canal do teste acima (lacuna 4): a lista de nomes não sobrevivia ao corte de
  // 120 chars do reason, a contagem sobrevive, e os nomes saem no console.error, um por um.
  assert.ok(/\b2 filha/.test(r.motivo), `as filhas travadas precisam ser CONTADAS: ${r.motivo}`);
  assert.notStrictEqual(r.semPauta, true, 'falha nunca pode virar desfecho resolvido');
});

// ── BRECHA 2: disjuntor de fechamento em massa ───────────────────────────────────────────────
// A única falha desta feature sem defesa nenhuma: se a fonte um dia disser que TODO MUNDO
// preencheu (incidente de dado, não mudança de schema), a passada do meio do dia esvazia o
// painel das três unidades em silêncio, carimba `executed`, e o primeiro sinal humano é a tela
// vazia. "Zero por FALHA idêntico a zero por SAÚDE" — a classe de bug que esta casa mais sangra.
test('atualização: fechamento em massa acima do teto → NÃO fecha NADA, fallback com motivo próprio', async () => {
  const n = 30;
  const d = depsRefresh({
    alunos: Array.from({ length: n }, (_, i) => aluno(`P${i}`, '09:00', true)),
    filhasPendentes: Array.from({ length: n }, (_, i) => ({ id: `f-${i}`, title: `09:00 Anamnese — P${i}` })),
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(d.filhasFechadas.length, 0,
    'não fecha NENHUMA — meia pauta esvaziada é pior que nenhuma, e não dá pra desfazer depois');
  assert.strictEqual(r.fechadas, 0);
  assert.strictEqual(r.atualizou, false);
  assert.ok(r.motivo && /disjuntor/i.test(r.motivo), 'sensor próprio: nenhum outro motivo do arquivo fala em disjuntor');
  assert.notStrictEqual(r.semPauta, true, 'é FALHA (fallback), não "não tem pauta hoje"');
});

// O teto tem que ser DOIS gatilhos ao mesmo tempo. Só proporção erraria em lote pequeno (o teste
// seguinte); só número absoluto erraria aqui — 20 filhas de uma vez é muito, mas 20 de 48 é um
// dia movimentado numa unidade que abre com 48 pendentes, não um incidente de dado.
test('atualização: fechamento GRANDE mas dentro do teto proporcional fecha normalmente', async () => {
  const preencheram = 20; const pendentes = 48;
  const alunos = Array.from({ length: pendentes }, (_, i) => aluno(`P${i}`, '09:00', i < preencheram));
  const d = depsRefresh({
    alunos,
    filhasPendentes: Array.from({ length: pendentes }, (_, i) => ({ id: `f-${i}`, title: `09:00 Anamnese — P${i}` })),
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.fechadas, preencheram, '20 de 48 (41%) é dia movimentado, não incidente');
  assert.strictEqual(d.filhasFechadas.length, preencheram);
  assert.strictEqual(r.motivo, null, 'dia movimentado não pode virar fallback e re-rodar a RPC 3x no slot');
});

// O caso que mata a porcentagem sozinha: às 21:00 sobra pouca gente pendente, e fechar 4 de 5
// (80%) é o comportamento NORMAL do último slot do dia. Um disjuntor só percentual travaria a
// pauta justamente na hora em que ela deve terminar de encolher.
test('atualização: 4 de 5 (80%) NÃO dispara o disjuntor — proporção alta em lote pequeno é saúde', async () => {
  const alunos = Array.from({ length: 5 }, (_, i) => aluno(`P${i}`, '20:00', i < 4));
  const d = depsRefresh({
    alunos,
    filhasPendentes: Array.from({ length: 5 }, (_, i) => ({ id: `f-${i}`, title: `20:00 Anamnese — P${i}` })),
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.fechadas, 4, '80% num lote de 5 é o slot das 21:00 fazendo exatamente o que deve');
  assert.strictEqual(r.continuamPendentes, 1);
  assert.strictEqual(r.motivo, null);
});

// ── A FRONTEIRA DA FRAÇÃO (lacuna 1, 04/09) ─────────────────────────────────────────────────
// POR QUE ESTE PAR EXISTE: sem ele, REFRESH_FRACAO_MAXIMA não era travada por teste NENHUM.
// Os seis cenários acima usam 100% (30/30, 15/15, 16/16, 40/40), 41,7% (20/48) e 80% (4/5, que
// nem chega ao teto absoluto) — nenhum deles encosta em 0,6. Medido: trocar a constante por 0,9
// (ou 0,99) deixava a suíte INTEIRA verde, e um incidente real de 24 de 27 (88,9%) deixaria de
// disparar em produção, em silêncio. O lado de BAIXO já estava protegido (qualquer valor abaixo
// de ~0,42 quebra o teste do dia movimentado, 20 de 48); faltava o de CIMA.
//
// 18 de 30 é EXATAMENTE 60%: o gatilho é `>` estrito, então `18 > 30*0,6` é `18 > 18` = falso e
// a pauta encolhe normalmente. 19 de 30 é o primeiro caso acima da fração, e trava. Subir a
// constante mantém o primeiro verde e derruba o segundo — que é o ponto do par.
test('atualização: 18 de 30 é EXATAMENTE 60% e NÃO dispara — o gatilho da fração é ">" estrito', async () => {
  const preencheram = 18; const pendentes = 30;
  const d = depsRefresh({
    alunos: Array.from({ length: pendentes }, (_, i) => aluno(`P${i}`, '09:00', i < preencheram)),
    filhasPendentes: Array.from({ length: pendentes }, (_, i) => ({ id: `f-${i}`, title: `09:00 Anamnese — P${i}` })),
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(r.fechadas, preencheram,
    'em cima da fração o disjuntor NÃO dispara: 18 > 30*0,6 é 18 > 18, falso');
  assert.strictEqual(d.filhasFechadas.length, preencheram);
  assert.strictEqual(r.motivo, null, 'a fronteira exata é saúde, não fallback');
});

test('atualização: 19 de 30 (63,3%) DISPARA — é o primeiro lote acima da fração', async () => {
  const preencheram = 19; const pendentes = 30;
  const d = depsRefresh({
    alunos: Array.from({ length: pendentes }, (_, i) => aluno(`P${i}`, '09:00', i < preencheram)),
    filhasPendentes: Array.from({ length: pendentes }, (_, i) => ({ id: `f-${i}`, title: `09:00 Anamnese — P${i}` })),
  });
  const r = await rodarRefresh(d);
  assert.strictEqual(d.filhasFechadas.length, 0,
    'um passo acima da fração já trava — e é ESTE assert que fica vermelho se alguém subir REFRESH_FRACAO_MAXIMA');
  assert.strictEqual(r.fechadas, 0);
  assert.ok(r.motivo && /disjuntor/i.test(r.motivo));
});

// A fronteira exata, escrita como teste pra que mexer nos números quebre algo visível em vez de
// mudar o comportamento em produção em silêncio.
test('atualização: os dois gatilhos do disjuntor são EXPORTADOS e o teto é "> teto E > fração"', async () => {
  assert.strictEqual(typeof REFRESH_LOTE_MAXIMO, 'number');
  assert.strictEqual(typeof REFRESH_FRACAO_MAXIMA, 'number');
  // Exatamente no teto absoluto (16 = REFRESH_LOTE_MAXIMO + 1 dispara; 15 não), com 100% —
  // prova que o número absoluto manda mesmo quando a proporção é total.
  const noLimite = REFRESH_LOTE_MAXIMO;
  const d1 = depsRefresh({
    alunos: Array.from({ length: noLimite }, (_, i) => aluno(`P${i}`, '09:00', true)),
    filhasPendentes: Array.from({ length: noLimite }, (_, i) => ({ id: `f-${i}`, title: `09:00 Anamnese — P${i}` })),
  });
  const r1 = await rodarRefresh(d1);
  assert.strictEqual(r1.fechadas, noLimite, `${noLimite} de ${noLimite} (100%) NÃO dispara: o gatilho é "mais de ${noLimite}"`);
  assert.strictEqual(r1.motivo, null);

  const acima = REFRESH_LOTE_MAXIMO + 1;
  const d2 = depsRefresh({
    alunos: Array.from({ length: acima }, (_, i) => aluno(`P${i}`, '09:00', true)),
    filhasPendentes: Array.from({ length: acima }, (_, i) => ({ id: `f-${i}`, title: `09:00 Anamnese — P${i}` })),
  });
  const r2 = await rodarRefresh(d2);
  assert.strictEqual(r2.fechadas, 0, `${acima} de ${acima} passa dos DOIS gatilhos e trava`);
});

// ── LACUNA 4 (04/09): os NÚMEROS têm que sobreviver ao corte do marcador ─────────────────────
// O dispatcher grava o reason em `marker_logs` cortado em 120 caracteres, e a chave de
// idempotência do slot (`pauta_refresh:<uuid>:<ymd>:<HH:MM>`) já come 67 deles. Somando o que o
// dispatcher escreve antes do motivo — ` fech=0 pend=NN nd=N` e ` erro=` — sobram 27 caracteres.
// O texto antigo abria com prosa ("disjuntor do meio do dia: 30 de 30 filhas pendentes...") e o
// banco guardava `erro=disjuntor do meio do dia: 3`: quem audita por marker_logs via QUE o
// disjuntor abriu, mas nunca o TAMANHO do lote barrado — que é justamente o número que separa
// "incidente de dado" de "dia estranho". O console.error tem o texto inteiro, mas o banco é onde
// se audita, e ninguém abre o journal do processo pra conferir uma pauta.
//
// O orçamento é DERIVADO aqui, não redigitado: se um dia o dispatcher passar a imprimir mais um
// contador antes do `erro=`, o número muda junto e o teste continua medindo a verdade. A prova
// de ponta a ponta (fórmula REAL do dispatcher, chave REAL de 67 chars) está no harness.
const ORCAMENTO_MOTIVO_NO_MARCADOR = 120
  - 'pauta_refresh:11111111-2222-3333-4444-555555555555:2026-09-04:17:00'.length
  - ' fech=0 pend=30 nd=0'.length
  - ' erro='.length;

test('atualização: o motivo do disjuntor põe os NÚMEROS antes do corte de 120 chars do marcador', async () => {
  const preencheram = 19; const pendentes = 30;   // assimétrico de propósito: 19 e 30 são distinguíveis
  const d = depsRefresh({
    alunos: Array.from({ length: pendentes }, (_, i) => aluno(`P${i}`, '09:00', i < preencheram)),
    filhasPendentes: Array.from({ length: pendentes }, (_, i) => ({ id: `f-${i}`, title: `09:00 Anamnese — P${i}` })),
  });
  const r = await rodarRefresh(d);
  const sobrevive = r.motivo.slice(0, ORCAMENTO_MOTIVO_NO_MARCADOR);
  assert.ok(/disjuntor/i.test(sobrevive),
    `o sensor tem que sobreviver ao corte, senão o marcador não diz nem QUE guarda abriu: ${JSON.stringify(sobrevive)}`);
  assert.ok(/\b19\b/.test(sobrevive),
    `o tamanho do lote barrado tem que sobreviver ao corte: ${JSON.stringify(sobrevive)}`);
  assert.ok(/\b30\b/.test(sobrevive),
    `o total de pendentes tem que sobreviver ao corte: ${JSON.stringify(sobrevive)}`);
});

// O sensor não pode ser distinto só do texto INTEIRO: ele é lido cortado. "disjuntor" é a
// palavra que diz a quem audita "vá olhar o LA Report, não a rede" — e ela precisa ser exclusiva
// deste desfecho entre TODOS os motivos do arquivo.
test('atualização: "disjuntor" é palavra EXCLUSIVA deste desfecho entre todos os motivos', async () => {
  const filha = [{ id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' }];
  const motivos = [
    (await rodarRefresh(depsRefresh({ containerId: null }))).motivo,
    (await rodarRefresh(depsRefresh({ erroAcharContainer: 'boom' }))).motivo,
    (await rodarRefresh(depsRefresh({ rpcErro: { message: 'timeout' }, filhasPendentes: filha }))).motivo,
    (await rodarRefresh(depsRefresh({ erroListarFilhas: 'boom', alunos: [aluno('Ana', '09:00', true)] }))).motivo,
    (await rodarRefresh(depsRefresh({}), { groupId: null })).motivo,
    (await rodarRefresh(depsRefresh({
      alunos: [aluno('Ana', '09:00', true)], filhasPendentes: filha, fecharFilhaOk: () => false,
    }))).motivo,
    (await rodarRefresh(depsRefresh({
      alunos: Array.from({ length: 30 }, (_, i) => aluno(`P${i}`, '09:00', true)),
      filhasPendentes: Array.from({ length: 30 }, (_, i) => ({ id: `f-${i}`, title: `09:00 Anamnese — P${i}` })),
    }))).motivo,
  ];
  assert.strictEqual(motivos.filter((m) => /disjuntor/i.test(m)).length, 1,
    'dois motivos com "disjuntor" = sensor cego: quem lê marker_logs deixa de saber qual guarda abriu');
});

// A mesma conta do outro desfecho que fala em número: "nenhuma fechou E N travaram". Aqui o
// orçamento é MENOR, porque o dispatcher ainda imprime ` falha=N` antes do `erro=` — e era esse
// o desfecho que gastava o pouco espaço listando NOMES de filhas. Os nomes já saem, um por um,
// no console.error de dentro do laço; no marcador o que importa é o TAMANHO do estrago.
const ORCAMENTO_MOTIVO_COM_CONTADOR_DE_FALHA = ORCAMENTO_MOTIVO_NO_MARCADOR - ' falha=80'.length;

test('atualização: "nenhuma fechou" põe a CONTAGEM antes do corte, e não gasta o espaço com nomes', async () => {
  const d = depsRefresh({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', true)],
    filhasPendentes: [
      { id: 'f-ana', title: '09:00 Anamnese — Ana (Canto)' },
      { id: 'f-bia', title: '08:00 Anamnese — Bia (Canto)' },
    ],
    fecharFilhaOk: () => false,
  });
  const r = await rodarRefresh(d);
  const sobrevive = r.motivo.slice(0, ORCAMENTO_MOTIVO_COM_CONTADOR_DE_FALHA);
  assert.ok(/\b2\b/.test(sobrevive),
    `quantas filhas travaram é o número que o marcador precisa carregar: ${JSON.stringify(sobrevive)}`);
  assert.ok(!/Ana|Bia/.test(r.motivo),
    'nome de filha no reason come o orçamento e não cabe: os nomes ficam no console.error, um por um');
});

// A ordem importa: o disjuntor decide ANTES de qualquer UPDATE. Se ele contasse depois de
// escrever, "não fecha nada" seria mentira — metade da pauta já teria ido embora.
test('atualização: o disjuntor decide ANTES de escrever — nenhuma filha é tocada antes da conta', async () => {
  const n = 40;
  const d = depsRefresh({
    alunos: Array.from({ length: n }, (_, i) => aluno(`P${i}`, '09:00', true)),
    filhasPendentes: Array.from({ length: n }, (_, i) => ({ id: `f-${i}`, title: `09:00 Anamnese — P${i}` })),
  });
  await rodarRefresh(d);
  assert.deepStrictEqual(d.filhasFechadas, [], 'zero chamadas de fecharFilha, não "algumas e aí parou"');
});

// ── O RELATÓRIO DE FIM DE DIA (pedido do Alf, 04/09) ─────────────────────────────────────────
// "no final do dia ele manda uma lista do que foi feito ali no dia. Alunos que tiveram na escola
// e não preencheram a anamnese." Barra 19:30, Campo Grande e Recreio 20:30.
//
// Ele LÊ o dia. Não grava na escada, não fecha filha, não fecha container — quem faz isso
// continua sendo o fechamento das 23:00. Os fakes de ESCRITA abaixo existem exatamente pra
// provar que ninguém os chama.
const { relatorioDeFimDeDia } = require('./anamnese-pauta');

function depsRelatorio({ rpcErro = null, alunos = [], daPauta = [], erroPessoas = false } = {}) {
  const escritas = [];
  return {
    escritas,
    laReport: { rpc: async () => ({ data: rpcErro ? null : alunos, error: rpcErro }) },
    repo: {
      pessoasDoDia: async () => (erroPessoas ? null : daPauta),
      // Qualquer uma destas sendo chamada é BUG: o relatório é leitura.
      gravarResultado: async (_sb, arg) => { escritas.push(['gravarResultado', arg]); return true; },
      registrarAparicoes: async (_sb, arg) => { escritas.push(['registrarAparicoes', arg]); return { gravadas: 0, erro: null }; },
    },
    fecharFilha: async (_sb, arg) => { escritas.push(['fecharFilha', arg]); return true; },
    fecharContainer: async (_sb, arg) => { escritas.push(['fecharContainer', arg]); return true; },
  };
}

const rodarRelatorio = (d) => relatorioDeFimDeDia({
  supabase: {}, laReport: d.laReport, unidadeId: 'u1', hoje: SEGUNDA, deps: d,
});

test('fim de dia: conta quem preencheu e NOMEIA quem escapou, lendo a fonte', async () => {
  const d = depsRelatorio({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', false), aluno('Cid', '10:00', false)],
    daPauta: ['pk-Ana', 'pk-Bia', 'pk-Cid'],
  });
  const r = await rodarRelatorio(d);
  assert.strictEqual(r.preencheram, 1);
  assert.strictEqual(r.faltaram.length, 2);
  assert.strictEqual(r.semVerificacao, 0);
  assert.match(r.texto, /Hoje 1 dos 3 alunos da pauta preencheram a anamnese/);
  // Ordem por HORÁRIO, igual à pauta da manhã: 08:00 Bia antes de 10:00 Cid.
  assert.match(r.texto, /Faltaram 2: 08:00 Bia · 10:00 Cid/);
  // \bAna\b, não /Ana/: o cabeçalho da própria mensagem é "*Anamnese — ...*" e casaria com o
  // fragmento solto, transformando este teste num falso vermelho eterno.
  assert.doesNotMatch(r.texto, /\bAna\b/, 'quem preencheu não vai na lista de quem escapou');
  assert.match(r.texto, /Semana que vem eu lembro de novo/);
  assert.strictEqual(r.motivo, null, 'dia normal não tem motivo — motivo é sensor de problema');
});

// A trava principal desta função: ela não pode encostar em nada que escreve.
test('fim de dia: NÃO grava na escada, não fecha filha e não fecha container', async () => {
  const d = depsRelatorio({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', false)],
    daPauta: ['pk-Ana', 'pk-Bia'],
  });
  await rodarRelatorio(d);
  assert.deepStrictEqual(d.escritas, [], 'o relatório é leitura — quem fecha o dia é o ritual das 23:00');
});

test('fim de dia: pauta vazia hoje é silêncio, não um relatório de zeros', async () => {
  const d = depsRelatorio({ daPauta: [] });
  const r = await rodarRelatorio(d);
  assert.strictEqual(r.texto, null);
  assert.strictEqual(r.motivo, null, 'zero por saúde nunca vira string de erro');
});

// Nunca afirmar número que não foi medido: sem fonte, o relatório DIZ que não apurou.
test('fim de dia: fonte fora vira "não consegui apurar", nunca zeros', async () => {
  const d = depsRelatorio({ rpcErro: { message: 'timeout' }, daPauta: ['pk-Ana'] });
  const r = await rodarRelatorio(d);
  assert.match(r.texto, /não consegui/i);
  assert.doesNotMatch(r.texto, /Dia bom/);
  assert.ok(r.motivo && /timeout/.test(r.motivo), `motivo tem que carregar o erro real: ${r.motivo}`);
  assert.deepStrictEqual(d.escritas, []);
});

// pessoasDoDia devolve null quando a LEITURA falha — diferente de "ninguém na pauta hoje" ([]).
// Confundir os dois faria o relatório calar num dia cheio, e ninguém saberia.
test('fim de dia: falha ao ler quem entrou na pauta não vira silêncio', async () => {
  const d = depsRelatorio({ erroPessoas: true });
  const r = await rodarRelatorio(d);
  assert.match(r.texto, /não consegui/i);
  assert.ok(r.motivo && /pauta de hoje/.test(r.motivo), `sensor próprio: ${r.motivo}`);
});

test('fim de dia: aluno que sumiu da base sai como "não consegui conferir"', async () => {
  const d = depsRelatorio({
    alunos: [aluno('Ana', '09:00', true)],
    daPauta: ['pk-Ana', 'pk-Fantasma'],
  });
  const r = await rodarRelatorio(d);
  assert.strictEqual(r.preencheram, 1);
  assert.strictEqual(r.faltaram.length, 0);
  assert.strictEqual(r.semVerificacao, 1);
  assert.match(r.texto, /1 eu não consegui conferir/);
});

test('fim de dia: dia em que todo mundo preencheu é dito como dia bom', async () => {
  const d = depsRelatorio({
    alunos: [aluno('Ana', '09:00', true), aluno('Bia', '08:00', true)],
    daPauta: ['pk-Ana', 'pk-Bia'],
  });
  const r = await rodarRelatorio(d);
  assert.match(r.texto, /Dia bom: os 2 alunos da pauta preencheram/);
});

// "sem anamnese" tem UMA definição nesta casa (filtrarPorRecorte). Se o relatório reimplementasse
// o filtro, um dia a mensagem da manhã e a da noite discordariam sobre a mesma pessoa.
test('fim de dia: usa a MESMA definição de pendência da manhã, não uma cópia', async () => {
  const situ = require('../services/situacao-aluno');
  // Marcado como preenchido pela flag, mas SEM registro: filtrarPorRecorte olha só a flag.
  const meio = { ...aluno('Meio', '09:00', true), anamnese_flag_sem_registro: true };
  const d = depsRelatorio({ alunos: [meio], daPauta: ['pk-Meio'] });
  const r = await rodarRelatorio(d);
  const pendentePelaFonte = situ.filtrarPorRecorte([meio], 'anamnese').length;
  assert.strictEqual(r.faltaram.length, pendentePelaFonte,
    'o relatório tem que concordar com filtrarPorRecorte, seja qual for a resposta dela');
});

// Aluno que estava na pauta de hoje mas cuja aula não é mais reconhecível hoje (grade mudou no
// meio do dia) não pode SUMIR da conta: o número é o que a equipe olha primeiro.
test('fim de dia: faltante sem horário de hoje continua contando', async () => {
  const semAulaHoje = {
    nome: 'Zeca', pessoa_chave: 'pk-Zeca', classificacao: 'LA',
    aulas_resumo: ['Canto — Sábado 11:00'], anamnese_preenchida: false, cadastro_faltando: ['anamnese'],
  };
  const d = depsRelatorio({
    alunos: [aluno('Bia', '08:00', false), semAulaHoje],
    daPauta: ['pk-Bia', 'pk-Zeca'],
  });
  const r = await rodarRelatorio(d);
  assert.strictEqual(r.faltaram.length, 2, 'a conta não pode perder ninguém por causa da grade');
  assert.match(r.texto, /Faltaram 2/);
  assert.match(r.texto, /Zeca/);
  assert.doesNotMatch(r.texto, /undefined/);
});

test('fim de dia: hoje torto não deixa o relatório inventar um dia', async () => {
  const d = depsRelatorio({ daPauta: ['pk-Ana'] });
  const r = await relatorioDeFimDeDia({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', hoje: 'nao-e-data', deps: d,
  });
  assert.strictEqual(r.texto, null);
  assert.ok(r.motivo && /dia da semana/.test(r.motivo), `sensor próprio: ${r.motivo}`);
  assert.deepStrictEqual(d.escritas, []);
});

// ── O LEMBRETE DE HORA EM HORA (pedido do Alf, 04/09) ────────────────────────────────────────
// De hora em hora (09:00 às 19:00) o TOM fala da PRÓXIMA hora. Ele SÓ LÊ: não grava na escada,
// não fecha filha, não fecha container, e — a regra sagrada — NUNCA escreve no LA Report. Quem
// dá baixa em anamnese e em contrato é a fonte; ele lê e cobra.
const { lembreteDaProximaHora } = require('./anamnese-pauta');

// `anamnese`/`contrato` aqui são "está OK": true = preenchido, e portanto FORA da cobrança.
const alunoDaHora = (nome, hora, { anamnese = true, contrato = true } = {}) => ({
  nome, pessoa_chave: 'pk-' + nome, classificacao: 'LA',
  aulas_resumo: [`Canto — Segunda-feira ${hora}`],
  anamnese_preenchida: !!anamnese, tem_data_contrato: !!contrato,
});

// supabase que EXPLODE se alguém encostar: o lembrete não recebe cliente de banco nenhum, e este
// fake é o que transforma essa promessa em teste. Um `from()` que escorregasse pra dentro da
// função apareceria como falha aqui, não como escrita silenciosa em produção.
const supabaseProibido = { from() { throw new Error('o lembrete não pode tocar o banco'); } };

function rodarLembrete({ alunos = [], rpcErro = null, lanca = false, hora = '15:00', hoje = SEGUNDA, recuperacao = false } = {}) {
  const chamadas = [];
  const laReport = {
    rpc: async (nome, args) => {
      chamadas.push([nome, args]);
      if (lanca) throw new Error('rede caiu no meio da consulta');
      return { data: rpcErro ? null : alunos, error: rpcErro };
    },
  };
  return lembreteDaProximaHora({ laReport, unidadeId: 'u1', hoje, hora, recuperacao })
    .then((r) => ({ ...r, chamadas }));
}

test('lembrete: fala SÓ de quem chega na próxima hora, não da lista do dia', async () => {
  const r = await rodarLembrete({
    alunos: [
      alunoDaHora('Arthur Bezerra', '15:00', { anamnese: false }),
      alunoDaHora('Bento Alves', '16:00', { anamnese: false }),
      alunoDaHora('Carla Dias', '15:00'),   // sem pendência nenhuma: não entra
    ],
  });
  assert.strictEqual(r.motivo, null);
  assert.strictEqual(r.alunos.length, 1);
  assert.match(r.texto, /Arthur Bezerra/);
  assert.doesNotMatch(r.texto, /Bento Alves/, 'a lista do dia inteiro é o ruído que este lembrete existe pra matar');
  assert.doesNotMatch(r.texto, /Carla Dias/);
});

test('lembrete: as DUAS pendências do mesmo aluno viram uma linha com rótulo combinado', async () => {
  const r = await rodarLembrete({
    alunos: [
      alunoDaHora('Levi Freire', '15:00', { anamnese: false, contrato: false }),
      alunoDaHora('Gabriela da Silva', '15:00', { contrato: false }),
    ],
  });
  assert.strictEqual(r.texto,
    '⏰ *Próxima hora — 15:00*\n'
    + '· Gabriela da Silva (Canto) — *contrato*\n'
    + '· Levi Freire (Canto) — *anamnese e contrato*');
});

test('lembrete: hora sem ninguém pendente NÃO vira mensagem — e o motivo é null (zero por saúde)', async () => {
  const r = await rodarLembrete({ alunos: [alunoDaHora('Carla Dias', '15:00')] });
  assert.strictEqual(r.texto, null, 'silêncio ali é notícia boa');
  assert.strictEqual(r.motivo, null, 'zero por SAÚDE não pode sair com a mesma cara de zero por FALHA');
  assert.deepStrictEqual(r.alunos, []);
});

test('lembrete: fonte fora do ar NÃO fala — e diz por quê, com sensor próprio', async () => {
  const r = await rodarLembrete({ rpcErro: { message: 'timeout' } });
  assert.strictEqual(r.texto, null, 'nunca "ninguém pendente" quando não deu pra apurar');
  assert.match(r.motivo, /lembrete/i, 'o motivo precisa distinguir esta consulta das outras três do arquivo');
  assert.match(r.motivo, /timeout/);
});

test('lembrete: exceção na consulta vira motivo, não explosão', async () => {
  const r = await rodarLembrete({ lanca: true });
  assert.strictEqual(r.texto, null);
  assert.match(r.motivo, /rede caiu/);
});

test('lembrete: SÓ LÊ — uma consulta à fonte, e nada de banco', async () => {
  const r = await lembreteDaProximaHora({
    supabase: supabaseProibido,
    laReport: { rpc: async () => ({ data: [alunoDaHora('Ana', '15:00', { anamnese: false })], error: null }) },
    unidadeId: 'u1', hoje: SEGUNDA, hora: '15:00',
  });
  assert.match(r.texto, /Ana/);
});

test('lembrete: uma única consulta por unidade — a RPC leva 6-8s e o dia tem 11 slots', async () => {
  const r = await rodarLembrete({ alunos: [alunoDaHora('Ana', '15:00', { anamnese: false, contrato: false })] });
  assert.strictEqual(r.chamadas.length, 1, 'anamnese e contrato saem da MESMA leitura');
  assert.strictEqual(r.chamadas[0][0], 'get_situacao_alunos_v1');
});

test('lembrete: hoje torto não inventa lista (LOCALYMD-UTC-SHIFT)', async () => {
  const r = await rodarLembrete({ hoje: 'ontem', alunos: [alunoDaHora('Ana', '15:00', { anamnese: false })] });
  assert.strictEqual(r.texto, null);
  assert.match(r.motivo, /dia da semana inválido/);
});

test('lembrete: hora torta não monta nada', async () => {
  const r = await rodarLembrete({ hora: '25h', alunos: [alunoDaHora('Ana', '15:00', { anamnese: false })] });
  assert.strictEqual(r.texto, null);
  assert.match(r.motivo, /hora inválida/);
});

// ── O PRIMEIRO LEMBRETE DO DIA É DE RECUPERAÇÃO (correção 04/09) ─────────────────────────────
// Quem tem aula na hora em que a unidade ABRE nunca entrava em lembrete nenhum: o primeiro
// lembrete do dia fala da hora SEGUINTE. Medido na fonte: 25 aulas por semana invisíveis. Na
// primeira passada do dia o ritual varre do começo do dia até o fim da hora seguinte; da segunda
// em diante volta a ser só a próxima hora. Ele CONTINUA só lendo — nada de banco, nada no LA
// Report.
test('lembrete de recuperação: a primeira passada do dia pega quem chegou na hora da abertura', async () => {
  const r = await rodarLembrete({
    hora: '10:00',
    recuperacao: true,
    alunos: [
      alunoDaHora('Arthur Bezerra', '08:00', { anamnese: false }),   // hora da abertura da unidade
      alunoDaHora('Gabriela da Silva', '09:00', { contrato: false }),
      alunoDaHora('Levi Freire', '10:00', { anamnese: false, contrato: false }),
      alunoDaHora('Zeca Pagodinho', '15:00', { anamnese: false }),   // ainda vai ter o lembrete dele
    ],
  });
  assert.strictEqual(r.motivo, null);
  assert.strictEqual(r.texto,
    '⏰ *Do começo do dia até as 10:00*\n'
    + '\n'
    + '🕗 *08:00*\n'
    + '· Arthur Bezerra (Canto) — *anamnese*\n'
    + '\n'
    + '🕘 *09:00*\n'
    + '· Gabriela da Silva (Canto) — *contrato*\n'
    + '\n'
    + '🕙 *10:00*\n'
    + '· Levi Freire (Canto) — *anamnese e contrato*');
  assert.doesNotMatch(r.texto, /Zeca/, 'a recuperação é uma FAIXA, não a lista do dia inteiro');
});

test('lembrete de recuperação: da SEGUNDA passada em diante não repete quem já passou', async () => {
  const alunos = [
    alunoDaHora('Arthur Bezerra', '08:00', { anamnese: false }),
    alunoDaHora('Levi Freire', '11:00', { anamnese: false }),
  ];
  const r = await rodarLembrete({ hora: '11:00', alunos });   // sem recuperacao: o comportamento de hoje
  assert.strictEqual(r.texto, '⏰ *Próxima hora — 11:00*\n· Levi Freire (Canto) — *anamnese*');
  assert.doesNotMatch(r.texto, /Arthur/, 'ele já saiu na recuperação — repetir 11 vezes é o ruído que mata a leitura');
});

test('lembrete de recuperação: fonte fora do ar NÃO vira faixa vazia', async () => {
  const r = await rodarLembrete({ hora: '10:00', recuperacao: true, rpcErro: { message: 'timeout' } });
  assert.strictEqual(r.texto, null, 'nunca "ninguém pendente" quando não deu pra apurar — nem na recuperação');
  assert.match(r.motivo, /lembrete/i);
});

test('lembrete de recuperação: faixa sem ninguém pendente é silêncio, com motivo null', async () => {
  const r = await rodarLembrete({ hora: '10:00', recuperacao: true, alunos: [alunoDaHora('Carla Dias', '08:00')] });
  assert.strictEqual(r.texto, null);
  assert.strictEqual(r.motivo, null, 'zero por SAÚDE não pode sair com cara de zero por FALHA');
});

test('lembrete de recuperação: SÓ LÊ — uma consulta à fonte e nada de banco', async () => {
  const r = await lembreteDaProximaHora({
    supabase: supabaseProibido,
    laReport: { rpc: async () => ({ data: [alunoDaHora('Ana', '08:00', { anamnese: false })], error: null }) },
    unidadeId: 'u1', hoje: SEGUNDA, hora: '10:00', recuperacao: true,
  });
  assert.match(r.texto, /08:00 Ana/);
});
