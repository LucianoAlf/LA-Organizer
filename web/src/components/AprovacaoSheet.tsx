import { useState } from 'react';
import { AdaptiveSheet } from './AdaptiveSheet';
import type { Announcement } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  announcement: Announcement | null;
  onConfirm: (reason: string | null) => Promise<void>;
}

export function AprovacaoSheet({ open, onClose, announcement, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleConfirm = async () => {
    setErr(null);
    setSubmitting(true);
    try {
      await onConfirm(reason.trim() || null);
      setReason('');
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? 'Erro ao rejeitar.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setReason('');
    setErr(null);
    onClose();
  };

  if (!announcement) return null;

  const preview = announcement.body.length > 120
    ? announcement.body.slice(0, 120) + '...'
    : announcement.body;

  return (
    <AdaptiveSheet open={open} onClose={handleClose} title="Rejeitar comunicado" size="sm">
      <div className="space-y-md">
        <div className="text-body-sm text-fg-muted">
          Comunicado de <strong>{announcement.created_by.slice(0, 8)}</strong>:
        </div>
        <div className="surface p-md text-body-sm">"{preview}"</div>

        <label className="block">
          <span className="text-body-sm text-fg-muted">Motivo da rejeição (opcional)</span>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="ex: texto muito longo, horário errado..."
            className="mt-1 w-full bg-bg-elevated border border-border rounded-sm p-md text-body-md focus:border-brand focus-ring"
            disabled={submitting}
          />
        </label>

        {err && <div className="text-body-sm text-danger">{err}</div>}

        <div className="flex gap-md justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="h-9 px-3 rounded-sm bg-bg-elevated border border-border text-body-sm focus-ring"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="h-9 px-3 rounded-sm bg-danger/10 border border-danger/40 text-danger text-body-sm focus-ring"
          >
            {submitting ? 'Rejeitando...' : 'Confirmar rejeição'}
          </button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
