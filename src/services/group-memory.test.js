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
