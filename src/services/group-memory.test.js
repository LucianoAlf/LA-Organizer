'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { montarHistorico, extrairMemoriaDeGrupo, consolidateGroupMemoryFor, deveConsolidarGrupo } = require('./group-memory');

const GRUPO = { id: 'g1', name: 'Administração Recreio' };

function fakeSupabase({ mensagens = [], existentes = [], insertErro = null } = {}) {
  const inseridas = [];
  return {
    _inseridas: inseridas,
    from(tbl) {
      const q = {
        // `or` entrou quando o SELECT de `existentes` passou a trazer também as memórias
        // globais (scope='tom') dos outros grupos — sem ele o grupo reaprende a mesma regra.
        select: () => q, eq: () => q, gte: () => q, order: () => q, is: () => q, or: () => q,
        insert: async (row) => { inseridas.push(row); return { error: insertErro }; },
        then: (ok) => ok({ data: tbl === 'group_chat_messages' ? mensagens : existentes, error: null }),
      };
      return q;
    },
  };
}

const semEmbedding = async () => { throw new Error('sem embedding no teste'); };

test('montarHistorico identifica quem falou e ignora linha vazia', () => {
  const txt = montarHistorico([
    { role: 'member', content: 'Tom, temos 6 contratos', sender: { full_name: 'Clayton' } },
    { role: 'tom', content: 'Criei os lembretes' },
    { role: 'member', content: '   ', sender: { full_name: 'Fefê' } },
  ]);
  assert.match(txt, /Clayton: Tom, temos 6 contratos/);
  assert.match(txt, /TOM: Criei os lembretes/);
  assert.doesNotMatch(txt, /Fefê/);
});

test('PISO: grupo sem mensagem em 24h não chama LLM nem grava', async () => {
  const sb = fakeSupabase({ mensagens: [] });
  let chamou = false;
  const r = await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO, chat: async () => { chamou = true; return '[]'; },
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  assert.strictEqual(chamou, false, 'não pode gastar LLM em grupo parado');
  assert.strictEqual(r.salvas, 0);
  assert.strictEqual(sb._inseridas.length, 0);
});

test('ANTI-VACUIDADE: LLM devolve lista vazia → zero memórias, sem inventar', async () => {
  const sb = fakeSupabase({ mensagens: [{ role: 'member', content: 'bom dia', sender: { full_name: 'Fefê' } }] });
  const r = await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO, chat: async () => '[]',
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  assert.strictEqual(r.salvas, 0);
  assert.strictEqual(sb._inseridas.length, 0);
  assert.strictEqual(r.erro, null);
});

// A conversa foi 02/09 17h BRT; a rodada do Dream é 03/09 03h BRT. occurred_on tem que ser
// o dia da CONVERSA — senão toda memória nasce datada da madrugada seguinte.
test('grava com occurred_on do DIA da conversa e source do dia da rodada', async () => {
  const sb = fakeSupabase({ mensagens: [{ role: 'member', content: 'o contrato do Kaique não sai', created_at: '2026-09-02T20:00:00Z', sender: { full_name: 'Clayton' } }] });
  await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async () => JSON.stringify([{ memory_type: 'decision', content: 'contrato do Kaique nao sai: aluno em aviso previo', importance: 'high', evidence: 'o contrato do Kaique não sai' }]),
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  const row = sb._inseridas[0];
  assert.strictEqual(row.group_id, 'g1');
  assert.strictEqual(row.occurred_on, '2026-09-02', 'o dia da CONVERSA, não o da rodada');
  assert.strictEqual(row.source, 'dream:2026-09-03');
  assert.strictEqual(row.evidence, 'o contrato do Kaique não sai');
});

test('GATE: lesson entra inativa; decision entra ativa', async () => {
  const sb = fakeSupabase({ mensagens: [{ role: 'member', content: 'x', created_at: '2026-09-02T20:00:00Z', sender: { full_name: 'Clayton' } }] });
  await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async () => JSON.stringify([
      { memory_type: 'lesson', content: 'nao cobrar contrato de aluno em aviso previo', importance: 'high' },
      { memory_type: 'decision', content: 'ficam cinco contratos para assinar nesta semana', importance: 'normal' },
    ]),
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  const licao = sb._inseridas.find((r) => r.memory_type === 'lesson');
  const decisao = sb._inseridas.find((r) => r.memory_type === 'decision');
  assert.strictEqual(licao.is_active, false);
  assert.strictEqual(licao.approved_at, null);
  assert.strictEqual(decisao.is_active, true);
});

test('SEM SEGREDO: candidata com senha não é gravada', async () => {
  const sb = fakeSupabase({ mensagens: [{ role: 'member', content: 'x', created_at: '2026-09-02T20:00:00Z', sender: { full_name: 'Clayton' } }] });
  const r = await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async () => JSON.stringify([{ memory_type: 'fact', content: 'a senha do Zoho e 1234', importance: 'high' }]),
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  assert.strictEqual(sb._inseridas.length, 0);
  assert.strictEqual(r.descartadas.credencial, 1);
});

test('SENSOR: LLM que quebra devolve erro, não silêncio', async () => {
  const sb = fakeSupabase({ mensagens: [{ role: 'member', content: 'x', created_at: '2026-09-02T20:00:00Z', sender: { full_name: 'Clayton' } }] });
  const r = await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO, chat: async () => { throw new Error('provider caiu'); },
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  assert.match(r.erro, /provider caiu/);
  assert.strictEqual(r.salvas, 0);
});

