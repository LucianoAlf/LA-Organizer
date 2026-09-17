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

// Filha do painel: sempre carrega `pagador_chave` (o vínculo já resolvido por containersPix) e
// `title` (só cosmético, nunca usado pra casar — é isso que este round de correção prova).
const filha = (id, pagador_chave, title) => ({ id, title, pagador_chave });

const laReportOk = (linhas) => ({ rpc: async () => ({ data: linhas, error: null }) });
const nuncaChama = (nome) => async () => { throw new Error(`${nome} não deveria ser chamado`); };
const semVinculo = async () => true; // deps.vincular que sempre funciona, pra testes que não focam nisso

const base = { supabase: null, unidadeId: 'u1', unidadeNome: 'Barra', groupId: 'g1', criadoPor: 'c1', hoje: '2026-09-16' };

// F1 ────────────────────────────────────────────────────────────────────────────────────────
test('monta o lote do dia: cria pacote com as filhas na ordem (autorização pendente primeiro), grava o vínculo e devolve o texto', async () => {
  const criadas = [];
  const vinculados = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Bia', 'autorizacao_pendente')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [],
      criarPacote: async ({ input }) => {
        criadas.push(...input.subtasks);
        return { groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) };
      },
      vincular: async (vs) => { vinculados.push(...vs); return true; },
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
  assert.deepStrictEqual(vinculados.map((v) => v.pagador_chave), ['k-Bia', 'k-Ana']);
  assert.ok(vinculados.every((v) => v.unidade_id === 'u1' && v.task_id));
  // fix round 1 (Critical): sucesso com texto não é nem fonte falhou nem sem cliente.
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
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
      vincular: nuncaChama('vincular'),
    },
  });
  assert.strictEqual(out.criou, false);
  assert.strictEqual(out.total, 0);
  assert.match(out.motivo, /LA Report/);
  // fix round 1 (Critical): ÚNICO caminho que marca fonteFalhou — é o que decisaoDaPublicacaoPix
  // usa pra saber que É a fonte que caiu, não o painel.
  assert.strictEqual(out.fonteFalhou, true);
  assert.strictEqual(out.semCliente, false);
  assert.strictEqual(out.texto, null);
});

// F3 ────────────────────────────────────────────────────────────────────────────────────────
test('fonte velha (mais de 48h): não mexe no painel, avisa e não cria pacote', async () => {
  const velha = linha('Ana', 'pix_avulso', { dado_atualizado_em: new Date(AGORA - 72 * 3600e3).toISOString() });
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([velha]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: nuncaChama('containersPix'),
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: nuncaChama('fecharFilha'),
      fecharContainer: nuncaChama('fecharContainer'),
      vincular: nuncaChama('vincular'),
    },
  });
  assert.strictEqual(out.fonteVelha, true);
  assert.strictEqual(out.criou, false);
  assert.match(out.texto, /não atualizou/i);
  // fix round 1 (Critical): fonte velha é dado requentado, NÃO é fonte falhou.
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
});

test('sem nenhum dado_atualizado_em recente entre as linhas: conta como fonte velha (inclusive nulo)', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso', { dado_atualizado_em: null })]),
    deps: { agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], containersPix: nuncaChama('containersPix') },
  });
  assert.strictEqual(out.fonteVelha, true);
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
});

// F4 ────────────────────────────────────────────────────────────────────────────────────────
test('pacote de ontem: quem continua na fonte (por pagador_chave) é carregado (cancelled) pro topo do lote de hoje; quem saiu fecha (done); pacote antigo fecha', async () => {
  const fechos = [];
  const containersFechados = [];
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Carlos', 'boleto')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: [
          filha('f-ana', 'k-Ana', 'PIX automático — Ana (Ana filho)'),
          filha('f-zeca', 'k-Zeca', 'PIX automático — Zeca (Zeca filho)'),
        ],
      }],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm2', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: async (id) => { containersFechados.push(id); return true; },
      vincular: semVinculo,
    },
  });
  assert.deepStrictEqual(fechos, [['f-ana', 'cancelled'], ['f-zeca', 'done']]);
  assert.deepStrictEqual(containersFechados, ['cont-ontem']);
  assert.strictEqual(out.carregadas, 1);
  assert.strictEqual(out.fechadas, 1);
  assert.strictEqual(out.criou, true);
  assert.match(criadas[0].title, /^PIX automático — Ana/, 'carregada de ontem entra primeiro no lote de hoje');
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
});

