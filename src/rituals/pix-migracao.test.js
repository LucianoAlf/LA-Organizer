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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
    deps: { agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [], containersPix: nuncaChama('containersPix') },
  });
  assert.strictEqual(out.fonteVelha, true);
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
});

// F4 ────────────────────────────────────────────────────────────────────────────────────────
test('pacote de ontem: quem continua na fonte (por pagador_chave) é carregado (cancelled) pro topo do lote de hoje; quem sumiu da fonte é cancelado (I4); pacote antigo fecha', async () => {
  const fechos = [];
  const containersFechados = [];
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Carlos', 'boleto')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
  assert.deepStrictEqual(fechos, [['f-ana', 'cancelled'], ['f-zeca', 'cancelled']]);
  assert.deepStrictEqual(containersFechados, ['cont-ontem']);
  assert.strictEqual(out.carregadas, 1);
  assert.strictEqual(out.fechadas, 1);
  assert.strictEqual(out.criou, true);
  assert.match(criadas[0].title, /^PIX automático — Ana/, 'carregada de ontem entra primeiro no lote de hoje');
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
});

// F5 ────────────────────────────────────────────────────────────────────────────────────────
test('pacote de hoje já existe: não cria; fecha só quem saiu da fonte (por pagador_chave — sumiu da RPC = cancelled, I4); jaExistia true', async () => {
  const fechos = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
  assert.deepStrictEqual(fechos, [['t2', 'cancelled']]);
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: carregadosNomes.map((nome, i) => filha(`f${i}`, `k-${nome}`, `PIX automático — ${nome}`)),
      }],
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: nuncaChama('fecharFilha'), // I3: sem pacote novo, o anterior fica intacto
      fecharContainer: nuncaChama('fecharContainer'),
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: [filha('f0a1b2c3-0000-4000-8000-000000000001', 'k-Zeca', 'PIX automático — Zeca')], // sumiu da fonte -> tenta cancelar (I4)
      }],
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: async () => false, // falha de escrita
      fecharContainer: async () => true,
    },
  });
  assert.strictEqual(out.criou, false);
  // M8: o aviso cita os 8 primeiros caracteres do id da tarefa, nunca o título (nome do cliente).
  assert.strictEqual(out.motivo, 'sem cliente a migrar; não consegui cancelar a filha f0a1b2c3');
  assert.strictEqual(out.semCliente, true, 'sem cliente a migrar continua semCliente mesmo com aviso de escrita junto');
  assert.strictEqual(out.fonteFalhou, false);
});

test('criarPacote lança (I3): o pacote ANTERIOR fica intacto (nenhuma filha nem o pacote tocados), os avisos já acumulados aparecem no motivo junto do erro', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      informados: async () => { throw new Error('marker_logs fora'); }, // aviso acumulado antes da criação
      containersPix: async () => [{
        id: 'cont-ontem',
        title: r.PREFIXO_CONTAINER + '15/09',
        due_date: '2026-09-15',
        filhas: [
          filha('f-ana', 'k-Ana', 'PIX automático — Ana'), // continua na fonte -> seria carregada
          filha('f-zeca', 'k-Zeca', 'PIX automático — Zeca'), // sumiu da fonte -> seria cancelada
        ],
      }],
      criarPacote: async () => { throw new Error('falhou de propósito'); },
      fecharFilha: nuncaChama('fecharFilha'),
      fecharContainer: nuncaChama('fecharContainer'),
      vincular: nuncaChama('vincular'),
    },
  });
  assert.strictEqual(out.criou, false);
  assert.match(out.motivo, /^não consegui criar o pacote: falhou de propósito; não consegui reconferir quem foi informado nos últimos dias: marker_logs fora$/);
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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

test('reproduz (b): dois clientes com título idêntico no pacote de ontem — quem sumiu da fonte é cancelado, quem ficou é cancelado e carregado, sem inversão nem duplicação', async () => {
  const fechos = [];
  // Duas Anas com o MESMO texto gerado (mesmo nome, mesmos alunos), chaves diferentes. Só
  // k-Ana-ficou continua na fonte.
  const anaQueFicou = linha('Ana', 'pix_avulso', { pagador_chave: 'k-Ana-ficou', alunos: ['Rafa'] });
  const tituloComum = pura.tituloDaFilha(anaQueFicou); // "PIX automático — Ana (Rafa)"
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([anaQueFicou]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
  assert.deepStrictEqual(fechos, [['f-saiu', 'cancelled'], ['f-ficou', 'cancelled']]);
  assert.strictEqual(out.fechadas, 1, 'só quem sumiu conta como fechada; quem ficou é carregada');
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
  assert.deepStrictEqual(fechos, [['t-saiu', 'cancelled']], 'quem saiu foi fechado — antes ficava aberto pra sempre');
  assert.strictEqual(out.jaExistia, true);
  assert.strictEqual(out.lote.length, 1, 'quem ficou aparece uma única vez, não duas');
  assert.strictEqual(out.lote[0].pagador_chave, 'k-Ana-ficou');
  const ocorrencias = (out.texto.match(/Ana/g) || []).length;
  assert.strictEqual(ocorrencias, 1, 'o texto cita a cliente uma única vez');
});

// Vínculo ──────────────────────────────────────────────────────────────────────────────────────
test('vincular falhou (I3): é falha de painel — texto nulo, motivo com o vínculo, e o pacote ANTERIOR fica intacto', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15',
        filhas: [filha('f-ana', 'k-Ana', 'PIX automático — Ana')],
      }],
      criarPacote: async ({ input }) => ({ groupId: 'm6', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      vincular: async () => false,
      fecharFilha: nuncaChama('fecharFilha'),
      fecharContainer: nuncaChama('fecharContainer'),
    },
  });
  assert.strictEqual(out.texto, null, 'sem vínculo a filha nova não tem chave — nada a publicar como sucesso');
  assert.strictEqual(out.criou, false);
  assert.match(out.motivo, /vínculo/);
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
});

