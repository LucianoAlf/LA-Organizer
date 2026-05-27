// Sprint 23 — Drawer de execução do checklist (lado direito do HojeTab)
// Mostra itens marcáveis, extras ad-hoc, anexos, ações (justificar, criar tarefa derivada)

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  WorkChecklistHoje,
  PersonalChecklistHoje,
} from './hooks/useChecklistsHoje';
import { ChecklistItemRow } from './ChecklistItemRow';
import { JustifyDialog } from './JustifyDialog';
import { useAdHocItem } from './hooks/useAdHocItem';

interface Props {
  checklist: WorkChecklistHoje | PersonalChecklistHoje;
  onClose: () => void;
}

export function ChecklistExecucaoDrawer({ checklist, onClose }: Props) {
  const [showJustify, setShowJustify] = useState(false);
  const qc = useQueryClient();
  const onChanged = () => {
    qc.invalidateQueries({ queryKey: ['checklists-hoje'] });
    qc.invalidateQueries({ queryKey: ['checklists-kpi'] });
  };

  const extras = checklist.scope === 'work' ? checklist.extras : [];
  const totalItems = checklist.items.length + extras.length;
  const doneItems =
    checklist.items.filter((i) => i.is_checked).length +
    extras.filter((e) => e.is_checked).length;
  const pct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-border flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-fg font-semibold truncate">{checklist.name}</h2>
          <div className="text-xs text-fg/60">
            {doneItems}/{totalItems} ({pct}%)
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-fg/60 hover:text-fg text-lg"
          aria-label="Fechar"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {checklist.items.length === 0 ? (
          <div className="text-fg/40 text-sm py-6 text-center">
            Sem itens neste checklist.
          </div>
        ) : (
          checklist.items.map((item) => (
            <ChecklistItemRow
              key={item.id}
              scope={checklist.scope}
              completionId={checklist.completion_id}
              item={item}
              onChanged={onChanged}
            />
          ))
        )}

        {checklist.scope === 'work' &&
          extras.map((extra) => (
            <ExtraItemRow
              key={extra.id}
              completionId={checklist.completion_id}
              extra={extra}
              onChanged={onChanged}
            />
          ))}

        {checklist.scope === 'work' && (
          <AddAdHocItemButton
            completionId={checklist.completion_id}
            onAdded={onChanged}
          />
        )}
      </div>

      {checklist.scope === 'work' && checklist.completion_id && (
        <footer className="border-t border-border p-3 flex gap-2">
          <button
            onClick={() => setShowJustify(true)}
            className="text-xs px-3 py-1.5 rounded-md border border-border text-fg/70 hover:text-fg"
          >
            Justificar não-execução
          </button>
        </footer>
      )}

      {showJustify && checklist.scope === 'work' && checklist.completion_id && (
        <JustifyDialog
          completionId={checklist.completion_id}
          onClose={() => setShowJustify(false)}
          onJustified={() => {
            setShowJustify(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ExtraItemRow({
  completionId,
  extra,
  onChanged,
}: {
  completionId: string;
  extra: {
    id: string;
    description: string;
    is_checked: boolean;
    notes: string | null;
  };
  onChanged: () => void;
}) {
  const { toggle, update, remove } = useAdHocItem();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(extra.description);

  if (!completionId) return null;

  return (
    <div className="border border-transparent hover:border-border rounded-md p-2 flex items-start gap-3">
      <button
        onClick={() =>
          toggle.mutate(
            { id: extra.id, isChecked: !extra.is_checked },
            { onSuccess: onChanged }
          )
        }
        className={`w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
          extra.is_checked
            ? 'bg-tom border-tom'
            : 'border-fg/40 hover:border-tom'
        }`}
      >
        {extra.is_checked && (
          <svg viewBox="0 0 20 20" fill="currentColor" className="text-bg-app w-3.5 h-3.5">
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3-3a1 1 0 011.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z"
            />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (value.trim() && value !== extra.description) {
                update.mutate(
                  { id: extra.id, description: value.trim() },
                  { onSuccess: onChanged }
                );
              }
              setEditing(false);
            }}
            autoFocus
            className="w-full bg-bg-app border border-border rounded-md p-1 text-sm text-fg focus:outline-none focus:border-tom"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className={`text-sm text-left ${
              extra.is_checked ? 'line-through text-fg/50' : 'text-fg'
            }`}
          >
            {extra.description}
          </button>
        )}
        <span className="text-xs text-fg/40 ml-2">(ad-hoc)</span>
      </div>
      <button
        onClick={() => {
          if (confirm('Remover este item?'))
            remove.mutate({ id: extra.id }, { onSuccess: onChanged });
        }}
        className="text-xs text-fg/40 hover:text-danger p-1"
        title="Remover item ad-hoc"
      >
        🗑
      </button>
    </div>
  );
}

function AddAdHocItemButton({
  completionId,
  onAdded,
}: {
  completionId: string | null;
  onAdded: () => void;
}) {
  const { add } = useAdHocItem();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');

  if (!completionId) return null;

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="text-xs text-fg/40 hover:text-tom px-3 py-2 w-full text-left border border-dashed border-border rounded-md mt-2"
      >
        + adicionar item ad-hoc
      </button>
    );
  }

  return (
    <div className="flex gap-2 mt-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            add.mutate(
              { completionId, description: value.trim() },
              {
                onSuccess: () => {
                  setValue('');
                  onAdded();
                },
              }
            );
          }
          if (e.key === 'Escape') {
            setAdding(false);
            setValue('');
          }
        }}
        placeholder="Descreva o item…"
        className="flex-1 bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
      />
      <button
        onClick={() => {
          setAdding(false);
          setValue('');
        }}
        className="text-xs text-fg/40 hover:text-fg px-2"
      >
        Cancelar
      </button>
    </div>
  );
}