// F5 ────────────────────────────────────────────────────────────────────────────────────────
test('pacote de hoje já existe: não cria; fecha (done) só quem saiu da fonte (por pagador_chave); jaExistia true', async () => {
  const fechos = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-hoje',
        title: r.PREFIXO_CONTAINER + '16/09',
        due_date: '2026-09-16',
        filhas: [
          filha('t1', 'k-Ana', 'PIX automático — Ana (Ana filho)'),
          filha('t2', 'k-Zeca', 'PIX automático — Zeca (Zeca filho)'),
        ],
      }],
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: nuncaChama('fecharContainer'),
      vincular: nuncaChama('vincular'),
    },
  });
  assert.deepStrictEqual(fechos, [['t2', 'done']]);
  assert.strictEqual(out.jaExistia, true);
  assert.strictEqual(out.criou, false);
  assert.strictEqual(out.fechadas, 1);
  assert.strictEqual(out.lote.length, 1);
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
});

// F6 ────────────────────────────────────────────────────────────────────────────────────────
// I1 (revisão final): o lote NÃO cresce com o carry-over. Carregados entram primeiro e o lote do
// dia só completa até LOTE_DIARIO — 8 carregados + 20 na fonte = 10 filhas, nunca 15.
test('I1: 8 carregados + 20 na fonte cria exatamente LOTE_DIARIO (10) filhas — carregados primeiro, o resto só completa', async () => {
  const muitos = [...Array(20)].map((_, i) => linha('N' + String(i).padStart(2, '0'), 'pix_avulso'));
  // Carregados = os 8 ÚLTIMOS por nome (N12..N19), pra provar que entram antes mesmo tendo
  // prioridade alfabética pior que os novos.
  const carregadosNomes = muitos.slice(12).map((l) => l.pagador_nome);
  let criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk(muitos),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: carregadosNomes.map((nome, i) => filha(`f${i}`, `k-${nome}`, `PIX automático — ${nome}`)),
      }],
      criarPacote: async ({ input }) => { criadas = input.subtasks; return { groupId: 'm3', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      fecharFilha: async () => true,
      fecharContainer: async () => true,
      vincular: semVinculo,
    },
  });
  assert.strictEqual(criadas.length, pura.LOTE_DIARIO, 'o lote com carry-over continua com 10 filhas, não 15');
  assert.strictEqual(out.lote.length, 10);
  assert.strictEqual(out.carregadas, 8);
  assert.deepStrictEqual(out.lote.slice(0, 8).map((l) => l.pagador_nome), carregadosNomes, 'os 8 carregados vêm primeiro');
  assert.deepStrictEqual(out.lote.slice(8).map((l) => l.pagador_nome), ['N00', 'N01'], 'o resto só completa até 10');
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
});

test('I1: TETO_FILHAS é trava dura — lote acima do teto NÃO cria pacote e devolve o motivo', async () => {
  const muitos = [...Array(20)].map((_, i) => linha('N' + String(i).padStart(2, '0'), 'pix_avulso'));
  const carregadosNomes = muitos.slice(0, 16).map((l) => l.pagador_nome); // 16 > TETO_FILHAS (15)
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk(muitos),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: carregadosNomes.map((nome, i) => filha(`f${i}`, `k-${nome}`, `PIX automático — ${nome}`)),
      }],
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: async () => true,
      fecharContainer: async () => true,
      vincular: nuncaChama('vincular'),
    },
  });
  assert.strictEqual(out.criou, false);
  assert.strictEqual(out.texto, null, 'sem pacote não há texto — decisaoDaPublicacaoPix vira fallback');
  assert.match(out.motivo, /teto/);
  assert.match(out.motivo, /16/);
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
});

