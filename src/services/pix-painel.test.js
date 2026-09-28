'use strict';
// pix-painel.test.js — o painel "PIX automático" na área do grupo (Alf, 28/09).
// Mesmas regras da mensagem do grupo (pix-consulta-fontes._lerPix) e do relatório de segunda:
// o painel NUNCA pode mostrar 43 onde a mensagem diz 41.
const { test } = require('node:test');
const assert = require('node:assert');
const p = require('./pix-painel');
const f = require('./pix-consulta-fontes');
const { resolverUnidade } = require('./situacao-aluno');

const L = (o) => ({ pagador_chave: `k-${o.pagador_nome}`, alunos: [], matriculas: [1], categoria: 'migrar', fatia: 'pix_avulso', dado_atualizado_em: '2026-09-28T09:00:00Z', ...o });
const FONTE = [
  L({ pagador_nome: 'Presa', fatia: 'pix_avulso', matriculas: [1, 2], alunos: ['P1', 'P2'] }),
  L({ pagador_nome: 'Zé Avulso', fatia: 'pix_avulso', alunos: ['Z1'], telefone: '21999999999', valor: 300 }),
  L({ pagador_nome: 'Cartão', fatia: 'cartao_com_falha' }),
  L({ pagador_nome: 'Cadastrada', categoria: 'autorizacao_pendente', fatia: null }),
  L({ pagador_nome: 'Já Foi', categoria: 'ja_migrou', fatia: null, migrou_em: '2026-09-20', alunos: ['J1'], dado_atualizado_em: '2026-09-28T10:00:00Z' }),
  L({ pagador_nome: 'Fora', categoria: 'nao_mexe', fatia: null }),
];
const semInterruptor = async (fn) => {
  const antes = process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  delete process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  try { return await fn(); } finally { if (antes !== undefined) process.env.TOM_PIX_BLOQUEIO_EMUSYS = antes; }
};

test('números do topo: total, migrados, faltam, 🔒 e cadastrados sem cobrança — a conta do relatório', () => semInterruptor(() => {
  const r = p.montarPainel(FONTE, { unidadeNome: 'Barra' });
  assert.strictEqual(r.unidade, 'Barra');
  assert.strictEqual(r.metaYmd, '2026-10-31');
  assert.deepStrictEqual([r.total, r.migrados, r.faltam, r.aguardandoEmusys, r.cadastradosSemCobranca], [5, 1, 4, 1, 1]);
  assert.strictEqual(r.dadoEm, '2026-09-28T10:00:00Z');
}));

test('seções de quem falta: ordem da pauta (🔵 primeiro, 🔒 por último), com contagem e nomes', () => semInterruptor(() => {
  const r = p.montarPainel(FONTE, { unidadeNome: 'Barra' });
  assert.deepStrictEqual(r.faltamSecoes.map((s) => [s.chave, s.emoji, s.nome, s.n]), [
    ['autorizacao_pendente', '🔵', 'Cadastrados sem cobrança', 1],
    ['pix_avulso', '🔴', 'Pix avulso', 1],
    ['cartao_com_falha', '🟣', 'Cartão falhando', 1],
    ['bloqueio_emusys', '🔒', 'Aguardando o Emusys', 1],
  ]);
  assert.match(r.faltamSecoes[0].nota, /resolver primeiro/);
  assert.match(r.faltamSecoes[3].nota, /2\+ cursos ou família/);
  assert.deepStrictEqual(r.faltamSecoes[3].clientes, [{ nome: 'Presa', alunos: ['P1', 'P2'] }]);
}));

test('já migraram: nome, alunos e quando migrou', () => semInterruptor(() => {
  const r = p.montarPainel(FONTE, { unidadeNome: 'Barra' });
  assert.deepStrictEqual(r.jaMigraram, [{ nome: 'Já Foi', alunos: ['J1'], migrouEm: '2026-09-20' }]);
}));

test('privacidade: só nome e alunos saem da fonte — nada de telefone, valor, chave', () => semInterruptor(() => {
  const txt = JSON.stringify(p.montarPainel(FONTE, { unidadeNome: 'Barra' }));
  assert.ok(!/21999999999|300|k-Zé|pagador_chave|telefone|valor/.test(txt), txt);
}));

