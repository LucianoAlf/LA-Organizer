// Picker de responsavel para checkpoint. Diferenca do AssigneePicker normal:
// - Aceita value === null (sem responsavel atribuido)
// - Quando null, mostra chip cinza "Responsavel: {fallbackName}" pra indicar
//   que vai cair no fallback do dono do projeto.

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, User, Crown } from 'lucide-react';
import type { AssigneeOption } from './AssigneePicker';

export interface CheckpointAssigneePickerProps {
  value: string | null;
  onChange: (collabId: string | null) => void;
  options: AssigneeOption[];
  /** Nome do dono do projeto, exibido quando value === null. */
  fallbackName: string;
  disabled?: boolean;
}

export function CheckpointAssigneePicker({
  value, onChange, options, fallbackName, disabled,
}: CheckpointAssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = value ? options.find(o => o.id === value) : null;
  const label = selected?.full_name ?? fallbackName;

  return (
    <div ref={ref} className="relative inline-block" data-no-nav>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
        className={[
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-body-sm focus-ring transition-colors',
          value
            ? 'bg-tom/10 border border-tom/30 text-tom hover:bg-tom/15'
            : 'bg-bg-elevated border border-border text-fg-muted hover:border-tom/40',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
        aria-label={value ? `Responsavel: ${label}` : `Sem responsavel (fallback: ${fallbackName})`}
      >
        {value ? <User size={12} /> : <Crown size={12} />}
        <span className="truncate max-w-[140px]">{label}</span>
        <ChevronDown size={12} className="opacity-60" />
      </button>

      {open && (
        <div className="absolute z-20 top-full mt-1 left-0 min-w-[200px] bg-bg-elevated2 border border-border rounded-md shadow-lg py-1 max-h-64 overflow-y-auto">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-body-sm text-fg-muted hover:bg-bg-elevated flex items-center gap-2"
          >
            <Crown size={12} />
            <span>Sem responsavel - usa {fallbackName}</span>
          </button>
          <div className="h-px bg-border my-1" />
          {options.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className={[
                'w-full text-left px-3 py-1.5 text-body-sm hover:bg-bg-elevated flex items-center gap-2',
                opt.id === value ? 'text-tom font-medium' : 'text-fg',
              ].join(' ')}
            >
              <User size={12} />
              <span className="truncate flex-1">{opt.full_name}</span>
              {opt.role_in_project && (
                <span className="text-[10px] text-fg-muted/60">{opt.role_in_project}</span>
              )}
              {opt.id === value && <span className="text-tom">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
