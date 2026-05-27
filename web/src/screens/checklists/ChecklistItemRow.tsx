// Sprint 23 — Linha de item dentro do drawer de execução
// Marcar, adicionar nota inline, anexar, gerar tarefa derivada

import { useState } from 'react';
import type { ChecklistItem } from './hooks/useChecklistsHoje';
import { useToggleItem } from './hooks/useToggleItem';
import { ChecklistAttachments } from './ChecklistAttachments';
import { DeriveTaskDialog } from './DeriveTaskDialog';

interface Props {
  scope: 'work' | 'personal';
  completionId: string | null;
  item: ChecklistItem;
  onChanged: () => void;
}

export function ChecklistItemRow({ scope, completionId, item, onChanged }: Props) {
  const toggle = useToggleItem();
  const [noteOpen, setNoteOpen] = useState(
    item.notes != null && item.notes.length > 0
  );
  const [noteValue, setNoteValue] = useState(item.notes ?? '');
  const [showDerive, setShowDerive] = useState(false);

  if (!completionId) {
    return (
      <div className="px-3 py-2 text-fg/40 text-sm italic">
        Esta lista ainda não foi iniciada hoje.
      </div>
    );
  }

  const handleToggle = () => {
    toggle.mutate(
      {
        scope,
        completionId,
        itemId: item.id,
        isChecked: !item.is_checked,
      },
      { onSuccess: onChanged }
    );
  };

  const handleNoteBlur = () => {
    if (noteValue !== (item.notes ?? '')) {
      toggle.mutate(
        {
          scope,
          completionId,
          itemId: item.id,
          isChecked: item.is_checked,
          notes: noteValue.trim() || null,
        },
        { onSuccess: onChanged }
      );
    }
  };

  return (
    <div className="border border-transparent hover:border-border rounded-md p-2">
      <div className="flex items-start gap-3">
        <button
          onClick={handleToggle}
          className={`w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
            item.is_checked
              ? 'bg-tom border-tom'
              : 'border-fg/40 hover:border-tom'
          }`}
          aria-label={item.is_checked ? 'Desmarcar' : 'Marcar'}
        >
          {item.is_checked && (
            <svg viewBox="0 0 20 20" fill="currentColor" className="text-bg-app w-3.5 h-3.5">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3-3a1 1 0 011.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z"
              />
            </svg>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div
            className={`text-sm ${
              item.is_checked ? 'line-through text-fg/50' : 'text-fg'
            }`}
          >
            {item.description}
          </div>

          {noteOpen ? (
            <textarea
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              onBlur={handleNoteBlur}
              placeholder="Observação…"
              rows={2}
              className="w-full mt-1 bg-bg-app border border-border rounded-md p-2 text-xs text-fg resize-none focus:outline-none focus:border-tom"
            />
          ) : (
            <button
              onClick={() => setNoteOpen(true)}
              className="text-xs text-fg/40 hover:text-tom mt-0.5"
            >
              + nota
            </button>
          )}

          <ChecklistAttachments
            scope={scope}
            itemCompletionId={item.item_completion_id}
          />
        </div>
        <button
          onClick={() => setShowDerive(true)}
          className="text-xs text-fg/40 hover:text-tom p-1"
          title="Gerar tarefa a partir deste item"
        >
          🪄
        </button>
      </div>

      {showDerive && (
        <DeriveTaskDialog
          scope={scope}
          completionId={completionId}
          itemId={item.id}
          itemDescription={item.description}
          onClose={() => setShowDerive(false)}
          onCreated={() => {
            setShowDerive(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