test('extrairMemoriaDeGrupo devolve [] quando o modelo responde prosa', async () => {
  const out = await extrairMemoriaDeGrupo({
    groupName: 'X', historyText: 'oi', existentes: [], chat: async () => 'não consegui, desculpa',
  });
  assert.deepStrictEqual(out, []);
});

// O Dream pode ser re-disparado no mesmo dia (force, restart). O piso de mensagens mora dentro
// do consolidador; este gate e so o "ja rodou hoje".
test('gate: so consolida grupo que ainda nao rodou hoje', () => {
  assert.strictEqual(deveConsolidarGrupo({ jaRodouHoje: false }), true);
  assert.strictEqual(deveConsolidarGrupo({ jaRodouHoje: true }), false, 'idempotencia: 1x por dia por grupo');
});

// ── FATIA 2: LEITURA DA MEMÓRIA DE GRUPO ──────────────────────────────────────────────────
// O TOM guardava desde 02/09 e nunca lia de volta. O bloco fixo entra em todo prompt do grupo
// e custa zero de LLM.
const {
  memoriaViva, ordenarMemorias, linhaDeMemoria, montarBlocoMemoria, escolherMemoria,
  MINIMO_PRA_TROCAR,
} = require('./group-memory');

const AGORA = new Date('2026-09-03T12:00:00Z');
const M = (o) => ({ content: 'combinado qualquer', importance: 'normal', occurred_on: '2026-09-02', is_active: true, ...o });

test('memoriaViva: desativada, vencida ou vazia ficam de fora', () => {
  assert.ok(memoriaViva(M({}), AGORA));
  assert.ok(!memoriaViva(M({ is_active: false }), AGORA));
  assert.ok(!memoriaViva(M({ decay_at: '2026-09-01T00:00:00Z' }), AGORA), 'venceu ontem');
  assert.ok(memoriaViva(M({ decay_at: '2026-09-12T00:00:00Z' }), AGORA), 'vence semana que vem');
  assert.ok(!memoriaViva(M({ content: '   ' }), AGORA));
});

test('ordem: importância primeiro, recência como desempate', () => {
  const r = ordenarMemorias([
    M({ content: 'a', importance: 'normal', occurred_on: '2026-09-01' }),
    M({ content: 'b', importance: 'high', occurred_on: '2026-08-01' }),
    M({ content: 'c', importance: 'normal', occurred_on: '2026-09-02' }),
    M({ content: 'd', importance: 'low', occurred_on: '2026-09-03' }),
  ]);
  assert.deepStrictEqual(r.map((m) => m.content), ['b', 'c', 'a', 'd']);
});

// Sem a data, "contrato do Kaique não sai" vira verdade sem prazo e ele repete em novembro —
// exatamente o que o buffer velho fez com "hoje é 06/08".
test('cada linha carrega a data do dia em que aquilo aconteceu', () => {
  assert.strictEqual(linhaDeMemoria(M({ content: 'boleto vai no grupo', occurred_on: '2026-08-12' })),
    '12/08 — boleto vai no grupo');
  assert.strictEqual(linhaDeMemoria(M({ content: 'sem data', occurred_on: null })), 'sem data');
});

test('bloco respeita o teto e corta pelo MENOS importante', () => {
  const bloco = montarBlocoMemoria([
    M({ content: 'IMPORTANTE', importance: 'high' }),
    M({ content: 'x'.repeat(200), importance: 'low' }),
  ], { agora: AGORA, teto: 40 });
  assert.match(bloco, /IMPORTANTE/);
  assert.doesNotMatch(bloco, /xxxxx/, 'o low não coube e foi cortado');
});

test('bloco só com memórias vencidas devolve null, não string vazia', () => {
  assert.strictEqual(montarBlocoMemoria([M({ decay_at: '2026-01-01T00:00:00Z' })], { agora: AGORA }), null);
});

// A transição é por GRUPO: nenhum grupo passa um dia sem contexto.
test('menos de 3 memórias ativas: segue o buffer velho', () => {
  const r = escolherMemoria({ memorias: [M({}), M({})], bufferAntigo: 'resumo antigo', agora: AGORA });
  assert.strictEqual(r.fonte, 'buffer');
  assert.strictEqual(r.texto, 'resumo antigo');
  assert.strictEqual(r.vivas, 2);
});

test('a partir de 3: só o bloco novo, o buffer velho sai de cena', () => {
  const r = escolherMemoria({
    memorias: [M({ content: 'um' }), M({ content: 'dois' }), M({ content: 'três' })],
    bufferAntigo: 'resumo antigo', agora: AGORA,
  });
  assert.strictEqual(r.fonte, 'group_memory');
  assert.match(r.texto, /um/);
  assert.doesNotMatch(r.texto, /resumo antigo/);
});

test('memórias vencidas não contam pro mínimo de 3', () => {
  const r = escolherMemoria({
    memorias: [M({}), M({}), M({ decay_at: '2026-01-01T00:00:00Z' })],
    bufferAntigo: 'resumo antigo', agora: AGORA,
  });
  assert.strictEqual(r.fonte, 'buffer', 'duas vivas + uma morta = ainda não troca');
});

// Leitura que falha devolve null (não []), e null não pode virar "grupo sem memória" calado.
test('falha de leitura cai no buffer velho, não em silêncio', () => {
  const r = escolherMemoria({ memorias: null, bufferAntigo: 'resumo antigo', agora: AGORA });
  assert.strictEqual(r.fonte, 'buffer');
  assert.strictEqual(r.texto, 'resumo antigo');
});

