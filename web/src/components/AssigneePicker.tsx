import { useState } from 'react';
import { User } from 'lucide-react';

// Sprint 22.22 — Dropdown inline pra atribuir task a um membro do projeto.
// Mesmo padrao visual do CategoryTag (z-50, blur fecha).

export interface AssigneeOption {
  id: string;            // collaborator_id
  full_name: string;
  role_in_project?: string;
}

interface Props {
  /** ID do colaborador atualmente atribuido. */
  value: string | null;
  /** Membros disponiveis pra atribuir (so internos — guests nao recebem task). */
  options: AssigneeOption[];
  /** Quando troca a atribuicao. */
  onChange: (collaboratorId: string) => void;
  /** Quando seleciona "ninguem" (so usado em fluxos especificos). */
  onClear?: () => void;
  /** Texto exibido quando value=null. */
  emptyLabel?: string;
}

export function AssigneePicker({ value, options, onChange, onClear, emptyLabel = 'Ninguém' }: Props) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.id === value);
  const label = current?.full_name ?? emptyLabel;
  const initials = current ? initialsOf(current.full_name) : null;

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setTimeout(() => setOpen(false), 150);
    }
  }

  function pick(id: string) {
    if (id !== value) onChange(id);
    setOpen(false);
  }

  return (
    <div className="relative inline-block" data-no-nav onBlur={handleBlur}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className={[
          'inline-flex items-center gap-1.5 text-[11px] font-medium rounded-sm px-1.5 py-0.5',
          'bg-bg-elevated text-fg-muted hover:text-fg border border-border',
          'cursor-pointer focus-ring',
        ].join(' ')}
        title={current ? `Atribuído a ${current.full_name}` : 'Atribuir'}
      >
        {initials ? (
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-tom/20 text-tom text-[9px] font-semibold">
            {initials}
          </span>
        ) : (
          <User size={11} />
        )}
        <span className="truncate max-w-[100px]">{label}</span>
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-md border border-border bg-bg-surface shadow-soft overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-body-sm text-fg-muted">Nenhum membro do time</div>
          ) : (
            options.map(opt => {
              const selected = opt.id === value;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); pick(opt.id); }}
                  className={[
                    'w-full px-3 py-2 text-left text-body-sm flex items-center gap-2',
                    selected ? 'bg-bg-elevated' : 'hover:bg-bg-elevated',
                  ].join(' ')}
                >
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-tom/20 text-tom text-[10px] font-semibold shrink-0">
                    {initialsOf(opt.full_name)}
                  </span>
                  <span className="flex-1 truncate">{opt.full_name}</span>
                  {opt.role_in_project && (
                    <span className="text-[10px] text-fg-muted/60">{opt.role_in_project}</span>
                  )}
                  {selected && <span className="text-fg-muted text-body-sm">✓</span>}
                </button>
              );
            })
          )}
          {onClear && value && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClear(); setOpen(false); }}
              className="w-full px-3 py-2 text-left text-body-sm text-fg-muted hover:bg-bg-elevated border-t border-border"
            >
              Remover atribuição
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
