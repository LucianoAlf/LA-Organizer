'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  ordenarPessoas, fatiar, PAGINA_INICIAL, PAGINA_SEGUINTE,
  renderResumo, renderLista, normalizarRecorte, filtrarPorRecorte,
} = require('./situacao-aluno');

const P = (nome, extra = {}) => Object.assign({
  nome, classificacao: 'EMLA', anamnese_preenchida: false, tem_instagram: false,
  instagram_nao_possui: false, na_comunidade_wa: null, comunidade_status: 'sem_captura',
  tem_data_contrato: true, tem_foto: true, tem_telefone: true, anamnese_flag_sem_registro: false,
}, extra);

// O Alf pediu: crianças primeiro. LAMK é ≤11 anos — é quem a recepção consegue resolver
// falando com o responsável na porta.
test('ordenação: LAMK (crianças) antes de EMLA, e nome dentro de cada faixa', () => {
  const ord = ordenarPessoas([
    P('Zeca', { classificacao: 'EMLA' }), P('Bia', { classificacao: 'LAMK' }),
    P('Ana', { classificacao: 'EMLA' }), P('Caio', { classificacao: 'LAMK' }),
  ]).map((p) => p.nome);
  assert.deepStrictEqual(ord, ['Bia', 'Caio', 'Ana', 'Zeca']);
});

test('fatia: a primeira entrega 15, as seguintes 30', () => {
  const cem = Array.from({ length: 100 }, (_, i) => P(`Aluno ${String(i).padStart(3, '0')}`));
  assert.strictEqual(PAGINA_INICIAL, 15);
  assert.strictEqual(PAGINA_SEGUINTE, 30);
  const p0 = fatiar(cem, 0);
  assert.strictEqual(p0.itens.length, 15);
  assert.strictEqual(p0.restam, 85);
  assert.strictEqual(p0.temMais, true);
  const p1 = fatiar(cem, 1);
  assert.strictEqual(p1.itens.length, 30);
  assert.strictEqual(p1.itens[0].nome, 'Aluno 015', 'a página 2 continua de onde a 1 parou');
  assert.strictEqual(p1.restam, 55);
  const p3 = fatiar(cem, 3);
  assert.strictEqual(p3.itens.length, 25, 'última fatia é o que sobrou');
  assert.strictEqual(p3.temMais, false);
  assert.strictEqual(p3.restam, 0);
});

// A trava que mais importa: sem captura fresca, "não sei" — NUNCA "fora da comunidade".
test('comunidade sem captura sai como NÃO SEI, jamais como fora', () => {
  const html = renderResumo({
    total_pessoas: 336, base: { alunos_ativos: 336 },
    pendentes: { anamnese: 236, instagram: 278 },
    comunidade: { na_comunidade: 0, fora_da_comunidade: 0, sem_captura: 336, captura_desatualizada: 0, sem_grupo_configurado: 0 },
    regra_versao: 'situacao_alunos_v1', medido_em: '2026-09-02T21:56:49Z',
  }, { grupoNome: 'Recreio' });
  assert.match(html, /não sei|sem captura/i);
  assert.doesNotMatch(html, /fora da comunidade/i);
});

test('comunidade COM captura fresca pode dizer quantos estão fora', () => {
  const html = renderResumo({
    total_pessoas: 336, base: { alunos_ativos: 336 }, pendentes: { anamnese: 236 },
    comunidade: { na_comunidade: 152, fora_da_comunidade: 184, sem_captura: 0, captura_desatualizada: 0, sem_grupo_configurado: 0, capturado_em: '2026-09-02T21:21:56Z' },
    regra_versao: 'situacao_alunos_v1',
  }, { grupoNome: 'Recreio' });
  assert.match(html, /184/);
  assert.match(html, /fora da comunidade/i);
});

test('o resumo sempre carrega a versão da regra e quando foi medido', () => {
  const html = renderResumo({
    total_pessoas: 336, base: { alunos_ativos: 336 }, pendentes: { anamnese: 236 },
    comunidade: {}, regra_versao: 'situacao_alunos_v1', medido_em: '2026-09-02T21:56:49Z',
  }, { grupoNome: 'Recreio' });
  assert.match(html, /situacao_alunos_v1/);
});

test('flag de anamnese sem registro vira RESSALVA, não vira "preenchida"', () => {
  const html = renderLista({
    recorte: 'anamnese', grupoNome: 'Recreio',
    pessoas: [P('Ana', { anamnese_preenchida: true, anamnese_flag_sem_registro: true })],
    total: 1, pagina: 0,
  });
  assert.match(html, /sem registro|conferir/i);
});

test('lista mostra o total e quantos ficaram de fora da fatia', () => {
  const muitos = Array.from({ length: 236 }, (_, i) => P(`Aluno ${String(i).padStart(3, '0')}`));
  const html = renderLista({ recorte: 'anamnese', grupoNome: 'Recreio', pessoas: muitos, total: 236, pagina: 0 });
  assert.match(html, /236/, 'o número é o que mais importa — tem que estar sempre');
  assert.match(html, /221/, 'e quantos sobraram');
  assert.strictEqual((html.match(/<li>/g) || []).length, 15);
});

test('lista vazia não finge: diz que não há ninguém', () => {
  const html = renderLista({ recorte: 'anamnese', grupoNome: 'Recreio', pessoas: [], total: 0, pagina: 0 });
  assert.match(html, /ningu[ée]m|nenhum|tudo em dia/i);
});

test('recorte desconhecido cai em resumo, não quebra', () => {
  assert.strictEqual(normalizarRecorte('xpto'), 'resumo');
  assert.strictEqual(normalizarRecorte('anamnese'), 'anamnese');
  assert.strictEqual(normalizarRecorte(null), 'resumo');
  assert.strictEqual(normalizarRecorte('INSTAGRAM'), 'instagram');
});

test('filtro por recorte usa o campo certo de cada pendência', () => {
  const pessoas = [
    P('SemAnamnese', { anamnese_preenchida: false }),
    P('ComAnamnese', { anamnese_preenchida: true }),
    P('SemInsta', { tem_instagram: false, instagram_nao_possui: false }),
    P('NaoTemInsta', { tem_instagram: false, instagram_nao_possui: true }),
  ];
  assert.deepStrictEqual(filtrarPorRecorte(pessoas, 'anamnese').map((p) => p.nome), ['SemAnamnese', 'SemInsta', 'NaoTemInsta']);
  // quem foi MARCADO como "não possui Instagram" está resolvido — não é pendência
  assert.ok(!filtrarPorRecorte(pessoas, 'instagram').some((p) => p.nome === 'NaoTemInsta'));
});

// ── CACHE + RETRY (medido: a RPC vive no limite do statement timeout) ──────────────────────
const { consultarComCache, _limparCache, TTL_MS } = require('./situacao-aluno');