test('sem memória nova E sem buffer, devolve null — nunca inventa bloco', () => {
  const r = escolherMemoria({ memorias: [], bufferAntigo: null, agora: AGORA });
  assert.strictEqual(r.texto, null);
});

test('MINIMO_PRA_TROCAR é 3, como a spec definiu', () => {
  assert.strictEqual(MINIMO_PRA_TROCAR, 3);
});

// ── FATIA 3: O ATO DE APROVAR A LIÇÃO ─────────────────────────────────────────────────────
// A lição nasce inativa porque muda o COMPORTAMENTO do TOM na frente da equipe. O health-check
// das 05:00 já avisava "⛔ N lições esperando seu ok" — mas não existia como responder, e sete
// ficaram paradas. O portão está certo; faltava a maçaneta.
const {
  ordenarPendentes, decidirMemorias, renderMemoriasPendentes, renderDecisao,
} = require('./group-memory');

const L = (id, content, dia) => ({ id, content, occurred_on: dia || '2026-09-03' });

// A pessoa responde por NÚMERO. Se a ordem escorregar entre o card e o comando, ela aprova
// outra coisa — e lição errada muda o comportamento dele com o time inteiro.
test('ordem é determinística: data desc, id como desempate', () => {
  const r = ordenarPendentes([
    L('b', 'dois', '2026-09-03'), L('a', 'um', '2026-09-03'), L('c', 'velha', '2026-09-01'),
  ]);
  assert.deepStrictEqual(r.map((x) => x.id), ['a', 'b', 'c']);
});

test('a mesma entrada em ordem embaralhada dá a mesma numeração', () => {
  const base = [L('b', 'dois'), L('a', 'um'), L('c', 'três')];
  const n1 = ordenarPendentes(base).map((x) => x.id);
  const n2 = ordenarPendentes([...base].reverse()).map((x) => x.id);
  assert.deepStrictEqual(n1, n2);
});

test('o card numera e diz como responder', () => {
  const h = renderMemoriasPendentes([L('a', 'chamar pelo nome'), L('b', 'não chutar dado')], { grupoNome: 'ADM CG' });
  assert.match(h, /ADM CG/);
  assert.match(h, /<b>1\.<\/b> chamar pelo nome/);
  assert.match(h, /<b>2\.<\/b> não chutar dado/);
  assert.match(h, /aprova a 1/);
});

// A fila deixou de ser só de lições (fact e preference agora esperam o ok também), então a
// palavra no card mudou junto — o card vazio não pode prometer que só lição espera aprovação.
test('sem pendência o card diz isso, não fica vazio', () => {
  assert.match(renderMemoriasPendentes([], { grupoNome: 'Barra' }), /Nenhuma memória esperando/);
});

function fakeSb(registro) {
  return {
    from() {
      const api = {
        update(patch) { api._patch = patch; return api; },
        eq(col, val) { if (col === 'id') registro.push({ id: val, ...api._patch }); return Promise.resolve({ error: null }); },
      };
      return api;
    },
  };
}

test('aprovar ativa e carimba a decisão', async () => {
  const escritas = [];
  const r = await decidirMemorias(fakeSb(escritas), {
    pendentes: [L('a', 'um'), L('b', 'dois'), L('c', 'três')], numeros: [1, 3], acao: 'aprovar',
  });
  assert.deepStrictEqual(escritas.map((x) => x.id), ['a', 'c']);
  assert.ok(escritas.every((x) => x.is_active === true && x.approved_at));
  assert.strictEqual(r.feitos.length, 2);
});

// Descartada também recebe approved_at, senão volta pra fila amanhã e a pessoa é obrigada a
// dizer não pra sempre.
test('descartar carimba a decisão para a lição não voltar pra fila', async () => {
  const escritas = [];
  await decidirMemorias(fakeSb(escritas), { pendentes: [L('a', 'um')], numeros: [1], acao: 'descartar' });
  assert.strictEqual(escritas[0].is_active, false);
  assert.ok(escritas[0].approved_at, 'sem approved_at ela reaparece como pendente');
});

test('número fora da lista não vira aprovação silenciosa', async () => {
  const escritas = [];
  const r = await decidirMemorias(fakeSb(escritas), { pendentes: [L('a', 'um')], numeros: [1, 7], acao: 'aprovar' });
  assert.deepStrictEqual(escritas.map((x) => x.id), ['a']);
  assert.deepStrictEqual(r.foraDaLista, [7]);
});

test('número repetido não aplica duas vezes', async () => {
  const escritas = [];
  await decidirMemorias(fakeSb(escritas), { pendentes: [L('a', 'um')], numeros: [1, 1, 1], acao: 'aprovar' });
  assert.strictEqual(escritas.length, 1);
});

// Mostra o TEXTO do que foi decidido, não o número: se a numeração tiver escorregado, quem leu
// vê na hora que aprovou outra coisa.
test('o card da decisão repete o TEXTO da lição, não o número', () => {
  const h = renderDecisao({ feitos: [L('a', 'chamar pelo nome')], foraDaLista: [], acao: 'aprovar' });
  assert.match(h, /chamar pelo nome/);
  assert.match(h, /Aprovada/);
});

test('nada aplicado é dito com todas as letras', () => {
  const h = renderDecisao({ feitos: [], foraDaLista: [9], acao: 'aprovar' });
  assert.match(h, /Não consegui aplicar nada/);
  assert.match(h, /9/);
});

