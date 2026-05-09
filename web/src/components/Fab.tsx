import { Plus } from 'lucide-react';

interface Props {
  onClick: () => void;
  label?: string;
  ariaLabel?: string;
}

/**
 * Floating Action Button — fixed bottom-right above the bottom nav.
 * Single-purpose: triggers the primary creation action of the screen.
 */
export function Fab({ onClick, label = 'Criar', ariaLabel = 'Criar tarefa' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={[
        'fixed z-20 right-md md:right-lg',
        // Above the bottom nav (88px area). Desktop: bottom of viewport.
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