function clienteFake(respostas) {
  let i = 0;
  return { chamadas: () => i, rpc: async () => { const r = respostas[Math.min(i, respostas.length - 1)]; i++; return r; } };
}

test('cache: segunda pergunta na janela não bate na RPC de novo', async () => {
  _limparCache();
  const c = clienteFake([{ data: { total_pessoas: 336 }, error: null }]);
  const a = await consultarComCache({ tipo: 'resumo', unidadeId: 'u1', client: c, agora: 1000 });
  // 30s: dentro da janela do RESUMO (60s). Rajada de perguntas seguidas nao repaga a RPC.
  const b = await consultarComCache({ tipo: 'resumo', unidadeId: 'u1', client: c, agora: 1000 + 30000 });
  assert.strictEqual(c.chamadas(), 1, 'a segunda veio do cache');
  assert.strictEqual(b.doCache, true);
  assert.strictEqual(a.data.total_pessoas, b.data.total_pessoas);
});

test('cache expira e busca de novo', async () => {
  _limparCache();
  const c = clienteFake([{ data: { total_pessoas: 1 }, error: null }, { data: { total_pessoas: 2 }, error: null }]);
  await consultarComCache({ tipo: 'resumo', unidadeId: 'u1', client: c, agora: 1000 });
  const b = await consultarComCache({ tipo: 'resumo', unidadeId: 'u1', client: c, agora: 1000 + TTL_MS + 1 });
  assert.strictEqual(c.chamadas(), 2);
  assert.strictEqual(b.data.total_pessoas, 2);
});

test('timeout de borda: uma tentativa a mais salva a resposta', async () => {
  _limparCache();
  const c = clienteFake([
    { data: null, error: { message: 'canceling statement due to statement timeout' } },
    { data: { total_pessoas: 336 }, error: null },
  ]);
  const r = await consultarComCache({ tipo: 'resumo', unidadeId: 'u1', client: c, agora: 1000 });
  assert.strictEqual(c.chamadas(), 2);
  assert.strictEqual(r.data.total_pessoas, 336);
});

test('duas falhas seguidas SEM cache: joga o erro, não inventa', async () => {
  _limparCache();
  const c = clienteFake([{ data: null, error: { message: 'timeout' } }]);
  await assert.rejects(
    () => consultarComCache({ tipo: 'resumo', unidadeId: 'u1', client: c, agora: 1000 }),
    /timeout/,
  );
});

test('duas falhas COM cache velho: serve o velho e marca degradado', async () => {
  _limparCache();
  const ok = clienteFake([{ data: { total_pessoas: 336 }, error: null }]);
  await consultarComCache({ tipo: 'resumo', unidadeId: 'u1', client: ok, agora: 1000 });
  const ruim = clienteFake([{ data: null, error: { message: 'timeout' } }]);
  const r = await consultarComCache({ tipo: 'resumo', unidadeId: 'u1', client: ruim, agora: 1000 + TTL_MS + 1 });
  assert.strictEqual(r.doCache, true);
  assert.match(r.degradado, /timeout/);
  assert.strictEqual(r.data.total_pessoas, 336);
});

// ── TTL POR TIPO (02/09, depois da otimização da RPC pelo Codex) ───────────────────────────
// O número anda durante o dia (anamneses do Recreio: 91 → 104 num mutirão), então o RESUMO
// não pode ficar 10 min parado. A LISTA fica, mas por consistência de paginação.
const { ttlDoTipo, TTL_POR_TIPO } = require('./situacao-aluno');

test('resumo tem TTL curto; lista tem TTL longo', () => {
  assert.strictEqual(ttlDoTipo('resumo'), 60 * 1000);
  assert.strictEqual(ttlDoTipo('lista'), 10 * 60 * 1000);
  assert.ok(TTL_POR_TIPO.resumo < TTL_POR_TIPO.lista, 'o número precisa ser mais fresco que a lista');
});

test('o resumo REBUSCA depois de 1 minuto — número velho em dia de mutirão é mentira útil', async () => {
  _limparCache();
  const c = clienteFake([
    { data: { total_pessoas: 336, pendentes: { anamnese: 236 } }, error: null },
    { data: { total_pessoas: 337, pendentes: { anamnese: 233 } }, error: null },
  ]);
  await consultarComCache({ tipo: 'resumo', unidadeId: 'u1', client: c, agora: 0 });
  const depois = await consultarComCache({ tipo: 'resumo', unidadeId: 'u1', client: c, agora: 61 * 1000 });
  assert.strictEqual(c.chamadas(), 2);
  assert.strictEqual(depois.data.pendentes.anamnese, 233, 'pegou o número novo');
});

test('a lista SEGURA a foto por 10 min — paginação não pode trocar de base no meio', async () => {
  _limparCache();
  const c = clienteFake([{ data: [{ nome: 'A' }], error: null }, { data: [{ nome: 'B' }], error: null }]);
  await consultarComCache({ tipo: 'lista', unidadeId: 'u1', client: c, agora: 0 });
  const p2 = await consultarComCache({ tipo: 'lista', unidadeId: 'u1', client: c, agora: 5 * 60 * 1000 });
  assert.strictEqual(c.chamadas(), 1, 'a página 2 usa a MESMA foto da página 1');
  assert.strictEqual(p2.data[0].nome, 'A');
});

// ── UNIDADE NO MARKER (grupo que atravessa unidades) ──────────────────────────────────────
const { resolverUnidade, UNIDADES } = require('./situacao-aluno');

test('resolverUnidade aceita apelido, com acento, caixa e espaco', () => {
  assert.strictEqual(resolverUnidade('Recreio'), UNIDADES.recreio);
  assert.strictEqual(resolverUnidade('  BARRA '), UNIDADES.barra);
  assert.strictEqual(resolverUnidade('Campo Grande'), UNIDADES['campo grande']);
  assert.strictEqual(resolverUnidade('CG'), UNIDADES.cg);
});

test('resolverUnidade aceita uuid cru', () => {
  assert.strictEqual(resolverUnidade(UNIDADES.recreio), UNIDADES.recreio);
});

// Responder pela unidade ERRADA e pior que nao responder — quem nao sabe, devolve null e o
// chamador faz o TOM perguntar.
test('resolverUnidade devolve null pro que nao reconhece', () => {
  for (const x of ['', null, 'tijuca', 'unidade 4', 'todas']) {
    assert.strictEqual(resolverUnidade(x), null, String(x));
  }
});

