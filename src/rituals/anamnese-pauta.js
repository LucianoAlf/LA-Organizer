'use strict';
// Ritual da pauta de anamnese. Orquestra e mais nada: quem decide é src/services/anamnese-pauta
// (puro) e src/services/anamnese-pauta-repo (banco). Aqui só busca, decide o dia, monta o
// pacote e devolve o relatório do que aconteceu — falha fechada em cada ponto que pode mentir.
// Ver docs/superpowers/specs/2026-09-03-pauta-de-anamnese-design.md.

const situ = require('../services/situacao-aluno');
const pura = require('../services/anamnese-pauta');
const repoPadrao = require('../services/anamnese-pauta-repo');

// O pico medido em 03/09 foi 80 (Campo Grande, terça), 759 alunos sem anamnese nas três
// unidades no total. 120 não é pra caber no normal — é pra GRITAR se a base ou a conta mudar.
// Doze filhas de quarenta e três é pior que zero (o time confia na lista e 31 passam batido);
// acima do teto o raciocínio é o mesmo, só que na ponta de cima.
const TETO_FILHAS = 120;

// `hoje` chega em "YYYY-MM-DD", já no dia certo em BRT (é o formato de nowSaoPaulo().ymd).
// Quebramos a string em dígitos e construímos a data em UTC EXPLÍCITO com Date.UTC + getUTCDay.
// NUNCA `new Date(hoje).getDay()`: essa forma faz o motor ler "YYYY-MM-DD" como MEIA-NOITE UTC
// e depois devolver o dia da semana em hora LOCAL DO PROCESSO. Numa VPS rodando em UTC os dois
// coincidem por sorte; no dia em que alguém setar TZ=America/Sao_Paulo, aquela mesma meia-noite
// UTC vira 21h do dia ANTERIOR e a pauta inteira sai um dia adiantada — em silêncio, sem
// exception nenhuma pra avisar (known issue desta casa: LOCALYMD-UTC-SHIFT). getUTCDay() sobre
// Date.UTC() nunca lê hora local, então é imune ao fuso do processo que roda o código.
function _diaSemanaBrt(hoje) {
  const [y, m, d] = String(hoje || '').split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Título do CONTAINER da pauta do dia. Ponto ÚNICO de verdade: é chamado tanto pra CONSULTAR se
// já existe (guarda de duplicata, abaixo) quanto pra CRIAR. Se cada lado montasse o texto
// inline, os dois poderiam divergir por um espaço ou um emoji e a guarda ficaria cega pro
// próprio container — o bug de duplicata a cada retry do cron voltaria calado.
function _tituloDoContainer(hoje) {
  const [, mesStr, diaStr] = String(hoje || '').split('-');
  return `📋 Anamnese — quem tem aula hoje · ${diaStr}/${mesStr}`;
}

// Já existe container da pauta pra este (groupId, hoje)? Por quê isto existe: createTaskGroup
// (task-groups.js) insere linha a linha SEM transação. Com 43-80 filhas, um insert que falhe no
// meio deixa mãe + filhas 1..N-1 JÁ COMMITADAS e a função lança — esse throw, sem esta guarda,
// subiria até o catch genérico do dispatcher, que loga e NÃO grava marcador (o insert do
// marcador vem depois desta chamada). O cron de 5 min bate de novo, não acha marcador, e monta
// tudo outra vez: meio-container antigo + container inteiro novo no painel da unidade. A spec
// quer a retentativa — bloqueá-la seria errado. O que tem que mudar é a retentativa SER segura:
// por isso checamos aqui antes de criar de novo, e não desfazemos containers antigos.
async function _pacoteJaExiste(supabase, { groupId, hoje, titulo }) {
  const { data, error } = await supabase.from('tasks').select('id')
    .eq('assigned_group_id', groupId).eq('due_date', hoje)
    .eq('is_group', true).eq('title', titulo).limit(1);
  if (error) return { existe: null, erro: error.message };
  return { existe: (data || []).length > 0, erro: null };
}

async function montarPautaDaUnidade({ supabase, laReport, unidadeId, groupId, criadoPor, hoje, deps = {} }) {
  const repo = deps.repo || repoPadrao;
  const pacoteExiste = deps.pacoteExiste || _pacoteJaExiste;
  const criarPacote = deps.criarPacote
    || ((arg) => require('../services/task-groups').createTaskGroup(arg));

  const diaSemana = _diaSemanaBrt(hoje);
  // Guarda barata (apontada na revisão da Task 2): diaDaAula() devolve `null` pra aula sem dia
  // reconhecível no texto do resumo. Se diaSemana chegasse `null`/`NaN` em pautaDoDia, a
  // comparação `diaDaAula(a) === diaSemana` casaria (null === null) com QUALQUER aula torta e
  // inflaria a pauta com gente que não tem aula nenhuma hoje. Falha fechada em vez de confiar
  // cegamente que _diaSemanaBrt sempre devolve um inteiro 0–6. Checada ANTES de tudo: um `hoje`
  // torto não deveria nem chegar perto de montar título ou consultar duplicata.
  if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
    return { criou: false, total: 0, escalados: 0, motivo: `dia da semana inválido para hoje="${hoje}"`, itens: [] };
  }

  // FALHA-FECHADA #0 (retentativa segura): container pra este (groupId, hoje) já existe? Checa
  // ANTES da RPC do LA Report (que leva 6-8s, ver situacao-aluno.js) — barato, e evita bater a
  // consulta lenta de novo num retry cujo resultado vai ser descartado de qualquer jeito.
  const titulo = _tituloDoContainer(hoje);
  const checagem = await pacoteExiste(supabase, { groupId, hoje, titulo });
  if (checagem.erro) {
    // Não dá pra afirmar que NÃO existe container quando a leitura falhou — "não sei" nunca
    // pode virar "não tem", ou criaríamos um duplicado no escuro. Sensor próprio: este motivo
    // nunca é igual ao de "já existe" (abaixo) nem ao de erro de RPC.
    return {
      criou: false, total: 0, escalados: 0, itens: [],
      motivo: `não consegui checar se a pauta já existe: ${checagem.erro}`,
    };
  }
  if (checagem.existe) {
    // Sensor próprio: "não criei porque já tinha" tem que ser TEXTUALMENTE diferente de "não
    // criei porque falhou" (RPC, teto, escrita) — senão quem lê o resultado não distingue os
    // casos, que é exatamente o problema que motivou esta rodada de correção.
    return { criou: false, total: 0, escalados: 0, motivo: 'pauta já montada hoje', itens: [] };
  }

  // Sempre checar `error`: consulta com coluna errada devolve {data:null,error} e viraria
  // "zero linhas" silencioso (já custou dois diagnósticos errados nesta casa em 03/09).
  const { data, error } = await laReport.rpc('get_situacao_alunos_v1',
    { p_unidade_id: unidadeId, p_apenas_pendentes: false });
  if (error) {
    // FALHA-FECHADA #1: RPC não respondeu → não cria NADA. Motivo tem sensor próprio (menciona
    // a consulta/o erro) pra nunca sair idêntico ao motivo de "pauta vazia por saúde".
    return { criou: false, total: 0, escalados: 0, motivo: `consulta do LA Report falhou: ${error.message}`, itens: [] };
  }

  // Fonte ÚNICA de "sem anamnese" — se a pauta reimplementasse o filtro, um dia o card diria
  // 225 e a pauta 231, e ninguém confiaria em nenhum dos dois.
  const semAnamnese = situ.filtrarPorRecorte(data || [], 'anamnese');
  const itens = pura.pautaDoDia(semAnamnese, diaSemana);
  if (!itens.length) {
    // Pauta vazia por SAÚDE (ninguém sem anamnese tem aula hoje) — motivo null, nunca uma
    // string de erro. É o sensor que distingue "zero por falha" de "zero por saúde".
    return { criou: false, total: 0, escalados: 0, motivo: null, itens: [] };
  }

  if (itens.length > TETO_FILHAS) {
    // FALHA-FECHADA #2: acima do teto de sanidade → não cria NADA. `total` carrega o tamanho
    // real (útil pra diagnosticar), mas `motivo` menciona "teto" — sensor próprio, nunca
    // idêntico ao motivo de erro de RPC nem ao de pauta vazia (que é null).
    return {
      criou: false, total: itens.length, escalados: 0, itens: [],
      motivo: `teto de sanidade: ${itens.length} alunos (máximo ${TETO_FILHAS}) — não montei a pauta`,
    };
  }

  // Falhas de HISTÓRICO (antes de registrar a aparição de hoje) decidem quem escala.
  // `mapa` pode vir `null` quando a leitura falhar — repassamos pro puro exatamente como veio:
  // separarPorDegrau já trata `null` como "ninguém escala" (nunca escalar no escuro). Trocar
  // por `new Map()` aqui anularia essa trava e faria a casa escalar gente sem prova de falha.
  const mapa = await repo.contarFalhas(supabase, { unidadeId, pessoas: itens.map((i) => i.pessoa.pessoa_chave) });
  const { pauta, escalados } = pura.separarPorDegrau(itens, mapa);

  // Chamada que ESCREVE não pode explodir pra fora: um throw aqui subiria até o catch genérico
  // do dispatcher, que loga e não grava marcador (o insert do marcador vem DEPOIS desta
  // chamada) — o cron de 5 min bateria de novo, cairia na guarda de duplicata acima (que ainda
  // não veria nada criado, pois nada foi) e tentaria tudo de novo. Isso já é seguro por causa da
  // guarda #0; mesmo assim devolvemos o motivo real em vez de deixar a exception subir crua e
  // quebrar o contrato de retorno documentado ({criou,total,escalados,motivo,itens}).
  try {
    await repo.registrarAparicoes(supabase, {
      unidadeId, dia: hoje, pessoas: itens.map((i) => i.pessoa.pessoa_chave),
    });
  } catch (e) {
    return {
      criou: false, total: pauta.length, escalados: escalados.length, itens: [],
      motivo: `falha ao registrar aparições de hoje: ${(e && e.message) || String(e)}`,
    };
  }

  try {
    // createTaskGroup (task-groups.js:62-93) insere linha a linha, SEM transação — com 43-80
    // filhas, um insert que falhe no meio deixa mãe+filhas parciais já commitadas e lança. A
    // guarda #0 no topo desta função é quem torna o PRÓXIMO retry seguro (não duplica o
    // meio-container órfão que este catch não desfaz e não tenta desfazer); consertar a criação
    // em si pra ser atômica é cirurgia de outro dia em task-groups.js — fora do escopo aqui.
    await criarPacote({
      supabase, groupId, createdBy: criadoPor,
      input: {
        title: titulo,
        recurrence: null,
        groupDueDate: hoje,
        subtasks: pauta.map((i) => ({ title: pura.tituloDaFilha(i, i.falhas), dueDate: hoje })),
      },
    });
  } catch (e) {
    return {
      criou: false, total: pauta.length, escalados: escalados.length, itens: [],
      motivo: `falha ao criar o pacote de tarefas: ${(e && e.message) || String(e)}`,
    };
  }

  return {
    criou: true, total: pauta.length, escalados: escalados.length, motivo: null,
    itens: pauta, escaladosItens: escalados,
  };
}

module.exports = { montarPautaDaUnidade, TETO_FILHAS };
