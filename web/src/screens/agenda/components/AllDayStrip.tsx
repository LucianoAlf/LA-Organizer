import type { TaskForPanel } from '../hooks/useAgendaTasks';

interface Props {
  /** Tarefas com due_date no período visível, SEM remind_at (sem hora). */
  tasks: TaskForPanel[];
  onTaskClick: (t: TaskForPanel) => void;
}

const QUADRANT_DOT: Record<string, string> = {
  '1': 'bg-danger',
  '2': 'bg-warning',
  '3': 'bg-info',
};

export function AllDayStrip({ tasks, onTaskClick }: Props) {
  if (tasks.length === 0) return null;

  return (
    <div className="border-b border-dashed border-border px-3 py-2 bg-bg-app">
      <div className="text-[9px] uppercase tracking-wider text-fg-muted font-semibold mb-1.5">
        Dia todo · vencimentos sem hora
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tasks.map(t => {
          const q = t.eisenhower_quadrant != null ? String(t.eisenhower_quadrant) : null;
          const dot = q && QUADRANT_DOT[q];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTaskClick(t)}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] border-l-[3px] bg-bg-elevated border-fg-muted hover:bg-bg-elevated2 focus-ring text-fg"
            >
              {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
              <span className="truncate max-w-[160px]">{t.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
