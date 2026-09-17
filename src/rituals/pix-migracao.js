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
// CORREÇÃO (fix round 1, achado 3, Critical — Tarefa 5): `texto: null` tem várias causas
// diferentes (RPC falhou, sem cliente a migrar, falha de leitura/escrita do painel), e só a
// primeira é "a fonte está fora do ar". O dispatcher da Tarefa 5 tratava todas como se fossem
// a mesma coisa e publicava "a fonte não atualizou hoje" no grupo REAL toda vez que a fila
// esvaziava ou o painel tinha um bug — uma afirmação FALSA, recorrente, que escondia justamente o
// defeito que merecia alarme. A correção mora em DOIS lugares: aqui, dois flags ESTRUTURADOS em
// TODO caminho de retorno (`fonteFalhou`: true só quando a RPC falhou; `semCliente`: true só
// quando não há cliente a migrar; false nos outros); e em services/pix-migracao.js
// (decisaoDaPublicacaoPix), que lê só esses flags — nunca o texto de `motivo` — pra decidir o que
// publicar. Nenhum consumidor deste ritual pode voltar a inferir "fonte caiu" de `texto === null`
// sozinho: os dois flags são a única fonte de verdade sobre POR QUE não há texto.
//
// CORREÇÃO (revisão final da branch, I3 + I4) — ORDEM DAS ESCRITAS E DESTINO DE CADA FILHA:
//   I4 — o destino de uma filha pendente sai de TODAS as linhas da RPC (não só das filtradas):
//        `done` SOMENTE se a fonte mostra `ja_migrou` ou se houve a transição migrar ->
//        autorizacao_pendente (I2, carência). Foi pra inadimplente, nao_pagante, excecao,
//        nao_mexe, qualquer outra categoria, ou sumiu da RPC -> `cancelled`. Antes, "saiu da fonte"
//        virava sempre `done` — o painel contava como feito o que ninguém fez.
//   I3 — filha SEM vínculo nunca vira `done` (vira `cancelled`). Pacote de HOJE com filha sem
//        vínculo é criação interrompida: cancela as filhas e o pacote e reconstrói na mesma
//        execução (se não conseguir desmontar, NÃO reconstrói — evitaria pacote duplicado). O
//        pacote ANTERIOR só é tocado (filhas carregadas `cancelled`, quem saiu fechado, pacote
//        `done`) DEPOIS que o pacote novo foi criado E vinculado; se a criação ou o vínculo falhar,
//        o anterior fica intacto e o retorno é falha de painel (`texto: null` -> fallback). Nenhum
//        caminho de FALHA devolve texto com lote vazio; lote vazio com texto só quando todo cliente
//        está excluído por carência (I2) ou por cadastro informado há menos de 7 dias.

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

// Um cliente aparece no máximo uma vez em carregadas/lote, mesmo que dois vínculos por acidente
// apontem pro mesmo pagador_chave (duas filhas coladas no mesmo cliente).
function _dedupPorChave(linhas) {
  const vistos = new Set();
  return (linhas || []).filter((l) => (vistos.has(l.pagador_chave) ? false : (vistos.add(l.pagador_chave), true)));
}

// Categorias que a pauta cobra (quem ainda falta migrar).
const _naPauta = (l) => !!l && (l.categoria === 'migrar' || l.categoria === 'autorizacao_pendente');

