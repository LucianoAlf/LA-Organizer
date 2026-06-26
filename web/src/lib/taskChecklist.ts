// Subtarefas/checklist nas tarefas (pessoal/delegada/grupo) — funções puras.
// Sub-item = task filha (parent_task_id = pai). Reusa o primitivo que já existe; sem conceito novo.
// O topo da agenda esconde filhas (Hoje/Semana já filtram parent_task_id IS NULL na query);
// estas funções dão a separação topo×filhas + progresso pra UI, sem I/O.

export function splitTopLevel<T extends { id: string; parent_task_id?: string | null }>(tasks: T[]) {
  const top: T[] = [];
  const childrenByParent = new Map<string, T[]>();
  for (const t of tasks) {
    if (t.parent_task_id) {
      const arr = childrenByParent.get(t.parent_task_id) ?? [];
      arr.push(t);
      childrenByParent.set(t.parent_task_id, arr);
    } else {
      top.push(t);
    }
  }
  return { top, childrenByParent };
}

// Progresso X/N de um checklist. Itens 'cancelled' saem do total (não contam como pendência).
export function checklistProgress(children: { status?: string | null }[]) {
  const counted = children.filter((c) => c.status !== 'cancelled');
  return { done: counted.filter((c) => c.status === 'done').length, total: counted.length };
}

// Permissão de marcar um item: só o RESPONSÁVEL pela tarefa (espelha "só o assignee marca como feita"
// das delegadas). O delegador (criador) vê o progresso mas não marca os itens do outro.
export function canCheckItem(args: { assigned_to?: string | null; meId?: string | null }): boolean {
  return !!args.meId && args.meId === args.assigned_to;
}