// ── O CONVITE CABE NO QUE SOBROU (Fabíola, Sucesso do Aluno, 02/09) ───────────────────────
// Sobravam 5 e ele oferecia "os próximos 30". Número que não bate com o que vem depois faz o
// resto parecer inventado — e o número é justamente o que o time mais olha.
test('rodapé oferece o que REALMENTE sobrou, não o teto fixo', () => {
  const vinte = Array.from({ length: 20 }, (_, i) => P(`Aluno ${String(i).padStart(2, '0')}`));
  const html = renderLista({ recorte: 'foto', grupoNome: 'X', pessoas: vinte, total: 20, pagina: 0 });
  assert.match(html, /e mais <b>5<\/b>/);
  assert.match(html, /os próximos 5\?/, 'não pode oferecer 30 quando sobram 5');
  assert.doesNotMatch(html, /próximos 30/);
});

test('quando sobram muitos, oferece a fatia cheia de 30', () => {
  const cem = Array.from({ length: 100 }, (_, i) => P(`Aluno ${String(i).padStart(3, '0')}`));
  const html = renderLista({ recorte: 'anamnese', grupoNome: 'X', pessoas: cem, total: 100, pagina: 0 });
  assert.match(html, /os próximos 30\?/);
});

test('sobrando exatamente 1, fala no singular', () => {
  const dz = Array.from({ length: 16 }, (_, i) => P(`Aluno ${String(i).padStart(2, '0')}`));
  const html = renderLista({ recorte: 'foto', grupoNome: 'X', pessoas: dz, total: 16, pagina: 0 });
  assert.match(html, /o último\?/);
});

// ── CRIANÇA NÃO ENTRA EM GRUPO; O RESPONSÁVEL ENTRA (Alf, 02/09) ──────────────────────────
// O dado está certo (a RPC casa telefone do aluno, do responsável e dos contatos), mas a lista
// entregava só o nome da criança — e quem lê sai convidando a pessoa errada.
test('lista de comunidade avisa que o convite é do responsável quando há criança', () => {
  const html = renderLista({
    recorte: 'comunidade', grupoNome: 'X',
    pessoas: [P('Alice', { classificacao: 'LAMK', comunidade_status: 'fora_da_comunidade' })],
    total: 1, pagina: 0,
  });
  assert.match(html, /responsável/i);
});

test('sem criança na fatia, não polui com a nota do responsável', () => {
  const html = renderLista({
    recorte: 'comunidade', grupoNome: 'X',
    pessoas: [P('Ana Clara', { classificacao: 'EMLA', comunidade_status: 'fora_da_comunidade' })],
    total: 1, pagina: 0,
  });
  assert.doesNotMatch(html, /responsável/i);
});

test('a nota é SÓ do recorte de comunidade — não aparece em anamnese', () => {
  const html = renderLista({
    recorte: 'anamnese', grupoNome: 'X',
    pessoas: [P('Alice', { classificacao: 'LAMK' })],
    total: 1, pagina: 0,
  });
  assert.doesNotMatch(html, /responsável/i);
});

// ── RECORTE POR PERÍODO DE MATRÍCULA (Fabíola, 02/09) ─────────────────────────────────────
// "dos alunos matriculados em agosto de 2026, quantos estão sem foto?" — antes ele respondia
// a unidade inteira. Os campos entrou_em / matricula_recente_em chegaram na RPC (Codex 9de30a74).
const { filtrarPorPeriodo, rotuloPeriodo } = require('./situacao-aluno');

const Q = (nome, entrou, recente) => P(nome, { entrou_em: entrou, matricula_recente_em: recente });

test('filtra pelo mês de ENTRADA na escola (padrão)', () => {
  const gente = [Q('Ago', '2026-08-10', '2026-08-10'), Q('Out', '2025-10-01', '2025-10-01'), Q('Set', '2026-09-01', '2026-09-01')];
  const r = filtrarPorPeriodo(gente, { de: '2026-08-01', ate: '2026-08-31' });
  assert.deepStrictEqual(r.map((p) => p.nome), ['Ago']);
});

// O caso que separa os dois eixos: quem já era aluno e ADICIONOU um curso em agosto.
test('critério "recente" pega quem acrescentou curso no período; "entrada" não', () => {
  const gente = [Q('Veterano', '2024-03-01', '2026-08-20')];
  assert.strictEqual(filtrarPorPeriodo(gente, { de: '2026-08-01', ate: '2026-08-31' }).length, 0);
  assert.strictEqual(filtrarPorPeriodo(gente, { de: '2026-08-01', ate: '2026-08-31', criterio: 'recente' }).length, 1);
});

test('sem data conhecida NÃO entra num recorte de data', () => {
  assert.strictEqual(filtrarPorPeriodo([Q('SemData', null, null)], { de: '2026-08-01' }).length, 0);
});

test('sem período, devolve todo mundo', () => {
  const gente = [Q('A', '2020-01-01', '2020-01-01')];
  assert.strictEqual(filtrarPorPeriodo(gente, {}).length, 1);
});

// O número vira opinião se ninguém disser o critério.
test('o rótulo DIZ qual eixo foi usado', () => {
  assert.match(rotuloPeriodo({ de: '2026-08-01', ate: '2026-08-31' }), /entre os que entraram na escola de 01\/08\/2026 a 31\/08\/2026/);
  assert.match(rotuloPeriodo({ de: '2026-08-01', criterio: 'recente' }), /matrícula nova/);
  // a frase tem que ler bem tambem quando nao ha ninguem
  assert.match(`Ninguém sem foto ${rotuloPeriodo({ de: '2026-08-01', ate: '2026-08-31' })}`, /Ninguém sem foto entre os que entraram/);
  assert.strictEqual(rotuloPeriodo({}), '');
});

test('a lista mostra o período no cabeçalho', () => {
  const html = renderLista({ recorte: 'foto', grupoNome: 'X', pessoas: [Q('Ago', '2026-08-10', '2026-08-10')],
    total: 1, pagina: 0, periodo: { de: '2026-08-01', ate: '2026-08-31' } });
  assert.match(html, /entraram na escola/);
});

test('lista VAZIA com período diz o recorte — "ninguém" precisa dizer ninguém DO QUÊ', () => {
  const html = renderLista({ recorte: 'foto', grupoNome: 'X', pessoas: [], total: 0, pagina: 0,
    periodo: { de: '2026-08-01', ate: '2026-08-31' } });
  assert.match(html, /Ninguém sem foto/);
  assert.match(html, /entraram na escola/);
});

// ── RESPONSÁVEL NA LISTA DA COMUNIDADE ────────────────────────────────────────────────────
test('comunidade: criança sai com o nome do RESPONSÁVEL, que é quem entra no grupo', () => {
  const html = renderLista({ recorte: 'comunidade', grupoNome: 'X', total: 1, pagina: 0,
    pessoas: [P('Alice', { classificacao: 'LAMK', responsavel_nome: 'Mychelle Dellatorre', comunidade_status: 'fora_da_comunidade' })] });
  assert.match(html, /Alice/);
  assert.match(html, /resp\. Mychelle Dellatorre/);
});

