import { ReactNode } from 'react';

type Props = {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'primary',
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  const confirmColors =
    variant === 'danger'
      ? 'bg-rose-500 hover:bg-rose-600 text-white'
      : 'bg-green-600 hover:bg-green-500 active:bg-green-700 text-white';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-700 shadow-2xl p-6"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">{title}</h2>
        {description && (
          <div className="text-sm text-zinc-300 mb-5">{description}</div>
        )}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl text-sm font-semibold ${confirmColors}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
