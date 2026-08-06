'use strict';
// Visibilidade de tarefas-de-grupo para o TOM — GROUP-RECUR-TEMPLATE-VISIBLE-TO-TOM (caso Rose 12/06).
//
// PORQUÊ: o app cria, POR DESIGN, uma mãe-TEMPLATE recorrente + a mãe-INSTÂNCIA do ciclo corrente
// (web/src/lib/taskGroups.ts createGroup, ramo mensal), e idem para cada subtarefa. O PWA esconde a
// mãe-template (fetchGroupsForDay → `.is('recurrence_rule', null)`), então o usuário vê 1. O contexto
// do TOM (system.js workGroupsCtx.myGroupTasks) NÃO escondia → o TOM via template + instância em dobro
// e reportava "tarefas atrasadas duplicadas" que não apareciam no LA Organizer. Aqui damos ao TOM a
// MESMA visão do app: esconder a mãe-template recorrente e as filhas-template; manter a mãe-instância
// e suas filhas. Função PURA (espelha a regra do PWA; não toca dados — o template é necessário p/
// gerar os ciclos futuros, NÃO deve ser deletado).

function isRecurringTemplate(t) {
  return !!(t && t.is_group && t.recurrence_rule != null);
}

/**
 * Filtra uma lista de tarefas de grupo para a visão correta do TOM: remove a mãe-template
 * recorrente (is_group + recurrence_rule) e qualquer filha cujo parent_task_id seja uma
 * mãe-template presente na lista. Mantém a ordem original. Não muta a entrada.
 *
 * @param {Array<{id,is_group?,recurrence_rule?,parent_task_id?}>} tasks
 * @returns {Array}
 */
function filterVisibleGroupTasks(tasks) {
  const arr = Array.isArray(tasks) ? tasks : [];
  const templateIds = new Set(arr.filter(isRecurringTemplate).map((t) => t.id));
  return arr.filter((t) => t && !isRecurringTemplate(t) && !templateIds.has(t.parent_task_id));
}

/**
 * Remove os CONTAINERS de pacote (is_group=true) de uma lista de tarefas de grupo.
 * GROUPPKG-CONTAINER-COMPLETABLE-1TO1 (caso Rose 03/08/2026).
 *
 * PORQUÊ separado de filterVisibleGroupTasks: aquele esconde só o TEMPLATE recorrente
 * e, por contrato (teste "grupo SEM recorrência passa inteiro"), MANTÉM a mãe-instância
 * — o digest usa isso pra resolver o nome do pacote. Aqui a regra é a outra, já aplicada
 * em group-chat-engine.js e em group-report-builder.js/shapeOpenTasks desde 20/06
 * (GROUPPKG-CONTAINER-PHANTOM-FLATLIST): container é PASTA, não tarefa. Ele herda
 * due_date do dia 1 (BYMONTHDAY=1) enquanto as filhas vencem no meio do mês, então
 * listá-lo cria uma "atrasada" fantasma que, ao ser concluída, fecha a pasta e deixa o
 * trabalho aberto. Compõe com filterVisibleGroupTasks; não muta a entrada.
 *
 * @param {Array<{is_group?:boolean}>} tasks
 * @returns {Array}
 */
function dropPackageContainers(tasks) {
  return (Array.isArray(tasks) ? tasks : []).filter((t) => t && t.is_group !== true);
}

module.exports = { filterVisibleGroupTasks, isRecurringTemplate, dropPackageContainers };
