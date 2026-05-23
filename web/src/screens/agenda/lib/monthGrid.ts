/** Retorna 35 ou 42 datas (5-6 linhas × 7 colunas) cobrindo o mês completo,
 *  começando no domingo da semana do dia 1.
 */
export function getMonthGrid(monthDate: Date): Date[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const startSunday = new Date(first);
  startSunday.setDate(first.getDate() - first.getDay());
  const last = new Date(year, month + 1, 0);
  const totalDays = first.getDay() + last.getDate();
  const daysNeeded = Math.ceil(totalDays / 7) * 7;
  return Array.from({ length: daysNeeded }, (_, i) => {
    const d = new Date(startSunday);
    d.setDate(startSunday.getDate() + i);
    return d;
  });
}