// ── ANTI-CONFABULAÇÃO: o auto-relato do TOM não é evidência ────────────────────────────────
// 04/09 (medido): o TOM disse no grupo da Barra que "não processou a mensagem da Krissya por ter
// pego o 'Tom' do Alf primeiro". A mensagem dela é 11:15:34; o "Tom" do Alf é 11:35:12 — 19min38s
// DEPOIS. A explicação era hipótese do próprio TOM sobre a própria falha, e ia virar `fact` ATIVO
// na rodada das 3h (fact nasce is_active=true). Estes testes seguram esse caminho.
const { materialDeConsolidacao, origemDaEvidencia, DECAY_PADRAO_CONTEXT_DIAS } = require('./group-memory');

const RESUMO_MENTIROSO = '<h3>📋 Resumo da sessão</h3><p>TOM não processou a mensagem da Krissya por ter pego o "Tom" do Alf primeiro — falha reconhecida e corrigida na hora.</p>';
const FALA_MENTIROSA = 'Fui na ordem e peguei o "Tom" do Alf logo depois — acabei não processando o da Krissya.';

test('material de consolidação: o "Resumo da sessão" do TOM fica de fora', () => {
  const dentro = materialDeConsolidacao([
    { role: 'member', kind: 'text', content: 'Tom, lembra o Arthur às 16h', sender: { full_name: 'Krissya' } },
    { role: 'tom', kind: 'report', content: RESUMO_MENTIROSO },
    { role: 'tom', kind: 'text', content: 'Anotado!' },
  ]);
  assert.strictEqual(dentro.length, 2);
  assert.ok(!dentro.some((m) => m.kind === 'report'), 'report do TOM não é material de memória');
  assert.ok(dentro.some((m) => m.role === 'tom' && m.kind === 'text'), 'a fala do TOM segue como fio da conversa');
});

test('o resumo de sessão do TOM nem chega ao extrator', async () => {
  const sb = fakeSupabase({ mensagens: [
    { role: 'member', kind: 'text', content: 'Porque vc nao respondeu a Krissya?', created_at: '2026-09-04T14:35:37Z', sender: { full_name: 'Alf' } },
    { role: 'tom', kind: 'report', content: RESUMO_MENTIROSO, created_at: '2026-09-04T14:47:05Z' },
  ] });
  let visto = null;
  await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async (_sys, msgs) => { visto = msgs[0].content; return '[]'; },
    getEmbedding: semEmbedding, agora: new Date('2026-09-05T06:00:00Z'),
  });
  assert.ok(visto, 'o extrator foi chamado');
  assert.doesNotMatch(visto, /pego o "Tom" do Alf primeiro/, 'o resumo do TOM não pode ser material de memória');
  assert.match(visto, /Porque vc nao respondeu a Krissya/, 'a fala das PESSOAS continua inteira');
});

test('CORTE: auto-explicação do TOM não vira fact nem context', async () => {
  const sb = fakeSupabase({ mensagens: [
    { role: 'member', kind: 'text', content: 'Porque vc nao respondeu a Krissya?', created_at: '2026-09-04T14:35:37Z', sender: { full_name: 'Alf' } },
    { role: 'tom', kind: 'text', content: FALA_MENTIROSA, created_at: '2026-09-04T14:36:02Z' },
    { role: 'tom', kind: 'report', content: RESUMO_MENTIROSO, created_at: '2026-09-04T14:47:05Z' },
  ] });
  const r = await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async () => JSON.stringify([
      { memory_type: 'fact', content: 'O TOM nao respondeu a Krissya porque pegou o Tom do Alf primeiro',
        importance: 'high', evidence: FALA_MENTIROSA },
      { memory_type: 'context', content: 'A falha do TOM com a Krissya foi reconhecida e corrigida na hora',
        importance: 'normal', decay_at: '2026-09-20T00:00:00Z',
        evidence: 'TOM não processou a mensagem da Krissya por ter pego o "Tom" do Alf primeiro' },
    ]),
    getEmbedding: semEmbedding, agora: new Date('2026-09-05T06:00:00Z'),
  });
  assert.strictEqual(sb._inseridas.length, 0, 'nenhuma memória pode nascer da fala do TOM sobre o TOM');
  assert.strictEqual(r.descartadas.autoRelato, 2, 'o descarte é CONTADO, não silencioso');
});

test('a mesma auto-explicação, se virar lesson, vai pra fila de aprovação em vez de sumir', async () => {
  const sb = fakeSupabase({ mensagens: [
    { role: 'tom', kind: 'text', content: FALA_MENTIROSA, created_at: '2026-09-04T14:36:02Z' },
  ] });
  await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async () => JSON.stringify([
      { memory_type: 'lesson', content: 'TOM deve processar cada chamado na ordem em que chegou', importance: 'high', evidence: FALA_MENTIROSA },
    ]),
    getEmbedding: semEmbedding, agora: new Date('2026-09-05T06:00:00Z'),
  });
  assert.strictEqual(sb._inseridas.length, 1, 'hipótese do TOM vira PROPOSTA, não verdade');
  assert.strictEqual(sb._inseridas[0].is_active, false);
  assert.strictEqual(sb._inseridas[0].approved_at, null);
});

test('evidência dita por PESSOA continua virando memória', async () => {
  const sb = fakeSupabase({ mensagens: [
    { role: 'member', kind: 'text', content: 'Krissya, nao marca ele com @', created_at: '2026-09-04T14:00:53Z', sender: { full_name: 'Alf' } },
    { role: 'tom', kind: 'text', content: 'Entendi, Alf!', created_at: '2026-09-04T14:01:00Z' },
  ] });
  const r = await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async () => JSON.stringify([
      { memory_type: 'fact', content: 'No grupo o TOM e chamado pelo nome, sem arroba', importance: 'high', evidence: 'Krissya, nao marca ele com @' },
    ]),
    getEmbedding: semEmbedding, agora: new Date('2026-09-05T06:00:00Z'),
  });
  assert.strictEqual(sb._inseridas.length, 1, 'testemunho de gente continua sendo evidência');
  assert.strictEqual(r.descartadas.autoRelato, 0);
});

