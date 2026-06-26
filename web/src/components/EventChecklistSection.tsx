// Checklist de compromisso (2026-06-26) — seção encaixada nas superfícies de evento
// (EditEventSheet, EventEditDrawer, EventoDetalhe) via slot. Espelha o TaskChecklistSection,
// mas sobre event_checklist_items (done bool). `editable` = dono do evento (marca/add/remove);
// outros veem read-only. Semântica PAUTA: marcar item NÃO conclui o compromisso.
import { useState } from 'react';
import { X } from 'lucide-react';
import { TaskCheckbox } from './TaskCheckbox';
import { useEventChecklist } from '../hooks/useEventChecklist';

export function EventChecklistSection({ eventId, meId, editable = false }: {
  eventId: string | null | undefined;
  meId: string | null | undefined;
  editable?: boolean;
}) {
  const { items, progress, addItem, toggleItem, removeItem } = useEventChecklist(eventId, meId);
  const [novo, setNovo] = useState('');

  const submitNovo = () => {
    const t = novo.trim();
    if (t) { addItem.mutate(t); setNovo(''); }
  };

  // Sem itens e não-editável (ex.: participante olhando um evento sem pauta) → não polui.
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
        {items.map((it) => (
          <div key={it.id} className="flex items-start gap-sm">
            <TaskCheckbox
              size="sm"
              done={it.done}
              disabled={!editable || toggleItem.isPending}
              onClick={() => { if (editable) toggleItem.mutate({ id: it.id, done: !it.done }); }}
            />
            <span className={`flex-1 min-w-0 text-body-md break-words ${it.done ? 'line-through text-fg-muted' : 'text-fg'}`}>
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
        ))}
        {items.length === 0 && <div className="text-body-sm text-fg-muted italic">Sem itens ainda.</div>}
      </div>
      {editable && (
        // SEM <form> aninhado (EditEventSheet/QuickCreateSheet são <form>): botão type=button +
        // Enter com preventDefault, pra não submeter um form ancestral.
        <div className="mt-2 flex items-center gap-sm">
          <input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNovo(); } }}
            placeholder="Adicionar item…"
            maxLength={200}
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
