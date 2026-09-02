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