test('adulto não ganha "resp." — ele mesmo entra no grupo', () => {
  const html = renderLista({ recorte: 'comunidade', grupoNome: 'X', total: 1, pagina: 0,
    pessoas: [P('Ana Clara', { classificacao: 'EMLA', responsavel_nome: 'Mãe da Ana', comunidade_status: 'fora_da_comunidade' })] });
  assert.doesNotMatch(html, /resp\./);
});

test('o responsável NÃO polui outros recortes', () => {
  const html = renderLista({ recorte: 'anamnese', grupoNome: 'X', total: 1, pagina: 0,
    pessoas: [P('Alice', { classificacao: 'LAMK', responsavel_nome: 'Mychelle' })] });
  assert.doesNotMatch(html, /resp\./);
});

// ── FICHA DE UM ALUNO ─────────────────────────────────────────────────────────────────────
// A RPC já devolvia tudo por pessoa; faltava o TOM montar a resposta sobre UM aluno.
const { resolverAluno, tempoDeCasa, renderFicha, renderAmbiguo } = require('./situacao-aluno');

const HOJE = new Date('2026-09-03T12:00:00Z');
const ALUNO = {
  nome: 'Bento Serpa Benitez', classificacao: 'LAMK', responsavel_nome: 'Carla Serpa',
  cursos: ['Canto'], professores: ['Rafael'], aulas_resumo: ['Canto — qua 15:00'],
  entrou_em: '2024-03-15', cadastro_faltando: [], anamnese_preenchida: true, anamnese_em: '2024-04-01',
  comunidade_status: 'na_comunidade', presenca_taxa_geral: 0.92, presenca_confianca: 'alta',
  dias_desde_ultima_aula: 2, inadimplente: false, proxima_renovacao_em: '2027-03-15',
  regra_versao: 'situacao_alunos_v1',
};

// Anti-chute: responder pela pessoa errada num grupo de trabalho é pior que perguntar de novo.
test('resolverAluno: nome exato e primeiro nome único resolvem', () => {
  const gente = [ALUNO, { nome: 'Alice Cordeiro' }];
  assert.strictEqual(resolverAluno(gente, 'Bento Serpa Benitez').pessoa.nome, ALUNO.nome);
  assert.strictEqual(resolverAluno(gente, 'bento').pessoa.nome, ALUNO.nome);
  assert.strictEqual(resolverAluno(gente, 'BENTO SERPA').pessoa.nome, ALUNO.nome);
});

test('resolverAluno: acento não atrapalha', () => {
  assert.strictEqual(resolverAluno([{ nome: 'Vitória Assunção' }], 'vitoria').pessoa.nome, 'Vitória Assunção');
});

test('resolverAluno: dois com o mesmo primeiro nome NÃO escolhe — devolve os candidatos', () => {
  const r = resolverAluno([{ nome: 'Bento Serpa' }, { nome: 'Bento Vieira' }], 'bento');
  assert.strictEqual(r.erro, 'ambiguo');
  assert.strictEqual(r.candidatos.length, 2);
});

test('resolverAluno: nome completo desempata mesmo com dois primeiros nomes iguais', () => {
  const r = resolverAluno([{ nome: 'Bento Serpa' }, { nome: 'Bento Vieira' }], 'bento vieira');
  assert.strictEqual(r.pessoa.nome, 'Bento Vieira');
});

test('resolverAluno: ninguém com esse nome devolve nao_achei, não o mais parecido', () => {
  assert.strictEqual(resolverAluno([{ nome: 'Alice' }], 'Joaquim').erro, 'nao_achei');
});

test('resolverAluno: termo curto demais não busca', () => {
  assert.strictEqual(resolverAluno([{ nome: 'Alice' }], 'a').erro, 'termo_curto');
  assert.strictEqual(resolverAluno([{ nome: 'Alice' }], '').erro, 'termo_curto');
});

test('tempoDeCasa fala em anos e meses, não em data crua', () => {
  assert.strictEqual(tempoDeCasa('2024-03-15', HOJE), '2 anos e 5 meses');
  assert.strictEqual(tempoDeCasa('2026-08-20', HOJE), 'menos de um mês');
  assert.strictEqual(tempoDeCasa('2025-09-03', HOJE), '1 ano');
  assert.strictEqual(tempoDeCasa('2026-07-03', HOJE), '2 meses');
  assert.strictEqual(tempoDeCasa(null, HOJE), null);
});

test('ficha traz professor, aula, tempo de casa e responsável', () => {
  const h = renderFicha(ALUNO, { hoje: HOJE });
  assert.match(h, /Bento Serpa Benitez/);
  assert.match(h, /Canto — qua 15:00/);
  assert.match(h, /Rafael/);
  assert.match(h, /2 anos e 5 meses/);
  assert.match(h, /Carla Serpa/);
  assert.match(h, /Cadastro completo/);
  assert.match(h, /Anamnese preenchida/);
  assert.match(h, /situacao_alunos_v1/);
});

test('ficha: presença de confiança BAIXA não vira número', () => {
  const h = renderFicha({ ...ALUNO, presenca_confianca: 'baixa', presenca_taxa_geral: 1 }, { hoje: HOJE });
  assert.doesNotMatch(h, /100%/);
  assert.match(h, /não dá pra afirmar/i);
});

test('ficha: comunidade sem captura diz NÃO SEI, nunca "está fora"', () => {
  const h = renderFicha({ ...ALUNO, comunidade_status: 'sem_captura' }, { hoje: HOJE });
  assert.match(h, /não sei/i);
  assert.doesNotMatch(h, /Fora da comunidade/);
});

test('ficha: criança fora da comunidade diz QUEM precisa entrar', () => {
  const h = renderFicha({ ...ALUNO, comunidade_status: 'fora_da_comunidade' }, { hoje: HOJE });
  assert.match(h, /quem precisa entrar é Carla Serpa/);
});

test('ficha: adulto não ganha linha de responsável', () => {
  const h = renderFicha({ ...ALUNO, classificacao: 'LA', responsavel_nome: 'Carla Serpa' }, { hoje: HOJE });
  assert.doesNotMatch(h, /Responsável/);
});

test('ficha: aviso prévio tem precedência sobre renovação', () => {
  const h = renderFicha({ ...ALUNO, em_aviso_previo: true }, { hoje: HOJE });
  assert.match(h, /aviso prévio/i);
  assert.doesNotMatch(h, /Renova em/);
});

test('ficha: inadimplência aparece com o número de faturas', () => {
  const h = renderFicha({ ...ALUNO, inadimplente: true, faturas_vencidas_abertas: 2 }, { hoje: HOJE });
  assert.match(h, /2 faturas vencidas/);
});