// F7 ────────────────────────────────────────────────────────────────────────────────────────
test('ninguém a migrar: não cria pacote', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso', { categoria: 'ja_migrou' })]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [],
      criarPacote: nuncaChama('criarPacote'),
    },
  });
  assert.strictEqual(out.criou, false);
  assert.strictEqual(out.total, 0);
  assert.strictEqual(out.motivo, 'sem cliente a migrar');
  // fix round 1 (Critical): ÚNICO caminho que marca semCliente — sucesso, fila vazia, não é
  // "fonte fora do ar".
  assert.strictEqual(out.semCliente, true);
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.texto, null);
});

// Achado 2 (fix round 1) — avisos de escrita nunca somem do motivo ────────────────────────────
test('ninguém a migrar, mas uma filha velha não fechou: o aviso aparece no motivo junto de "sem cliente a migrar"', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso', { categoria: 'ja_migrou' })]), // ninguém em migrar/autorizacao_pendente
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: [filha('f-x', 'k-Zeca', 'PIX automático — Zeca')], // não está na fonte -> tenta fechar 'done'
      }],
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: async () => false, // falha de escrita
      fecharContainer: async () => true,
    },
  });
  assert.strictEqual(out.criou, false);
  assert.strictEqual(out.motivo, 'sem cliente a migrar; não consegui fechar a filha "PIX automático — Zeca"');
  assert.strictEqual(out.semCliente, true, 'sem cliente a migrar continua semCliente mesmo com aviso de escrita junto');
  assert.strictEqual(out.fonteFalhou, false);
});

test('criarPacote lança: o(s) aviso(s) de fechamento acumulados até ali aparecem no motivo junto do erro', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: [filha('f-zeca', 'k-Zeca', 'PIX automático — Zeca')], // saiu da fonte -> tenta fechar 'done'
      }],
      criarPacote: async () => { throw new Error('falhou de propósito'); },
      fecharFilha: async () => false, // falha de escrita ao fechar quem saiu
      fecharContainer: async () => true,
    },
  });
  assert.strictEqual(out.criou, false);
  assert.match(out.motivo, /^não consegui criar o pacote: falhou de propósito; não consegui fechar a filha "PIX automático — Zeca"$/);
  // fix round 1 (Critical): criarPacote lançou é falha de ESCRITA do painel — a fonte respondeu
  // bem (havia cliente pra migrar). Nem fonteFalhou nem semCliente.
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
  assert.strictEqual(out.texto, null);
});

// Achado 3 (fix round 1, Critical) — falha de LEITURA do painel também não é fonte falhou ──────
test('containersPix lança (falha de leitura do painel): não é fonte falhou nem sem cliente — texto nulo, os dois flags false', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => { throw new Error('conexão recusada'); },
    },
  });
  assert.strictEqual(out.criou, false);
  assert.strictEqual(out.texto, null);
  assert.match(out.motivo, /falha ao processar o painel do PIX: conexão recusada/);
  assert.strictEqual(out.fonteFalhou, false, 'a fonte respondeu bem — quem falhou foi a leitura do painel');
  assert.strictEqual(out.semCliente, false);
});

