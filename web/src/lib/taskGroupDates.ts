// web/src/lib/taskGroupDates.ts
// Helpers PUROS de data pra grupos de tarefas. ESPELHO: src/services/task-group-dates.js
// (manter em paridade — o motor backend usa a versão CJS).

const pad = (n: number) => String(n).padStart(2, '0')

/** Último dia do mês (1-12). */
function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** YMD pra um dia-do-mês no mês de referência, com clamp (31→30, 30→28 em fev). */
export function dayOfMonthToYmd(day: number, refYmd: string): string {
  const [y, m] = refYmd.split('-').map(Number)
  return `${y}-${pad(m)}-${pad(Math.min(day, lastDay(y, m)))}`
}

/**
 * Due da filha-instância: MESMO dia-do-mês da filha-template, no mês do ciclo
 * (= mês do due da mãe-instância), com clamp em mês curto.
 */
export function childDueDateForCycle(childTemplateDueYmd: string, motherInstanceDueYmd: string): string {
  const childDay = Number(childTemplateDueYmd.split('-')[2])
  return dayOfMonthToYmd(childDay, motherInstanceDueYmd)
}

/** Label do ciclo pro card ("junho"). */
export function cycleLabel(motherInstanceDueYmd: string): string {
  const [y, m] = motherInstanceDueYmd.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 15)))
}
