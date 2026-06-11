// web/src/lib/groupWorkspace.ts
// Workspace de grupos (spec 2026-06-10) — funções PURAS (testáveis sem DB).
// Buckets por urgência espelham o mockup aprovado: Atrasadas → Vence em breve
// (hoje..+7d) → Mais pra frente/sem prazo → Feitas recentemente (mês, máx 10).

export type PoolTaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';

export interface PoolTask {
  id: string; title: string; description: string | null;
  status: PoolTaskStatus; due_date: string | null; due_time: string | null;
  completed_at: string | null; created_by: string | null;
  creator_name: string | null; completed_by_name: string | null;
}

export interface PoolBuckets {
  overdue: PoolTask[]; dueSoon: PoolTask[]; later: PoolTask[]; doneRecent: PoolTask[];
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const NO_DUE_SENTINEL = '9999-12-31'; // sem prazo ordena por último

const byDueAsc = (a: PoolTask, b: PoolTask) =>
  (a.due_date ?? NO_DUE_SENTINEL).localeCompare(b.due_date ?? NO_DUE_SENTINEL);

export function bucketizeGroupTasks(tasks: PoolTask[], todayYmd: string): PoolBuckets {
  const horizon = addDaysYmd(todayYmd, 7);
  const open = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
  const done = tasks.filter(t => t.status === 'done' && t.completed_at != null);
  return {
    overdue: open.filter(t => t.due_date && t.due_date < todayYmd).sort(byDueAsc),
    dueSoon: open.filter(t => t.due_date && t.due_date >= todayYmd && t.due_date <= horizon).sort(byDueAsc),
    later: open.filter(t => !t.due_date || t.due_date > horizon).sort(byDueAsc),
    doneRecent: done
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
      .slice(0, 10),
  };
}

const SP = 'America/Sao_Paulo';
function ymdSP(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SP, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** "hoje 14:02" / "ontem" / "01/06" — sempre em BRT. */
export function doneWhenLabel(completedAtIso: string, nowIso: string): string {
  const d = ymdSP(completedAtIso);
  const today = ymdSP(nowIso);
  if (d === today) {
    const hm = new Intl.DateTimeFormat('pt-BR', { timeZone: SP, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(completedAtIso));
    return `hoje ${hm}`;
  }
  if (d === addDaysYmd(today, -1)) return 'ontem';
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** Pacote (mãe is_group do pool) pertence ao painel do mês corrente? */
export function packageInMonth(m: { status: string; due_date: string | null }, ym: string): boolean {
  if (m.status === 'cancelled') return false;
  if (m.due_date && m.due_date.slice(0, 7) === ym) return true;
  // done SEM due_date fica fora — sem ancora de mês, só o ciclo aberto interessa.
  if (m.status !== 'done' && (!m.due_date || m.due_date.slice(0, 7) < ym)) return true;
  return false;
}
