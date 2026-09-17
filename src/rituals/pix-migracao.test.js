'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const r = require('./pix-migracao');
const pura = require('../services/pix-migracao');

const AGORA = new Date('2026-09-16T12:00:00-03:00').getTime();
const agoraFixo = () => AGORA;

const linha = (nome, fatia, extra = {}) => ({
  pagador_chave: `k-${nome}`,
  pagador_nome: nome,
  alunos: [nome + ' filho'],
  categoria: fatia === 'autorizacao_pendente' ? 'autorizacao_pendente' : 'migrar',
  fatia: fatia === 'autorizacao_pendente' ? null : fatia,
  dado_atualizado_em: new Date(AGORA - 3600e3).toISOString(),
  ...extra,
});

const laReportOk = (linhas) => ({ rpc: async () => ({ data: linhas, error: null }) });
const nuncaChama = (nome) => async () => { throw new Error(`${nome} não deveria ser chamado`); };

const base = { supabase: null, unidadeId: 'u1', unidadeNome: 'Barra', groupId: 'g1', criadoPor: 'c1', hoje: '2026-09-16' };

// F1 ────────────────────────────────────────────────────────────────────────────────────────
test('monta o lote do dia: cria pacote com as filhas na ordem (autorização pendente primeiro) e devolve o texto', async () => {
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Bia', 'autorizacao_pendente')]),
    deps: {
      agora: agoraFixo,
      containersPix: async () => [],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm1', childIds: [] }; },
      fecharFilha: nuncaChama('fecharFilha'),
      fecharContainer: nuncaChama('fecharContainer'),
    },
  });
  assert.strictEqual(out.criou, true);
  assert.strictEqual(out.jaExistia, false);
  assert.strictEqual(out.total, 2);
  assert.strictEqual(out.lote.length, 2);
  assert.strictEqual(out.carregadas, 0);
  assert.strictEqual(criadas.length, 2);
  assert.match(criadas[0].title, /^PIX automático — Bia/, 'autorização pendente entra primeiro');
  assert.match(out.texto, /💠 \*PIX automático — Barra\*/);
});

// F2 ────────────────────────────────────────────────────────────────────────────────────────
test('fonte falhou: não mexe no painel e devolve o motivo', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: { rpc: async () => ({ data: null, error: { message: 'timeout' } }) },
    deps: {
      containersPix: nuncaChama('containersPix'),
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: nuncaChama('fecharFilha'),
      fecharContainer: nuncaChama('fecharContainer'),
    },
  });
  assert.strictEqual(out.criou, false);
  assert.strictEqual(out.total, 0);
  assert.match(out.motivo, /LA Report/);
});

// F3 ────────────────────────────────────────────────────────────────────────────────────────
test('fonte velha (mais de 48h): não mexe no painel, avisa e não cria pacote', async () => {
  const velha = linha('Ana', 'pix_avulso', { dado_atualizado_em: new Date(AGORA - 72 * 3600e3).toISOString() });
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([velha]),
    deps: {
      agora: agoraFixo,
      containersPix: nuncaChama('containersPix'),
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: nuncaChama('fecharFilha'),
      fecharContainer: nuncaChama('fecharContainer'),
    },
  });
  assert.strictEqual(out.fonteVelha, true);
  assert.strictEqual(out.criou, false);
  assert.match(out.texto, /não atualizou/i);
});

test('sem nenhum dado_atualizado_em recente entre as linhas: conta como fonte velha (inclusive nulo)', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso', { dado_atualizado_em: null })]),
    deps: { agora: agoraFixo, containersPix: nuncaChama('containersPix') },
  });
  assert.strictEqual(out.fonteVelha, true);
});

// F4 ────────────────────────────────────────────────────────────────────────────────────────
test('pacote de ontem: quem continua na fonte é carregado (cancelled) pro topo do lote de hoje; quem saiu fecha (done); pacote antigo fecha', async () => {
  const fechos = [];
  const containersFechados = [];
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Carlos', 'boleto')]),
    deps: {
      agora: agoraFixo,
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: [
          { id: 'f-ana', title: pura.tituloDaFilha(linha('Ana', 'pix_avulso')) },
          { id: 'f-zeca', title: pura.tituloDaFilha(linha('Zeca', 'pix_avulso')) },
        ],
      }],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm2', childIds: [] }; },
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: async (id) => { containersFechados.push(id); return true; },
    },
  });
  assert.deepStrictEqual(fechos, [['f-ana', 'cancelled'], ['f-zeca', 'done']]);
  assert.deepStrictEqual(containersFechados, ['cont-ontem']);
  assert.strictEqual(out.carregadas, 1);
  assert.strictEqual(out.fechadas, 1);
  assert.strictEqual(out.criou, true);
  assert.match(criadas[0].title, /^PIX automático — Ana/, 'carregada de ontem entra primeiro no lote de hoje');
});

// F5 ────────────────────────────────────────────────────────────────────────────────────────
test('pacote de hoje já existe: não cria; fecha (done) só quem saiu da fonte; jaExistia true', async () => {
  const fechos = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo,
      containersPix: async () => [{
        id: 'cont-hoje',
        title: r.PREFIXO_CONTAINER + '16/09',
        due_date: '2026-09-16',
        filhas: [
          { id: 't1', title: pura.tituloDaFilha(linha('Ana', 'pix_avulso')) },
          { id: 't2', title: pura.tituloDaFilha(linha('Zeca', 'pix_avulso')) },
        ],
      }],
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: nuncaChama('fecharContainer'),
    },
  });
  assert.deepStrictEqual(fechos, [['t2', 'done']]);
  assert.strictEqual(out.jaExistia, true);
  assert.strictEqual(out.criou, false);
  assert.strictEqual(out.fechadas, 1);
  assert.strictEqual(out.lote.length, 1);
});

// F6 ────────────────────────────────────────────────────────────────────────────────────────
test('teto de sanidade: 12 carregados + 40 na fonte nunca cria mais que TETO_FILHAS filhas', async () => {
  const muitos = [...Array(40)].map((_, i) => linha('N' + String(i).padStart(2, '0'), 'pix_avulso'));
  const carregadosNomes = muitos.slice(0, 12).map((l) => l.pagador_nome);
  let n = 0;
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk(muitos),
    deps: {
      agora: agoraFixo,
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: carregadosNomes.map((nome, i) => ({ id: `f${i}`, title: pura.tituloDaFilha(linha(nome, 'pix_avulso')) })),
      }],
      criarPacote: async ({ input }) => { n = input.subtasks.length; return { groupId: 'm3', childIds: [] }; },
      fecharFilha: async () => true,
      fecharContainer: async () => true,
    },
  });
  assert.strictEqual(n, pura.TETO_FILHAS);
  assert.strictEqual(out.carregadas, 12);
});

// F7 ────────────────────────────────────────────────────────────────────────────────────────
test('ninguém a migrar: não cria pacote', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso', { categoria: 'ja_migrado' })]),
    deps: {
      agora: agoraFixo,
      containersPix: async () => [],
      criarPacote: nuncaChama('criarPacote'),
    },
  });
  assert.strictEqual(out.criou, false);
  assert.strictEqual(out.total, 0);
  assert.strictEqual(out.motivo, 'sem cliente a migrar');
});