test('ficha: cadastro incompleto diz O QUE falta', () => {
  const h = renderFicha({ ...ALUNO, cadastro_faltando: ['foto', 'contrato'] }, { hoje: HOJE });
  assert.match(h, /falta <b>foto, contrato<\/b>/);
});

test('ficha: anamnese com flag sem registro sai como RESSALVA', () => {
  const h = renderFicha({ ...ALUNO, anamnese_flag_sem_registro: true }, { hoje: HOJE });
  assert.match(h, /sem registro hoje/);
});

test('ficha: sem professor nem aula não inventa a linha', () => {
  const h = renderFicha({ ...ALUNO, professores: [], aulas_resumo: [] }, { hoje: HOJE });
  assert.doesNotMatch(h, /Professor/);
  assert.match(h, /Canto/, 'cai pro curso, que é o que se sabe');
});

test('renderAmbiguo lista os candidatos e pergunta', () => {
  const h = renderAmbiguo([{ nome: 'Bento Serpa' }, { nome: 'Bento Vieira' }], 'bento');
  assert.match(h, /Bento Serpa/);
  assert.match(h, /Bento Vieira/);
  assert.match(h, /Qual deles/i);
});

test('ficha: "hoje"/"ontem" em vez de "há 0 dia(s)"', () => {
  const f = (d) => renderFicha({ ...ALUNO, dias_desde_ultima_aula: d }, { hoje: HOJE });
  assert.match(f(0), /teve aula hoje/);
  assert.match(f(1), /última aula ontem/);
  assert.match(f(5), /última aula há 5 dias/);
  assert.doesNotMatch(f(5), /dia\(s\)/);
});

test('ficha: fatura no singular e no plural', () => {
  const f = (n) => renderFicha({ ...ALUNO, inadimplente: true, faturas_vencidas_abertas: n }, { hoje: HOJE });
  assert.match(f(1), /1 fatura vencida</);
  assert.match(f(3), /3 faturas vencidas</);
});

// "Maria" tem 23 alunos só no Recreio. Mostrar 8 de 23 dá a impressão de que são 8.
test('renderAmbiguo: muitos homônimos dizem o TAMANHO e pedem o sobrenome', () => {
  const h = renderAmbiguo([{ nome: 'Maria A' }], 'maria', 23);
  assert.match(h, /23 alunos/);
  assert.match(h, /sobrenome/i);
  assert.doesNotMatch(h, /<li>/, 'não lista uma amostra que engana');
});

test('resolverAluno devolve o total de homônimos, não só a fatia', () => {
  const gente = Array.from({ length: 12 }, (_, i) => ({ nome: `Maria Sobrenome${i}` }));
  const r = resolverAluno(gente, 'maria');
  assert.strictEqual(r.total, 12);
  assert.strictEqual(r.candidatos.length, 8, 'a fatia continua limitada');
});

// ── BUSCA ATRAVESSANDO AS UNIDADES ────────────────────────────────────────────────────────
const { buscarAlunoNasUnidades, UNIDADES_IDS, nomeDaUnidade } = require('./situacao-aluno');
const REC = '95553e96-971b-4590-a6eb-0201d013c14d';
const BAR = '368d47f5-2d88-4475-bc14-ba084a9a348e';

test('UNIDADES_IDS tem as três unidades, sem repetir apelido', () => {
  assert.strictEqual(UNIDADES_IDS.length, 3, 'cg e campogrande são o MESMO lugar');
  assert.strictEqual(nomeDaUnidade(REC), 'Recreio');
  assert.strictEqual(nomeDaUnidade('id-que-nao-existe'), null);
});

test('buscarAlunoNasUnidades junta as três e marca de onde cada pessoa veio', async () => {
  const consultar = async ({ unidadeId }) => ({ data: [{ nome: `Aluno de ${unidadeId.slice(0, 4)}` }] });
  const r = await buscarAlunoNasUnidades({ unidadeIds: [REC, BAR], client: null, consultar });
  assert.strictEqual(r.pessoas.length, 2);
  assert.strictEqual(r.pessoas[0]._unidade_id, REC);
  assert.strictEqual(r.falharam.length, 0);
});

// Zero por FALHA não pode parecer zero por SAÚDE: se uma unidade caiu, quem chamou precisa saber.
test('buscarAlunoNasUnidades: unidade que falha não derruba a busca, mas é REPORTADA', async () => {
  const consultar = async ({ unidadeId }) => {
    if (unidadeId === BAR) throw new Error('timeout');
    return { data: [{ nome: 'Alice' }] };
  };
  const r = await buscarAlunoNasUnidades({ unidadeIds: [REC, BAR], client: null, consultar });
  assert.strictEqual(r.pessoas.length, 1);
  assert.deepStrictEqual(r.falharam, [BAR]);
});

test('buscarAlunoNasUnidades: todas falhando devolve falharam completo (o chamador vira erro)', async () => {
  const consultar = async () => { throw new Error('fora do ar'); };
  const r = await buscarAlunoNasUnidades({ unidadeIds: [REC, BAR], client: null, consultar });
  assert.strictEqual(r.pessoas.length, 0);
  assert.strictEqual(r.falharam.length, 2);
});

test('homônimos em unidades diferentes: o card mostra a UNIDADE, que é o que desempata', () => {
  const h = renderAmbiguo([{ nome: 'Ana Silva', _unidade_id: REC }, { nome: 'Ana Silva', _unidade_id: BAR }], 'ana silva');
  assert.match(h, /Recreio/);
  assert.match(h, /Barra/);
});

test('ficha diz em qual unidade a pessoa está quando a busca atravessou', () => {
  const h = renderFicha({ ...ALUNO, _unidade_id: BAR }, { hoje: HOJE });
  assert.match(h, /LA Report · Barra/);
});

// ── O CABEÇALHO ASSINA A UNIDADE ──────────────────────────────────────────────────────────
// 02/09, Sucesso do Aluno: a Fabi pediu "sem contrato na Barra" e o card veio com o cabeçalho
// "👥 Sucesso do Aluno · 92". 92 era da Barra, mas quem lê entende como sendo da escola. Quando
// ela contestou, nem o TOM sabia dizer de qual das três listas ela falava.
test('lista: o cabeçalho é a UNIDADE, não o nome do grupo', () => {
  const h = renderLista({
    recorte: 'contrato', pessoas: [{ nome: 'Alice', classificacao: 'LA' }], total: 1,
    grupoNome: 'Sucesso do Aluno', unidadeNome: 'Barra',
  });
  assert.match(h, /Barra/);
  assert.doesNotMatch(h, /Sucesso do Aluno/, 'o grupo perguntou; quem assina o número é a unidade');
});