test('I3: criarPacote devolveu MENOS filhas que o lote — mesma falha do vínculo: texto nulo, anterior intacto', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Bia', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15',
        filhas: [filha('f-ana', 'k-Ana', 'PIX automático — Ana')],
      }],
      criarPacote: async () => ({ groupId: 'm6', childIds: ['t0'] }), // 2 no lote, 1 filha
      vincular: nuncaChama('vincular'),
      fecharFilha: nuncaChama('fecharFilha'),
      fecharContainer: nuncaChama('fecharContainer'),
    },
  });
  assert.strictEqual(out.texto, null);
  assert.match(out.motivo, /vínculo/);
});

// Dedup ────────────────────────────────────────────────────────────────────────────────────────
test('dedup: dois vínculos apontando pro mesmo pagador_chave no pacote de ontem não duplicam carregadas nem o lote de hoje', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
  assert.deepStrictEqual(transicoes, [{ taskIds: ['f-ana'], hoje: '2026-09-16' }]);
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
  assert.deepStrictEqual(transicoes, [{ taskIds: ['t-ana'], hoje: '2026-09-16' }]);
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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
        transicoesRecentes: transicoesDoBanco([{ pagador_chave: 'k-Ana', transicao_em: transicaoEm }]), vinculosSemTransicao: async () => [],
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
      transicoesRecentes: transicoesDoBanco([{ pagador_chave: 'k-Ana', transicao_em: '2026-09-10' }]), vinculosSemTransicao: async () => [],
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
      transicoesRecentes: async () => { throw new Error('vínculo indisponível'); }, vinculosSemTransicao: async () => [],
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
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
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

// ── I3 (revisão final) — falha parcial nunca vira "done" falso nem lista vazia publicada ─────────
const quarenta = () => [...Array(40)].map((_, i) => linha('P' + String(i).padStart(2, '0'), 'pix_avulso'));

test('I3: filha SEM vínculo num pacote velho nunca vira done — vira cancelled', async () => {
  const fechos = [];
  await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15',
        filhas: [filha('f-sem', null, 'PIX automático — Alguém')],
      }],
      criarPacote: async ({ input }) => ({ groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: async () => true,
      vincular: semVinculo,
    },
  });
  assert.deepStrictEqual(fechos, [['f-sem', 'cancelled']]);
});

test('I3 (repro C): pacote de HOJE com filhas sem vínculo (criação interrompida) — cancela as filhas e o pacote e RECONSTRÓI na mesma execução, nenhuma filha done', async () => {
  const fechos = [];
  const containers = [];
  const vinculados = [];
  let criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk(quarenta()),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [{
        id: 'c-hoje', title: r.PREFIXO_CONTAINER + '16/09', due_date: '2026-09-16',
        filhas: [0, 1, 2, 3].map((i) => filha(`p${i}`, null, 'x')),
      }],
      criarPacote: async ({ input }) => { criadas = input.subtasks; return { groupId: 'c-novo', childIds: input.subtasks.map((_, i) => `n${i}`) }; },
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: async (id, status) => { containers.push([id, status]); return true; },
      vincular: async (vs) => { vinculados.push(...vs); return true; },
    },
  });
  assert.deepStrictEqual(fechos, [['p0', 'cancelled'], ['p1', 'cancelled'], ['p2', 'cancelled'], ['p3', 'cancelled']]);
  assert.deepStrictEqual(containers, [['c-hoje', 'cancelled']]);
  assert.strictEqual(criadas.length, 10, 'reconstruiu o pacote na mesma execução');
  assert.strictEqual(vinculados.length, 10);
  assert.strictEqual(out.criou, true);
  assert.strictEqual(out.lote.length, 10);
  assert.ok(out.texto && out.texto.includes('• P00'), 'publica o lote reconstruído, não uma lista vazia');
});

test('I3: se não consegui desmontar o pacote de hoje incompleto, NÃO reconstrói (evita pacote duplicado) — texto nulo e motivo', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk(quarenta()),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [{
        id: 'c-hoje', title: r.PREFIXO_CONTAINER + '16/09', due_date: '2026-09-16',
        filhas: [filha('p0', null, 'x')],
      }],
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: async () => false,
      fecharContainer: nuncaChama('fecharContainer'),
      vincular: nuncaChama('vincular'),
    },
  });
  assert.strictEqual(out.texto, null);
  assert.strictEqual(out.criou, false);
  assert.match(out.motivo, /incompleto/);
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
});

