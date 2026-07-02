// web/src/lib/delegatePermission.ts
// Quem pode delegar uma tarefa JÁ criada (2026-07-02, caso Gabi).
// ALINHADO com a CRIAÇÃO: qualquer colaborador delega a PRÓPRIA tarefa ativa.
// Antes o "Transformar → Delegar" exigia coord-level (hasCoordLevel), mas a criação
// (QuickCreateSheet → "Delegar") NUNCA exigiu — então quem delega no dia a dia mas
// não é coord (farmers/collaborators como a Gabi) ficava preso: criava delegando,
// mas ao editar a tarefa não achava a opção. Aqui removemos o gate de coord;
// mantemos só a POSSE (a tarefa tem que ser sua) — e o UPDATE do DelegateTaskSheet
// ainda filtra `assigned_to = você`, então a trava de posse continua no banco.

export interface DelegatableTask {
  assigned_to?: string | null;
  status?: string | null;
}

// Tarefa "morta" — nada a delegar (já concluída/cancelada, ou já delegada a outro).
const INACTIVE = new Set(['done', 'cancelled', 'delegated']);

/** Pode delegar = usuário logado + tarefa ativa + a tarefa é SUA (posse). Sem coord. */
export function canDelegateOwnTask(
  collabId: string | null | undefined,
  task: DelegatableTask | null | undefined,
): boolean {
  if (!collabId || !task) return false;
  if (task.status && INACTIVE.has(task.status)) return false;
  return task.assigned_to === collabId;
}
