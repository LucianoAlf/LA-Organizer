import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { User } from 'lucide-react';
import { PROJECT_MEMBER_ROLE_LABELS, type ProjectMemberRole } from '../types';

// Sprint 22.22 — Dropdown inline pra atribuir task a um membro do projeto.
// Sprint 22.X — dropdown usa position: fixed com coords do trigger pra escapar
// de containers com overflow (ex: BottomSheet).

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
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = options.find(o => o.id === value);
  const label = current?.full_name ?? emptyLabel;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownWidth = Math.max(220, rect.width);
    let left = rect.left;
    if (left + dropdownWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - 8 - dropdownWidth);
    }
    // Flip pra cima se nao tem espaco abaixo (max-h-60 = 240px + folga).
    const dropdownMaxH = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < dropdownMaxH
      ? Math.max(8, rect.top - dropdownMaxH - 4)
      : rect.bottom + 4;
    setCoords({ top, left, width: dropdownWidth });
  }, [open]);

  // Click outside fecha
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current && triggerRef.current.contains(t)) return;
      const dropdown = document.getElementById('assignee-picker-dropdown');
      if (dropdown && dropdown.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(id: string) {
    if (id !== value) onChange(id);
    setOpen(false);
  }

  return (
    <div className="relative inline-block" data-no-nav>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className={[
          'inline-flex items-center gap-1.5 text-[11px] font-medium rounded-sm px-2 py-1',
          current
            ? 'bg-tom/10 text-tom border border-tom/30 hover:bg-tom/15'
            : 'bg-transparent text-fg-muted border border-dashed border-fg-muted/40 hover:text-tom hover:border-tom/60',
          'cursor-pointer focus-ring transition-colors',
        ].join(' ')}
        title={current ? `Atribuído a ${current.full_name}` : 'Atribuir tarefa a alguém do time'}
      >
        {!current && <User size={11} />}
        <span className="truncate max-w-[120px]">
          {current ? label : '+ Atribuir'}
        </span>
      </button>
      {open && coords && (
        <div
          id="assignee-picker-dropdown"
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width, zIndex: 60 }}
          className="max-h-60 overflow-y-auto rounded-md border border-border bg-bg-surface shadow-soft"
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
                  <span className="flex-1 truncate">{opt.full_name}</span>
                  {opt.role_in_project && (
                    <span className="text-[10px] text-fg-muted/60">
                      {PROJECT_MEMBER_ROLE_LABELS[opt.role_in_project as ProjectMemberRole] ?? opt.role_in_project}
                    </span>
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
