// All app dates use America/Sao_Paulo as canonical timezone.
// DB columns are date or timestamptz; we always render in SP.

const SP = 'America/Sao_Paulo';

const ymdFmtSP = new Intl.DateTimeFormat('en-CA', {
  timeZone: SP, year: 'numeric', month: '2-digit', day: '2-digit',
});

export function todaySP(): string {
  return ymdFmtSP.format(new Date());
}

/** YMD (YYYY-MM-DD) de um Date no fuso SP. Nunca usar toISOString().slice(0, 10)
 *  pra isso: é UTC e desloca o dia civil a partir das 21h BRT. */
export function localYmd(d: Date): string {
  return ymdFmtSP.format(d);
}

/** YYYY-MM-DD + days (positive or negative). */
export function ymdAddDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Returns Mon..Sun labels for a YMD. */
export function dowShort(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][dt.getUTCDay()];
}

/** YYYY-MM-DD -> DD/MM */
export function brShort(ymd: string | null | undefined): string {
  if (!ymd) return '';
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : ymd;
}

/** Returns the Monday YMD of the week containing `ymd`. */
export function startOfWeekMonday(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = dt.getUTCDay(); // 0..6, Sun=0
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** [Mon, Tue, Wed, Thu, Fri] of the week containing `ymd`. */
export function workWeekDays(ymd: string): string[] {
  const start = startOfWeekMonday(ymd);
  return [0, 1, 2, 3, 4].map(i => ymdAddDays(start, i));
}

/** [Mon, Tue, Wed, Thu, Fri, Sat] of the week containing `ymd`. Escola opera sábado. */
export function weekDaysMonSat(ymd: string): string[] {
  const start = startOfWeekMonday(ymd);
  return [0, 1, 2, 3, 4, 5].map(i => ymdAddDays(start, i));
}