// Polaridade: quem falou primeiro não importa — se ALGUMA pessoa disse aquilo, é testemunho.
// Só quando SÓ o TOM disse é que a candidata cai. Falso positivo aqui custaria memória boa.
test('origemDaEvidencia: pessoa ganha do TOM quando os dois disseram parecido', () => {
  const msgs = [
    { role: 'member', kind: 'text', content: 'Chama ele normalmente no Vocativo (com virgula)' },
    { role: 'tom', kind: 'text', content: 'Chama ele normalmente no Vocativo, combinado' },
  ];
  assert.strictEqual(origemDaEvidencia('Chama ele normalmente no Vocativo (com virgula)', msgs), 'humano');
  assert.strictEqual(origemDaEvidencia(FALA_MENTIROSA, [{ role: 'tom', kind: 'text', content: FALA_MENTIROSA }]), 'tom');
  assert.strictEqual(origemDaEvidencia('', msgs), 'desconhecida');
  assert.strictEqual(origemDaEvidencia('jacare pescando manga no telhado da vizinha', msgs), 'desconhecida');
});

// `context` é "situação temporária (SEMPRE defina decay_at)" — mas quem obedece é a LLM. Sem
// backstop, um context sem prazo entra ATIVO e sem validade: vira verdade permanente do grupo.
test('context sem decay_at ganha prazo; com prazo, respeita o que veio', async () => {
  const sb = fakeSupabase({ mensagens: [
    { role: 'member', kind: 'text', content: 'a Duda comeca sabado e o Arthur cuida da matricula', created_at: '2026-09-02T20:00:00Z', sender: { full_name: 'Alf' } },
  ] });
  await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async () => JSON.stringify([
      { memory_type: 'context', content: 'a Duda comeca no sabado 05/09', importance: 'normal', evidence: 'a Duda comeca sabado' },
      { memory_type: 'context', content: 'cinco contratos para assinar entre 08 e 11/09', importance: 'normal', decay_at: '2026-09-12T00:00:00.000Z', evidence: 'a Duda comeca sabado' },
      { memory_type: 'fact', content: 'o Arthur cuida da matricula na Barra', importance: 'normal', evidence: 'o Arthur cuida da matricula' },
    ]),
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  const semPrazo = sb._inseridas.find((r) => /Duda/.test(r.content));
  const comPrazo = sb._inseridas.find((r) => /contratos/.test(r.content));
  const fato = sb._inseridas.find((r) => r.memory_type === 'fact');
  const esperado = new Date(new Date('2026-09-03T06:00:00Z').getTime() + DECAY_PADRAO_CONTEXT_DIAS * 86400000).toISOString();
  assert.strictEqual(semPrazo.decay_at, esperado, 'context sem prazo ganha o prazo padrão');
  assert.strictEqual(comPrazo.decay_at, '2026-09-12T00:00:00.000Z', 'prazo explícito da LLM manda');
  assert.strictEqual(fato.decay_at, null, 'fact não ganha prazo automático');
});

// ══ ESCOPO: A LIÇÃO QUE ATRAVESSA GRUPOS ═══════════════════════════════════════════════════
// MEDIDO em 04/09: a regra "chame a pessoa pelo nome, não com @" existe como `lesson` aprovada
// em ADM CG E, com outra redação, em Administração Recreio — e ia nascer uma TERCEIRA na Barra
// naquela noite. A memória é por grupo (`group_memory.group_id` NOT NULL) e
// `carregarMemoriasDoGrupo` lia só a do grupo corrente, então o dono ensinava a mesma coisa de
// novo em cada grupo. O TOM é uma pessoa só: como ele FALA vale em todo lugar; onde o Arthur
// cuida da matrícula, não.
const {
  ESCOPO_TOM, ehGlobal, colunaScopeAusente, montarBlocoComportamento, pediuPraTodosOsGrupos,
  defaultsPorTipoDoGrupo, listarMemoriasPendentes, TETO_BLOCO_TOM, carregarMemoriasDoGrupo,
} = require('./group-memory');

const G = (o) => ({ content: 'combinado qualquer', importance: 'normal', occurred_on: '2026-09-02', is_active: true, scope: 'group', ...o });
const GLOBAL = (o) => G({ scope: ESCOPO_TOM, ...o });

// ── O reader tem que trazer as globais dos OUTROS grupos ───────────────────────────────────
/** Supabase de mentira que registra o filtro usado e sabe simular a coluna `scope` ausente. */
function sbLeitura({ linhas = [], temScope = true } = {}) {
  const chamadas = [];
  return {
    chamadas,
    from() {
      const st = { or: null, eqs: {}, cols: '' };
      const q = {
        select(cols) { st.cols = cols; return q; },
        or(f) { st.or = f; return q; },
        eq(c, v) { st.eqs[c] = v; return q; },
        is(c, v) { st.eqs[c] = v; return q; },
        order() { return q; },
        limit() { return q.then(); },
        then(ok) {
          chamadas.push(st);
          // A coluna só existe depois da migration. Antes dela o PostgREST devolve 42703 —
          // e é isso que o fallback precisa enxergar.
          const usaScope = !!st.or || String(st.cols || '').includes('scope');
          const r = (!temScope && usaScope)
            ? { data: null, error: { code: '42703', message: 'column group_memory.scope does not exist' } }
            : { data: linhas, error: null };
          return ok ? ok(r) : Promise.resolve(r);
        },
      };
      return q;
    },
  };
}