test('paridade com a mensagem do grupo: mesmo "faltam" e mesmos nomes na mesma ordem', () => semInterruptor(async () => {
  const deps = { rpcPix: async () => ({ data: FONTE, error: null }), rpcSituacao: async () => ({ data: [], error: null }), retry: (fn) => fn(), hoje: '2026-09-28' };
  const lista = await f.itensDaLista({ unidadeId: resolverUnidade('barra'), alvo: 'pix', deps });
  const painel = p.montarPainel(FONTE, { unidadeNome: 'Barra' });
  assert.strictEqual(painel.faltam, lista.length);
  assert.deepStrictEqual(painel.faltamSecoes.flatMap((s) => s.clientes.map((c) => c.nome)), lista.map((x) => x.pagador.replace(/ 🔒$/, '')));
}));

test('fonte vazia/torta: zeros honestos, nunca exceção', () => {
  const r = p.montarPainel(null, { unidadeNome: 'Recreio' });
  assert.deepStrictEqual([r.total, r.migrados, r.faltam, r.faltamSecoes.length, r.jaMigraram.length, r.dadoEm], [0, 0, 0, 0, 0, null]);
});

// ── quem pode ver (mesma regra de web/src/lib/workGroupAccess.ts) ─────────────────────────────
const G = { id: 'g1', leader_id: 'lider', created_by: 'criador' };
test('podeVerGrupo: diretor vê todos; outros só se forem membro, líder ou criador', () => {
  assert.strictEqual(p.podeVerGrupo({ collab: { id: 'x', role: 'director' }, group: G, souMembro: false }), true);
  assert.strictEqual(p.podeVerGrupo({ collab: { id: 'x', role: 'manager' }, group: G, souMembro: false }), false);
  assert.strictEqual(p.podeVerGrupo({ collab: { id: 'x', role: 'coordinator' }, group: G, souMembro: true }), true);
  assert.strictEqual(p.podeVerGrupo({ collab: { id: 'lider', role: 'manager' }, group: G, souMembro: false }), true);
  assert.strictEqual(p.podeVerGrupo({ collab: { id: 'criador', role: 'staff' }, group: G, souMembro: false }), true);
  assert.strictEqual(p.podeVerGrupo({ collab: null, group: G, souMembro: true }), false);
});

// ── a rota (orquestração com dependências injetadas; sem rede) ────────────────────────────────
const depsRota = (o = {}) => ({
  usuarioDoToken: async (t) => (t === 'ok' ? { email: 'a@la' } : null),
  colaboradorPorEmail: async () => ({ id: 'c1', role: 'coordinator' }),
  grupo: async () => ({ id: 'g1', leader_id: null, created_by: null, la_report_unidade_id: resolverUnidade('barra') }),
  souMembro: async () => true,
  lerFonte: async () => FONTE,
  ...o,
});
test('rota: sem token → 401; token inválido → 401', async () => {
  assert.strictEqual((await p.atenderPainel({ token: null, groupId: 'g1', deps: depsRota() })).status, 401);
  assert.strictEqual((await p.atenderPainel({ token: 'ruim', groupId: 'g1', deps: depsRota() })).status, 401);
});
test('rota: quem não vê o grupo → 403 e a fonte NÃO é lida', async () => {
  let leu = false;
  const r = await p.atenderPainel({ token: 'ok', groupId: 'g1', deps: depsRota({ souMembro: async () => false, lerFonte: async () => { leu = true; return []; } }) });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(leu, false);
});
test('rota: grupo sem unidade → 404 grupo_sem_unidade (o painel some da tela)', async () => {
  const r = await p.atenderPainel({ token: 'ok', groupId: 'g1', deps: depsRota({ grupo: async () => ({ id: 'g1', la_report_unidade_id: null }) }) });
  assert.deepStrictEqual([r.status, r.body.error], [404, 'grupo_sem_unidade']);
});
test('rota: fonte fora → 502 honesto, nunca painel zerado', async () => {
  const r = await p.atenderPainel({ token: 'ok', groupId: 'g1', deps: depsRota({ lerFonte: async () => { throw new Error('caiu'); } }) });
  assert.deepStrictEqual([r.status, r.body.error], [502, 'fonte_fora']);
});
test('rota: feliz → 200 com o painel da unidade do grupo', () => semInterruptor(async () => {
  const r = await p.atenderPainel({ token: 'ok', groupId: 'g1', deps: depsRota() });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.data.unidade, 'Barra');
  assert.strictEqual(r.body.data.faltam, 4);
}));
