import { ReactNode, useEffect } from 'react';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { BottomSheet } from './BottomSheet';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

export function AdaptiveSheet({ open, onClose, title, children, size = 'md' }: Props) {
  const bp = useBreakpoint();

  // Esc key + body scroll lock (desktop)
  useEffect(() => {
    if (bp === 'mobile' || !open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [bp, open, onClose]);

  // Mobile: BottomSheet existente (zero mudança)
  if (bp === 'mobile') {
    return (
      <BottomSheet open={open} onClose={onClose} title={title ?? ''}>
        {children}
      </BottomSheet>
    );
  }

  // Desktop/Tablet: modal central com backdrop
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`bg-bg-surface border border-border rounded-xl w-full ${widths[size]} max-h-[85vh] overflow-y-auto shadow-2xl`}
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-bg-surface z-10">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="p-1.5 rounded-md hover:bg-bg-elevated text-fg-muted hover:text-fg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