// Painel falso COM ESTADO — pra provar o que sobra no banco entre duas execuções.
function painelFalso() {
  const tasks = new Map();
  const vinculos = new Map();
  let seq = 0;
  let falharCriacaoDepoisDe = null;
  const addTask = (t) => { tasks.set(t.id, { status: 'pending', ...t }); return t.id; };
  return {
    tasks,
    vinculos,
    addTask,
    vincularDireto: (v) => vinculos.set(v.task_id, v),
    falharProximaCriacaoDepoisDe: (n) => { falharCriacaoDepoisDe = n; },
    deps: {
      containersPix: async () => [...tasks.values()]
        .filter((t) => t.isGroup && t.status === 'pending')
        .map((c) => ({
          id: c.id, title: c.title, due_date: c.due_date,
          totalFilhas: [...tasks.values()].filter((f) => f.parent === c.id).length,
          filhas: [...tasks.values()].filter((f) => f.parent === c.id && f.status === 'pending').map((f) => {
            const v = vinculos.get(f.id);
            return { id: f.id, title: f.title, pagador_chave: v ? v.pagador_chave : null, categoria_origem: v ? v.categoria_origem : null };
          }),
        })),
      criarPacote: async ({ input }) => {
        seq += 1;
        const mae = addTask({ id: `mae${seq}`, isGroup: true, title: input.title, due_date: input.groupDueDate });
        const childIds = [];
        for (const [i, s] of input.subtasks.entries()) {
          if (falharCriacaoDepoisDe !== null && i === falharCriacaoDepoisDe) {
            falharCriacaoDepoisDe = null;
            throw new Error('insert task: timeout');
          }
          childIds.push(addTask({ id: `${mae}-f${i}`, parent: mae, title: s.title, due_date: s.dueDate }));
        }
        return { groupId: mae, childIds };
      },
      fecharFilha: async (id, status) => {
        const t = tasks.get(id);
        if (!t || t.status !== 'pending') return false;
        t.status = status;
        return true;
      },
      fecharContainer: async (id, status = 'done') => { tasks.get(id).status = status; return true; },
      vincular: async (vs) => { vs.forEach((v) => vinculos.set(v.task_id, v)); return true; },
      marcarTransicao: async () => true,
    },
  };
}

test('I3 (repro C, duas execuções): criação lança no meio (mãe + 4 filhas sem vínculo) — anterior intacto; na execução seguinte o pacote é reconstruído, o anterior só fecha depois, nenhuma filha done', async () => {
  const fonte = quarenta();
  const painel = painelFalso();
  painel.addTask({ id: 'c-ontem', isGroup: true, title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15' });
  fonte.slice(0, 10).forEach((l, i) => {
    painel.addTask({ id: `o${i}`, parent: 'c-ontem', title: pura.tituloDaFilha(l), due_date: '2026-09-15' });
    painel.vincularDireto({ task_id: `o${i}`, pagador_chave: l.pagador_chave, unidade_id: 'u1', categoria_origem: 'migrar' });
  });
  const deps = { agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [], ...painel.deps };

  painel.falharProximaCriacaoDepoisDe(4);
  const r1 = await r.pautaPixDaUnidade({ ...base, laReport: laReportOk(fonte), deps });
  assert.strictEqual(r1.texto, null, '1ª execução: falha de painel, nada publicado');
  assert.match(r1.motivo, /não consegui criar o pacote/);
  assert.strictEqual(painel.tasks.get('c-ontem').status, 'pending', 'anterior intacto');
  for (let i = 0; i < 10; i += 1) assert.strictEqual(painel.tasks.get(`o${i}`).status, 'pending', `filha o${i} do anterior intacta`);
  assert.strictEqual([...painel.tasks.values()].filter((t) => t.parent === 'mae1').length, 4, 'sobrou o pacote parcial (4 filhas sem vínculo)');

  const r2 = await r.pautaPixDaUnidade({ ...base, laReport: laReportOk(fonte), deps });
  assert.strictEqual(r2.criou, true, '2ª execução: reconstruiu');
  assert.strictEqual(r2.lote.length, 10);
  assert.deepStrictEqual(r2.lote.map((l) => l.pagador_nome), fonte.slice(0, 10).map((l) => l.pagador_nome), 'os carregados do anterior continuam primeiro');
  assert.ok(r2.texto && r2.texto.includes('• P00'));
  assert.strictEqual(painel.tasks.get('mae1').status, 'cancelled', 'o pacote parcial foi cancelado');
  assert.ok([...painel.tasks.values()].filter((t) => t.parent === 'mae1').every((t) => t.status === 'cancelled'));
  assert.strictEqual(painel.tasks.get('c-ontem').status, 'done', 'o anterior fecha só depois do pacote novo');
  for (let i = 0; i < 10; i += 1) assert.strictEqual(painel.tasks.get(`o${i}`).status, 'cancelled');
  const novas = [...painel.tasks.values()].filter((t) => t.parent === 'mae2');
  assert.strictEqual(novas.length, 10);
  assert.ok(novas.every((t) => t.status === 'pending' && painel.vinculos.has(t.id)), 'pacote novo inteiro vinculado');
  const filhasDone = [...painel.tasks.values()].filter((t) => !t.isGroup && t.status === 'done');
  assert.deepStrictEqual(filhasDone, [], 'nenhuma filha virou done — ninguém saiu da fonte');

  const r3 = await r.pautaPixDaUnidade({ ...base, laReport: laReportOk(fonte), deps });
  assert.strictEqual(r3.jaExistia, true, '3ª execução no mesmo dia: não cria de novo');
  assert.strictEqual(r3.lote.length, 10);
});

// ── R2 (re-revisão) — pacote de hoje SEM filha nenhuma também é incompleto ──────────────────────
test('R2: pacote de HOJE com ZERO filhas (criação caiu na 1ª filha / resposta perdida) — cancela o pacote vazio, reconstrói, e só DEPOIS mexe nas carregadas e no anterior', async () => {
  const eventos = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Bia', 'pix_avulso'), linha('Caio', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [
        { id: 'c-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15', totalFilhas: 2,
          filhas: [filha('f-ana', 'k-Ana', 'a'), filha('f-bia', 'k-Bia', 'b')] },
        { id: 'c-hoje', title: r.PREFIXO_CONTAINER + '16/09', due_date: '2026-09-16', totalFilhas: 0, filhas: [] },
      ],
      criarPacote: async ({ input }) => { eventos.push(`criar:${input.subtasks.length}`); return { groupId: 'c-novo', childIds: input.subtasks.map((_, i) => `n${i}`) }; },
      vincular: async (vs) => { eventos.push(`vincular:${vs.length}`); return true; },
      fecharFilha: async (id, status) => { eventos.push(`filha:${id}:${status}`); return true; },
      fecharContainer: async (id, status) => { eventos.push(`pacote:${id}:${status}`); return true; },
    },
  });
  assert.deepStrictEqual(eventos, [
    'pacote:c-hoje:cancelled', 'criar:3', 'vincular:3',
    'filha:f-ana:cancelled', 'filha:f-bia:cancelled', 'pacote:c-ontem:done',
  ]);
  assert.strictEqual(out.criou, true);
  assert.strictEqual(out.jaExistia, false);
  assert.deepStrictEqual(out.lote.map((l) => l.pagador_chave), ['k-Ana', 'k-Bia', 'k-Caio']);
  assert.strictEqual(out.carregadas, 2);
  assert.ok(out.texto.includes('• Ana'), 'publica o lote reconstruído, não uma lista vazia');
  assert.strictEqual(pura.decisaoDaPublicacaoPix(out, { unidadeNome: 'Barra' }).result, 'executed');
});

