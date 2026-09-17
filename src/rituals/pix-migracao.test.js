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
      agora: agoraFixo,
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
      agora: agoraFixo,
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
    deps: { agora: agoraFixo, containersPix: nuncaChama('containersPix') },
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
      agora: agoraFixo,
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
      agora: agoraFixo,
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
        filhas: carregadosNomes.map((nome, i) => filha(`f${i}`, `k-${nome}`, `PIX automático — ${nome}`)),
      }],
      criarPacote: async ({ input }) => { n = input.subtasks.length; return { groupId: 'm3', childIds: input.subtasks.map((_, i) => `t${i}`) }; },
      fecharFilha: async () => true,
      fecharContainer: async () => true,
      vincular: semVinculo,
    },
  });
  assert.strictEqual(n, pura.TETO_FILHAS);
  assert.strictEqual(out.carregadas, 12);
  assert.strictEqual(out.fonteFalhou, false);
  assert.strictEqual(out.semCliente, false);
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
    laReport: laReportOk([linha('Ana', 'pix_avulso', { categoria: 'ja_migrado' })]), // ninguém em migrar/autorizacao_pendente
    deps: {
      agora: agoraFixo,
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
      agora: agoraFixo,
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
      agora: agoraFixo,
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
      agora: agoraFixo,
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
      agora: agoraFixo,
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
      agora: agoraFixo,
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
      agora: agoraFixo,
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
      agora: agoraFixo,
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
      agora: agoraFixo,
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