test('escopo: a regra de comportamento do TOM chega no grupo que nunca a aprendeu', async () => {
  const sb = sbLeitura({ linhas: [G({ content: 'local' }), GLOBAL({ content: 'chame pelo nome' })] });
  const r = await carregarMemoriasDoGrupo(sb, 'g-barra');
  assert.ok(sb.chamadas[0].or, 'a consulta tem que pedir group_id OU scope=tom');
  assert.match(sb.chamadas[0].or, /scope\.eq\.tom/);
  assert.match(String(sb.chamadas[0].cols), /scope/, 'sem trazer a coluna, ninguém sabe o que é global');
  assert.strictEqual(r.length, 2);
});

// Sem isto, o deploy do CÓDIGO antes da migration derrubaria a memória de TODOS os grupos de
// uma vez: a consulta erraria 42703, o reader devolveria null e todo grupo cairia no buffer.
test('escopo: enquanto a coluna não existe, volta ao SELECT antigo em vez de perder a memória', async () => {
  const sb = sbLeitura({ linhas: [G({ content: 'local' })], temScope: false });
  const r = await carregarMemoriasDoGrupo(sb, 'g-barra');
  assert.ok(Array.isArray(r), `devia cair no SELECT antigo, veio ${JSON.stringify(r)}`);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(sb.chamadas.length, 2, 'tentou com scope, caiu pro sem scope');
  assert.strictEqual(sb.chamadas[1].or, null, 'a segunda tentativa é a consulta de antes');
});

test('colunaScopeAusente só reconhece o erro certo — não engole falha de verdade', () => {
  assert.ok(colunaScopeAusente({ code: '42703', message: 'column group_memory.scope does not exist' }));
  assert.ok(!colunaScopeAusente({ code: '08006', message: 'connection failure' }));
  assert.ok(!colunaScopeAusente(null));
});

// ── O piso e o bloco de comportamento ──────────────────────────────────────────────────────
test('escopo: o piso de 3 conta só as memórias DO GRUPO — global não empurra ninguém', () => {
  const r = escolherMemoria({
    memorias: [G({ content: 'uma' }), G({ content: 'duas' }), GLOBAL({ content: 'chame pelo nome' })],
    bufferAntigo: 'resumo antigo', agora: AGORA,
  });
  assert.strictEqual(r.fonte, 'buffer', 'duas locais + uma global ainda não aposenta o buffer');
  assert.strictEqual(r.vivas, 2, 'vivas conta o que é DO GRUPO');
});

// O grupo QUIETO é o que mais precisa da regra — se a global só viesse de carona no bloco
// local, ele seria justamente o único a não recebê-la.
test('escopo: a regra global sai mesmo quando o grupo ainda está no buffer velho', () => {
  const r = escolherMemoria({
    memorias: [G({ content: 'uma' }), GLOBAL({ content: 'chame a pessoa pelo nome, nunca com arroba' })],
    bufferAntigo: 'resumo antigo', agora: AGORA,
  });
  assert.strictEqual(r.texto, 'resumo antigo');
  assert.match(r.comportamento, /chame a pessoa pelo nome/);
});

test('escopo: a regra global também sai quando o bloco novo já venceu o buffer', () => {
  const r = escolherMemoria({
    memorias: [G({ content: 'uma' }), G({ content: 'duas' }), G({ content: 'tres' }), GLOBAL({ content: 'chame pelo nome' })],
    bufferAntigo: 'resumo antigo', agora: AGORA,
  });
  assert.strictEqual(r.fonte, 'group_memory');
  assert.doesNotMatch(r.texto, /chame pelo nome/, 'a global não se mistura com a memória do grupo');
  assert.match(r.comportamento, /chame pelo nome/);
});

// O default da migration é 'group'. No dia em que ela subir, NADA pode mudar de comportamento.
test('escopo: sem nenhuma global, a escolha é idêntica à de antes do escopo existir', () => {
  const memorias = [G({ content: 'um' }), G({ content: 'dois' }), G({ content: 'três' })];
  const r = escolherMemoria({ memorias, bufferAntigo: 'resumo antigo', agora: AGORA });
  const semScope = escolherMemoria({
    memorias: memorias.map(({ scope, ...m }) => m), bufferAntigo: 'resumo antigo', agora: AGORA,
  });
  assert.strictEqual(r.texto, semScope.texto);
  assert.strictEqual(r.fonte, semScope.fonte);
  assert.strictEqual(r.comportamento, null, 'sem global, nenhum bloco novo aparece no prompt');
  assert.strictEqual(semScope.comportamento, null);
});

// "03/09 — chame a pessoa pelo nome" lê como evento daquele dia. Regra de comportamento não
// tem data: ela vale enquanto ninguém desaprovar.
test('escopo: o bloco de comportamento sai SEM data — não é fato datado', () => {
  const b = montarBlocoComportamento([GLOBAL({ content: 'chame pelo nome', occurred_on: '2026-09-02' })]);
  assert.match(b, /chame pelo nome/);
  assert.doesNotMatch(b, /02\/09/);
});