test('R2: pacote de hoje com ZERO filhas e a reconstrução falha — falha de painel (texto nulo, fallback), anterior e carregadas intactos', async () => {
  const eventos = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [
        { id: 'c-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15', totalFilhas: 1, filhas: [filha('f-ana', 'k-Ana', 'a')] },
        { id: 'c-hoje', title: r.PREFIXO_CONTAINER + '16/09', due_date: '2026-09-16', totalFilhas: 0, filhas: [] },
      ],
      criarPacote: async () => { throw new Error('insert task: timeout'); },
      vincular: nuncaChama('vincular'),
      fecharFilha: nuncaChama('fecharFilha'),
      fecharContainer: async (id, status) => { eventos.push(`pacote:${id}:${status}`); return true; },
    },
  });
  assert.deepStrictEqual(eventos, ['pacote:c-hoje:cancelled'], 'só o pacote vazio foi cancelado');
  assert.strictEqual(out.texto, null);
  assert.deepStrictEqual(out.lote, []);
  assert.strictEqual(pura.decisaoDaPublicacaoPix(out, { unidadeNome: 'Barra' }).result, 'fallback');
});

test('R2: pacote de hoje cujas filhas foram TODAS fechadas hoje (atalho) NÃO é incompleto — não cancela nem reconstrói', async () => {
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Bia', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      informados: async () => [
        { pagador_chave: 'k-Ana', created_at: new Date(AGORA - 3600e3).toISOString() },
        { pagador_chave: 'k-Bia', created_at: new Date(AGORA - 3600e3).toISOString() },
      ],
      containersPix: async () => [
        { id: 'c-hoje', title: r.PREFIXO_CONTAINER + '16/09', due_date: '2026-09-16', totalFilhas: 2, filhas: [] },
      ],
      criarPacote: nuncaChama('criarPacote'),
      vincular: nuncaChama('vincular'),
      fecharFilha: nuncaChama('fecharFilha'),
      fecharContainer: nuncaChama('fecharContainer'),
    },
  });
  assert.strictEqual(out.jaExistia, true);
  assert.strictEqual(out.criou, false);
  assert.deepStrictEqual(out.lote, []);
  assert.match(out.texto, /· faltam 2 ·/, 'publica as contagens reais do dia');
});

test('R2 (duas execuções, painel com estado): a criação cai na 1ª filha e deixa a mãe SEM filha — a execução seguinte cancela a mãe vazia e reconstrói; anterior só fecha depois', async () => {
  const fonte = quarenta();
  const painel = painelFalso();
  painel.addTask({ id: 'c-ontem', isGroup: true, title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15' });
  fonte.slice(0, 3).forEach((l, i) => {
    painel.addTask({ id: `o${i}`, parent: 'c-ontem', title: pura.tituloDaFilha(l), due_date: '2026-09-15' });
    painel.vincularDireto({ task_id: `o${i}`, pagador_chave: l.pagador_chave, unidade_id: 'u1', categoria_origem: 'migrar' });
  });
  const deps = { agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [], ...painel.deps };

  painel.falharProximaCriacaoDepoisDe(0);
  const r1 = await r.pautaPixDaUnidade({ ...base, laReport: laReportOk(fonte), deps });
  assert.strictEqual(r1.texto, null);
  assert.strictEqual(painel.tasks.get('mae1').status, 'pending', 'sobrou a mãe sem filha nenhuma');
  assert.strictEqual([...painel.tasks.values()].filter((t) => t.parent === 'mae1').length, 0);
  assert.strictEqual(painel.tasks.get('c-ontem').status, 'pending');

  const r2 = await r.pautaPixDaUnidade({ ...base, laReport: laReportOk(fonte), deps });
  assert.strictEqual(r2.jaExistia, false, 'a mãe vazia não pode passar por "pacote de hoje já existe"');
  assert.strictEqual(r2.criou, true);
  assert.strictEqual(r2.lote.length, 10);
  assert.strictEqual(r2.carregadas, 3);
  assert.ok(r2.texto.includes('• P00'));
  assert.strictEqual(painel.tasks.get('mae1').status, 'cancelled');
  assert.strictEqual(painel.tasks.get('c-ontem').status, 'done');
  assert.ok(['o0', 'o1', 'o2'].every((id) => painel.tasks.get(id).status === 'cancelled'));
  assert.deepStrictEqual([...painel.tasks.values()].filter((t) => !t.isGroup && t.status === 'done'), []);
});

test('I3: lote vazio legítimo — todos informados há menos de 7 dias: não cria, mas PUBLICA o texto com as contagens (informação real)', async () => {
  const informadoEm = new Date(AGORA - 2 * 86400000).toISOString();
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Bia', 'cheque')]),
    deps: {
      agora: agoraFixo, transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      informados: async () => [{ pagador_chave: 'k-Ana', created_at: informadoEm }, { pagador_chave: 'k-Bia', created_at: informadoEm }],
      containersPix: async () => [],
      criarPacote: nuncaChama('criarPacote'),
      vincular: nuncaChama('vincular'),
    },
  });
  assert.strictEqual(out.criou, false);
  assert.strictEqual(out.semCliente, false);
  assert.deepStrictEqual(out.lote, []);
  assert.match(out.texto, /· faltam 2 ·/);
  assert.match(out.texto, /🔴 Pix avulso \(1\) · 🟠 Cheque \(1\)/);
  assert.strictEqual(pura.decisaoDaPublicacaoPix(out, { unidadeNome: 'Barra' }).result, 'executed');
});

