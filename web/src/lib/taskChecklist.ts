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

// Permissão de marcar um item:
//  - tarefa de GRUPO (assigned_group_id) → qualquer membro marca (igual ao pool do grupo);
//  - pessoal/delegada → só o RESPONSÁVEL (assigned_to), espelhando "só o assignee marca como feita".
// O delegador (criador) vê o progresso e edita a LISTA, mas não MARCA os itens do liderado.
export function canCheckItem(args: { assigned_to?: string | null; assigned_group_id?: string | null; meId?: string | null }): boolean {
  if (args.assigned_group_id) return true;
  return !!args.meId && args.meId === args.assigned_to;
}

// Bloco de texto do checklist pro WhatsApp (determinístico, formato cravado).
// assigneeName: nome a exibir no label — o delegador vê o nome do executor; o próprio executor vê sem nome.
// A barra usa 1 segmento por item até 10; acima disso escala proporcional (cap 10). O label X/N é a fonte de verdade.
export function renderChecklistBlock(
  children: { title: string; status?: string | null; sort_position?: number | null }[],
  opts?: { assigneeName?: string | null },
): string {
  const counted = children.filter((c) => c.status !== 'cancelled');
  const total = counted.length;
  if (total === 0) return '';
  const done = counted.filter((c) => c.status === 'done').length;
  const segments = Math.min(total, 10);
  const filled = Math.round((done / total) * segments);
  const bar = '▓'.repeat(filled) + '░'.repeat(segments - filled);
  const label = opts?.assigneeName ? `*Checklist* ${opts.assigneeName}:` : '*Checklist:*';
  const header = `${label} ${done}/${total} ${bar}`;
  const sorted = [...counted].sort((a, b) => (a.sort_position ?? 0) - (b.sort_position ?? 0));
  const lines = sorted.map((c) => `${c.status === 'done' ? '✅' : '⬜'} ${c.title}`);
  return [header, ...lines].join('\n');
}

// Cascade: o pai deve auto-concluir sse tem itens (não-cancelados) e TODOS estão done.
export function shouldAutocompleteParent(children: { status?: string | null }[]): boolean {
  const counted = children.filter((c) => c.status !== 'cancelled');
  if (counted.length === 0) return false;
  return counted.every((c) => c.status === 'done');
}
