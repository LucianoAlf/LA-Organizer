'use strict';

// BRIEFING-FUTURE-TASK-AS-TODAY (26/06) — predicado único "tarefa visível até o dia X",
// reusado pelo FECHAMENTO (cutoff = hoje) e pelo BRIEFING (cutoff = amanhã, p/ preservar o ⏳
// "vence amanhã" da skill rituais-diarios). Antes: o briefing passava a janela de 7 dias
// (lte due_date next7days) crua ao LLM, que listava tarefa futura (Bia, +4d) como "hoje".

// addDaysYmd(ymd, n): soma n dias a um YMD (YYYY-MM-DD) interpretado em BRT, SEM shift de fuso.
// Ancora em 03:00Z (= 00:00 America/Sao_Paulo) e usa setUTCDate — mesma técnica fuso-safe do
// system.js (tomorrowISO). NÃO usar new Date(ymd).setDate(): reintroduz o shift das 21h BRT.
function addDaysYmd(ymd, n) {
  const d = new Date(String(ymd) + 'T03:00:00.000Z');
  if (Number.isNaN(d.getTime())) return ymd; // defensivo: ymd inválido volta intacto
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// isVisibleForDay(t, cutoffYmd): a tarefa entra na lista "até o cutoff" se NÃO tem due (sem
// prazo) OU vence até o cutoff inclusive (pega atrasadas). Corta só o que vence DEPOIS do cutoff.
// Comparação YMD-string em SP (sem Date) — correta porque ambos os lados são YYYY-MM-DD locais.
function isVisibleForDay(t, cutoffYmd) {
  return !t || !t.due_date || String(t.due_date) <= String(cutoffYmd);
}

module.exports = { addDaysYmd, isVisibleForDay };