test('escopo: bloco de comportamento respeita teto próprio e ignora memória local', () => {
  assert.strictEqual(montarBlocoComportamento([G({ content: 'local' })]), null, 'local nunca vira regra global');
  assert.strictEqual(montarBlocoComportamento([]), null);
  const b = montarBlocoComportamento([GLOBAL({ content: 'x'.repeat(TETO_BLOCO_TOM + 500) })]);
  assert.strictEqual(b, null, 'linha maior que o teto não entra pela metade');
});

test('escopo: global vencida ou desativada não vira regra eterna', () => {
  assert.strictEqual(montarBlocoComportamento([GLOBAL({ decay_at: '2026-01-01T00:00:00Z' })], { agora: AGORA }), null);
  assert.strictEqual(montarBlocoComportamento([GLOBAL({ is_active: false })], { agora: AGORA }), null);
});

test('ehGlobal: só scope=tom; ausência de scope é memória local (o default da migration)', () => {
  assert.ok(ehGlobal(GLOBAL({})));
  assert.ok(!ehGlobal(G({})));
  assert.ok(!ehGlobal({ content: 'sem coluna scope ainda' }));
});

// ── A PROMOÇÃO É DA PESSOA, NUNCA DA LLM ───────────────────────────────────────────────────
// Se a LLM pudesse decidir que algo vale pra todo lugar, um erro dela contaminaria todos os
// grupos de uma vez. Por isso a frase de quem pediu é conferida em CÓDIGO, não no prompt.
test('promoção exige a frase da pessoa, em português, com todas as letras', () => {
  for (const frase of [
    'aprova a 1 pra todos os grupos', 'aprova a 1 para todos os grupos',
    'aprova a 2 em todos os grupos', 'aprova a 1 pra todo grupo',
    'aprova essa em qualquer grupo', 'aprova a 3 pra valer em todos',
  ]) assert.ok(pediuPraTodosOsGrupos(frase), `devia promover: ${frase}`);
});

test('promoção NÃO nasce de pedido comum — nem com acento, nem com maiúscula', () => {
  for (const frase of [
    'aprova a 1', 'aprova a 1 e a 3', 'descarta a 2', 'pode aprovar todas',
    'aprova a 1 desse grupo', 'aprova tudo aqui', '',
  ]) assert.ok(!pediuPraTodosOsGrupos(frase), `NÃO podia promover: ${frase}`);
});

// ── decidirMemorias: escopo gravado, e a falha nunca vira sucesso silencioso ────────────────
function sbDecide({ escritas, falhaScope = false }) {
  return {
    from() {
      const api = {
        update(patch) { api._patch = patch; return api; },
        eq(col, val) {
          if (col !== 'id') return Promise.resolve({ error: null });
          if (falhaScope && api._patch.scope) {
            return Promise.resolve({ error: { code: '42703', message: 'column group_memory.scope does not exist' } });
          }
          escritas.push({ id: val, ...api._patch });
          return Promise.resolve({ error: null });
        },
      };
      return api;
    },
  };
}

test('aprovar pra todos os grupos grava scope=tom', async () => {
  const escritas = [];
  const r = await decidirMemorias(sbDecide({ escritas }), {
    pendentes: [L('a', 'chame pelo nome')], numeros: [1], acao: 'aprovar', escopo: 'tom',
  });
  assert.strictEqual(escritas[0].scope, 'tom');
  assert.strictEqual(escritas[0].is_active, true);
  assert.strictEqual(r.escopoAplicado, 'tom');
});

// O default não muda o que já existe: aprovação normal não escreve scope nenhum.
test('aprovar do jeito de sempre NÃO toca em scope', async () => {
  const escritas = [];
  const r = await decidirMemorias(sbDecide({ escritas }), {
    pendentes: [L('a', 'um')], numeros: [1], acao: 'aprovar',
  });
  assert.ok(!('scope' in escritas[0]), `não podia mexer em scope: ${JSON.stringify(escritas[0])}`);
  assert.strictEqual(r.escopoAplicado, 'group');
});

// Antes da migration, "pra todos os grupos" não tem como ser honrado. Aprovar só aqui é melhor
// que não aprovar nada — mas quem pediu "pra todos" PRECISA ler que não foi pra todos.
test('promoção sem a coluna no banco: aprova local e DECLARA que não promoveu', async () => {
  const escritas = [];
  const r = await decidirMemorias(sbDecide({ escritas, falhaScope: true }), {
    pendentes: [L('a', 'chame pelo nome')], numeros: [1], acao: 'aprovar', escopo: 'tom',
  });
  assert.strictEqual(r.feitos.length, 1, 'a aprovação local tem que valer');
  assert.strictEqual(escritas[0].is_active, true);
  assert.strictEqual(r.escopoAplicado, 'group', 'não pode dizer que promoveu quando não promoveu');
});

test('o card da decisão diz quando a lição passou a valer em TODOS os grupos', () => {
  const h = renderDecisao({ feitos: [L('a', 'chame pelo nome')], foraDaLista: [], acao: 'aprovar', escopoAplicado: 'tom' });
  assert.match(h, /todos os grupos/i);
});

test('o card explica por que NÃO promoveu, em vez de calar', () => {
  const semFrase = renderDecisao({ feitos: [L('a', 'x')], foraDaLista: [], acao: 'aprovar', escopoAplicado: 'group', motivo: 'sem_frase' });
  assert.match(semFrase, /todos os grupos/i);
  const semColuna = renderDecisao({ feitos: [L('a', 'x')], foraDaLista: [], acao: 'aprovar', escopoAplicado: 'group', motivo: 'sem_coluna' });
  assert.match(semColuna, /todos os grupos/i);
  assert.notStrictEqual(semFrase, semColuna, 'os dois motivos não podem virar a mesma frase');
});