test('I3: lote vazio legítimo — todos na carência da 1ª cobrança: publica o texto com ⏳ (fecha o pacote velho antes)', async () => {
  const fechos = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'autorizacao_pendente')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [{
        id: 'cont-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15',
        filhas: [filhaOrig('f-ana', 'k-Ana', 'PIX automático — Ana', 'migrar')],
      }],
      marcarTransicao: async () => true,
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: async () => true,
    },
  });
  assert.deepStrictEqual(fechos, [['f-ana', 'done']]);
  assert.strictEqual(out.criou, false);
  assert.strictEqual(out.semCliente, false);
  assert.match(out.texto, /⏳ Aguardando 1ª cobrança \(1\)/);
});

test('I3: NENHUM caminho de falha devolve texto não nulo com lote vazio', async () => {
  const fonte = quarenta();
  const ontem = () => [{
    id: 'c-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15',
    filhas: fonte.slice(0, 16).map((l, i) => filha(`o${i}`, l.pagador_chave, 'x')),
  }];
  const casos = {
    criacao_lanca: { criarPacote: async () => { throw new Error('boom'); } },
    vinculo_falha: { vincular: async () => false },
    painel_nao_le: { containersPix: async () => { throw new Error('leitura'); } },
    teto: { containersPix: async () => ontem() },
    desmontar_falha: {
      containersPix: async () => [{ id: 'c-hoje', title: 'x', due_date: '2026-09-16', filhas: [filha('p0', null, 'x')] }],
      fecharFilha: async () => false,
    },
  };
  for (const [nome, extra] of Object.entries(casos)) {
    const out = await r.pautaPixDaUnidade({
      ...base,
      laReport: laReportOk(fonte),
      deps: {
        agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
        containersPix: async () => [],
        criarPacote: async ({ input }) => ({ groupId: 'm', childIds: input.subtasks.map((_, i) => `t${i}`) }),
        fecharFilha: async () => true, fecharContainer: async () => true, vincular: semVinculo,
        ...extra,
      },
    });
    assert.strictEqual(out.texto, null, `${nome}: falha não pode publicar lista`);
    assert.deepStrictEqual(out.lote, [], `${nome}: lote vazio`);
    assert.ok(out.motivo, `${nome}: motivo explicando`);
    assert.strictEqual(pura.decisaoDaPublicacaoPix(out, { unidadeNome: 'Barra' }).result, 'fallback', `${nome}: tenta de novo`);
  }
});

// ── I4 (revisão final) — quem sai do lote: done SÓ se ja_migrou (ou transição); resto cancelled ──
for (const [destino, linhaDaFonte, esperado] of [
  ['ja_migrou', (nome) => linha(nome, 'pix_avulso', { categoria: 'ja_migrou' }), 'done'],
  ['inadimplente', (nome) => linha(nome, 'pix_avulso', { categoria: 'inadimplente' }), 'cancelled'],
  ['nao_pagante', (nome) => linha(nome, 'pix_avulso', { categoria: 'nao_pagante' }), 'cancelled'],
  ['excecao', (nome) => linha(nome, 'pix_avulso', { categoria: 'excecao' }), 'cancelled'],
  ['nao_mexe', (nome) => linha(nome, 'pix_avulso', { categoria: 'nao_mexe' }), 'cancelled'],
  ['sumiu da RPC', () => null, 'cancelled'],
]) {
  test(`I4: cliente do pacote de ontem que foi pra "${destino}" fecha como ${esperado}`, async () => {
    const fechos = [];
    const fonte = [linha('Bia', 'pix_avulso'), linhaDaFonte('Zeca')].filter(Boolean);
    await r.pautaPixDaUnidade({
      ...base,
      laReport: laReportOk(fonte),
      deps: {
        agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
        containersPix: async () => [{
          id: 'cont-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15',
          filhas: [filha('f-zeca', 'k-Zeca', 'PIX automático — Zeca')],
        }],
        criarPacote: async ({ input }) => ({ groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }),
        fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
        fecharContainer: async () => true,
        vincular: semVinculo,
      },
    });
    assert.deepStrictEqual(fechos, [['f-zeca', esperado]]);
  });
}