// Achado 1 (fix round 1) — casar por pagador_chave, nunca por título ──────────────────────────
test('reproduz (a): alunos mudaram (título mudou), mas a chave continua igual — filha de ontem é cancelada e o cliente é carregado, não fica done por engano', async () => {
  const fechos = [];
  // Ontem o título gerado era "... (Rafa)"; hoje a fonte devolve Ana com outro aluno, o título
  // mudaria pra "... (Rafa, Duda)" — mas a chave (pagador_chave) é a mesma.
  const anaHoje = linha('Ana', 'pix_avulso', { alunos: ['Rafa', 'Duda'] });
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([anaHoje]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: [filha('f-ana', 'k-Ana', 'PIX automático — Ana (Rafa)')], // título de ONTEM, diferente do de hoje
      }],
      criarPacote: async ({ input }) => ({ groupId: 'm4', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: async () => true,
      vincular: semVinculo,
    },
  });
  assert.deepStrictEqual(fechos, [['f-ana', 'cancelled']], 'casou pela chave, não pelo título — nunca virou done');
  assert.strictEqual(out.carregadas, 1);
  assert.strictEqual(out.lote[0].pagador_chave, 'k-Ana');
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
});

test('reproduz (b): dois clientes com título idêntico no pacote de ontem — quem saiu fecha done, quem ficou é cancelado e carregado, sem inversão nem duplicação', async () => {
  const fechos = [];
  // Duas Anas com o MESMO texto gerado (mesmo nome, mesmos alunos), chaves diferentes. Só
  // k-Ana-ficou continua na fonte.
  const anaQueFicou = linha('Ana', 'pix_avulso', { pagador_chave: 'k-Ana-ficou', alunos: ['Rafa'] });
  const tituloComum = pura.tituloDaFilha(anaQueFicou); // "PIX automático — Ana (Rafa)"
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([anaQueFicou]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: [
          filha('f-saiu', 'k-Ana-saiu', tituloComum),   // título idêntico, chave de quem SAIU
          filha('f-ficou', 'k-Ana-ficou', tituloComum), // título idêntico, chave de quem FICOU
        ],
      }],
      criarPacote: async ({ input }) => ({ groupId: 'm5', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: async () => true,
      vincular: semVinculo,
    },
  });
  assert.deepStrictEqual(fechos, [['f-saiu', 'done'], ['f-ficou', 'cancelled']]);
  assert.strictEqual(out.carregadas, 1, 'só um cliente foi carregado, não dois');
  assert.strictEqual(out.lote.length, 1);
  assert.strictEqual(out.lote[0].pagador_chave, 'k-Ana-ficou');
});

test('reproduz (c): pacote de hoje com dois títulos idênticos — quem saiu é fechado, quem ficou aparece uma única vez no lote e no texto', async () => {
  const fechos = [];
  const anaQueFicou = linha('Ana', 'pix_avulso', { pagador_chave: 'k-Ana-ficou', alunos: ['Rafa'] });
  const tituloComum = pura.tituloDaFilha(anaQueFicou);
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([anaQueFicou]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-hoje',
        title: r.PREFIXO_CONTAINER + '16/09',
        due_date: '2026-09-16',
        filhas: [
          filha('t-saiu', 'k-Ana-saiu', tituloComum),
          filha('t-ficou', 'k-Ana-ficou', tituloComum),
        ],
      }],
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: nuncaChama('fecharContainer'),
      vincular: nuncaChama('vincular'),
    },
  });
  assert.deepStrictEqual(fechos, [['t-saiu', 'done']], 'quem saiu foi fechado — antes ficava aberto pra sempre');
  assert.strictEqual(out.jaExistia, true);
  assert.strictEqual(out.lote.length, 1, 'quem ficou aparece uma única vez, não duas');
  assert.strictEqual(out.lote[0].pagador_chave, 'k-Ana-ficou');
  const ocorrencias = (out.texto.match(/Ana/g) || []).length;
  assert.strictEqual(ocorrencias, 1, 'o texto cita a cliente uma única vez');
});

// Vínculo ──────────────────────────────────────────────────────────────────────────────────────
test('vincular falhou: o pacote foi criado mesmo assim, mas o aviso aparece no motivo', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [],
      criarPacote: async ({ input }) => ({ groupId: 'm6', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      vincular: async () => false,
    },
  });
  assert.strictEqual(out.criou, true, 'falha de vínculo não derruba o pacote já criado');
  assert.match(out.motivo, /vínculo/);
});