// M8 (revisão final): todo aviso que vai pra `motivo` acaba em marker_logs.reason (o dispatcher
// grava `erro=<motivo>`). Título de filha é "PIX automático — <cliente> (<alunos>)" — nome de
// cliente em marcador. Aviso cita só os 8 primeiros caracteres do id da tarefa.
const _id8 = (id) => String(id == null ? '' : id).slice(0, 8);

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
// deps.fecharFilha(id, status)          -> boolean   status 'done' | 'cancelled'; nunca lança.
// deps.fecharContainer(id, status)      -> boolean   status 'done' (padrão) | 'cancelled'; nunca lança.
// deps.vincular([{ task_id, pagador_chave, unidade_id, categoria_origem }]) -> boolean   grava em
//   pix_pauta_vinculo; nunca lança — erro de escrita vira aviso em `motivo`. `categoria_origem` é
//   a categoria do cliente na fonte no momento da criação (I2).
// deps.informados({ unidadeId, desdeIso })    -> [{ pagador_chave, created_at }]   (Tarefa 7)
//   marker_logs PIX_CADASTRO/executed com reason 'informado:<unidadeId>:%' desde desdeIso. PODE
//   lançar — erro vira aviso em `motivo` e NÃO exclui ninguém do lote (falha-aberta).
// deps.transicoesRecentes({ unidadeId, desdeYmd }) -> [{ pagador_chave, transicao_em }]   (I2)
//   pix_pauta_vinculo com transicao_em >= desdeYmd. PODE lançar — erro vira aviso em `motivo` e
//   NÃO exclui ninguém (falha-aberta, mesma regra dos informados).
// deps.vinculosSemTransicao({ unidadeId, desdeYmd }) -> [{ task_id, pagador_chave }]   (R1)
//   pix_pauta_vinculo da unidade com categoria_origem 'migrar', transicao_em nulo e created_at >=
//   desdeYmd — de filha em QUALQUER status (inclusive a baixada pelo atalho). PODE lançar — erro
//   vira aviso em `motivo` e a execução segue sem esta leitura (falha-aberta).
// deps.marcarTransicao({ taskIds, hoje })     -> boolean   grava transicao_em = hoje nos vínculos
//   dessas filhas (só onde ainda está nulo), num único UPDATE; nunca lança.

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

// 'done' fecha o pacote anterior depois do pacote novo; 'cancelled' desmonta um pacote de hoje
// que ficou incompleto (I3).
async function _fecharContainerPadrao(sb, id, status = 'done') {
  const payload = { status };
  if (status === 'done') payload.completed_at = new Date().toISOString();
  const { data, error } = await sb.from('tasks').update(payload).eq('id', id).select('id');
  if (error) { console.error(`[PixMigracao] fecharContainer falhou id=${id}: ${error.message}`); return false; }
  if (!(data || []).length) { console.error(`[PixMigracao] fecharContainer não achou id=${id}`); return false; }
  return true;
}

// Grava task_id -> pagador_chave logo depois de criar as filhas do pacote (um único INSERT com
// todas as linhas — ou grava tudo, ou nada). Nunca lança — erro de escrita vira `false`; o ritual
// trata como falha do pacote novo (I3: o anterior fica intacto e o novo é refeito na próxima
// execução, pelo caminho do "pacote de hoje incompleto").
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

// R1: vínculos `migrar` ainda sem transição, de filha em QUALQUER status (o vínculo não tem status:
// a filha baixada pelo atalho continua aqui). Lança em erro do Supabase (falha-aberta no chamador).
async function _vinculosSemTransicaoPadrao(sb, { unidadeId, desdeYmd }) {
  const { data, error } = await sb.from('pix_pauta_vinculo').select('task_id, pagador_chave')
    .eq('unidade_id', unidadeId).eq('categoria_origem', 'migrar').is('transicao_em', null)
    .gte('created_at', desdeYmd);
  if (error) throw new Error(`vinculosSemTransicao: ${error.message}`);
  return data || [];
}

// I2/R1: grava transicao_em nos vínculos das filhas — só onde ainda está nulo (uma segunda tentativa
// não empurra a data pra frente e não estica a carência). Um único UPDATE por cliente: todos os
// vínculos dele ganham a MESMA data, senão uma sobra regravada no dia seguinte esticaria a carência.
// Nunca lança: erro vira `false`.
async function _marcarTransicaoPadrao(sb, { taskIds, hoje }) {
  const ids = (taskIds || []).filter(Boolean);
  if (!ids.length) return true;
  const { error } = await sb.from('pix_pauta_vinculo').update({ transicao_em: hoje })
    .in('task_id', ids).is('transicao_em', null);
  if (error) { console.error(`[PixMigracao] marcarTransicao falhou ids=${ids.map(_id8).join(',')}: ${error.message}`); return false; }
  return true;
}