test('I4: no pacote de HOJE vale a mesma regra — ja_migrou fecha done, inadimplente fecha cancelled', async () => {
  const fechos = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([
      linha('Ana', 'pix_avulso'),
      linha('Bia', 'pix_avulso', { categoria: 'ja_migrou' }),
      linha('Caio', 'pix_avulso', { categoria: 'inadimplente' }),
    ]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [{
        id: 'cont-hoje', title: r.PREFIXO_CONTAINER + '16/09', due_date: '2026-09-16',
        filhas: [filha('t-ana', 'k-Ana', 'a'), filha('t-bia', 'k-Bia', 'b'), filha('t-caio', 'k-Caio', 'c')],
      }],
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: nuncaChama('fecharContainer'),
    },
  });
  assert.deepStrictEqual(fechos, [['t-bia', 'done'], ['t-caio', 'cancelled']]);
  assert.deepStrictEqual(out.lote.map((l) => l.pagador_chave), ['k-Ana']);
});

// ── M8 (revisão final): nome de cliente nunca vai pro motivo (-> marker_logs.reason) ───────────
test('M8: nenhum motivo de falha contém o nome do pagador nem o título da tarefa — só os 8 primeiros caracteres do id', async () => {
  const NOMES = ['Zuleica Primeira', 'Yolanda Segunda', 'Xavier Terceiro', 'Wanda Quarta'];
  const fonte = [
    linha(NOMES[0], 'pix_avulso'), // continua -> cancelar (falha)
    linha(NOMES[1], 'autorizacao_pendente'), // transição -> marcar (falha) + fechar (falha)
    linha(NOMES[2], 'pix_avulso', { categoria: 'ja_migrou' }), // done (falha)
    // NOMES[3] sumiu da RPC -> cancelar (falha)
  ];
  const id = (n) => `${n}aaaaaaa-1111-4222-8333-444444444444`;
  const filhasVelhas = [
    filhaOrig(id(1), `k-${NOMES[0]}`, `PIX automático — ${NOMES[0]}`, 'migrar'),
    filhaOrig(id(2), `k-${NOMES[1]}`, `PIX automático — ${NOMES[1]}`, 'migrar'),
    filhaOrig(id(3), `k-${NOMES[2]}`, `PIX automático — ${NOMES[2]}`, 'migrar'),
    filhaOrig(id(4), `k-${NOMES[3]}`, `PIX automático — ${NOMES[3]}`, 'migrar'),
  ];
  const motivos = [];
  // (a) pacote novo criado, todas as escritas do anterior falham
  const a = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk(fonte),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [{ id: id(9), title: `${r.PREFIXO_CONTAINER}15/09 ${NOMES[0]}`, due_date: '2026-09-15', filhas: filhasVelhas }],
      criarPacote: async ({ input }) => ({ groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      vincular: semVinculo,
      marcarTransicao: async () => false,
      fecharFilha: async () => false,
      fecharContainer: async () => false,
    },
  });
  motivos.push(a.motivo);
  // (b) pacote de hoje incompleto que não desmonta
  const b = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk(fonte),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      containersPix: async () => [{
        id: id(8), title: `${r.PREFIXO_CONTAINER}16/09`, due_date: '2026-09-16',
        filhas: [filha(id(7), null, `PIX automático — ${NOMES[3]}`), filhaOrig(id(6), `k-${NOMES[0]}`, `PIX automático — ${NOMES[0]}`, 'migrar')],
      }],
      criarPacote: nuncaChama('criarPacote'),
      fecharFilha: async (fid) => fid === id(7),
      fecharContainer: async () => false,
    },
  });
  motivos.push(b.motivo);
  assert.match(a.motivo, /1aaaaaaa/);
  assert.match(a.motivo, /2aaaaaaa/);
  assert.match(a.motivo, /9aaaaaaa/, 'pacote velho também pelo id');
  assert.match(b.motivo, /6aaaaaaa/);
  for (const m of motivos) {
    assert.ok(m, 'cada cenário tem motivo');
    for (const nome of NOMES) assert.ok(!m.includes(nome), `motivo não pode citar "${nome}": ${m}`);
    assert.ok(!m.includes('PIX automático —'), `motivo não pode citar título de tarefa: ${m}`);
  }
});

test('I4/M3: filha PENDENTE de cliente informado há 2 dias (marcador gravou, baixa falhou) continua na fonte em migrar — é carregada, nunca vira done', async () => {
  const fechos = [];
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'pix_avulso'), linha('Bia', 'pix_avulso')]),
    deps: {
      agora: agoraFixo, transicoesRecentes: async () => [], vinculosSemTransicao: async () => [],
      informados: async () => [{ pagador_chave: 'k-Ana', created_at: new Date(AGORA - 2 * 86400000).toISOString() }],
      containersPix: async () => [{
        id: 'cont-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15',
        filhas: [filha('f-ana', 'k-Ana', 'PIX automático — Ana')],
      }],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: async () => true,
      vincular: semVinculo,
    },
  });
  assert.deepStrictEqual(fechos, [['f-ana', 'cancelled']]);
  assert.strictEqual(out.carregadas, 1);
  assert.strictEqual(criadas[0].title, 'PIX automático — Ana (Ana filho)', 'a filha pendente mantém a cliente no lote');
});