// Dedup ────────────────────────────────────────────────────────────────────────────────────────
test('dedup: dois vínculos apontando pro mesmo pagador_chave no pacote de ontem não duplicam carregadas nem o lote de hoje', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: [
          filha('f1', 'k-Ana', 'PIX automático — Ana'),
          filha('f2', 'k-Ana', 'PIX automático — Ana'), // mesmo pagador_chave, "acidente" de dois vínculos
        ],
      }],
      criarPacote: async ({ input }) => ({ groupId: 'm7', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      fecharFilha: async () => true,
      fecharContainer: async () => true,
      vincular: semVinculo,
    },
  });
  assert.strictEqual(out.carregadas, 1, 'o mesmo cliente carregado duas vezes conta uma única vez');
  assert.strictEqual(out.lote.length, 1);
});

test('dedup: dois vínculos apontando pro mesmo pagador_chave no pacote de hoje não duplicam o lote', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-hoje',
        title: r.PREFIXO_CONTAINER + '16/09',
        due_date: '2026-09-16',
        filhas: [
          filha('t1', 'k-Ana', 'PIX automático — Ana'),
          filha('t2', 'k-Ana', 'PIX automático — Ana'),
        ],
      }],
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: nuncaChama('fecharFilha'), // as duas casam com a fonte -> nenhuma deveria fechar
      fecharContainer: nuncaChama('fecharContainer'),
      vincular: nuncaChama('vincular'),
    },
  });
  assert.strictEqual(out.lote.length, 1, 'a mesma chave duas vezes no painel não duplica o lote de hoje');
});

// ── Tarefa 7 — reconferência de 7 dias (deps.informados + voltaram + informadosRecentes) ───────
test('Tarefa 7: informado há 3 dias NÃO entra no lote nem é carregado, mas segue contado no total', async () => {
  const criadas = [];
  const informadoEm = new Date(AGORA - 3 * 86400000).toISOString();
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Bia', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, transicoesRecentes: async () => [],
      informados: async ({ unidadeId }) => {
        assert.strictEqual(unidadeId, 'u1');
        return [{ pagador_chave: 'k-Ana', created_at: informadoEm }];
      },
      containersPix: async () => [],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      vincular: semVinculo,
      fecharFilha: nuncaChama('fecharFilha'),
      fecharContainer: nuncaChama('fecharContainer'),
    },
  });
  assert.strictEqual(out.total, 2, 'total continua contando os dois clientes');
  assert.strictEqual(criadas.length, 1, 'só a Bia entra no pacote — a Ana está em carência');
  assert.match(criadas[0].title, /^PIX automático — Bia/);
  assert.strictEqual(out.informadosRecentes, 1);
  assert.deepStrictEqual(out.voltaram, []);
});

test('Tarefa 7: informado há 7 dias e AINDA em migrar na fonte volta ao lote e ganha a seção ↩️ Voltaram pra lista', async () => {
  const criadas = [];
  const informadoEm = new Date(AGORA - 7 * 86400000).toISOString();
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, transicoesRecentes: async () => [],
      informados: async () => [{ pagador_chave: 'k-Ana', created_at: informadoEm }],
      containersPix: async () => [],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm2', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      vincular: semVinculo,
      fecharFilha: nuncaChama('fecharFilha'),
      fecharContainer: nuncaChama('fecharContainer'),
    },
  });
  assert.strictEqual(criadas.length, 1, 'a Ana volta pro pacote normalmente, 7 dias depois');
  assert.strictEqual(out.informadosRecentes, 0);
  assert.strictEqual(out.voltaram.length, 1);
  assert.strictEqual(out.voltaram[0].pagador_chave, 'k-Ana');
  assert.match(out.texto, /↩️ \*Voltaram pra lista\* \(1\)/);
});

