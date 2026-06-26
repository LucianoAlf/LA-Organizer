// Sprint 2026-06-25 — view de LEITURA de tarefa (read-only). Nasce porque a descrição
// só era legível dentro do form de edição, num campo travado que cortava (feedback da
// equipe). Aqui a descrição aparece INTEIRA (whitespace-pre-wrap, sem teto de altura),
// e a edição fica atrás do botão "Editar". Apresentacional: o caller passa props
// normalizadas (3 superfícies: agenda mobile, agenda desktop, workspace de grupo).
import type { ReactNode } from 'react';
import { Repeat } from 'lucide-react';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { Badge } from './Badge';

interface TaskDetailSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  metaLine: ReactNode;
  description?: string | null;
  dueLabel?: string | null;
  statusTone?: 'neutral' | 'warning' | 'danger' | 'success';
  statusLabel?: string | null;
  doneByLine?: ReactNode;
  isRecurring?: boolean;
  canComplete?: boolean;
  isDone?: boolean;
  completing?: boolean;
  onComplete?: () => void;
  onReopen?: () => void;
  onEdit?: () => void;
}

export function TaskDetailSheet({
  open, onClose, title, metaLine, description, dueLabel, statusTone = 'neutral', statusLabel,
  doneByLine, isRecurring, canComplete, isDone, completing, onComplete, onReopen, onEdit,
}: TaskDetailSheetProps) {
  const desc = (description ?? '').trim();
  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Tarefa" size="md">
      <div className="space-y-md">
        <p className="text-body-sm text-fg-muted flex items-center gap-1.5">
          <span className="min-w-0 break-words">{metaLine}</span>
          {isRecurring && <Repeat size={13} className="shrink-0" aria-label="Recorrente" />}
        </p>
        <h2 className="text-lg font-semibold text-fg leading-snug break-words">{title}</h2>
        {(dueLabel || statusLabel) && (
          <div className="flex flex-wrap items-center gap-xs">
            {dueLabel && <Badge tone="neutral">{dueLabel}</Badge>}
            {statusLabel && <Badge tone={statusTone}>{statusLabel}</Badge>}
          </div>
        )}
        {doneByLine && <p className="text-body-sm text-fg-muted">{doneByLine}</p>}
        <div>
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1">Descrição</div>
          {desc
            ? <div className="text-body-md text-fg whitespace-pre-wrap break-words">{desc}</div>
            : <div className="text-body-sm text-fg-muted italic">Sem descrição.</div>}
        </div>
        <div className="flex items-center gap-sm pt-sm border-t border-border">
          {canComplete && !isDone && onComplete && (
            <Button variant="primary" size="md" loading={completing} onClick={onComplete}>Concluir</Button>
          )}
          {isDone && onReopen && (
            <Button variant="secondary" size="md" onClick={onReopen}>Reabrir</Button>
          )}
          <div className="ml-auto flex gap-sm">
            {onEdit && <Button variant="secondary" size="md" onClick={onEdit}>Editar</Button>}
            <Button variant="ghost" size="md" onClick={onClose}>Fechar</Button>
          </div>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
