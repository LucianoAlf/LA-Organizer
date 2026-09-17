'use strict';
// pix-migracao.js — RITUAL: lê a fonte (LA Report), mantém no máximo um pacote "PIX" aberto por
// grupo no painel de tarefas (lote do dia, até 10 clientes, carregando quem ficou pendente de
// ontem, fechando quem saiu da fonte) e devolve o texto pronto (mensagemDaUnidade, camada pura).
// NUNCA manda WhatsApp — quem publica é o dispatcher (tarefa seguinte desta pauta).
//
// Espelha o padrão de src/rituals/anamnese-pauta.js: toda chamada ao Supabase checa `error`;
// falha de ESCRITA (fechar filha/container, gravar vínculo) nunca lança — vira aviso, devolvido
// em `motivo`, em TODO caminho de retorno (inclusive "sem cliente a migrar" e a falha de
// criarPacote — fix round 1, achado 2: esses dois caminhos derrubavam os avisos já acumulados no
// chão). A única exceção que PODE lançar é a criação do pacote (createTaskGroup, que insere linha
// a linha SEM transação — ver o comentário de montarPautaDaUnidade); por isso é a única chamada
// envolta em try/catch dedicado, igual ao ritual da anamnese.
//
// CORREÇÃO (fix round 1, achado 1 — revisão do controlador REVOGA a decisão anterior de casar
// filha↔cliente pelo TÍTULO gerado): título não é chave. Dois clientes podem gerar o mesmo texto
// (mesmo nome + mesmos alunos), e o MESMO cliente gera textos DIFERENTES em dias diferentes (a
// lista de alunos mudou). Casar pelo título misatribuía status de 3 jeitos comprovados: (a) só a
// lista de alunos mudou → filha de ontem virava `done` (devia ser `cancelled`+carregada); (b)
// dois clientes com título idêntico → o que saiu ficava carregado e o que ficou era fechado
// (inversão); (c) pacote de hoje com dois títulos idênticos → quem saiu nunca fechava e quem
// ficou aparecia duas vezes no lote e no texto. A chave estável agora é `pagador_chave`, gravada
// em `public.pix_pauta_vinculo` (task_id -> pagador_chave, unidade_id) no momento em que a filha
// é criada (ver `vincular` abaixo). O título segue existindo SÓ pra exibição (tituloDaFilha,
// mensagemDaUnidade) — nunca mais pra casar filha com cliente.
//
// CORREÇÃO (fix round 1, achado 3, Critical — Tarefa 5): `texto: null` tem QUATRO causas
// diferentes (RPC falhou, sem cliente a migrar, criarPacote lançou, containersPix lançou), e só a
// primeira é "a fonte está fora do ar". O dispatcher da Tarefa 5 tratava as quatro como se fossem
// a mesma coisa e publicava "a fonte não atualizou hoje" no grupo REAL toda vez que a fila
// esvaziava ou o painel tinha um bug — uma afirmação FALSA, recorrente, que escondia justamente o
// defeito que merecia alarme. A correção mora em DOIS lugares: aqui, dois flags ESTRUTURADOS em
// TODO caminho de retorno (`fonteFalhou`: true só quando a RPC falhou; `semCliente`: true só
// quando não há cliente a migrar; false nos outros); e em services/pix-migracao.js
// (decisaoDaPublicacaoPix), que lê só esses flags — nunca o texto de `motivo` — pra decidir o que
// publicar. Nenhum consumidor deste ritual pode voltar a inferir "fonte caiu" de `texto === null`
// sozinho: os dois flags são a única fonte de verdade sobre POR QUE não há texto.

const pura = require('../services/pix-migracao');
const { consultaComRetry } = require('../lib/consulta-com-retry');

// Prefixo do título do container — ÚNICO lugar onde este texto existe. Os deps padrão de leitura
// (containersPix) procuram por este mesmo texto: se cada lado escrevesse o seu, a leitura do
// painel ficaria cega pro próprio pacote que a criação monta.
const PREFIXO_CONTAINER = '💠 PIX automático — migrar · ';

