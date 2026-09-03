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
        select: () => q, eq: () => q, gte: () => q, order: () => q, is: () => q,
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
