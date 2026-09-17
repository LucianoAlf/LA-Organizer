'use strict';
// pix-migracao.js — RITUAL: lê a fonte (LA Report), mantém no máximo um pacote "PIX" aberto por
// grupo no painel de tarefas (lote do dia, até 10 clientes, carregando quem ficou pendente de
// ontem, fechando quem saiu da fonte) e devolve o texto pronto (mensagemDaUnidade, camada pura).
// NUNCA manda WhatsApp — quem publica é o dispatcher (tarefa seguinte desta pauta).
//
// Espelha o padrão de src/rituals/anamnese-pauta.js: toda chamada ao Supabase checa `error`;
// falha de ESCRITA (fechar filha/container) nunca lança — vira aviso, devolvido em `motivo`. A
// única exceção é a criação do pacote (createTaskGroup, que insere linha a linha SEM transação —
// ver o comentário de montarPautaDaUnidade): essa SIM pode lançar, e por isso é a única chamada
// envolta em try/catch dedicado, igual ao ritual da anamnese.

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

// ── deps padrão (Supabase real) ──────────────────────────────────────────────────────────────
// Todas fecham sobre `supabase` por closure — mesmo padrão de `criarPacote` em
// montarPautaDaUnidade (anamnese-pauta.js), pra que os testes injetem `deps` sem precisar de
// banco e o caminho real não precise passar `supabase` em cada chamada.

// Só pacotes PIX (título começa com PREFIXO_CONTAINER) com status 'pending', e só as filhas
// 'pending' de cada um — mesmo par de consultas de _listarContainersVelhosAbertos +
// _listarFilhasPendentes em anamnese-pauta.js, sem o corte por due_date (quem decide o que é
// "hoje" e o que é "velho" é o chamador, que tem `hoje` disponível).
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
    containers.push({ id: c.id, title: c.title, due_date: c.due_date, filhas: filhas || [] });
  }
  return containers;
}

// Só fecha se ainda está 'pending' (evita corrida com quem já fechou por fora). Nunca lança —
// erro de escrita vira `false` (o chamador registra em `motivo`), igual a _fecharFilha de
// anamnese-pauta.js.
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

