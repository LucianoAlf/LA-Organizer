// web/src/components/ConfirmDialog.tsx
// Sprint 29.x — atualizado para usar DS tokens + Button + suporte a isPending.
// Backward-compat: onCancel ainda funciona (alias de onClose).
// Zero dialogs nativos — funciona no Simple Browser, PWA e desktop.
import type { ReactNode } from 'react'
import { Button } from './Button'

type Props = {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Novo — preferred. Alias de variant. */
  confirmVariant?: 'primary' | 'danger'
  /** Legacy — mantido para callers existentes. */
  variant?: 'primary' | 'danger'
  onConfirm: () => void
  /** Novo — preferred. Alias de onCancel. */
  onClose?: () => void
  /** Legacy — mantido para callers existentes. */
  onCancel?: () => void
  isPending?: boolean
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  confirmVariant,
  variant = 'primary',
  onConfirm,
  onClose,
  onCancel,
  isPending = false,
}: Props) {
  if (!open) return null

  const handleClose = onClose ?? onCancel ?? (() => {})
  const resolvedVariant = confirmVariant ?? variant

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-bg-surface border border-border shadow-2xl p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-card-title text-fg">{title}</h2>
        {description && (
          <p className="text-body-md text-fg-muted">{description}</p>
        )}
        <div className="flex gap-3">
          <div className="flex-1">
            <Button
              variant="secondary"
              size="md"
              fullWidth
              type="button"
              onClick={handleClose}
              disabled={isPending}
            >
              {cancelLabel}
            </Button>
          </div>
          <div className="flex-1">
            <Button
              variant={resolvedVariant}
              size="md"
              fullWidth
              type="button"
              onClick={onConfirm}
              loading={isPending}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
