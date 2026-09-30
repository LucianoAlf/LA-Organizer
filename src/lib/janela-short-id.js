// src/lib/janela-short-id.js
// JANELA-60D (caso Peterson 29/09) — que tarefas o resolvedor de short id (resolveTaskByShortId)
// enxerga.
//
// Por que existe uma janela: uuid não suporta LIKE, então o resolvedor puxa as tarefas do
// colaborador (limit 500) e casa o prefixo em JS. A janela de 60 dias (6db469b5, abr/2026) mantém
// esse lote pequeno e tira do caminho as FECHADAS velhas (done/cancelled se acumulam sem parar;
// quanto mais linhas, mais chance de prefixo ambíguo e de estourar o limit).
//
// O erro era aplicar a janela também às ABERTAS: tarefa pendente com prazo > 60 dias sumia do
// resolvedor, o "complete" era REJECTED e ela seguia pendente — enquanto o próprio TOM a listava
// e cobrava. Aberta é pouca e é justamente o que o usuário quer fechar: entra sempre. A janela
// continua valendo só pras fechadas.

'use strict';

const JANELA_FECHADAS_DIAS = 60;
const STATUS_FECHADOS = ['done', 'cancelled'];

/** Data (YYYY-MM-DD, UTC) a partir da qual uma tarefa FECHADA ainda entra. */
function desdeIsoJanela(nowMs = Date.now()) {
  return new Date(nowMs - JANELA_FECHADAS_DIAS * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Filtro .or() do PostgREST: aberta de qualquer idade OU prazo recente OU sem prazo. */
function filtroOrJanelaShortId(sinceIso) {
  return `status.not.in.(${STATUS_FECHADOS.join(',')}),due_date.gte.${sinceIso},due_date.is.null`;
}

/** Espelho JS do filtro (mesma regra), pra teste e pra quem já tem as linhas em mãos. */
function entraNaJanelaShortId(task, sinceIso) {
  if (!task) return false;
  if (!STATUS_FECHADOS.includes(task.status)) return true;
  if (task.due_date == null) return true;
  return String(task.due_date).slice(0, 10) >= sinceIso;
}

module.exports = { JANELA_FECHADAS_DIAS, STATUS_FECHADOS, desdeIsoJanela, filtroOrJanelaShortId, entraNaJanelaShortId };
