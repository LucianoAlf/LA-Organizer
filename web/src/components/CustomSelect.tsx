// Sprint 22.25 (audit Hoje, Mega-fatia A) — extraido de components/MembersTab.tsx.
// Dropdown customizado padrao design system. Substitui <select> nativo do OS
// (Windows mostra dropdown feio; Mac e mobile tambem incoerentes com o resto).
//
// - Posicionamento inteligente (mede espaco; abre pra cima ou baixo).
// - Bg/border/text-color usam tokens do design system.
// - Suporte a sublabel (texto auxiliar a direita).
// - Marcador "✓" no item selecionado (cor TOM).
// - Tamanhos: sm (h-9, edits inline) | md (h-12, forms standard).

import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Option {
  value: string;
  label: string;
  sublabel?: string;
}

interface Props {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** 'up' fixa pra cima, 'down' pra baixo, 'auto' decide pelo espaco. */
  prefer?: 'up' | 'down' | 'auto';
  /** sm = h-9 (inline edits), md = h-12 (forms standard). Default md. */
  size?: 'sm' | 'md';
}

export function CustomSelect({
  value,
  options,
  onChange,
  placeholder,
  prefer = 'auto',
  size = 'md',
}: Props) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(prefer === 'up');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = options.find(o => o.value === value);

  // Sprint 22.22l — quando abre, mede espaco. Sprint 22.22n — respeita prefer.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    if (prefer === 'up') { setOpenUpward(true); return; }
    if (prefer === 'down') { setOpenUpward(false); return; }
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const need = 280;
    setOpenUpward(spaceBelow < need && spaceAbove > spaceBelow);
  }, [open, options.length, prefer]);

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setTimeout(() => setOpen(false), 150);
    }
  }

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  const sizeCls = size === 'md' ? 'h-12 text-body-md' : 'h-9 text-body-sm';

  return (
    <div className="relative" onBlur={handleBlur}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        className={[
          'w-full px-3 rounded-md bg-bg-elevated border border-border focus-ring',
          'flex items-center justify-between gap-2',
          sizeCls,
          current ? 'text-fg' : 'text-fg-muted',
        ].join(' ')}
      >
        <span className="truncate">
          {current ? (
            <>
              {current.label}
              {current.sublabel && (
                <span className="text-fg-muted ml-1">({current.sublabel})</span>
              )}
            </>
          ) : (
            placeholder ?? 'Selecionar'
          )}
        </span>
        <ChevronDown size={14} className={['shrink-0 text-fg-muted transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </button>
      {open && (
        <div
          className={[
            'absolute left-0 right-0 z-50 max-h-60 overflow-y-auto rounded-md border border-border bg-bg-surface shadow-soft',
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1',
          ].join(' ')}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-body-sm text-fg-muted">Nenhuma opção</div>
          ) : (
            options.map(opt => {
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => pick(opt.value)}
                  className={[
                    'w-full px-3 py-2 text-left text-body-sm flex items-center justify-between gap-2',
                    selected ? 'bg-bg-elevated text-fg' : 'text-fg hover:bg-bg-elevated',
                  ].join(' ')}
                >
                  <span className="min-w-0 truncate">
                    {opt.label}
                    {opt.sublabel && (
                      <span className="text-fg-muted ml-1.5 text-[11px]">({opt.sublabel})</span>
                    )}
                  </span>
                  {selected && <span className="text-tom shrink-0">✓</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