test('Tarefa 7: informado há 8 dias (borda de cima da janela) ainda volta — não fica excluído por engano', async () => {
  const criadas = [];
  const informadoEm = new Date(AGORA - 8 * 86400000).toISOString();
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, transicoesRecentes: async () => [],
      informados: async () => [{ pagador_chave: 'k-Ana', created_at: informadoEm }],
      containersPix: async () => [],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm3', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      vincular: semVinculo,
    },
  });
  assert.strictEqual(criadas.length, 1, 'informado há 8 dias não pode ser excluído do lote');
  assert.strictEqual(out.voltaram.length, 1);
});

test('Tarefa 7: cliente informado que a fonte já confirma como migrado NÃO aparece em voltaram', async () => {
  const informadoEm = new Date(AGORA - 7 * 86400000).toISOString();
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso', { categoria: 'ja_migrou' })]), // já não está mais em migrar/autorizacao_pendente
    deps: {
      agora: agoraFixo, transicoesRecentes: async () => [],
      informados: async () => [{ pagador_chave: 'k-Ana', created_at: informadoEm }],
      containersPix: async () => [],
      criarPacote: nuncaChama('criarPacote'),
    },
  });
  assert.deepStrictEqual(out.voltaram, []);
  assert.strictEqual(out.semCliente, true);
});

test('Tarefa 7: erro ao reconferir quem foi informado segue SEM excluir ninguém, com aviso no motivo (falha-aberta)', async () => {
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, transicoesRecentes: async () => [],
      informados: async () => { throw new Error('marker_logs indisponível'); },
      containersPix: async () => [],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm4', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      vincular: semVinculo,
    },
  });
  assert.strictEqual(criadas.length, 1, 'falha-aberta: ninguém é excluído quando a reconferência falha');
  assert.match(out.motivo, /não consegui reconferir/);
  assert.strictEqual(out.voltaram.length, 0);
});

// ── C1 (revisão final) — "Voltaram pra lista" só pra quem a fonte AINDA mostra em `migrar` ─────
test('C1: informado há 7 dias que a fonte já mostra em autorizacao_pendente (cadastrou!) NÃO entra em voltaram — afirmação falsa', async () => {
  const informadoEm = new Date(AGORA - 7 * 86400000).toISOString();
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'autorizacao_pendente'), linha('Bia', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, transicoesRecentes: async () => [],
      informados: async () => [{ pagador_chave: 'k-Ana', created_at: informadoEm }],
      containersPix: async () => [],
      criarPacote: async ({ input }) => ({ groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      vincular: semVinculo,
    },
  });
  assert.deepStrictEqual(out.voltaram, [], 'autorização pendente não é "o Emusys ainda não mostra"');
  assert.ok(!out.texto.includes('Voltaram pra lista'));
});

test('C1: quem voltou pra lista é citado UMA vez só no texto (não repete na seção da fatia)', async () => {
  const informadoEm = new Date(AGORA - 7 * 86400000).toISOString();
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Bia', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, transicoesRecentes: async () => [],
      informados: async () => [{ pagador_chave: 'k-Ana', created_at: informadoEm }],
      containersPix: async () => [],
      criarPacote: async ({ input }) => ({ groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      vincular: semVinculo,
    },
  });
  assert.strictEqual(out.voltaram.length, 1);
  assert.strictEqual((out.texto.match(/Ana \(/g) || []).length, 1, 'Ana aparece só na seção ↩️');
  assert.match(out.texto, /• Bia \(Bia filho\)/, 'quem não voltou segue listado na fatia normalmente');
});

// ── I2 (revisão final) — carência da 1ª cobrança: migrar -> autorizacao_pendente é PROGRESSO ────
const filhaOrig = (id, pagador_chave, title, categoria_origem) => ({ id, title, pagador_chave, categoria_origem });

