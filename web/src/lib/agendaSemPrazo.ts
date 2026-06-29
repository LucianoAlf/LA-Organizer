// Fonte ÚNICA da definição "tarefa sem prazo" pra agenda (mobile Hoje + desktop AgendaDesktop).
// Lição (project_groupchat_phantom_pool / pool fantasma): todo lugar usa o MESMO filtro — senão
// uma superfície mostra o que a outra esconde. Sem prazo = ABERTA, due_date vazio, nível de TOPO
// (não filha de checklist via parent_task_id) e NÃO-grupo (is_group=false).

export interface NoPrazoLike {
  due_date?: string | null;
  status?: string | null;
  parent_task_id?: string | null;
  is_group?: boolean | null;
  context?: string | null;
  sort_position?: number | null;
  created_at?: string | null;
}

const isOpen = (s?: string | null) => s !== 'done' && s !== 'cancelled';

export function isNoPrazoOpen(t: NoPrazoLike): boolean {
  return !t.due_date && isOpen(t.status) && !t.parent_task_id && !t.is_group;
}

// Filtra + ordena (sort_position, depois created_at). context opcional restringe work|personal.
export function filterNoPrazo<T extends NoPrazoLike>(tasks: T[], context?: 'work' | 'personal'): T[] {
  return (tasks || [])
    .filter(isNoPrazoOpen)
    .filter((t) => (context ? t.context === context : true))
    .sort((a, b) =>
      (a.sort_position ?? 1e9) - (b.sort_position ?? 1e9) ||
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
}