// ── R1 (re-revisão) — a carência vale para quem foi baixado pelo atalho ─────────────────────────
// Tabela pix_pauta_vinculo falsa COM ESTADO: filtra como o banco (origem migrar, transicao_em nulo,
// created_at na janela; transições por data) e grava transicao_em só onde ainda é nulo.
function bancoDeVinculos(linhas) {
  const vinculos = linhas.map((v) => ({ unidade_id: 'u1', transicao_em: null, created_at: '2026-09-16T12:00:00.000Z', ...v }));
  let falhar = false;
  const gravacoes = [];
  return {
    vinculos,
    gravacoes,
    falharGravacao: (b) => { falhar = b; },
    deps: {
      vinculosSemTransicao: async ({ unidadeId, desdeYmd }) => vinculos
        .filter((v) => v.unidade_id === unidadeId && v.categoria_origem === 'migrar' && v.transicao_em === null && v.created_at >= desdeYmd)
        .map((v) => ({ task_id: v.task_id, pagador_chave: v.pagador_chave })),
      transicoesRecentes: async ({ unidadeId, desdeYmd }) => vinculos
        .filter((v) => v.unidade_id === unidadeId && v.transicao_em && v.transicao_em >= desdeYmd)
        .map((v) => ({ pagador_chave: v.pagador_chave, transicao_em: v.transicao_em })),
      marcarTransicao: async ({ taskIds, hoje }) => {
        gravacoes.push({ taskIds: [...taskIds], hoje });
        if (falhar) return false;
        vinculos.filter((v) => taskIds.includes(v.task_id) && v.transicao_em === null).forEach((v) => { v.transicao_em = hoje; });
        return true;
      },
    },
  };
}
const DIA = 86400000;
const informadaNoDia0 = async () => [{ pagador_chave: 'k-Ana', created_at: new Date(AGORA).toISOString() }];

test('R1 (trace do revisor): atalho baixou a filha no dia 0; no dia 7 a fonte mostra autorizacao_pendente — grava transicao_em (em TODOS os vínculos migrar dela, de qualquer status), fica FORA do lote e conta em ⏳', async () => {
  const banco = bancoDeVinculos([
    { task_id: 'f-ana-d0', pagador_chave: 'k-Ana', categoria_origem: 'migrar' }, // filha baixada pelo atalho (done)
    { task_id: 'f-ana-velha', pagador_chave: 'k-Ana', categoria_origem: 'migrar', created_at: '2026-09-10T12:00:00.000Z' }, // carregada antes (cancelled)
    { task_id: 'f-bia-d0', pagador_chave: 'k-Bia', categoria_origem: 'migrar' }, // Bia segue em migrar
  ]);
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base, hoje: '2026-09-23',
    laReport: laReportOk([
      linha('Ana', 'autorizacao_pendente', { dado_atualizado_em: new Date(AGORA + 7 * DIA - 3600e3).toISOString() }),
      linha('Bia', 'pix_avulso', { dado_atualizado_em: new Date(AGORA + 7 * DIA - 3600e3).toISOString() }),
    ]),
    deps: {
      agora: () => AGORA + 7 * DIA, informados: informadaNoDia0,
      ...banco.deps,
      containersPix: async () => [], // nenhuma filha pendente da Ana: o atalho já baixou
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      vincular: semVinculo,
    },
  });
  assert.deepStrictEqual(banco.gravacoes, [{ taskIds: ['f-ana-d0', 'f-ana-velha'], hoje: '2026-09-23' }], 'uma gravação por cliente, com todos os vínculos dela');
  assert.deepStrictEqual(banco.vinculos.map((v) => [v.task_id, v.transicao_em]), [['f-ana-d0', '2026-09-23'], ['f-ana-velha', '2026-09-23'], ['f-bia-d0', null]]);
  assert.deepStrictEqual(criadas.map((s) => s.title), ['PIX automático — Bia (Bia filho)'], 'Ana NÃO volta ao lote como 🔵');
  assert.match(out.texto, /⏳ Aguardando 1ª cobrança \(1\)/);
  assert.ok(!out.texto.includes('🔵'));
  assert.ok(!out.texto.includes('Ana'));
  assert.ok(!out.texto.includes('Voltaram'), 'e C1 continua: autorização pendente não é "voltou"');
  assert.strictEqual(out.motivo, null);

  // Dia 8: a carência agora vem do BANCO — continua fora do lote, sem gravar de novo.
  const criadasD8 = [];
  const out8 = await r.pautaPixDaUnidade({
    ...base, hoje: '2026-09-24',
    laReport: laReportOk([
      linha('Ana', 'autorizacao_pendente', { dado_atualizado_em: new Date(AGORA + 8 * DIA - 3600e3).toISOString() }),
      linha('Bia', 'pix_avulso', { dado_atualizado_em: new Date(AGORA + 8 * DIA - 3600e3).toISOString() }),
    ]),
    deps: {
      agora: () => AGORA + 8 * DIA, informados: informadaNoDia0,
      ...banco.deps,
      containersPix: async () => [],
      criarPacote: async ({ input }) => { criadasD8.push(...input.subtasks); return { groupId: 'm2', childIds: input.subtasks.map((_, i) => `u${i}`) }; },
      vincular: semVinculo,
    },
  });
  assert.strictEqual(banco.gravacoes.length, 1, 'dia 8 não regrava (a data da transição não anda pra frente)');
  assert.deepStrictEqual(criadasD8.map((s) => s.title), ['PIX automático — Bia (Bia filho)']);
  assert.match(out8.texto, /⏳ Aguardando 1ª cobrança \(1\)/);
});