// 'YYYY-MM-DD' -> 'DD/MM' por posição, nunca `new Date(hoje)` (que troca de dia sob fuso) — mesmo
// corte de anamnese-pauta._tituloDoContainer.
function _dataBr(hoje) {
  const [, mes, dia] = String(hoje || '').split('-');
  return `${dia}/${mes}`;
}

function _tituloContainerDoDia(hoje) {
  return `${PREFIXO_CONTAINER}${_dataBr(hoje)}`;
}

// Fonte velha: NENHUMA linha devolvida pela RPC (campo nulo incluso, zero linhas incluso) tem
// dado_atualizado_em dentro das últimas 48h. Checa o retorno CRU da RPC (antes do filtro de
// categoria) — o frescor é da extração inteira, não de uma fatia dela.
function _fonteVelha(todasAsLinhas, agoraMs) {
  const limite = agoraMs - 48 * 3600e3;
  return !(todasAsLinhas || []).some((l) => {
    const t = l && l.dado_atualizado_em ? Date.parse(l.dado_atualizado_em) : NaN;
    return Number.isFinite(t) && t >= limite;
  });
}

// Casa uma filha do painel com o cliente da fonte — SEMPRE por pagador_chave (nunca por título:
// ver a correção no topo do arquivo). Filha sem vínculo (pagador_chave nulo — nunca foi gravado,
// ou a gravação falhou) não casa com ninguém: cai no ramo "não está mais na fonte" só pra fins de
// fechamento (vira `done`), nunca entra em carregadas/lote.
function _acharCliente(f, porChave) {
  return f.pagador_chave ? porChave.get(f.pagador_chave) : undefined;
}

// Um cliente aparece no máximo uma vez em carregadas/lote, mesmo que dois vínculos por acidente
// apontem pro mesmo pagador_chave (duas filhas coladas no mesmo cliente).
function _dedupPorChave(linhas) {
  const vistos = new Set();
  return (linhas || []).filter((l) => (vistos.has(l.pagador_chave) ? false : (vistos.add(l.pagador_chave), true)));
}

// ── contrato de deps (testável sem banco — nenhum teste deste arquivo toca o Supabase real) ───
// deps.agora()                                -> number   (padrão Date.now())
// deps.containersPix({ groupId })             -> [{ id, title, due_date,
//                                                    filhas: [{ id, title, pagador_chave, categoria_origem }] }]
//   Só pacotes PIX (título começa com PREFIXO_CONTAINER) com status 'pending', e só filhas
//   'pending'. `pagador_chave`/`categoria_origem` vêm de public.pix_pauta_vinculo; filha sem
//   vínculo devolve pagador_chave: null (e categoria_origem: null).
// deps.criarPacote({ supabase, groupId, createdBy, input }) -> { groupId, childIds }
//   Padrão: require('../services/task-groups').createTaskGroup. childIds vem na MESMA ordem de
//   input.subtasks (garantia do motor de criação, não deste ritual).
// deps.fecharFilha(id, status)  -> boolean   status 'done' | 'cancelled'; nunca lança.
// deps.fecharContainer(id)      -> boolean   nunca lança.
// deps.vincular([{ task_id, pagador_chave, unidade_id, categoria_origem }]) -> boolean   grava em
//   pix_pauta_vinculo; nunca lança — erro de escrita vira aviso em `motivo`. `categoria_origem` é
//   a categoria do cliente na fonte no momento da criação (I2).
// deps.informados({ unidadeId, desdeIso })    -> [{ pagador_chave, created_at }]   (Tarefa 7)
//   marker_logs PIX_CADASTRO/executed com reason 'informado:<unidadeId>:%' desde desdeIso. PODE
//   lançar — erro vira aviso em `motivo` e NÃO exclui ninguém do lote (falha-aberta).
// deps.transicoesRecentes({ unidadeId, desdeYmd }) -> [{ pagador_chave, transicao_em }]   (I2)
//   pix_pauta_vinculo com transicao_em >= desdeYmd. PODE lançar — erro vira aviso em `motivo` e
//   NÃO exclui ninguém (falha-aberta, mesma regra dos informados).
// deps.marcarTransicao({ taskId, hoje })      -> boolean   grava transicao_em = hoje no vínculo
//   da filha (só se ainda estiver nulo); nunca lança.

