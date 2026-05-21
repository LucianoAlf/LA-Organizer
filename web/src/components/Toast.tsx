import { useEffect, useState } from 'react';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

// Sprint 22.34j — Toast minimal: notifica ações pelo botão direito inferior.
// Chamado via window.dispatchEvent(new CustomEvent('app-toast', { detail: ... })).
// Sem dependência externa, sem context provider — só window event bus.

export type ToastKind = 'success' | 'error' | 'info';
export interface ToastDetail {
  kind: ToastKind;
  title: string;
  msg?: string;
  /** ms; default 4500 */
  duration?: number;
}

interface InternalToast extends ToastDetail {
  id: number;
}

let nextId = 1;

export function showToast(detail: ToastDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastDetail>('app-toast', { detail }));
}

const KIND_TONE: Record<ToastKind, { border: string; icon: typeof CheckCircle2; iconColor: string }> = {
  success: { border: 'border-success', icon: CheckCircle2, iconColor: 'text-success' },
  error: { border: 'border-danger', icon: AlertCircle, iconColor: 'text-danger' },
  info: { border: 'border-info', icon: Info, iconColor: 'text-info' },
};

export function ToastHost() {
  const [toasts, setToasts] = useState<InternalToast[]>([]);
  const bp = useBreakpoint();
  const positionClass = bp === 'mobile' ? 'bottom-20 right-4' : 'top-4 right-4';

  useEffect(() => {
    function onToast(e: Event) {
      const ev = e as CustomEvent<ToastDetail>;
      const t: InternalToast = { ...ev.detail, id: nextId++ };
      setToasts(prev => [...prev, t]);
      const dur = t.duration ?? 4500;
      window.setTimeout(() => {
        setToasts(prev => prev.filter(x => x.id !== t.id));
      }, dur);
    }
    window.addEventListener('app-toast', onToast);
    return () => window.removeEventListener('app-toast', onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className={`fixed ${positionClass} z-[9999] flex flex-col gap-2 pointer-events-none max-w-[360px]`}>
      {toasts.map(t => {
        const tone = KIND_TONE[t.kind];
        const Icon = tone.icon;
        return (
          <div
            key={t.id}
            role="status"
            className={[
              'rounded-md border border-border border-l-4 p-3 shadow-card pointer-events-auto',
              'bg-bg-elevated',
              tone.border,
            ].join(' ')}
            style={{
              animation: 'toastSlideIn 220ms cubic-bezier(0.32, 0.72, 0, 1)',
            }}
          >
            <div className="flex items-start gap-2">
              <Icon size={18} className={['shrink-0 mt-0.5', tone.iconColor].join(' ')} />
              <div className="flex-1 min-w-0">
                <div className="text-body-sm font-semibold text-fg leading-tight">{t.title}</div>
                {t.msg && <div className="text-body-sm text-fg-secondary mt-0.5">{t.msg}</div>}
              </div>
              <button
                type="button"
                onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                aria-label="Fechar"
                className="shrink-0 -mr-1 -mt-1 p-1 text-fg-muted hover:text-fg focus-ring rounded-sm"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
      <style>{`
        @keyframes toastSlideIn {
          0% { opacity: 0; transform: translateY(24px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
