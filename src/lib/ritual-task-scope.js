'use strict';

// Recorte de tarefas por ritual — o que cada ritual proativo enxerga do dia.
//
// FECHAMENTO-SO-TRABALHO (Jereh 04/09): o escopo do fechamento nasceu grudado no de
// briefing_trabalho (6311e0a7, ramo único "só trabalho"). Quando o briefing virou
// unificado (da579097, Sprint 11.1) ele saiu daquele ramo e o fechamento ficou para
// trás — o dia que o TOM abre com pessoal+trabalho passou a fechar só com trabalho.
//
// Função pura: recebe as listas já montadas e devolve o recorte. `null` significa
// "este ritual não recorta" — o chamador mantém o contexto padrão.

function tasksForRitual(ritualType, ctx = {}, isVisible = null) {
  const personal = Array.isArray(ctx.personalTasks) ? ctx.personalTasks : [];
  const work = Array.isArray(ctx.workTasks) ? ctx.workTasks : [];
  const visivel = typeof isVisible === 'function' ? isVisible : null;
  const cortar = (lista) => (visivel ? lista.filter(visivel) : lista);

  switch (ritualType) {
    case 'briefing_pessoal':
      return { personal: cortar(personal), work: [] };
    case 'briefing_trabalho':
      return { personal: [], work: cortar(work) };
    // O fechamento passa as listas CRUAS: o recorte dele é por dia (cutoff=hoje) e mora
    // no engine (buildClosingItems/isVisibleForDay), não no cutoff do briefing.
    case 'fechamento':
    case 'daily_closing':
      return { personal, work };
    case 'briefing_diario':
    case 'daily_briefing':
      return { personal: cortar(personal), work: cortar(work) };
    default:
      return null;
  }
}

module.exports = { tasksForRitual };
