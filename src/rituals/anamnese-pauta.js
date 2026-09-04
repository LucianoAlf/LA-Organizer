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

async function montarPautaDaUnidade({ supabase, laReport, unidadeId, groupId, criadoPor, hoje, deps = {} }) {
  const repo = deps.repo || repoPadrao;
  const criarPacote = deps.criarPacote
    || ((arg) => require('../services/task-groups').createTaskGroup(arg));

  // Sempre checar `error`: consulta com coluna errada devolve {data:null,error} e viraria
  // "zero linhas" silencioso (já custou dois diagnósticos errados nesta casa em 03/09).
  const { data, error } = await laReport.rpc('get_situacao_alunos_v1',
    { p_unidade_id: unidadeId, p_apenas_pendentes: false });
  if (error) {
    // FALHA-FECHADA #1: RPC não respondeu → não cria NADA. Motivo tem sensor próprio (menciona
    // a consulta/o erro) pra nunca sair idêntico ao motivo de "pauta vazia por saúde".
    return { criou: false, total: 0, escalados: 0, motivo: `consulta do LA Report falhou: ${error.message}`, itens: [] };
  }

  const diaSemana = _diaSemanaBrt(hoje);
  // Guarda barata (apontada na revisão da Task 2): diaDaAula() devolve `null` pra aula sem dia
  // reconhecível no texto do resumo. Se diaSemana chegasse `null`/`NaN` em pautaDoDia, a
  // comparação `diaDaAula(a) === diaSemana` casaria (null === null) com QUALQUER aula torta e
  // inflaria a pauta com gente que não tem aula nenhuma hoje. Falha fechada em vez de confiar
  // cegamente que _diaSemanaBrt sempre devolve um inteiro 0–6.
  if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
    return { criou: false, total: 0, escalados: 0, motivo: `dia da semana inválido para hoje="${hoje}"`, itens: [] };
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

  // Best-effort: registra quem apareceu hoje pra a escada de AMANHÃ enxergar. Erro aqui não
  // pode travar a pauta de HOJE — a própria anamnese-pauta-repo.js já loga o motivo
  // (console.error) e devolve {erro}; não há decisão adicional a tomar neste ritual.
  await repo.registrarAparicoes(supabase, {
    unidadeId, dia: hoje, pessoas: itens.map((i) => i.pessoa.pessoa_chave),
  });

  const [, mesStr, diaStr] = hoje.split('-');
  await criarPacote({
    supabase, groupId, createdBy: criadoPor,
    input: {
      title: `📋 Anamnese — quem tem aula hoje · ${diaStr}/${mesStr}`,
      recurrence: null,
      groupDueDate: hoje,
      subtasks: pauta.map((i) => ({ title: pura.tituloDaFilha(i, i.falhas), dueDate: hoje })),
    },
  });

  return {
    criou: true, total: pauta.length, escalados: escalados.length, motivo: null,
    itens: pauta, escaladosItens: escalados,
  };
}

module.exports = { montarPautaDaUnidade, TETO_FILHAS };
