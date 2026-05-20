import { useState, useEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';

interface FabAction {
  icon: string;        // emoji ou string curta
  label: string;       // texto do item
  onClick: () => void;
  ariaLabel?: string;
}

interface Props {
  onClick?: () => void;          // modo single-ação (legacy)
  label?: string;                // texto do botão principal
  ariaLabel?: string;
  actions?: FabAction[];         // modo menu: se preenchido (>=1), o FAB expande
}

/**
 * Floating Action Button — fixed bottom-right above the bottom nav.
 *
 * Modos:
 *   1. Single-ação (legacy):   <Fab onClick={...} label="..."/>
 *   2. Menu de ações (novo):   <Fab label="Novo" actions={[{icon:'💰', label:'Venda', onClick}, ...]}/>
 *
 * No modo menu, clicar abre painel acima do FAB com os itens listados.
 * Clicar fora ou no X fecha. ESC também fecha.
 */
export function Fab({ onClick, label = 'Criar', ariaLabel = 'Criar', actions }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasMenu = Array.isArray(actions) && actions.length > 0;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);

  // Modo single-ação (compat): sem menu, só dispara onClick
  if (!hasMenu) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={[
          'fixed z-20 right-md md:right-lg',
          'bottom-[96px] md:bottom-md',
          'h-14 px-5 rounded-full bg-tom text-black shadow-soft hover:bg-tom-shade active:bg-tom-deep',
          'inline-flex items-center gap-2 font-semibold focus-ring',
        ].join(' ')}
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <Plus size={20} strokeWidth={2.5} />
        <span className="hidden sm:inline">{label}</span>
      </button>
    );
  }

  // Modo menu de ações
  return (
    <div
      ref={containerRef}
      className="fixed z-20 right-md md:right-lg bottom-[96px] md:bottom-md flex flex-col items-end gap-sm"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      {open && (
        <div className="flex flex-col items-end gap-2 mb-2">
          {actions!.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setOpen(false); a.onClick(); }}
              aria-label={a.ariaLabel || a.label}
              className={[
                'h-12 px-4 rounded-full bg-bg-surface text-fg border border-border shadow-soft',
                'inline-flex items-center gap-2 font-medium focus-ring',
                'hover:bg-bg-elevated active:bg-bg-app',
              ].join(' ')}
            >
              <span aria-hidden className="text-lg leading-none">{a.icon}</span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Fechar menu' : (ariaLabel || label)}
        aria-expanded={open}
        className={[
          'h-14 px-5 rounded-full shadow-soft inline-flex items-center gap-2 font-semibold focus-ring',
          open
            ? 'bg-bg-surface text-fg border border-border'
            : 'bg-tom text-black hover:bg-tom-shade active:bg-tom-deep',
        ].join(' ')}
      >
        {open ? <X size={20} strokeWidth={2.5} /> : <Plus size={20} strokeWidth={2.5} />}
        <span className="hidden sm:inline">{open ? 'Fechar' : label}</span>
      </button>
    </div>
  );
}
