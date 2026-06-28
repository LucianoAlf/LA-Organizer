import type { TaskForPanel } from '../screens/agenda/hooks/useAgendaTasks';
import type { EventForGrid } from '../screens/agenda/hooks/useAgendaEvents';

export type ChipTone = 'overdue' | 'open' | 'done' | 'event' | 'eventDone';

export interface MonthChip {
  id: string;
  label: string;
  tone: ChipTone;
  kind: 'task' | 'event';
  /** ordenação: eventos (prefixo 0, por start_at) antes de tarefas (prefixo 1, por título). */
  sortKey: string;
}

/** Fundo leve (token a baixa opacidade) + texto do mesmo família. Adapta a dark/light. */
export const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  overdue: 'bg-danger/10 text-danger',
  open: 'bg-tom/20 text-tom-deep',
  done: 'bg-transparent text-fg-muted line-through',
  event: 'bg-info/10 text-info',
  eventDone: 'bg-transparent text-fg-muted line-through',
};

/** YMD (America/Sao_Paulo) de um ISO — evita o shift de UTC após 21h BRT. */
export function ymdInSP(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

export function taskChipTone(t: { status: string; due_date: string | null }, todayYmd: string): ChipTone {
  if (t.status === 'done') return 'done';
  if (t.due_date && t.due_date.slice(0, 10) < todayYmd) return 'overdue';
  return 'open';
}

/** null = não mostra (cancelado). */
export function eventChipTone(e: { status: string }): ChipTone | null {
  if (e.status === 'cancelled') return null;
  if (e.status === 'done') return 'eventDone';
  return 'event';
}

export function buildMonthDayMap(
  tasks: TaskForPanel[],
  events: EventForGrid[],
  todayYmd: string,
): Map<string, MonthChip[]> {
  const map = new Map<string, MonthChip[]>();
  const push = (ymd: string, chip: MonthChip) => {
    const list = map.get(ymd) ?? [];
    list.push(chip);
    map.set(ymd, list);
  };
  for (const e of events) {
    const tone = eventChipTone(e);
    if (!tone) continue;
    push(ymdInSP(e.start_at), { id: `e-${e.id}`, label: e.title, tone, kind: 'event', sortKey: `0-${e.start_at}` });
  }
  for (const t of tasks) {
    if (!t.due_date) continue;
    push(t.due_date.slice(0, 10), { id: `t-${t.id}`, label: t.title, tone: taskChipTone(t, todayYmd), kind: 'task', sortKey: `1-${t.title}` });
  }
  for (const [, list] of map) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return map;
}