// ── deps padrão (Supabase real) ──────────────────────────────────────────────────────────────
// Todas fecham sobre `supabase` por closure — mesmo padrão de `criarPacote` em
// montarPautaDaUnidade (anamnese-pauta.js), pra que os testes injetem `deps` sem precisar de
// banco e o caminho real não precise passar `supabase` em cada chamada.

async function _containersPixPadrao(sb, { groupId }) {
  const { data, error } = await sb.from('tasks').select('id, title, due_date')
    .eq('assigned_group_id', groupId).eq('is_group', true).eq('status', 'pending')
    .like('title', `${PREFIXO_CONTAINER}%`);
  if (error) throw new Error(`containersPix: ${error.message}`);
  const containers = [];
  for (const c of data || []) {
    const { data: filhas, error: erroFilhas } = await sb.from('tasks').select('id, title')
      .eq('parent_task_id', c.id).eq('status', 'pending');
    if (erroFilhas) throw new Error(`containersPix (filhas de ${c.id}): ${erroFilhas.message}`);
    const ids = (filhas || []).map((f) => f.id);
    let porTask = new Map();
    if (ids.length) {
      const { data: vinculos, error: erroVinculo } = await sb.from('pix_pauta_vinculo')
        .select('task_id, pagador_chave, categoria_origem').in('task_id', ids);
      if (erroVinculo) throw new Error(`containersPix (vínculo de ${c.id}): ${erroVinculo.message}`);
      porTask = new Map((vinculos || []).map((v) => [v.task_id, v]));
    }
    containers.push({
      id: c.id,
      title: c.title,
      due_date: c.due_date,
      filhas: (filhas || []).map((f) => {
        const v = porTask.get(f.id);
        return {
          id: f.id, title: f.title,
          pagador_chave: (v && v.pagador_chave) || null, categoria_origem: (v && v.categoria_origem) || null,
        };
      }),
    });
  }
  return containers;
}

// Só fecha se ainda está 'pending' (evita corrida com quem já fechou por fora). Nunca lança —
// erro de escrita vira `false` (o chamador registra em `avisos`/`motivo`), igual a _fecharFilha
// de anamnese-pauta.js.
async function _fecharFilhaPadrao(sb, id, status) {
  const payload = { status };
  if (status === 'done') payload.completed_at = new Date().toISOString();
  const { data, error } = await sb.from('tasks').update(payload)
    .eq('id', id).eq('status', 'pending').select('id');
  if (error) { console.error(`[PixMigracao] fecharFilha falhou id=${id}: ${error.message}`); return false; }
  if (!(data || []).length) { console.error(`[PixMigracao] fecharFilha não achou id=${id} pending`); return false; }
  return true;
}

async function _fecharContainerPadrao(sb, id) {
  const { data, error } = await sb.from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', id).select('id');
  if (error) { console.error(`[PixMigracao] fecharContainer falhou id=${id}: ${error.message}`); return false; }
  if (!(data || []).length) { console.error(`[PixMigracao] fecharContainer não achou id=${id}`); return false; }
  return true;
}

// Grava task_id -> pagador_chave logo depois de criar as filhas do pacote. Nunca lança — erro de
// escrita vira `false` (o chamador registra em `motivo`); a filha já foi criada, perder o vínculo
// não pode derrubar o pacote inteiro.
async function _vincularPadrao(sb, vinculos) {
  if (!vinculos || !vinculos.length) return true;
  const { error } = await sb.from('pix_pauta_vinculo').insert(vinculos);
  if (error) { console.error(`[PixMigracao] vincular falhou: ${error.message}`); return false; }
  return true;
}