// ══ A FILA DE APROVAÇÃO ENXERGA TODOS OS TIPOS ═════════════════════════════════════════════
// MEDIDO em 04/09: das 35 linhas, 23 estavam ATIVAS sem ninguém ter olhado (14 fact, 4 context,
// 3 preference, 2 decision). `listarLicoesPendentes` filtrava `.eq('memory_type','lesson')` —
// então gatear qualquer outro tipo criava memória que NINGUÉM conseguia aprovar. Fila primeiro.
test('a fila enxerga fact e preference, não só lesson', async () => {
  const st = [];
  const sb = {
    from() {
      const q = {
        select() { return q; },
        eq(c, v) { st.push([c, v]); return q; },
        is() { return q; },
        limit() { return Promise.resolve({ data: [], error: null }); },
      };
      return q;
    },
  };
  await listarMemoriasPendentes(sb, 'g1');
  assert.ok(!st.some(([c]) => c === 'memory_type'), 'filtrar por memory_type volta a criar memória inaprovável');
  assert.ok(st.some(([c, v]) => c === 'is_active' && v === false), 'a fila é o que nasceu inativo');
});

// A pessoa responde por NÚMERO: lesson primeiro porque é o que ela quer ver antes — mas o card
// e o comando usam o MESMO comparador, senão ela aprova outra coisa.
test('a fila põe lição no topo e mantém a ordem determinística', () => {
  const r = ordenarPendentes([
    { id: 'b', memory_type: 'fact', content: 'f', occurred_on: '2026-09-04' },
    { id: 'a', memory_type: 'lesson', content: 'l', occurred_on: '2026-09-01' },
    { id: 'c', memory_type: 'preference', content: 'p', occurred_on: '2026-09-04' },
  ]);
  assert.deepStrictEqual(r.map((x) => x.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(ordenarPendentes([...r].reverse()).map((x) => x.id), ['a', 'b', 'c']);
});

test('o card mostra o TIPO de cada pendência e ensina o verbo de promover', () => {
  const h = renderMemoriasPendentes([
    { id: 'a', memory_type: 'lesson', content: 'chame pelo nome', occurred_on: '2026-09-03' },
    { id: 'b', memory_type: 'fact', content: 'a Duda entra sabado', occurred_on: '2026-09-03' },
  ], { grupoNome: 'Barra' });
  assert.match(h, /Barra/);
  assert.match(h, /<b>1\.<\/b>/);
  assert.match(h, /lição/i);
  assert.match(h, /fato/i);
  assert.match(h, /aprova a 1/);
  assert.match(h, /todos os grupos/i, 'sem o verbo no card, ninguém descobre que dá pra promover');
});

// ── QUEM ENTRA SOZINHO ─────────────────────────────────────────────────────────────────────
// `preference` já tinha contrabandeado uma regra de comportamento pro prompt: a linha "Tom é
// acionado apenas quando chamado pelo nome" (grupo Sucesso do Aluno) é a MESMA regra que existe
// como `lesson` APROVADA em outros dois grupos — só que essa entrou sozinha. O tipo muda; o
// efeito no comportamento do TOM, não.
test('fact e preference passam a esperar aprovação; decision e context seguem entrando', () => {
  assert.strictEqual(defaultsPorTipoDoGrupo('lesson').is_active, false);
  assert.strictEqual(defaultsPorTipoDoGrupo('fact').is_active, false);
  assert.strictEqual(defaultsPorTipoDoGrupo('preference').is_active, false);
  assert.strictEqual(defaultsPorTipoDoGrupo('decision').is_active, true, 'registro datado do que o time combinou');
  assert.strictEqual(defaultsPorTipoDoGrupo('context').is_active, true, 'morre em 30 dias pelo backstop');
});

test('o gate vale no que é GRAVADO, não só na tabela de política', async () => {
  const sb = fakeSupabase({ mensagens: [
    { role: 'member', kind: 'text', content: 'o Arthur cuida da matricula', created_at: '2026-09-02T20:00:00Z', sender: { full_name: 'Alf' } },
  ] });
  await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async () => JSON.stringify([
      { memory_type: 'fact', content: 'o Arthur cuida da matricula na Barra', importance: 'normal', evidence: 'o Arthur cuida da matricula' },
      { memory_type: 'decision', content: 'a matricula passa a ser conferida na sexta', importance: 'normal', evidence: 'o Arthur cuida da matricula' },
    ]),
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  const fato = sb._inseridas.find((r) => r.memory_type === 'fact');
  const decisao = sb._inseridas.find((r) => r.memory_type === 'decision');
  assert.strictEqual(fato.is_active, false, 'fact nasce esperando o ok');
  assert.strictEqual(decisao.is_active, true);
});

// O grupo não pode reaprender toda noite uma regra que já é global — o extrator precisa VER as
// globais na lista do "o que já está guardado".
test('o extrator recebe as memórias globais na lista do que já está guardado', async () => {
  const sb = fakeSupabase({
    mensagens: [{ role: 'member', kind: 'text', content: 'oi', created_at: '2026-09-02T20:00:00Z', sender: { full_name: 'Alf' } }],
    existentes: [GLOBAL({ content: 'chame a pessoa pelo nome, nunca com arroba', memory_type: 'lesson' })],
  });
  let sysVisto = '';
  await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async (sys) => { sysVisto = sys; return '[]'; },
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  assert.match(sysVisto, /chame a pessoa pelo nome/, 'sem isso o grupo reaprende a mesma regra toda noite');
});