test('I2: o vínculo grava categoria_origem = categoria do cliente na fonte no momento da criação', async () => {
  const vinculados = [];
  await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Bia', 'autorizacao_pendente')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [],
      criarPacote: async ({ input }) => ({ groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      vincular: async (vs) => { vinculados.push(...vs); return true; },
    },
  });
  assert.deepStrictEqual(
    vinculados.map((v) => [v.pagador_chave, v.categoria_origem]),
    [['k-Bia', 'autorizacao_pendente'], ['k-Ana', 'migrar']],
  );
});

test('I2: filha pendente de ontem cujo cliente era migrar e AGORA está em autorizacao_pendente — grava transicao_em=hoje, fecha done, não carrega, fica fora do lote e do 🔵, conta em ⏳', async () => {
  const fechos = [];
  const transicoes = [];
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'autorizacao_pendente'), linha('Bia', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15',
        filhas: [filhaOrig('f-ana', 'k-Ana', 'PIX automático — Ana (Ana filho)', 'migrar')],
      }],
      marcarTransicao: async (arg) => { transicoes.push(arg); return true; },
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: async () => true,
      vincular: semVinculo,
    },
  });
  assert.deepStrictEqual(transicoes, [{ taskId: 'f-ana', hoje: '2026-09-16' }]);
  assert.deepStrictEqual(fechos, [['f-ana', 'done']], 'progresso: foi cadastrado — done, não cancelled nem carregado');
  assert.strictEqual(out.carregadas, 0);
  assert.deepStrictEqual(out.lote.map((l) => l.pagador_chave), ['k-Bia']);
  assert.deepStrictEqual(criadas.map((s) => s.title), ['PIX automático — Bia (Bia filho)']);
  assert.ok(!out.texto.includes('🔵'), 'quem está na carência sai da seção 🔵');
  assert.ok(!out.texto.includes('Ana'), 'e não é citado por nome');
  assert.match(out.texto, /⏳ Aguardando 1ª cobrança \(1\)/);
  assert.match(out.texto, /· faltam 2 ·/, 'continua contado no faltam (ainda não migrou de fato)');
});

test('I2: a mesma transição dentro do pacote de HOJE (já existe) também grava a transição e fecha done', async () => {
  const fechos = [];
  const transicoes = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'autorizacao_pendente'), linha('Bia', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-hoje', title: r.PREFIXO_CONTAINER + '16/09', due_date: '2026-09-16',
        filhas: [
          filhaOrig('t-ana', 'k-Ana', 'PIX automático — Ana (Ana filho)', 'migrar'),
          filhaOrig('t-bia', 'k-Bia', 'PIX automático — Bia (Bia filho)', 'migrar'),
        ],
      }],
      marcarTransicao: async (arg) => { transicoes.push(arg); return true; },
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: nuncaChama('fecharContainer'),
      vincular: nuncaChama('vincular'),
    },
  });
  assert.strictEqual(out.jaExistia, true);
  assert.deepStrictEqual(transicoes, [{ taskId: 't-ana', hoje: '2026-09-16' }]);
  assert.deepStrictEqual(fechos, [['t-ana', 'done']]);
  assert.deepStrictEqual(out.lote.map((l) => l.pagador_chave), ['k-Bia']);
  assert.match(out.texto, /⏳ Aguardando 1ª cobrança \(1\)/);
});

test('I2: quem JÁ estava em autorizacao_pendente quando a filha foi criada e continua assim NÃO é transição — é pendência real, carregada normalmente', async () => {
  const fechos = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'autorizacao_pendente')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15',
        filhas: [filhaOrig('f-ana', 'k-Ana', 'PIX automático — Ana (Ana filho)', 'autorizacao_pendente')],
      }],
      marcarTransicao: nuncaChama('marcarTransicao'),
      criarPacote: async ({ input }) => ({ groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: async () => true,
      vincular: semVinculo,
    },
  });
  assert.deepStrictEqual(fechos, [['f-ana', 'cancelled']]);
  assert.strictEqual(out.carregadas, 1);
  assert.match(out.texto, /🔵 \*Cadastrados sem cobrança\* \(1\)/);
  assert.ok(!out.texto.includes('⏳'));
});

