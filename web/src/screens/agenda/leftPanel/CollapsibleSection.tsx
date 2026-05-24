import { useState, useEffect, type ReactNode } from 'react';

interface Props {
  /** Identificador único pra persistir estado em localStorage. */
  storageKey: string;
  /** Título exibido em uppercase. */
  title: string;
  /** Ícone Lucide (ou qualquer ReactNode) renderizado antes do título. */
  icon?: ReactNode;
  /** Conteúdo opcional do lado direito do header (count, streak médio, etc). */
  meta?: ReactNode;
  /** Estado inicial quando não há preferência salva. Default: aberto. */
  defaultOpen?: boolean;
  children: ReactNode;
}

const LS_PREFIX = 'agenda.desktop.leftPanel.section.';

export function CollapsibleSection({ storageKey, title, icon, meta, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(LS_PREFIX + storageKey);
      if (saved === '1') return true;
      if (saved === '0') return false;
    } catch { /* ignore */ }
    return defaultOpen;
  });

  useEffect(() => {
    try { localStorage.setItem(LS_PREFIX + storageKey, open ? '1' : '0'); } catch { /* ignore */ }
  }, [storageKey, open]);

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 py-1.5 text-[11px] uppercase tracking-wider text-fg-muted font-semibold hover:text-fg focus-ring rounded"
      >
        <span className="text-[9px] text-fg-muted/70">{open ? '▼' : '▶'}</span>
        {icon && <span className="text-fg-muted/80 shrink-0">{icon}</span>}
        <span>{title}</span>
        {meta != null && <span className="ml-auto text-[10px] text-fg-muted/70 font-normal">{meta}</span>}
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </section>
  );
}