test('lista vazia também assina a unidade (o "ninguém" é de alguém)', () => {
  const h = renderLista({
    recorte: 'foto', pessoas: [], total: 0, grupoNome: 'Sucesso do Aluno', unidadeNome: 'Recreio',
  });
  assert.match(h, /Recreio/);
  assert.doesNotMatch(h, /Sucesso do Aluno/);
});

test('resumo: o cabeçalho é a UNIDADE', () => {
  const h = renderResumo({ total_pessoas: 337, pendentes: { anamnese: 233 } },
    { grupoNome: 'Sucesso do Aluno', unidadeNome: 'Recreio' });
  assert.match(h, /Recreio/);
  assert.doesNotMatch(h, /Sucesso do Aluno/);
});

test('sem unidade conhecida, cai pro nome do grupo em vez de mentir', () => {
  const h = renderLista({ recorte: 'foto', pessoas: [], total: 0, grupoNome: 'ADM CG' });
  assert.match(h, /ADM CG/);
});

test('sem unidade e sem grupo, não inventa nome nenhum', () => {
  const h = renderLista({ recorte: 'foto', pessoas: [], total: 0 });
  assert.match(h, /a unidade/);
});

// ── QUEM É ALUNO E TAMBÉM DÁ AULA ─────────────────────────────────────────────────────────
// 02/09: "1 sem anamnese: Gabriel Antony Alves de Araujo" — e o Alf: "esse é professor, não
// aluno". Conferido: ele é os dois (matriculado em Bateria, com aula ontem) e o nome dele
// aparece como professor de outras turmas. São 6 pessoas assim. O card tem que dizer, senão
// toda aparição delas vira uma suspeita de bug.
const { conjuntoDeProfessores, tambemDaAula } = require('./situacao-aluno');

const TURMAS = [
  { nome: 'Alice Cagnin', professores: ['Gabriel Antony Alves de Araújo'] },
  { nome: 'Bento Serpa', professores: ['Rafael Alves Souza (Akeem)'] },
];

test('conjuntoDeProfessores tira os professores do próprio conjunto consultado', () => {
  const s = conjuntoDeProfessores(TURMAS);
  assert.strictEqual(s.size, 2);
  assert.ok(tambemDaAula('Gabriel Antony Alves de Araujo', s), 'acento não pode desfazer o match');
  assert.ok(!tambemDaAula('Alice Cagnin', s));
});

test('tambemDaAula com conjunto vazio nunca marca ninguém', () => {
  assert.ok(!tambemDaAula('Fulano', new Set()));
  assert.ok(!tambemDaAula('Fulano', null));
});

test('lista marca quem também dá aula', () => {
  const profs = conjuntoDeProfessores(TURMAS);
  const h = renderLista({
    recorte: 'anamnese', total: 1, unidadeNome: 'Recreio', professores: profs,
    pessoas: [{ nome: 'Gabriel Antony Alves de Araujo', classificacao: 'EMLA' }],
  });
  assert.match(h, /também dá aula aqui/);
});

test('lista NÃO marca quem só estuda', () => {
  const h = renderLista({
    recorte: 'anamnese', total: 1, unidadeNome: 'Recreio', professores: conjuntoDeProfessores(TURMAS),
    pessoas: [{ nome: 'Alice Cagnin', classificacao: 'LAMK' }],
  });
  assert.doesNotMatch(h, /também dá aula/);
});

test('ficha diz que a pessoa é aluno E dá aula', () => {
  const h = renderFicha({ ...ALUNO, nome: 'Gabriel Antony Alves de Araujo' },
    { hoje: HOJE, professores: conjuntoDeProfessores(TURMAS) });
  assert.match(h, /também aparece como professor/);
});

// ── O CARD NÃO FALA: dado é do código, voz é do modelo ────────────────────────────────────
// Três unidades seguidas devolveram a MESMA frase enlatada ("tudo em dia por aqui 👊"), junto
// com a linha do modelo. Duas vozes na mesma resposta, uma delas sempre idêntica: robô.
test('lista vazia é um fato, não uma frase de efeito', () => {
  const h = renderLista({ recorte: 'foto', pessoas: [], total: 0, unidadeNome: 'Recreio' });
  assert.match(h, /Ninguém sem foto/);
  assert.doesNotMatch(h, /tudo em dia por aqui/);
  assert.doesNotMatch(h, /👊/);
});

test('fim de lista não estampa "Essa foi a lista toda"', () => {
  const h = renderLista({
    recorte: 'foto', total: 2, unidadeNome: 'Barra',
    pessoas: [{ nome: 'Ana', classificacao: 'LA' }, { nome: 'Bia', classificacao: 'LA' }],
  });
  assert.doesNotMatch(h, /lista toda/);
  assert.doesNotMatch(h, /👊/);
});

// "Começando pelas crianças" explica a ORDEM. Com um adulto sozinho não explica nada.
test('a dica de ordem só sai quando há criança E mais de um nome', () => {
  const so1 = renderLista({
    recorte: 'anamnese', total: 1, unidadeNome: 'Recreio',
    pessoas: [{ nome: 'Gabriel', classificacao: 'EMLA' }],
  });
  assert.doesNotMatch(so1, /Começando pelas crianças/);
  assert.doesNotMatch(so1, /\.:/, 'e sem ponto duplicado');

  const comCrianca = renderLista({
    recorte: 'foto', total: 2, unidadeNome: 'Barra',
    pessoas: [{ nome: 'Bento', classificacao: 'LAMK' }, { nome: 'Ana', classificacao: 'LA' }],
  });
  assert.match(comCrianca, /Começando pelas crianças/);
});

// ── NOME DE COLUNA NÃO É PALAVRA DE GENTE ─────────────────────────────────────────────────
// A bateria de sombra pegou "📋 Cadastro: falta data_inicio_contrato" no card. Esse token
// aparece 306 vezes na base — ninguém no grupo fala assim.
const { rotuloPendencia, responsavelDistinto } = require('./situacao-aluno');

test('rotuloPendencia traduz o vocabulário conhecido', () => {
  assert.strictEqual(rotuloPendencia('data_inicio_contrato'), 'data de início do contrato');
  assert.strictEqual(rotuloPendencia('instagram'), 'Instagram');
  assert.strictEqual(rotuloPendencia('foto'), 'foto');
  assert.strictEqual(rotuloPendencia('telefone'), 'telefone');
});

// Coluna nova tem que ficar FEIA, não sumir: pendência que desaparece calada é pior.
test('rotuloPendencia humaniza token desconhecido em vez de escondê-lo', () => {
  assert.strictEqual(rotuloPendencia('cpf_responsavel_legal'), 'cpf responsavel legal');
});

