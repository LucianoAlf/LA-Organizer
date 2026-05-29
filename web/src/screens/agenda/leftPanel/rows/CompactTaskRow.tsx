import { Bell, ArrowRight, Repeat, Clock } from 'lucide-react';
import type { TaskForPanel } from '../../hooks/useAgendaTasks';
import { useCollaboratorNames } from '../../hooks/useCollaboratorNames';

/**
 * Single-line compact task row para o painel esquerdo desktop (400px).
 * Layout: [checkbox] [eisenhower dot] [title] [🔔hora?] [→ Nome?] [badge atraso?]
 */
interface Props {
  task: TaskForPanel;
  onToggle: () => void;
  onClick: () => void;
  /** Texto opcional de badge à direita (ex: "5d" pra atrasada). */
  trailingBadge?: { text: string; tone: 'danger' | 'warning' | 'neutral' };
}

const QUADRANT_DOT: Record<string, string> = {
  '1': 'bg-danger',
  '2': 'bg-warning',
  '3': 'bg-info',
  '4': 'bg-fg-muted/60',
};

function formatHM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const BADGE_TONE: Record<'danger' | 'warning' | 'neutral', string> = {
  danger: 'bg-danger/20 text-danger border-danger/30',
  warning: 'bg-warning/20 text-warning border-warning/30',
  neutral: 'bg-bg-elevated text-fg-muted border-border',
};

export function CompactTaskRow({ task, onToggle, onClick, trailingBadge }: Props) {
  const isDone = task.status === 'done';
  const q = task.eisenhower_quadrant != null ? String(task.eisenhower_quadrant) : null;
  const dot = q && QUADRANT_DOT[q];
  const remindHM = task.remind_at ? formatHM(task.remind_at) : null;
  // Sprint 30 — horário-alvo da tarefa (due_time "HH:MM:SS" → "HH:MM").
  const dueHM = task.due_time ? task.due_time.slice(0, 5) : null;
  const names = useCollaboratorNames();
  const delegatedToName = names.firstName(task.delegated_to);

  return (
    <div className="group flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-elevated min-w-0">
      <input
        type="checkbox"
        checked={isDone}
        onChange={(e) => { e.stopPropagation(); onToggle(); }}
        className="w-3.5 h-3.5 accent-tom shrink-0 cursor-pointer"
        aria-label="Marcar como feita"
      />
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} aria-hidden title={`Prioridade Q${q}`} />}
      <button
        type="button"
        onClick={onClick}
        className={[
          'flex-1 text-left text-[12px] truncate focus-ring rounded',
          isDone ? 'text-fg-muted line-through' : 'text-fg',
        ].join(' ')}
      >
        {task.title}
      </button>
      {dueHM && (
        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-fg-muted tabular-nums" title={`Horário da tarefa: ${dueHM}`}>
          <Clock size={10} aria-hidden />
          {dueHM}
        </span>
      )}
      {task.is_recurring && (
        <span className="shrink-0 inline-flex items-center text-fg-muted" title="Tarefa recorrente">
          <Repeat size={11} aria-label="Recorrente" />
        </span>
      )}
      {remindHM && (
        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-tom tabular-nums" title={`Lembrete às ${remindHM}`}>
          <Bell size={10} aria-hidden />
          {remindHM}
        </span>
      )}
      {delegatedToName && (
        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-fg-muted max-w-[80px] truncate" title={`Delegada pra ${delegatedToName}`}>
          <ArrowRight size={10} aria-hidden />
          <span className="truncate">{delegatedToName}</span>
        </span>
      )}
      {trailingBadge && (
        <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border tabular-nums ${BADGE_TONE[trailingBadge.tone]}`}>
          {trailingBadge.text}
        </span>
      )}
    </div>
  );
}
