import type { TaskForPanel } from '../../hooks/useAgendaTasks';

/**
 * Single-line compact task row para o painel esquerdo desktop (400px).
 * Layout: [checkbox] [eisenhower dot] [title truncated] [badge dias atraso]
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
};

const BADGE_TONE: Record<'danger' | 'warning' | 'neutral', string> = {
  danger: 'bg-danger/20 text-danger border-danger/30',
  warning: 'bg-warning/20 text-warning border-warning/30',
  neutral: 'bg-bg-elevated text-fg-muted border-border',
};

export function CompactTaskRow({ task, onToggle, onClick, trailingBadge }: Props) {
  const isDone = task.status === 'done';
  const q = task.eisenhower_quadrant != null ? String(task.eisenhower_quadrant) : null;
  const dot = q && QUADRANT_DOT[q];

  return (
    <div className="group flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-elevated min-w-0">
      <input
        type="checkbox"
        checked={isDone}
        onChange={(e) => { e.stopPropagation(); onToggle(); }}
        className="w-3.5 h-3.5 accent-tom shrink-0 cursor-pointer"
        aria-label="Marcar como feita"
      />
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} aria-hidden />}
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
      {trailingBadge && (
        <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border tabular-nums ${BADGE_TONE[trailingBadge.tone]}`}>
          {trailingBadge.text}
        </span>
      )}
    </div>
  );
}
