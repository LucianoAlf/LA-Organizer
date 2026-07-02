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
  // Recorrência (2026-07-02): colapso de série no pool + badge de cadência.
  // Instância traz recurrence_parent_id; template traz recurrence_rule; series_rule
  // é o rule RESOLVIDO (próprio ou do pai, via embed) pra rotular o badge.
  // recurrence_series_size é anotado pelo colapso (quantas ocorrências viraram 1 linha).
  recurrence_parent_id?: string | null;
  recurrence_rule?: string | null;
  series_rule?: string | null;
  recurrence_series_size?: number;
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

// ————— Recorrência no pool do grupo (2026-07-02) —————
// PORQUÊ: uma tarefa recorrente de GRUPO materializa 1 instância por ciclo
// (FREQ=DAILY → ~30 linhas). O pool nunca foi pensado pra isso e inundava a tela
// (caso Vitória/ADM CG: 30× "Ligar para aluno" = ~todas as "abertas" do grupo).
// Aqui colapsamos cada SÉRIE numa linha só — a ocorrência que o time deve olhar
// agora — com o rule resolvido pra badge de cadência.

export interface RecurringLike {
  id: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  recurrence_parent_id?: string | null;
  recurrence_rule?: string | null;
  series_rule?: string | null;
}

/** Chave da série: pai (instância) ou o próprio id (template). null = não-recorrente. */
function seriesKey(t: RecurringLike): string | null {
  if (t.recurrence_parent_id) return t.recurrence_parent_id;
  if (t.recurrence_rule || t.series_rule) return t.id;
  return null;
}

const isOpenStatus = (s: string) => s !== 'done' && s !== 'cancelled';

/** Representante da série: a ocorrência que o time deve olhar AGORA.
 *  1) aberta com prazo >= hoje, a mais próxima (menor due);
 *  2) senão, aberta atrasada mais recente (maior due; sem prazo por último);
 *  3) senão (nada aberto), a done mais recente. */
function pickRepresentative<T extends RecurringLike>(members: T[], todayYmd: string): T | null {
  const open = members.filter((m) => isOpenStatus(m.status));
  if (open.length > 0) {
    const upcoming = open
      .filter((m) => m.due_date && m.due_date >= todayYmd)
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
    if (upcoming.length > 0) return upcoming[0];
    const overdue = open
      .filter((m) => m.due_date)
      .sort((a, b) => (b.due_date ?? '').localeCompare(a.due_date ?? ''));
    return overdue[0] ?? open[0];
  }
  const done = members
    .filter((m) => m.status === 'done' && m.completed_at)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  return done[0] ?? null;
}

/** Colapsa séries recorrentes numa linha (o representante). Não-recorrentes passam
 *  intactas (mantendo ordem). Anota recurrence_series_size no representante. Preserva
 *  o tipo T (usável no pool E no overside de contagem). Não muta a entrada. */
export function collapseRecurringSeries<T extends RecurringLike>(rows: T[], todayYmd: string): T[] {
  const groups = new Map<string, T[]>();
  const out: T[] = [];
  for (const r of rows) {
    const key = seriesKey(r);
    if (key == null) { out.push(r); continue; }
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  for (const members of groups.values()) {
    const rep = pickRepresentative(members, todayYmd);
    if (rep) out.push({ ...rep, recurrence_series_size: members.length });
  }
  return out;
}

/** RRULE → rótulo curto de cadência pro badge ("diária", "semanal", "mensal"…). */
export function recurrenceLabel(rule: string | null | undefined): string | null {
  if (!rule) return null;
  const r = rule.toUpperCase();
  const freq = /FREQ=([A-Z]+)/.exec(r)?.[1];
  const interval = Number(/INTERVAL=(\d+)/.exec(r)?.[1] ?? '1');
  switch (freq) {
    case 'DAILY':   return interval > 1 ? `a cada ${interval}d` : 'diária';
    case 'WEEKLY':  return /BYDAY=MO,TU,WE,TH,FR/.test(r) ? 'dias úteis'
                         : interval > 1 ? `a cada ${interval}sem` : 'semanal';
    case 'MONTHLY': return interval > 1 ? `a cada ${interval}m` : 'mensal';
    case 'YEARLY':  return 'anual';
    default:        return 'recorrente';
  }
}
