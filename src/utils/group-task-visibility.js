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
 * mãe-template. Mantém a ordem original. Não muta a entrada.
 *
 * GROUPPKG-FILHA-TEMPLATE-VAZA-MOLDE-CANCELADO (caso Rose 12/08/2026): derivar os ids de
 * molde SÓ do array recebido é um buraco, porque as queries que alimentam este helper
 * filtram `status != cancelled`. Molde cancelado sai do result set, o conjunto fica sem
 * ele, e as filhas-template dele vazam pra lista como tarefas reais — mesmo título, mesma
 * data e sem `recurrence_rule` próprio pra denunciá-las. Foi o que fez o TOM concluir 10
 * tarefas erradas: o molde da Conciliação foi cancelado em 09/08 e o pedido veio em 12/08.
 *
 * Por isso `idsDeMolde` — a mesma disciplina que `escondeMoldeComInstancia` já aplica logo
 * abaixo: o conjunto de exclusão vem do BANCO, não da página já filtrada. Ele COMPÕE com os
 * ids derivados do array (não substitui), e omiti-lo preserva o comportamento legado.
 *
 * @param {Array<{id,is_group?,recurrence_rule?,parent_task_id?}>} tasks
 * @param {Set<string>|Array<string>} [idsDeMolde] ids de mãe-template vindos do banco,
 *   consultados SEM filtro de status.
 * @returns {Array}
 */
function filterVisibleGroupTasks(tasks, idsDeMolde) {
  const arr = Array.isArray(tasks) ? tasks : [];
  const templateIds = new Set(arr.filter(isRecurringTemplate).map((t) => t.id));
  if (idsDeMolde) for (const id of idsDeMolde) templateIds.add(String(id));
  // VERDADE ÚNICA (Fatia 2): o marcador intrínseco `is_recurrence_template` fecha, por
  // construção, a borda que o parentesco só pegava com o round-trip idsDeMoldeDosPais (molde
  // cancelado fora da página). REFORÇA — compõe com a lógica de parentesco, nunca esconde
  // MENOS que o legado; degrada pro comportamento antigo se a coluna não vier no select. A
  // remoção da maquinaria de parentesco fica pra Fatia 5, quando o flag estiver provado.
  return arr.filter((t) => t && !isRecurringTemplate(t) && t.is_recurrence_template !== true
    && !templateIds.has(t.parent_task_id));
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

// ── GROUPCHAT-POOL-RECUR-TEMPLATE-INVISIBLE (caso Rose 06/08) ────────────────────────
// Molde recorrente = tem regra e não tem pai. Note que é DIFERENTE de isRecurringTemplate
// acima, que exige `is_group` (mãe-template de PACOTE). Uma tarefa mensal simples de grupo
// tem is_group=false e não era coberta por aquela regra — nem precisava, porque a query do
// pool a eliminava antes, com `.is('recurrence_rule', null)`.
function ehMoldeRecorrente(t) {
  return !!(t && t.recurrence_rule != null && !t.recurrence_parent_id);
}

/**
 * Esconde o molde recorrente APENAS quando ele já tem instância viva — que é o caso que a
 * regra de 12/06 existe para resolver (TOM via molde + instância e cobrava em dobro).
 * Sem instância, o molde É a ocorrência corrente e precisa aparecer: escondê-lo fez a Rose
 * ouvir "essa tarefa não existe no grupo" sobre trabalho que estava na tela dela.
 *
 * `idsComInstanciaViva` vem de consulta ao BANCO, não da página buscada: se a instância
 * existir mas cair fora do limite da página, decidir pela página reintroduz a duplicata.
 *
 * @param {Array} tasks
 * @param {Set<string>} idsComInstanciaViva
 * @returns {Array} nova lista; não muta a entrada
 */
function escondeMoldeComInstancia(tasks, idsComInstanciaViva) {
  const ids = idsComInstanciaViva instanceof Set ? idsComInstanciaViva : new Set(idsComInstanciaViva || []);
  return (Array.isArray(tasks) ? tasks : [])
    .filter((t) => t && !(ehMoldeRecorrente(t) && ids.has(String(t.id))));
}

/**
 * Resolve, NO BANCO, quais `parent_task_id` da lista são molde recorrente — a fonte do
 * `idsDeMolde` de `filterVisibleGroupTasks`.
 *
 * A consulta é deliberadamente SEM filtro de status: é justamente o molde cancelado (ou
 * concluído) que some do result set dos chamadores e faz a filha-template vazar. Filtrar
 * status aqui reintroduziria o bug que esta função existe pra fechar.
 *
 * Best-effort: o digest do grupo e o contexto do TOM não podem cair por causa disto —
 * falha degrada pro comportamento legado (a fantasma volta), nunca derruba o envio.
 *
 * @param {Object} supabase
 * @param {Array<{parent_task_id?:string}>} tasks
 * @returns {Promise<Set<string>>}
 */
async function idsDeMoldeDosPais(supabase, tasks) {
  const pais = [...new Set((Array.isArray(tasks) ? tasks : [])
    .map((t) => t && t.parent_task_id).filter(Boolean).map(String))];
  if (!pais.length) return new Set();
  try {
    const { data } = await supabase.from('tasks')
      .select('id').in('id', pais).not('recurrence_rule', 'is', null);
    return new Set((data || []).map((r) => String(r.id)));
  } catch (e) {
    console.error('[group-visibility] idsDeMoldeDosPais:', e.message);
    return new Set();
  }
}

module.exports = { filterVisibleGroupTasks, isRecurringTemplate, dropPackageContainers,
  ehMoldeRecorrente, escondeMoldeComInstancia, idsDeMoldeDosPais };