test('R1: informada no dia 0 mas AINDA em migrar no dia 7 — volta pela seção ↩️ e entra no lote (C1 inalterado), sem gravar transição', async () => {
  const banco = bancoDeVinculos([{ task_id: 'f-ana-d0', pagador_chave: 'k-Ana', categoria_origem: 'migrar' }]);
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base, hoje: '2026-09-23',
    laReport: laReportOk([linha('Ana', 'pix_avulso', { dado_atualizado_em: new Date(AGORA + 7 * DIA - 3600e3).toISOString() })]),
    deps: {
      agora: () => AGORA + 7 * DIA, informados: informadaNoDia0,
      ...banco.deps,
      marcarTransicao: nuncaChama('marcarTransicao'),
      containersPix: async () => [],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      vincular: semVinculo,
    },
  });
  assert.strictEqual(out.voltaram.length, 1);
  assert.match(out.texto, /↩️ \*Voltaram pra lista\* \(1\)/);
  assert.deepStrictEqual(criadas.map((s) => s.title), ['PIX automático — Ana (Ana filho)']);
  assert.strictEqual(banco.vinculos[0].transicao_em, null);
  assert.ok(!out.texto.includes('⏳'));
});

test('R1: gravação da transição falha numa filha pendente — a filha fecha done mesmo assim (progresso) e a execução SEGUINTE regrava pelo mesmo caminho (vínculo sem transição, qualquer status)', async () => {
  const banco = bancoDeVinculos([{ task_id: 'f-ana', pagador_chave: 'k-Ana', categoria_origem: 'migrar' }]);
  const fonte = (dia) => [
    linha('Ana', 'autorizacao_pendente', { dado_atualizado_em: new Date(AGORA + dia * DIA - 3600e3).toISOString() }),
    linha('Bia', 'pix_avulso', { dado_atualizado_em: new Date(AGORA + dia * DIA - 3600e3).toISOString() }),
  ];
  const fechos = [];
  banco.falharGravacao(true);
  const d1 = await r.pautaPixDaUnidade({
    ...base, hoje: '2026-09-16',
    laReport: laReportOk(fonte(0)),
    deps: {
      agora: agoraFixo, informados: async () => [],
      ...banco.deps,
      containersPix: async () => [{
        id: 'cont-ontem', title: r.PREFIXO_CONTAINER + '15/09', due_date: '2026-09-15',
        filhas: [filhaOrig('f-ana', 'k-Ana', 'PIX automático — Ana', 'migrar')],
      }],
      criarPacote: async ({ input }) => ({ groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }),
      fecharFilha: async (id, status) => { fechos.push([id, status]); return true; },
      fecharContainer: async () => true,
      vincular: semVinculo,
    },
  });
  assert.deepStrictEqual(fechos, [['f-ana', 'done']], 'progresso: fecha done mesmo sem gravar');
  assert.deepStrictEqual(banco.gravacoes, [{ taskIds: ['f-ana'], hoje: '2026-09-16' }], 'tentou uma vez só nesta execução');
  assert.match(d1.motivo, /transição/);
  assert.deepStrictEqual(d1.lote.map((l) => l.pagador_chave), ['k-Bia'], 'na carência nesta execução mesmo sem gravar');
  assert.strictEqual(banco.vinculos[0].transicao_em, null);

  banco.falharGravacao(false);
  const d2 = await r.pautaPixDaUnidade({
    ...base, hoje: '2026-09-17',
    laReport: laReportOk(fonte(1)),
    deps: {
      agora: () => AGORA + DIA, informados: async () => [],
      ...banco.deps,
      containersPix: async () => [], // a filha da Ana já está done: só o caminho "qualquer status" a acha
      criarPacote: async ({ input }) => ({ groupId: 'm2', childIds: input.subtasks.map((_, i) => `u${i}`) }),
      vincular: semVinculo,
    },
  });
  assert.deepStrictEqual(banco.gravacoes[1], { taskIds: ['f-ana'], hoje: '2026-09-17' }, 'a execução seguinte regravou');
  assert.strictEqual(banco.vinculos[0].transicao_em, '2026-09-17');
  assert.deepStrictEqual(d2.lote.map((l) => l.pagador_chave), ['k-Bia']);
  assert.match(d2.texto, /⏳ Aguardando 1ª cobrança \(1\)/);
  assert.strictEqual(d2.motivo, null);
});

test('R1: vínculo migrar sem transição criado há mais de 60 dias fica fora da leitura', async () => {
  const banco = bancoDeVinculos([{ task_id: 'f-ana-antiga', pagador_chave: 'k-Ana', categoria_origem: 'migrar', created_at: '2026-07-17T12:00:00.000Z' }]);
  const criadas = [];
  await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'autorizacao_pendente')]),
    deps: {
      agora: agoraFixo, informados: async () => [],
      ...banco.deps,
      marcarTransicao: nuncaChama('marcarTransicao'),
      containersPix: async () => [],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      vincular: semVinculo,
    },
  });
  assert.strictEqual(criadas.length, 1, 'sem vínculo recente, Ana é 🔵 normal');
});

test('R1: erro ao ler os vínculos sem transição — aviso no motivo e segue sem ela (falha-aberta)', async () => {
  const criadas = [];
  const out = await r.pautaPixDaUnidade({
    ...base,
    laReport: laReportOk([linha('Ana', 'autorizacao_pendente')]),
    deps: {
      agora: agoraFixo, informados: async () => [], transicoesRecentes: async () => [],
      vinculosSemTransicao: async () => { throw new Error('leitura caiu'); },
      marcarTransicao: nuncaChama('marcarTransicao'),
      containersPix: async () => [],
      criarPacote: async ({ input }) => { criadas.push(...input.subtasks); return { groupId: 'm1', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      vincular: semVinculo,
    },
  });
  assert.strictEqual(criadas.length, 1);
  assert.match(out.motivo, /vínculos sem transição: leitura caiu/);
  assert.ok(out.texto);
});