// Lê marker_logs (PIX_CADASTRO, result='executed') gravados pelo atalho de baixa informada no
// grupo (src/services/pix-cadastro-grupo.js) desde `desdeIso`, casando pelo prefixo do reason
// ('informado:<unidadeId>:'). Lança em erro do Supabase — quem chama (pautaPixDaUnidade) decide o
// que fazer: aqui é falha-aberta, então NENHUMA exclusão acontece quando esta consulta falha.
async function _informadosPadrao(sb, { unidadeId, desdeIso }) {
  const { data, error } = await sb.from('marker_logs').select('reason, created_at')
    .eq('marker_type', 'PIX_CADASTRO').eq('result', 'executed')
    .like('reason', `informado:${unidadeId}:%`).gte('created_at', desdeIso);
  if (error) throw new Error(`informados: ${error.message}`);
  return (data || []).map((row) => ({
    pagador_chave: String(row.reason || '').slice('informado:'.length),
    created_at: row.created_at,
  }));
}

// I2: clientes da unidade com transição migrar -> autorizacao_pendente registrada desde
// `desdeYmd`. Lança em erro do Supabase (quem chama trata como falha-aberta).
async function _transicoesRecentesPadrao(sb, { unidadeId, desdeYmd }) {
  const { data, error } = await sb.from('pix_pauta_vinculo').select('pagador_chave, transicao_em')
    .eq('unidade_id', unidadeId).gte('transicao_em', desdeYmd);
  if (error) throw new Error(`transicoesRecentes: ${error.message}`);
  return data || [];
}

// I2: grava transicao_em no vínculo da filha — só se ainda estiver nulo (uma segunda tentativa não
// empurra a data pra frente e não encurta a carência). Nunca lança: erro vira `false`.
async function _marcarTransicaoPadrao(sb, { taskId, hoje }) {
  const { error } = await sb.from('pix_pauta_vinculo').update({ transicao_em: hoje })
    .eq('task_id', taskId).is('transicao_em', null);
  if (error) { console.error(`[PixMigracao] marcarTransicao falhou id=${taskId}: ${error.message}`); return false; }
  return true;
}