test('ficha escreve a pendência em português, não o nome da coluna', () => {
  const h = renderFicha({ ...ALUNO, cadastro_faltando: ['data_inicio_contrato', 'instagram'] }, { hoje: HOJE });
  assert.match(h, /data de início do contrato/);
  assert.doesNotMatch(h, /data_inicio_contrato/);
});

// ── RESPONSÁVEL QUE É O PRÓPRIO ALUNO ─────────────────────────────────────────────────────
// responsavel_nome cai pro nome da criança em 64% dos casos (310 de 481). Na lista da
// comunidade isso virava "🧒 Alice — resp. Alice": manda convidar a criança, que é justamente
// quem não entra em grupo de WhatsApp.
test('responsavelDistinto ignora o campo quando ele repete o nome do aluno', () => {
  assert.strictEqual(responsavelDistinto({ nome: 'Alice Mafra', responsavel_nome: 'Alice Mafra' }), null);
  assert.strictEqual(responsavelDistinto({ nome: 'Alice Mafra', responsavel_nome: 'ALICE MAFRA' }), null, 'caixa não engana');
  assert.strictEqual(responsavelDistinto({ nome: 'Alice Cagnin', responsavel_nome: 'Joyce Alves' }), 'Joyce Alves');
  assert.strictEqual(responsavelDistinto({ nome: 'Alice', responsavel_nome: null }), null);
});

test('lista da comunidade: sem responsável distinto, DIZ que não tem — não repete a criança', () => {
  const h = renderLista({
    recorte: 'comunidade', total: 1, unidadeNome: 'Barra',
    pessoas: [{ nome: 'Alice Cordeiro Mafra', classificacao: 'LAMK', responsavel_nome: 'Alice Cordeiro Mafra' }],
  });
  assert.match(h, /sem responsável identificado/);
  assert.doesNotMatch(h, /resp\. Alice/);
});

test('lista da comunidade: com responsável de verdade, mostra o nome dele', () => {
  const h = renderLista({
    recorte: 'comunidade', total: 1, unidadeNome: 'Recreio',
    pessoas: [{ nome: 'Alice Cagnin', classificacao: 'LAMK', responsavel_nome: 'Joyce Alves de Souza' }],
  });
  assert.match(h, /resp\. Joyce Alves de Souza/);
});

test('ficha: responsável repetido vira "não identificado", não o nome da criança', () => {
  const h = renderFicha({ ...ALUNO, nome: 'Bento Serpa Benitez', responsavel_nome: 'Bento Serpa Benitez' }, { hoje: HOJE });
  assert.match(h, /não identificado no cadastro/);
});

test('ficha: fora da comunidade sem responsável distinto não aponta pra criança', () => {
  const h = renderFicha({
    ...ALUNO, nome: 'Bento Serpa Benitez', responsavel_nome: 'Bento Serpa Benitez',
    comunidade_status: 'fora_da_comunidade',
  }, { hoje: HOJE });
  assert.match(h, /Fora da comunidade/);
  assert.doesNotMatch(h, /quem precisa entrar é Bento/);
});

// ── A PORTA QUE FICOU ABERTA: O RECORTE 'contrato' QUANDO ALGUÉM PERGUNTA (04/09) ──────────
// A reversão de 9aec4e0c tirou o contrato das mensagens que o TOM manda POR CONTA PRÓPRIA (a
// pauta da manhã e o lembrete de hora em hora). Só que o recorte continuou vivo pra quem
// PERGUNTA — e o dono disse à equipe, nos três grupos, "me peça a lista de contrato que eu
// mando ela inteira". Ou seja: o TOM pararia de oferecer o número errado e diria o mesmo
// número errado no segundo seguinte.
//
// O número sai de `data_inicio_contrato`, campo DERIVADO da data da primeira aula: ele existe
// desde a criação da matrícula e não sabe nada sobre assinatura. Quem está sem ele É uma
// pendência de verdade — só não é a que a pessoa está pensando ao pedir "a lista de contrato".
// Por isso a resposta não é bloqueada (a informação vale): ela passa a DIZER o que é.
//
// A ressalva anda no MESMO interruptor da pauta — pura.CONTRATO_NA_PAUTA, em
// services/anamnese-pauta.js. Não há segundo botão: o último teste deste bloco liga o
// interruptor DE VERDADE e exige que a ressalva suma sozinha nas três superfícies.
const pura = require('./anamnese-pauta');
const { RESSALVA_CONTRATO } = require('./situacao-aluno');

// Liga o interruptor de verdade (a propriedade exportada é a MESMA que o render lê em tempo de
// chamada) e devolve ao lugar no finally — teste que vaza estado envenena o arquivo inteiro.
function comOContratoReligado(fn) {
  const antes = pura.CONTRATO_NA_PAUTA;
  pura.CONTRATO_NA_PAUTA = true;
  try { return fn(); } finally { pura.CONTRATO_NA_PAUTA = antes; }
}

// O espelho do de cima. Estes testes provam a ressalva LIGADA (interruptor desligado); desde
// 06/09 o padrão do arquivo é o contrário, então eles declaram o estado que exercitam em vez de
// herdá-lo — teste que depende do valor atual de uma flag quebra no dia em que a flag muda, e
// foi exatamente o que aconteceu aqui.
function comOContratoDesligado(fn) {
  const antes = pura.CONTRATO_NA_PAUTA;
  pura.CONTRATO_NA_PAUTA = false;
  try { return fn(); } finally { pura.CONTRATO_NA_PAUTA = antes; }
}

const SEM_CONTRATO = (n) => Array.from({ length: n }, (_, i) => P(`Aluno ${String(i).padStart(2, '0')}`, { tem_data_contrato: false }));

test('lista de contrato: a ressalva sai COLADA no número, na primeira página', () => comOContratoDesligado(() => {
    const h = renderLista({ recorte: 'contrato', unidadeNome: 'Recreio', pessoas: SEM_CONTRATO(92), total: 92 });
    assert.match(h, /<b>92<\/b> sem data de contrato/);
    assert.ok(h.includes(RESSALVA_CONTRATO), 'o número saiu sem a ressalva');
    assert.match(h, /não é o mesmo que não ter assinado/);
    // Colada mesmo: entre a linha do número e a lista de nomes, não perdida no rodapé.
    assert.ok(h.indexOf(RESSALVA_CONTRATO) < h.indexOf('<ul>'), 'a ressalva ficou depois dos nomes');
}));

test('lista de contrato: a CONTINUAÇÃO também traz a ressalva — pedir o resto não pode limpar o aviso', () => comOContratoDesligado(() => {
    const h = renderLista({ recorte: 'contrato', unidadeNome: 'Recreio', pessoas: SEM_CONTRATO(92), total: 92, pagina: 1 });
    assert.match(h, /Continuando/);
    assert.ok(h.includes(RESSALVA_CONTRATO), 'a página 2 mostrou o número sem a ressalva');
}));