// transicoesRecentes falso que se comporta como o banco: devolve só transicao_em >= desdeYmd.
const transicoesDoBanco = (linhas) => async ({ unidadeId, desdeYmd }) => {
  assert.strictEqual(unidadeId, 'u1');
  return linhas.filter((l) => l.transicao_em >= desdeYmd);
};

test('I2: carência de 35 dias — transição há 34 dias fica FORA do lote e do 🔵 e conta em ⏳; há 35 dias volta a ser 🔵 normal', async () => {
  const rodar = async (transicaoEm) => {
    const criadas = [];
    const out = await r.pautaPixDaUnidade({
      ...base,
      laReport: laReportOk([linha('Ana', 'autorizacao_pendente'), linha('Bia', 'pix_avulso')]),
      deps: {
        agora: agoraFixo, informados: async () => [],
        transicoesRecentes: transicoesDoBanco([{ pagador_chave: 'k-Ana', transicao_em: transicaoEm }]),
        containersPix: async () => [],
        criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
        vincular: semVinculo,
      },
    });
    return { out, criadas };
  };
  const dentro = await rodar('2026-08-13'); // hoje (16/09) - 34 dias
  assert.deepStrictEqual(dentro.criadas.map((s) => s.title), ['PIX automático — Bia (Bia filho)'], 'na carência: fora do lote');
  assert.ok(!dentro.out.texto.includes('🔵'));
  assert.match(dentro.out.texto, /⏳ Aguardando 1ª cobrança \(1\)/);
  assert.strictEqual(dentro.out.total, 2);

  const fora = await rodar('2026-08-12'); // hoje - 35 dias: acabou a carência
  assert.deepStrictEqual(fora.criadas.map((s) => s.title), ['PIX automático — Ana (Ana filho)', 'PIX automático — Bia (Bia filho)']);
  assert.match(fora.out.texto, /🔵 \*Cadastrados sem cobrança\* \(1\)/);
  assert.ok(!fora.out.texto.includes('⏳'));
});

test('I2: transição recente só vale pra quem ESTÁ em autorizacao_pendente — se voltou pra migrar, entra no lote normalmente', async () => {
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [],
      transicoesRecentes: transicoesDoBanco([{ pagador_chave: 'k-Ana', transicao_em: '2026-09-10' }]),
      containersPix: async () => [],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      vincular: semVinculo,
    },
  });
  assert.strictEqual(criadas.length, 1);
  assert.ok(!out.texto.includes('⏳'));
});

test('I2: erro ao ler as transições recentes — aviso no motivo e segue SEM excluir ninguém', async () => {
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'autorizacao_pendente')]),
    deps: {
      agora: agoraFixo, informados: async () => [],
      transicoesRecentes: async () => { throw new Error('vínculo indisponível'); },
      containersPix: async () => [],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      vincular: semVinculo,
    },
  });
  assert.strictEqual(criadas.length, 1, 'falha-aberta: ninguém sai do lote');
  assert.match(out.motivo, /transições/);
  assert.ok(!out.texto.includes('⏳'));
});

test('I2: falha ao gravar a transição vira aviso no motivo (a filha ainda fecha done e o cliente fica fora do lote de hoje)', async () => {
  const fechos = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'autorizacao_pendente'), linha('Bia', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15',
        filhas: [filhaOrig('f-ana', 'k-Ana', 'PIX automático — Ana (Ana filho)', 'migrar')],
      }],
      marcarTransicao: async () => false,
      criarPacote: async ({ input }) => ({ groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: async () => true,
      vincular: semVinculo,
    },
  });
  assert.deepStrictEqual(fechos, [['f-ana', 'done']]);
  assert.match(out.motivo, /transição/);
  assert.deepStrictEqual(out.lote.map((l) => l.pagador_chave), ['k-Bia']);
});