// ── ritual ────────────────────────────────────────────────────────────────────────────────────
async function pautaPixDaUnidade({ supabase, laReport, unidadeId, unidadeNome, groupId, criadoPor, hoje, deps = {} }) {
  const agora = deps.agora || (() => Date.now());
  const containersPix = deps.containersPix || ((arg) => _containersPixPadrao(supabase, arg));
  const criarPacote = deps.criarPacote
    || ((arg) => require('../services/task-groups').createTaskGroup(arg));
  const fecharFilha = deps.fecharFilha || ((id, status) => _fecharFilhaPadrao(supabase, id, status));
  const fecharContainer = deps.fecharContainer || ((id, status) => _fecharContainerPadrao(supabase, id, status));
  const vincular = deps.vincular || ((vinculos) => _vincularPadrao(supabase, vinculos));
  const informados = deps.informados || ((arg) => _informadosPadrao(supabase, arg));
  const transicoesRecentes = deps.transicoesRecentes || ((arg) => _transicoesRecentesPadrao(supabase, arg));
  const marcarTransicao = deps.marcarTransicao || ((arg) => _marcarTransicaoPadrao(supabase, arg));
  const vinculosSemTransicao = deps.vinculosSemTransicao || ((arg) => _vinculosSemTransicaoPadrao(supabase, arg));

  // fonteFalhou/semCliente: false por padrão (fix round 1, Critical) — só os DOIS caminhos que os
  // marcam `true` explicitamente (abaixo) representam "fonte fora do ar" e "sem cliente a migrar
  // hoje". Todo outro caminho de `texto: null` (falha de leitura/escrita do painel, teto) herda
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

  const linhas = todasAsLinhas.filter(_naPauta);
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
  const recentesSet = new Set();
  const voltaramSet = new Set();
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
  // < 7 dias: não entra no lote NOVO (mas continua contado em `total` e nas fatias). Se a filha
  // dele continua PENDENTE (o atalho gravou o marcador mas não conseguiu dar baixa), ela é
  // carregada normalmente — o marcador sozinho não tira ninguém de um pacote. >= 7 dias (até 8,
  // janela da consulta) e ainda na fonte: volta a ser candidato normal. A seção "Voltaram pra
  // lista" afirma "disseram que cadastrou, mas o Emusys ainda não mostra" — por isso só entra quem
  // a fonte AINDA mostra em `migrar` (C1, revisão final). `autorizacao_pendente` é o contrário: o
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

  // ── TRANSIÇÃO DE QUEM JÁ NÃO TEM FILHA PENDENTE (R1, re-revisão) ───────────────────────────
  // O caminho mais comum é o atalho: a equipe avisa no grupo, a filha fecha `done` NA HORA, e a
  // fonte só muda pra autorizacao_pendente dias depois. Olhando só filha pendente, a transição nunca
  // era gravada: dias 1–6 o cliente ficava fora como "informado", no dia 7 voltava como 🔵 no topo
  // do lote e, a partir daí, a filha nova nascia com origem autorizacao_pendente (nunca mais
  // "transição") e era carregada todo dia até a 1ª cobrança — travando o lote. Por isso, A CADA
  // execução: vínculos `migrar` sem transicao_em (filha em qualquer status, criados nos últimos
  // JANELA_VINCULO_SEM_TRANSICAO_DIAS dias) cujo cliente a fonte AGORA mostra em
  // autorizacao_pendente -> grava transicao_em = hoje (todos os vínculos do cliente num único
  // UPDATE) e o cliente já entra na carência nesta execução, mesmo que a gravação falhe (a próxima
  // execução acha o mesmo vínculo ainda nulo e tenta de novo). Erro na leitura: falha-aberta.
  const todasPorChave = new Map(todasAsLinhas.filter((l) => l && l.pagador_chave).map((l) => [l.pagador_chave, l]));
  const tentouTransicao = new Set(); // task_ids cuja transição esta execução já tentou gravar
  try {
    const desdeVinculo = pura.somaDiasYmd(hoje, -pura.JANELA_VINCULO_SEM_TRANSICAO_DIAS);
    const vinculosSemT = await vinculosSemTransicao({ unidadeId, desdeYmd: desdeVinculo });
    const porCliente = new Map();
    for (const v of vinculosSemT || []) {
      if (!v || !v.task_id || !v.pagador_chave) continue;
      const naFonte = todasPorChave.get(v.pagador_chave);
      if (!naFonte || naFonte.categoria !== 'autorizacao_pendente') continue;
      if (!porCliente.has(v.pagador_chave)) porCliente.set(v.pagador_chave, []);
      porCliente.get(v.pagador_chave).push(v.task_id);
    }
    for (const [chave, taskIds] of porCliente) {
      carenciaSet.add(chave);
      taskIds.forEach((id) => tentouTransicao.add(id));
      if (!(await marcarTransicao({ taskIds, hoje }))) {
        avisos.push(`não consegui gravar a transição da(s) filha(s) ${taskIds.map(_id8).join(', ')}`);
      }
    }
  } catch (e) {
    avisos.push(`não consegui ler os vínculos sem transição: ${(e && e.message) || String(e)}`);
  }

  // Todo retorno depois daqui sai por este molde — os avisos acumulados SEMPRE entram no motivo.
  const retorno = (campos) => ({ ...vazio, total, voltaram, informadosRecentes, ...campos });
  const motivoCom = (principal) => [principal, ...avisos].filter(Boolean).join('; ') || null;

  let fechadas = 0;
  let carregadasCount = 0;
  try {
    const containers = await containersPix({ groupId });

    // Transições DESTA execução nas filhas PENDENTES (de qualquer pacote): cliente com
    // categoria_origem 'migrar' que a fonte AGORA mostra em 'autorizacao_pendente' — foi
    // cadastrado. Define o destino da filha (`done`); a gravação normalmente já foi feita acima
    // (R1) — só é tentada de novo aqui se a leitura dos vínculos falhou.
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
    const mensagem = (lote) => pura.mensagemDaUnidade({
      unidadeNome, linhas: linhasDaPauta, lote, fonteVelha: false, voltaram, aguardandoCobranca,
    });

    // Destino de UMA filha pendente — sempre pela chave, contra TODAS as linhas da RPC (I4).
    //   'continua'    cliente ainda na pauta (migrar/autorizacao_pendente fora da carência) —
    //                 fica no lote de hoje, ou é carregado (filha velha `cancelled`)
    //   'transicao'   migrar -> autorizacao_pendente (I2): grava transicao_em, `done`
    //   'migrou'      ja_migrou: `done`
    //   'carencia'    já na carência por uma transição anterior: `done` (o cadastro foi feito)
    //   'sem_vinculo' (I3) · 'sumiu' da RPC · 'saiu' pra outra categoria (I4): `cancelled`
    const destinoDa = (f) => {
      if (!f.pagador_chave) return 'sem_vinculo';
      if (transicaoIds.has(f.id)) return 'transicao';
      const naFonte = todasPorChave.get(f.pagador_chave);
      if (!naFonte) return 'sumiu';
      if (naFonte.categoria === 'ja_migrou') return 'migrou';
      if (_naPauta(naFonte)) return naCarencia(naFonte) ? 'carencia' : 'continua';
      return 'saiu';
    };

    // Escreve o destino de uma filha que NÃO fica no lote de hoje. Devolve true se a filha fechou.
    const aplicar = async (f, destino) => {
      if (destino === 'continua') {
        if (await fecharFilha(f.id, 'cancelled')) return true;
        avisos.push(`não consegui cancelar a filha ${_id8(f.id)}`);
        return false;
      }
      if (destino === 'transicao' && !tentouTransicao.has(f.id)
        && !(await marcarTransicao({ taskIds: [f.id], hoje }))) {
        // A filha fecha mesmo assim (o cadastro aconteceu). O vínculo fica com transicao_em nulo e
        // a próxima execução regrava pelo caminho R1 (vínculo sem transição, qualquer status).
        avisos.push(`não consegui gravar a transição da filha ${_id8(f.id)}`);
      }
      const status = (destino === 'transicao' || destino === 'migrou' || destino === 'carencia') ? 'done' : 'cancelled';
      if (await fecharFilha(f.id, status)) { fechadas++; return true; }
      avisos.push(`não consegui ${status === 'done' ? 'fechar' : 'cancelar'} a filha ${_id8(f.id)}`);
      return false;
    };

    const anteriores = containers.filter((c) => c.due_date < hoje);
    const deHoje = containers.filter((c) => c.due_date === hoje);
    const incompletos = deHoje.filter((c) => (c.filhas || []).some((f) => !f.pagador_chave));
    const pacoteDeHoje = deHoje.find((c) => !incompletos.includes(c));

    // 1) I3 — pacote de HOJE incompleto (alguma filha sem vínculo = a criação foi interrompida):
    // desmonta (todas as filhas pendentes + o pacote) e segue pra reconstruir. Quem ainda está na
    // pauta vira carregado do pacote reconstruído. Se QUALQUER escrita da desmontagem falhar, NÃO
    // reconstrói: com o incompleto ainda aberto, um pacote novo seria um segundo pacote do dia.
    const carregadasBrutas = [];
    for (const c of incompletos) {
      let desmontou = true;
      const continuam = [];
      for (const f of c.filhas || []) {
        const destino = destinoDa(f);
        if (!(await aplicar(f, destino))) desmontou = false;
        else if (destino === 'continua') continuam.push(todasPorChave.get(f.pagador_chave));
      }
      if (desmontou && !(await fecharContainer(c.id, 'cancelled'))) {
        avisos.push(`não consegui cancelar o pacote incompleto ${_id8(c.id)}`);
        desmontou = false;
      }
      if (!desmontou) {
        return retorno({
          fechadas,
          motivo: motivoCom('pacote de hoje incompleto (filha sem vínculo) e não consegui desmontá-lo — não reconstruí pra não duplicar'),
        });
      }
      carregadasBrutas.push(...continuam);
    }

    // 2) Pacote de hoje já existe (e está inteiro): não cria nada. Fecha quem saiu (destino de
    // cada filha, I4); o lote são os clientes cujas filhas de hoje continuam, deduplicado. Um
    // pacote anterior ainda aberto (escrita que falhou num dia anterior) é fechado aqui — o novo
    // já existe, então não há o que esperar.
    if (pacoteDeHoje) {
      for (const c of anteriores) {
        for (const f of c.filhas || []) {
          const destino = destinoDa(f);
          if ((await aplicar(f, destino)) && destino === 'continua') carregadasCount++;
        }
        if (!(await fecharContainer(c.id, 'done'))) avisos.push(`não consegui fechar o pacote velho ${_id8(c.id)}`);
      }
      const loteBruto = [];
      for (const f of pacoteDeHoje.filhas || []) {
        const destino = destinoDa(f);
        if (destino === 'continua') loteBruto.push(todasPorChave.get(f.pagador_chave));
        else await aplicar(f, destino);
      }
      const lote = _dedupPorChave(loteBruto);
      return retorno({
        jaExistia: true, lote, fechadas, carregadas: carregadasCount, texto: mensagem(lote), motivo: motivoCom(null),
      });
    }

    // 3) Sem pacote de hoje: PLANEJA sem escrever nada no anterior (I3). Carregados = filhas
    // velhas cujo cliente continua na pauta (prioridade, sempre primeiro); o lote do dia só
    // completa até LOTE_DIARIO (I1). Informados há menos de 7 dias não entram como novos.
    const planoAnterior = [];
    for (const c of anteriores) {
      for (const f of c.filhas || []) {
        const destino = destinoDa(f);
        planoAnterior.push({ f, destino });
        if (destino === 'continua') carregadasBrutas.push(todasPorChave.get(f.pagador_chave));
      }
    }
    const carregadas = _dedupPorChave(pura.ordenarPorPrioridade(carregadasBrutas));
    carregadasCount = carregadas.length;
    const chavesCarregadas = new Set(carregadas.map((l) => l.pagador_chave));
    const demais = linhasDaPauta.filter((l) => !recentesSet.has(l.pagador_chave) && !chavesCarregadas.has(l.pagador_chave));
    const resto = pura.loteDoDia(demais, { tamanho: Math.max(0, pura.LOTE_DIARIO - carregadas.length) });
    const lote = _dedupPorChave([...carregadas, ...resto]);

    // TETO_FILHAS é TRAVA DURA (spec: "acima disso, não cria e registra o motivo"): nunca corta o
    // lote em silêncio. Só dispara se o carry-over sozinho passar do teto (vários pacotes velhos
    // abertos) — aí é defeito pra alguém olhar, não dia normal. Anterior intacto.
    if (lote.length > pura.TETO_FILHAS) {
      return retorno({
        carregadas: carregadasCount,
        motivo: motivoCom(`lote de ${lote.length} clientes passa do teto de ${pura.TETO_FILHAS} filhas — não criei o pacote`),
      });
    }

    const fecharAnteriores = async () => {
      for (const { f, destino } of planoAnterior) await aplicar(f, destino);
      for (const c of anteriores) {
        if (!(await fecharContainer(c.id, 'done'))) avisos.push(`não consegui fechar o pacote velho ${_id8(c.id)}`);
      }
    };

    if (!lote.length) {
      // Nada a criar, então não há pacote novo pra esperar: o anterior fecha já.
      await fecharAnteriores();
      if (!linhas.length) {
        // Único caminho que marca semCliente: true — sucesso (a fonte respondeu, o painel foi
        // lido/escrito), só que não há ninguém a migrar hoje; decisaoDaPublicacaoPix lê este flag
        // pra NÃO publicar nada (fila vazia é notícia boa, não falha).
        return retorno({ fechadas, semCliente: true, motivo: motivoCom('sem cliente a migrar') });
      }
      // Lote vazio LEGÍTIMO (I3): há clientes na pauta, mas todos estão na carência da 1ª cobrança
      // ou foram informados há menos de 7 dias. É informação real — publica as contagens.
      return retorno({ fechadas, texto: mensagem([]), motivo: motivoCom(null) });
    }

    // createTaskGroup (task-groups.js) insere linha a linha SEM transação: um insert que falhe no
    // meio deixa mãe+filhas parciais já commitadas e LANÇA. É por isso que só esta chamada, entre
    // todas as escritas do ritual, tem try/catch dedicado. O resto parcial é desmontado na
    // próxima execução (passo 1). Anterior intacto.
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
      // Falha de ESCRITA do painel (a fonte respondeu bem) — nem fonteFalhou nem semCliente:
      // `texto: null` aqui significa "não consegui montar o lote", não "não há nada a mostrar".
      return retorno({
        carregadas: carregadasCount,
        motivo: motivoCom(`não consegui criar o pacote: ${(e && e.message) || String(e)}`),
      });
    }

    // Grava o vínculo task_id -> pagador_chave (+ categoria_origem) pra cada filha recém-criada,
    // na MESMA ordem de `lote` (createTaskGroup insere as filhas na ordem de `input.subtasks`, que
    // veio de `lote.map(...)` acima — é essa ordem que garante o pareamento childIds[i] <->
    // lote[i]). Filha a menos que o lote, ou vínculo que não gravou: o pacote novo está
    // incompleto — falha de painel, anterior intacto; a próxima execução desmonta e refaz.
    const childIds = (criado && criado.childIds) || [];
    const vinculos = lote
      .map((l, i) => ({
        task_id: childIds[i], pagador_chave: l.pagador_chave, unidade_id: unidadeId, categoria_origem: l.categoria,
      }))
      .filter((v) => v.task_id);
    if (vinculos.length !== lote.length || !(await vincular(vinculos))) {
      return retorno({
        carregadas: carregadasCount,
        motivo: motivoCom('não consegui gravar o vínculo pagador-tarefa do pacote novo — o anterior ficou intacto e o novo é refeito na próxima execução'),
      });
    }

    // Só agora, com o pacote novo criado E vinculado, o anterior é fechado (I3).
    await fecharAnteriores();
    return retorno({
      criou: true, lote, fechadas, carregadas: carregadasCount, texto: mensagem(lote), motivo: motivoCom(null),
    });
  } catch (e) {
    // Falha ao LER o painel (containersPix, que lança em erro do Supabase por não ter outro jeito
    // de sinalizar "não consegui nem checar o que já existe") cai aqui — nunca sobe pro chamador.
    // Nem fonteFalhou nem semCliente (os dois já vêm `false` de `vazio`). Os avisos já acumulados
    // não podem sumir só porque o painel falhou depois.
    return retorno({
      fechadas, carregadas: carregadasCount,
      motivo: motivoCom(`falha ao processar o painel do PIX: ${(e && e.message) || String(e)}`),
    });
  }
}

module.exports = { PREFIXO_CONTAINER, pautaPixDaUnidade };
