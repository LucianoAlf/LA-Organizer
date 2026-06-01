// Gera horários datetime-local "YYYY-MM-DDTHH:MM" de `start` a `end` (HH:MM),
// a cada `stepMin` minutos, todos na data `ymd`. Inclui o `end` se cair no passo.
// Usado pelo gerador de intervalo do RemindersField ("de 13h às 20h, a cada 1h").
export function generateIntervalTimes(
  ymd: string,        // "2026-06-01"
  start: string,      // "13:00"
  end: string,        // "20:00"
  stepMin: number,    // 60 | 30
): string[] {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const s = toMin(start);
  const e = toMin(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || stepMin <= 0 || e < s) return [];
  const out: string[] = [];
  for (let t = s; t <= e; t += stepMin) {
    const hh = String(Math.floor(t / 60)).padStart(2, '0');
    const mm = String(t % 60).padStart(2, '0');
    out.push(`${ymd}T${hh}:${mm}`);
  }
  return out;
}