test('lista de contrato VAZIA traz a ressalva — "ninguém sem contrato" é a leitura mais perigosa de todas', () => comOContratoDesligado(() => {
    const h = renderLista({ recorte: 'contrato', unidadeNome: 'Barra', pessoas: [], total: 0 });
    assert.match(h, /Ninguém sem data de contrato/);
    assert.ok(h.includes(RESSALVA_CONTRATO), 'o zero saiu sozinho, e zero sem ressalva se lê como "todo mundo assinou"');
}));

test('ficha: quem está sem data de contrato leva a ressalva junto da linha de cadastro', () => comOContratoDesligado(() => {
    const h = renderFicha({ ...ALUNO, cadastro_faltando: ['data_inicio_contrato', 'foto'] }, { hoje: HOJE });
    assert.match(h, /falta <b>data de início do contrato, foto<\/b>/);
    assert.ok(h.includes(RESSALVA_CONTRATO), 'a ficha apontou a pendência sem dizer o que ela é');
}));

test('ficha: pendência de cadastro que NÃO é contrato não ganha ressalva nenhuma', () => {
  const h = renderFicha({ ...ALUNO, cadastro_faltando: ['foto', 'telefone'] }, { hoje: HOJE });
  assert.ok(!h.includes(RESSALVA_CONTRATO));
  assert.doesNotMatch(h, /assinad/i);
});

test('ficha com cadastro completo continua limpa', () => {
  const h = renderFicha({ ...ALUNO, cadastro_faltando: [] }, { hoje: HOJE });
  assert.match(h, /Cadastro completo/);
  assert.ok(!h.includes(RESSALVA_CONTRATO));
});

test('os OUTROS recortes não ganharam texto nenhum', () => {
  for (const rec of ['anamnese', 'instagram', 'foto', 'telefone', 'comunidade']) {
    const cheio = renderLista({ recorte: rec, unidadeNome: 'Recreio', pessoas: SEM_CONTRATO(20), total: 20 });
    const vazio = renderLista({ recorte: rec, unidadeNome: 'Recreio', pessoas: [], total: 0 });
    for (const h of [cheio, vazio]) {
      assert.ok(!h.includes(RESSALVA_CONTRATO), `${rec} ganhou a ressalva do contrato`);
      assert.doesNotMatch(h, /assinad/i, `${rec} ganhou texto de contrato`);
    }
  }
  // O resumo TEM a ressalva quando há pendência de contrato — é a terceira superfície que lê o
  // mesmo número (ver testes dedicados logo abaixo). Aqui o que importa é confirmar que os
  // OUTROS recortes continuam de fora, o que já foi checado no loop acima.
});

test('RELIGADO o interruptor da pauta, a ressalva some SOZINHA — lista, continuação, vazio e ficha', () => {
  comOContratoReligado(() => {
    const cheio = renderLista({ recorte: 'contrato', unidadeNome: 'Recreio', pessoas: SEM_CONTRATO(92), total: 92 });
    const cont = renderLista({ recorte: 'contrato', unidadeNome: 'Recreio', pessoas: SEM_CONTRATO(92), total: 92, pagina: 1 });
    const vazio = renderLista({ recorte: 'contrato', unidadeNome: 'Barra', pessoas: [], total: 0 });
    const ficha = renderFicha({ ...ALUNO, cadastro_faltando: ['data_inicio_contrato'] }, { hoje: HOJE });
    for (const h of [cheio, cont, vazio, ficha]) {
      assert.ok(!h.includes(RESSALVA_CONTRATO), 'a ressalva sobreviveu ao interruptor ligado');
      assert.doesNotMatch(h, /não é o mesmo que não ter assinado/);
    }
    // E o resto do card continua inteiro: o que sai de cena é a ressalva, não o número.
    assert.match(cheio, /<b>92<\/b> sem data de contrato/);
    assert.match(ficha, /falta <b>data de início do contrato<\/b>/);
  });
  // Desligado de volta, a ressalva volta na mesma chamada — ninguém precisa mexer aqui.
  const depois = renderLista({ recorte: 'contrato', unidadeNome: 'Recreio', pessoas: SEM_CONTRATO(92), total: 92 });
  assert.strictEqual(depois.includes(RESSALVA_CONTRATO), !pura.CONTRATO_NA_PAUTA);
});

// A PORTA QUE FICOU ABERTA (04/09): o resumo também imprime "92 sem data de contrato" — a
// mesma frase, lida como "não assinaram", numa terceira superfície que renderLista/renderFicha
// já cobriam. Reusa ressalvaDeContrato() (mesmo interruptor, lido em tempo de chamada); nada de
// segunda cópia da frase nem de segundo botão.
test('resumo: pendência de data de contrato carrega a ressalva junto do número, não no fim do card', () => comOContratoDesligado(() => {
    const h = renderResumo({ total_pessoas: 300, pendentes: { data_inicio_contrato: 92 }, regra_versao: 'v1' });
    assert.match(h, /<b>92<\/b> sem data de contrato/);
    assert.ok(h.includes(RESSALVA_CONTRATO), 'o número saiu sem a ressalva');
    // "Junto do número": antes da linha de fonte do rodapé, não depois dela.
    assert.ok(h.indexOf(RESSALVA_CONTRATO) < h.indexOf('fonte:'), 'a ressalva foi parar depois do rodapé');
}));

test('resumo SEM pendência de contrato não ganha a ressalva', () => {
  const h = renderResumo({ total_pessoas: 300, pendentes: { anamnese: 40 }, regra_versao: 'v1' });
  assert.ok(!h.includes(RESSALVA_CONTRATO));
  assert.doesNotMatch(h, /assinad/i);
});

test('resumo RELIGADO o interruptor da pauta, a ressalva some SOZINHA — mesmo CONTRATO_NA_PAUTA das outras duas superfícies', () => {
  comOContratoReligado(() => {
    const h = renderResumo({ total_pessoas: 300, pendentes: { data_inicio_contrato: 92 }, regra_versao: 'v1' });
    assert.ok(!h.includes(RESSALVA_CONTRATO), 'a ressalva sobreviveu ao interruptor ligado');
    assert.doesNotMatch(h, /não é o mesmo que não ter assinado/);
    // O número continua saindo — o que some é só a ressalva.
    assert.match(h, /<b>92<\/b> sem data de contrato/);
  });
  const depois = renderResumo({ total_pessoas: 300, pendentes: { data_inicio_contrato: 92 }, regra_versao: 'v1' });
  assert.strictEqual(depois.includes(RESSALVA_CONTRATO), !pura.CONTRATO_NA_PAUTA);
});
