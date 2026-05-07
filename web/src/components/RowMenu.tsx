// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Acionador "..." com dropdown e confirmacao inline pra acoes destrutivas.
// Comportamento identico ao da versao inline anterior.

import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

export type MenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Quando presente, click no item nao executa direto — exibe confirm inline. */
  confirm?: string;
};

export function RowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmIdx(null);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); setConfirmIdx(null); }}
        aria-label="Mais ações"
        className="text-fg-muted hover:text-fg p-1 focus-ring rounded-sm"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-md border border-border bg-bg-surface shadow-soft overflow-hidden">
          {items.map((item, i) => {
            const isConfirming = confirmIdx === i;
            if (isConfirming && item.confirm) {
              return (
                <div key={i} className="px-3 py-2 border-b border-border last:border-b-0 bg-danger/5">
                  <div className="text-body-sm text-fg mb-2">{item.confirm}</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmIdx(null); }}
                      className="flex-1 h-7 px-2 rounded-sm text-body-sm text-fg-muted hover:text-fg border border-border focus-ring"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); item.onClick(); setOpen(false); setConfirmIdx(null); }}
                      className="flex-1 h-7 px-2 rounded-sm text-body-sm font-semibold bg-danger text-white focus-ring"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.confirm) { setConfirmIdx(i); return; }
                  item.onClick();
                  setOpen(false);
                }}
                className={[
                  'w-full px-3 py-2 text-left text-body-sm hover:bg-bg-elevated transition-colors',
                  item.danger ? 'text-danger' : 'text-fg',
                ].join(' ')}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
