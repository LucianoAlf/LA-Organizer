// web/src/lib/governance-metrics.ts
// Fonte das regras de "número honesto" da governança (spec §4). Puro/testável.
// Por ora vive no frontend; quando a Fase 6 (digest) chegar, as MESMAS regras
// sobem pra uma função única no Postgres (fonte única front+engine).

export interface OverdueRow {
  id: string;
  title: string;
  assigned_to: string;
  due_date: string; // YYYY-MM-DD
}

export interface DedupedOverdue {
  key: string;
  title: string;
  assigned_to: string;
  count: number;       // quantas linhas colapsaram (fan-out de recorrência)
  oldestDue: string;   // due_date mais antigo do grupo (o mais atrasado)
  recurring: boolean;  // count > 1
}

/** Normaliza título pra agrupar recorrência: minúsculo, sem acento, espaço colapsado. */
export function normTitle(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Colapsa instâncias do mesmo (dono + título normalizado) em 1 grupo. */
export function dedupeRecurringOverdue(rows: OverdueRow[]): DedupedOverdue[] {
  const groups = new Map<string, DedupedOverdue>();
  for (const r of (rows ?? [])) {
    const key = `${r.assigned_to}|${normTitle(r.title)}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { key, title: r.title, assigned_to: r.assigned_to, count: 1, oldestDue: r.due_date, recurring: false });
    } else {
      g.count += 1;
      g.recurring = true;
      if (r.due_date < g.oldestDue) g.oldestDue = r.due_date;
    }
  }
  return [...groups.values()];
}

/** Mantém só linhas de colaboradores ativos. */
export function filterActiveAssignees<T extends { assigned_to: string }>(rows: T[], activeIds: Set<string>): T[] {
  return (rows ?? []).filter(r => activeIds.has(r.assigned_to));
}

/** Contagem honesta = nº de obrigações distintas (recorrência já colapsada). */
export function countDistinctOverdue(deduped: DedupedOverdue[]): number {
  return (deduped ?? []).length;
}

/** Atrasos por pessoa = nº de obrigações distintas por dono, desc. */
export function overdueByPerson(deduped: DedupedOverdue[]): Array<{ assigned_to: string; count: number }> {
  const m = new Map<string, number>();
  for (const d of (deduped ?? [])) m.set(d.assigned_to, (m.get(d.assigned_to) ?? 0) + 1);
  return [...m.entries()]
    .map(([assigned_to, count]) => ({ assigned_to, count }))
    .sort((a, b) => b.count - a.count);
}