// ── ritual ────────────────────────────────────────────────────────────────────────────────────
async function pautaPixDaUnidade({ supabase, laReport, unidadeId, unidadeNome, groupId, criadoPor, hoje, deps = {} }) {
  const agora = deps.agora || (() => Date.now());
  const containersPix = deps.containersPix || ((arg) => _containersPixPadrao(supabase, arg));
  const criarPacote = deps.criarPacote
    || ((arg) => require('../services/task-groups').createTaskGroup(arg));
  const fecharFilha = deps.fecharFilha || ((id, status) => _fecharFilhaPadrao(supabase, id, status));
  const fecharContainer = deps.fecharContainer || ((id) => _fecharContainerPadrao(supabase, id));
  const vincular = deps.vincular || ((vinculos) => _vincularPadrao(supabase, vinculos));
  const informados = deps.informados || ((arg) => _informadosPadrao(supabase, arg));
  const transicoesRecentes = deps.transicoesRecentes || ((arg) => _transicoesRecentesPadrao(supabase, arg));
  const marcarTransicao = deps.marcarTransicao || ((arg) => _marcarTransicaoPadrao(supabase, arg));

  // fonteFalhou/semCliente: false por padrão (fix round 1, Critical) — só os DOIS caminhos que os
  // marcam `true` explicitamente (abaixo) representam "fonte fora do ar" e "sem cliente a migrar
  // hoje". Todo outro caminho de `texto: null` (criarPacote lançou, containersPix lançou) herda
  // `false` nos dois daqui, e é assim que decisaoDaPublicacaoPix (services/pix-migracao.js)
  // distingue "a fonte está bem, o painel que falhou" de "a fonte caiu".
  const vazio = {
    criou: false, jaExistia: false, total: 0, lote: [], fechadas: 0, carregadas: 0,
    texto: null, motivo: null, fonteVelha: false, fonteFalhou: false, semCliente: false,
    voltaram: [], informadosRecentes: 0,
  };

  // Sempre checar `error`: RPC com parâmetro errado devolve {data:null,error} e viraria "zero
  // clientes" silencioso — a fonte pareceria vazia (ou pior, "ninguém a migrar") em vez de quebrada.
  const { data, error } = await consultaComRetry(() => laReport.rpc('get_pix_migracao_v1',
    { p_unidade_id: unidadeId, p_fatia: null }));
  if (error) {
    // Único caminho que marca fonteFalhou: true — é o único que significa "a RPC do LA Report não
    // respondeu", ao contrário de fonte velha (respondeu, mas com dado requentado) ou de qualquer
    // falha do painel (a RPC respondeu bem, o problema é nosso).
    return { ...vazio, fonteFalhou: true, motivo: `consulta do LA Report falhou: ${error.message}` };
  }

  const todasAsLinhas = data || [];
  if (_fonteVelha(todasAsLinhas, agora())) {
    // Fonte velha: NÃO mexe no painel — nem lê containers, nem fecha, nem cria. Silêncio
    // completo, mesma regra sagrada de mensagemDaUnidade ("não vou cobrar número que não medi").
    return {
      ...vazio, fonteVelha: true,
      texto: pura.mensagemDaUnidade({ unidadeNome, linhas: [], lote: [], fonteVelha: true }),
    };
  }

  const linhas = todasAsLinhas.filter((l) => l && (l.categoria === 'migrar' || l.categoria === 'autorizacao_pendente'));
  const total = linhas.length;

  // ── RECONFERÊNCIA DE 7 DIAS (Tarefa 7 do plano de migração) ────────────────────────────────
  // A equipe deu baixa informada no grupo (src/services/pix-cadastro-grupo.js), que já fechou a
  // filha na hora — mas a FONTE (Emusys, via LA Report) pode levar alguns dias pra refletir o
  // cadastro. Sem esta reconferência, o cliente reaparece amanhã como "migrar" e o ritual cria
  // OUTRA filha pra ele — pedindo de novo o que a equipe acabou de dizer que já fez. `informados`
  // lê marker_logs (PIX_CADASTRO/executed) dos últimos ~8 dias pra saber, POR CLIENTE, há quantos
  // dias a equipe avisou. Erro na leitura é FALHA-ABERTA de propósito (melhor repetir um nome já
  // resolvido do que esconder um cliente de verdade da pauta): vira aviso em `motivo`, nenhuma
  // exclusão é aplicada.
  const avisos = [];
  const agoraMs = agora();
  let recentesSet = new Set();
  let voltaramSet = new Set();
  try {
    const desdeIso = new Date(agoraMs - 8 * 86400000).toISOString();
    const rows = await informados({ unidadeId, desdeIso });
    const diasPorChave = new Map();
    for (const row of rows || []) {
      const dias = Math.floor((agoraMs - Date.parse(row && row.created_at)) / 86400000);
      if (!Number.isFinite(dias)) continue;
      const atual = diasPorChave.get(row.pagador_chave);
      if (atual === undefined || dias < atual) diasPorChave.set(row.pagador_chave, dias);
    }
    for (const [chave, dias] of diasPorChave) {
      if (dias < 7) recentesSet.add(chave); else voltaramSet.add(chave);
    }
  } catch (e) {
    avisos.push(`não consegui reconferir quem foi informado nos últimos dias: ${(e && e.message) || String(e)}`);
  }
  // < 7 dias: some da fila (não entra no lote nem é carregado), mas continua contado em `total`
  // e nas fatias de `mensagemDaUnidade` (usa `linhas`, nunca filtrada). >= 7 dias (até 8, janela
  // da consulta) e ainda na fonte: volta a ser candidato normal. A seção "Voltaram pra lista"
  // afirma "disseram que cadastrou, mas o Emusys ainda não mostra" — por isso só entra quem a
  // fonte AINDA mostra em `migrar` (C1, revisão final). `autorizacao_pendente` é o contrário: o
  // Emusys JÁ mostra o cadastro (só falta a 1ª cobrança) — listar ali seria afirmação falsa.
  const voltaram = linhas.filter((l) => voltaramSet.has(l.pagador_chave) && l.categoria === 'migrar');
  const informadosRecentes = recentesSet.size;

  // ── CARÊNCIA DA 1ª COBRANÇA (I2, revisão final) ────────────────────────────────────────────
  // Quem a equipe cadastrou passa de `migrar` pra `autorizacao_pendente` e fica assim até a 1ª
  // cobrança (até um ciclo, ~30 dias). Sem esta carência o cliente virava 🔵 "resolver primeiro" e
  // TRAVAVA o topo do lote justamente depois que a equipe fez o trabalho. A transição é gravada
  // no vínculo (transicao_em); aqui lemos as dos últimos CARENCIA_PRIMEIRA_COBRANCA_DIAS dias
  // (hoje incluso). Erro na leitura é FALHA-ABERTA (mesma regra dos informados): aviso no
  // `motivo`, ninguém excluído.
  const carenciaSet = new Set();
  try {
    const desdeYmd = pura.somaDiasYmd(hoje, -(pura.CARENCIA_PRIMEIRA_COBRANCA_DIAS - 1));
    const rows = await transicoesRecentes({ unidadeId, desdeYmd });
    for (const row of rows || []) if (row && row.pagador_chave) carenciaSet.add(row.pagador_chave);
  } catch (e) {
    avisos.push(`não consegui ler as transições recentes (carência da 1ª cobrança): ${(e && e.message) || String(e)}`);
  }

  try {
    const containers = await containersPix({ groupId });

    // Transições DESTA execução: filha pendente (de qualquer pacote) cujo cliente tinha
    // categoria_origem 'migrar' e a fonte AGORA mostra em 'autorizacao_pendente' — foi cadastrado.
    // O cliente já entra na carência hoje (antes mesmo de a gravação chegar ao banco).
    const todasPorChave = new Map(todasAsLinhas.filter((l) => l && l.pagador_chave).map((l) => [l.pagador_chave, l]));
    const transicaoIds = new Set();
    for (const c of containers) {
      for (const f of c.filhas || []) {
        const naFonte = f.pagador_chave ? todasPorChave.get(f.pagador_chave) : undefined;
        if (naFonte && naFonte.categoria === 'autorizacao_pendente' && f.categoria_origem === 'migrar') {
          transicaoIds.add(f.id);
          carenciaSet.add(f.pagador_chave);
        }
      }
    }
    // Na carência: só quem ESTÁ em autorizacao_pendente (se voltou pra migrar, volta pro lote).
    const naCarencia = (l) => l.categoria === 'autorizacao_pendente' && carenciaSet.has(l.pagador_chave);
    const aguardandoCobranca = linhas.filter(naCarencia).length;
    const linhasDaPauta = linhas.filter((l) => !naCarencia(l));
    const linhasElegiveis = linhasDaPauta.filter((l) => !recentesSet.has(l.pagador_chave));
    const porChave = new Map(linhasElegiveis.map((l) => [l.pagador_chave, l]));

    let fechadas = 0;
    // Transição: grava transicao_em = hoje no vínculo e fecha a filha `done` (progresso). Nunca
    // carrega. Falha ao gravar vira aviso — a filha fecha mesmo assim (o cadastro aconteceu).
    const fecharPorTransicao = async (f) => {
      if (!(await marcarTransicao({ taskId: f.id, hoje }))) avisos.push(`não consegui gravar a transição da filha "${f.title}"`);
      if (await fecharFilha(f.id, 'done')) fechadas++;
      else avisos.push(`não consegui fechar a filha "${f.title}"`);
    };

    // 1) Pacotes anteriores (due_date < hoje) ainda abertos: quem continua na fonte (casado por
    // pagador_chave, NUNCA por título) é CARREGADO pro lote de hoje — a filha velha vira
    // `cancelled` (não `done`: ela não deixou de ser feita, só não coube ontem), e o cliente entra
    // PRIMEIRO no lote de hoje. Quem saiu da fonte (ou nunca teve vínculo gravado) vira `done`
    // (conta em `fechadas`). O pacote antigo sempre fecha no final.
    const carregadasBrutas = [];
    for (const c of containers.filter((x) => x.due_date < hoje)) {
      for (const f of c.filhas || []) {
        if (transicaoIds.has(f.id)) { await fecharPorTransicao(f); continue; }
        const linhaDaFonte = _acharCliente(f, porChave);
        if (linhaDaFonte) {
          if (!(await fecharFilha(f.id, 'cancelled'))) avisos.push(`não consegui cancelar a filha "${f.title}"`);
          carregadasBrutas.push(linhaDaFonte);
        } else if (await fecharFilha(f.id, 'done')) {
          fechadas++;
        } else {
          avisos.push(`não consegui fechar a filha "${f.title}"`);
        }
      }
      if (!(await fecharContainer(c.id))) avisos.push(`não consegui fechar o pacote velho "${c.title}"`);
    }
    // Ordena por prioridade e deduplica por pagador_chave — um cliente nunca aparece duas vezes
    // em `carregadas`, mesmo que dois vínculos velhos apontem pra ele por acidente.
    const carregadas = _dedupPorChave(pura.ordenarPorPrioridade(carregadasBrutas));

    const containerHoje = containers.find((c) => c.due_date === hoje);

    // 2) Pacote de hoje já existe: não cria nada. Só fecha (`done`) quem saiu da fonte (casado por
    // pagador_chave); o lote devolvido são os clientes cujas filhas de hoje continuam pendentes,
    // deduplicado (dois vínculos pro mesmo cliente nunca duplicam o lote nem o texto).
    if (containerHoje) {
      for (const f of containerHoje.filhas || []) {
        if (transicaoIds.has(f.id)) { await fecharPorTransicao(f); continue; }
        if (_acharCliente(f, porChave)) continue;
        if (await fecharFilha(f.id, 'done')) fechadas++;
        else avisos.push(`não consegui fechar a filha "${f.title}"`);
      }
      const loteBruto = (containerHoje.filhas || []).map((f) => _acharCliente(f, porChave)).filter(Boolean);
      const lote = _dedupPorChave(loteBruto);
      return {
        criou: false, jaExistia: true, total, lote, fechadas, carregadas: carregadas.length,
        texto: pura.mensagemDaUnidade({
          unidadeNome, linhas: linhasDaPauta, lote, fonteVelha: false, voltaram, aguardandoCobranca,
        }),
        motivo: avisos.length ? avisos.join('; ') : null, fonteVelha: false,
        fonteFalhou: false, semCliente: false, voltaram, informadosRecentes,
      };
    }

    // 3) Pacote de hoje não existe: lote = carregados (prioridade, sempre primeiro) + o lote do
    // dia (loteDoDia, camada pura) dos demais clientes da fonte, só o que FALTA pra completar
    // LOTE_DIARIO (I1, revisão final: antes o carry-over empilhava em cima de um lote cheio de 10 e
    // o pacote crescia pra 15 todo dia que alguém sobrava). Deduplicado.
    const chavesCarregadas = new Set(carregadas.map((l) => l.pagador_chave));
    const demais = linhasElegiveis.filter((l) => !chavesCarregadas.has(l.pagador_chave));
    const resto = pura.loteDoDia(demais, { tamanho: Math.max(0, pura.LOTE_DIARIO - carregadas.length) });
    const lote = _dedupPorChave([...carregadas, ...resto]);
    // TETO_FILHAS é TRAVA DURA (spec: "acima disso, não cria e registra o motivo"): nunca corta o
    // lote em silêncio. Só dispara se o carry-over sozinho passar do teto (vários pacotes velhos
    // abertos) — aí é defeito pra alguém olhar, não dia normal.
    if (lote.length > pura.TETO_FILHAS) {
      return {
        criou: false, jaExistia: false, total, lote: [], fechadas, carregadas: carregadas.length,
        texto: null,
        motivo: [`lote de ${lote.length} clientes passa do teto de ${pura.TETO_FILHAS} filhas — não criei o pacote`, ...avisos].join('; '),
        fonteVelha: false, fonteFalhou: false, semCliente: false, voltaram, informadosRecentes,
      };
    }

    if (!lote.length) {
      // Fix round 1 (achado 2): os avisos já acumulados (ex.: falha ao fechar uma filha velha)
      // não podem sumir só porque o resultado do dia é "ninguém a migrar". Único caminho que
      // marca semCliente: true — sucesso (a fonte respondeu, o painel foi lido/escrito sem
      // erro), só que não há ninguém a migrar hoje; decisaoDaPublicacaoPix lê este flag pra NÃO
      // publicar o aviso de fonte velha aqui (fila vazia é notícia boa, não falha).
      return {
        criou: false, jaExistia: false, total, lote: [], fechadas, carregadas: carregadas.length,
        texto: null, motivo: ['sem cliente a migrar', ...avisos].join('; '), fonteVelha: false,
        fonteFalhou: false, semCliente: true, voltaram, informadosRecentes,
      };
    }

    // createTaskGroup (task-groups.js) insere linha a linha SEM transação: um insert que falhe no
    // meio deixa mãe+filhas parciais já commitadas e LANÇA. É por isso que só esta chamada, entre
    // todas as escritas do ritual, tem try/catch dedicado — mesma lógica de montarPautaDaUnidade.
    let criado;
    try {
      criado = await criarPacote({
        supabase, groupId, createdBy: criadoPor,
        input: {
          title: _tituloContainerDoDia(hoje), recurrence: null, groupDueDate: hoje,
          subtasks: lote.map((l) => ({ title: pura.tituloDaFilha(l), dueDate: hoje })),
        },
      });
    } catch (e) {
      // Fix round 1 (achado 2): idem — avisos anteriores entram no motivo também aqui. Falha de
      // ESCRITA do painel (a fonte respondeu bem) — nem fonteFalhou nem semCliente: `texto: null`
      // aqui significa "não consegui nem tentar mostrar o lote", não "não há nada a mostrar".
      return {
        criou: false, jaExistia: false, total, lote: [], fechadas, carregadas: carregadas.length,
        texto: null,
        motivo: [`não consegui criar o pacote: ${(e && e.message) || String(e)}`, ...avisos].join('; '),
        fonteVelha: false, fonteFalhou: false, semCliente: false, voltaram, informadosRecentes,
      };
    }

    // Grava o vínculo task_id -> pagador_chave pra cada filha recém-criada, na MESMA ordem de
    // `lote` (createTaskGroup insere as filhas na ordem de `input.subtasks`, que veio de
    // `lote.map(...)` acima — é essa ordem que garante o pareamento childIds[i] <-> lote[i]).
    // Falha aqui não desfaz o pacote (a filha já existe): vira aviso, nunca exceção — a filha
    // fica sem chave estável até a próxima pauta tentar de novo (ela vai cair no ramo "sem
    // vínculo" de containersPix e ser fechada como se tivesse saído da fonte, o que é seguro:
    // pior caso é recriar a filha no dia seguinte).
    const childIds = (criado && criado.childIds) || [];
    const vinculos = lote
      .map((l, i) => ({
        task_id: childIds[i], pagador_chave: l.pagador_chave, unidade_id: unidadeId, categoria_origem: l.categoria,
      }))
      .filter((v) => v.task_id);
    if (vinculos.length && !(await vincular(vinculos))) {
      avisos.push('não consegui gravar o vínculo pagador-tarefa (a filha ficou sem chave estável)');
    }

    return {
      criou: true, jaExistia: false, total, lote, fechadas, carregadas: carregadas.length,
      texto: pura.mensagemDaUnidade({
        unidadeNome, linhas: linhasDaPauta, lote, fonteVelha: false, voltaram, aguardandoCobranca,
      }),
      motivo: avisos.length ? avisos.join('; ') : null, fonteVelha: false,
      fonteFalhou: false, semCliente: false, voltaram, informadosRecentes,
    };
  } catch (e) {
    // Falha ao LER o painel (containersPix, que lança em erro do Supabase por não ter outro jeito
    // de sinalizar "não consegui nem checar o que já existe") cai aqui — nunca sobe pro chamador.
    // Falha de LEITURA do painel (a fonte respondeu bem) — nem fonteFalhou nem semCliente, os dois
    // já vêm `false` de `vazio`. Os avisos da reconferência de 7 dias (se algum já tinha
    // acontecido) não podem sumir só porque o painel falhou depois.
    return {
      ...vazio, total, voltaram, informadosRecentes,
      motivo: [`falha ao processar o painel do PIX: ${(e && e.message) || String(e)}`, ...avisos].join('; '),
    };
  }
}

module.exports = { PREFIXO_CONTAINER, pautaPixDaUnidade };
