import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Override the desktop max-width (default 'md:max-w-md'). */
  widthClass?: string;
}

/**
 * Mobile-first bottom sheet. Slides up from the bottom on small screens,
 * centers on desktop. Backdrop click + Esc close. Body scroll locked while open.
 */
export function BottomSheet({ open, onClose, title, children, widthClass = 'md:max-w-md' }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
    >
      {/* backdrop */}
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* sheet */}
      <div
        className={[
          `relative w-full ${widthClass} bg-bg-surface border border-border`,
          'rounded-t-lg md:rounded-lg shadow-soft',
          'max-h-[88vh] overflow-y-auto',
          'animate-[slideup_220ms_cubic-bezier(0.2,0.8,0.2,1)]',
        ].join(' ')}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* drag handle (mobile only) */}
        <div aria-hidden className="md:hidden pt-2 grid place-items-center">
          <span className="block w-10 h-1 rounded-full bg-fg-muted/40" />
        </div>

        <div className="flex items-center justify-between px-md pt-md pb-2">
          <h3 className="text-card-title">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="h-9 w-9 grid place-items-center rounded-md hover:bg-bg-elevated focus-ring text-fg-muted"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-md pb-md">{children}</div>
      </div>

      <style>{`
        @keyframes slideup {
          from { transform: translateY(100%); opacity: 0.6; }
          to   { transform: translateY(0%);   opacity: 1; }
        }
        @media (min-width: 768px) {
          @keyframes slideup {
            from { transform: translateY(8px); opacity: 0; }
            to   { transform: translateY(0);   opacity: 1; }
          }
        }
      `}</style>
    </div>
  );
}