// ── ritual ────────────────────────────────────────────────────────────────────────────────────
async function pautaPixDaUnidade({ supabase, laReport, unidadeId, unidadeNome, groupId, criadoPor, hoje, deps = {} }) {
  const agora = deps.agora || (() => Date.now());
  const containersPix = deps.containersPix || ((arg) => _containersPixPadrao(supabase, arg));
  const criarPacote = deps.criarPacote
    || ((arg) => require('../services/task-groups').createTaskGroup(arg));
  const fecharFilha = deps.fecharFilha || ((id, status) => _fecharFilhaPadrao(supabase, id, status));
  const fecharContainer = deps.fecharContainer || ((id) => _fecharContainerPadrao(supabase, id));

  const vazio = {
    criou: false, jaExistia: false, total: 0, lote: [], fechadas: 0, carregadas: 0,
    texto: null, motivo: null, fonteVelha: false,
  };

  // Sempre checar `error`: RPC com parâmetro errado devolve {data:null,error} e viraria "zero
  // clientes" silencioso — a fonte pareceria vazia (ou pior, "ninguém a migrar") em vez de quebrada.
  const { data, error } = await consultaComRetry(() => laReport.rpc('get_pix_migracao_v1',
    { p_unidade_id: unidadeId, p_fatia: null }));
  if (error) {
    return { ...vazio, motivo: `consulta do LA Report falhou: ${error.message}` };
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
  const porTitulo = new Map(linhas.map((l) => [pura.tituloDaFilha(l), l]));

  const avisos = [];
  try {
    const containers = await containersPix({ groupId });

    // 1) Pacotes anteriores (due_date < hoje) ainda abertos: quem continua na fonte é CARREGADO
    // pro lote de hoje — a filha velha vira `cancelled` (não `done`: ela não deixou de ser feita,
    // só não coube ontem), e o cliente entra PRIMEIRO no lote de hoje. Quem saiu da fonte vira
    // `done` (conta em `fechadas`). O pacote antigo sempre fecha no final, independente do que
    // aconteceu com as filhas.
    let fechadas = 0;
    const carregadasBrutas = [];
    for (const c of containers.filter((x) => x.due_date < hoje)) {
      for (const f of c.filhas || []) {
        const linhaDaFonte = porTitulo.get(f.title);
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
    // De-dup por pagador_chave (defesa: dois containers velhos nunca deveriam citar o mesmo
    // cliente, mas duplicar a filha no lote de hoje seria pior que ignorar a repetição) e ordena
    // por prioridade — se mais de um cliente foi carregado, quem tem fatia mais urgente entra
    // primeiro entre os próprios carregados também.
    const vistos = new Set();
    const carregadas = pura.ordenarPorPrioridade(carregadasBrutas)
      .filter((l) => (vistos.has(l.pagador_chave) ? false : (vistos.add(l.pagador_chave), true)));

    const containerHoje = containers.find((c) => c.due_date === hoje);

    // 2) Pacote de hoje já existe: não cria nada. Só fecha (`done`) quem saiu da fonte; o lote
    // devolvido são os clientes cujas filhas de hoje continuam pendentes.
    if (containerHoje) {
      for (const f of containerHoje.filhas || []) {
        if (porTitulo.has(f.title)) continue;
        if (await fecharFilha(f.id, 'done')) fechadas++;
        else avisos.push(`não consegui fechar a filha "${f.title}"`);
      }
      const lote = (containerHoje.filhas || [])
        .filter((f) => porTitulo.has(f.title))
        .map((f) => porTitulo.get(f.title));
      return {
        criou: false, jaExistia: true, total, lote, fechadas, carregadas: carregadas.length,
        texto: pura.mensagemDaUnidade({ unidadeNome, linhas, lote, fonteVelha: false }),
        motivo: avisos.length ? avisos.join('; ') : null, fonteVelha: false,
      };
    }

    // 3) Pacote de hoje não existe: lote = carregados (prioridade, sempre primeiro) + o lote do
    // dia (loteDoDia, camada pura) dos demais clientes da fonte, excluindo os carregados. Teto de
    // sanidade por cima: nunca mais que TETO_FILHAS, mesmo quando o carry-over empilha em cima de
    // um lote normal de 10.
    const chavesCarregadas = new Set(carregadas.map((l) => l.pagador_chave));
    const demais = linhas.filter((l) => !chavesCarregadas.has(l.pagador_chave));
    const resto = pura.loteDoDia(demais);
    let lote = [...carregadas, ...resto];
    if (lote.length > pura.TETO_FILHAS) lote = lote.slice(0, pura.TETO_FILHAS);

    if (!lote.length) {
      return {
        criou: false, jaExistia: false, total, lote: [], fechadas, carregadas: carregadas.length,
        texto: null, motivo: 'sem cliente a migrar', fonteVelha: false,
      };
    }

    // createTaskGroup (task-groups.js) insere linha a linha SEM transação: um insert que falhe no
    // meio deixa mãe+filhas parciais já commitadas e LANÇA. É por isso que só esta chamada, entre
    // todas as escritas do ritual, tem try/catch dedicado — mesma lógica de montarPautaDaUnidade.
    try {
      await criarPacote({
        supabase, groupId, createdBy: criadoPor,
        input: {
          title: _tituloContainerDoDia(hoje), recurrence: null, groupDueDate: hoje,
          subtasks: lote.map((l) => ({ title: pura.tituloDaFilha(l), dueDate: hoje })),
        },
      });
    } catch (e) {
      return {
        criou: false, jaExistia: false, total, lote: [], fechadas, carregadas: carregadas.length,
        texto: null, motivo: `não consegui criar o pacote: ${(e && e.message) || String(e)}`,
        fonteVelha: false,
      };
    }

    return {
      criou: true, jaExistia: false, total, lote, fechadas, carregadas: carregadas.length,
      texto: pura.mensagemDaUnidade({ unidadeNome, linhas, lote, fonteVelha: false }),
      motivo: avisos.length ? avisos.join('; ') : null, fonteVelha: false,
    };
  } catch (e) {
    // Falha ao LER o painel (containersPix) cai aqui — nunca deveria acontecer com os deps
    // padrão (que também nunca lançam em erro de leitura... exceto o próprio containersPix, que
    // lança por não ter outro jeito de sinalizar "não consegui nem checar o que já existe").
    return { ...vazio, total, motivo: `falha ao processar o painel do PIX: ${(e && e.message) || String(e)}` };
  }
}

module.exports = { PREFIXO_CONTAINER, pautaPixDaUnidade };
