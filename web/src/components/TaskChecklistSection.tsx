// Subtarefas/checklist (2026-06-26) — seção de checklist de uma tarefa, encaixada no read-view
// (TaskDetailSheet) via slot. Ver/marcar/adicionar/remover, com a permissão de marcação correta
// (grupo: qualquer membro; pessoal/delegada: só o responsável). Reusa TaskCheckbox do app.
import { useState } from 'react';
import { X } from 'lucide-react';
import { TaskCheckbox } from './TaskCheckbox';
import { canCheckItem } from '../lib/taskChecklist';
import { useTaskChecklist, type ChecklistParent } from '../hooks/useTaskChecklist';

export function TaskChecklistSection({ parent, meId, editable = false }: {
  parent: ChecklistParent;
  meId: string | null | undefined;
  editable?: boolean;
}) {
  const { items, progress, addItem, toggleItem, removeItem } = useTaskChecklist(parent, meId);
  const [novo, setNovo] = useState('');
  const canCheck = canCheckItem({
    assigned_to: parent.assigned_to,
    assigned_group_id: parent.assigned_group_id,
    meId,
  });

  const submitNovo = () => {
    const t = novo.trim();
    if (t) { addItem.mutate(t); setNovo(''); }
  };

  // Sem itens e não-editável (ex.: delegador olhando uma tarefa sem checklist) → não polui o read-view.
  if (items.length === 0 && !editable) return null;

  return (
    <div>
      <div className="text-label uppercase tracking-wide text-fg-muted mb-1 flex items-center gap-2">
        <span>Checklist</span>
        {progress.total > 0 && (
          <span className="text-fg-muted normal-case tracking-normal">{progress.done}/{progress.total}</span>
        )}
      </div>
      <div className="space-y-1">
        {items.map((it) => {
          const done = it.status === 'done';
          return (
            <div key={it.id} className="flex items-start gap-sm">
              <TaskCheckbox
                size="sm"
                done={done}
                disabled={!canCheck || toggleItem.isPending}
                onClick={() => { if (canCheck) toggleItem.mutate({ id: it.id, done: !done }); }}
              />
              <span className={`flex-1 min-w-0 text-body-md break-words ${done ? 'line-through text-fg-muted' : 'text-fg'}`}>
                {it.title}
              </span>
              {editable && (
                <button
                  type="button"
                  aria-label="Remover item"
                  title="Remover"
                  className="shrink-0 mt-0.5 text-fg-muted hover:text-danger focus-ring rounded"
                  onClick={() => removeItem.mutate(it.id)}
                  disabled={removeItem.isPending}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          );
        })}
        {items.length === 0 && <div className="text-body-sm text-fg-muted italic">Sem itens ainda.</div>}
      </div>
      {editable && (
        // 2026-06-26 — SEM <form> aninhado: este componente também é usado dentro do
        // EditTaskSheet (que já é um <form>), e <form> dentro de <form> é HTML inválido +
        // faz o "Add"/Enter submeterem o form de edição (salvava a tarefa e fechava o sheet).
        // Enter e botão chamam submitNovo direto; o botão é type="button" pra NUNCA submeter
        // um form ancestral.
        <div className="mt-2 flex items-center gap-sm">
          <input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNovo(); } }}
            placeholder="Adicionar item…"
            className="flex-1 bg-bg-surface border border-border rounded-md p-2 text-fg text-body-md focus:outline-none focus:border-tom"
          />
          <button
            type="button"
            disabled={!novo.trim() || addItem.isPending}
            onClick={submitNovo}
            className="shrink-0 text-tom text-body-md font-medium disabled:opacity-40 focus-ring rounded px-1"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
