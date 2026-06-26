// Classifica uma tarefa em delegada / grupo / pessoal e devolve a linha de meta
// ("Delegada por X", "👥 grupo · criada por X", "Pessoal") pra view de LEITURA
// (TaskDetailSheet). Puro — o caller resolve os nomes (creatorName/assigneeName).

export type TaskMetaKind = 'delegated' | 'group' | 'personal';

export interface TaskMetaInput {
  meId: string | null;
  assigned_to: string | null;
  created_by: string | null;
  assigned_group_id?: string | null;
  creatorName?: string | null;   // nome de created_by, já resolvido
  assigneeName?: string | null;  // nome de assigned_to, já resolvido
  groupName?: string | null;
}

export interface TaskMeta { kind: TaskMetaKind; label: string; }

function first(name?: string | null): string {
  return String(name ?? '').trim().split(/\s+/)[0] || '';
}

export function taskDetailMeta(i: TaskMetaInput): TaskMeta {
  if (i.assigned_group_id) {
    const by = first(i.creatorName);
    return { kind: 'group', label: `👥 ${i.groupName || 'grupo'}${by ? ` · criada por ${by}` : ''}` };
  }
  const me = i.meId;
  if (me && i.assigned_to === me && i.created_by && i.created_by !== me) {
    return { kind: 'delegated', label: `Delegada por ${first(i.creatorName) || 'alguém'}` };
  }
  if (me && i.created_by === me && i.assigned_to && i.assigned_to !== me) {
    return { kind: 'delegated', label: `Delegada para ${first(i.assigneeName) || 'alguém'}` };
  }
  return { kind: 'personal', label: 'Pessoal' };
}
