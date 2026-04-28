import { Check } from 'lucide-react';
import { Badge } from './Badge';
import type { Task } from '../types';

interface Props {
  task: Task;
  onToggle?: (task: Task) => void;
  /** Quando true, esconde o checkbox e bloqueia interação. Para visões coord/director em PessoaDetalhe. */
  readOnly?: boolean;
}

function fmtDayMonth(iso: string | null) {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : '';
}

function statusOf(task: Task): { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string | null } {
  if (task.status === 'done') return { tone: 'success', label: 'Concluída' };
  if (task.status === 'overdue') return { tone: 'danger', label: 'Atrasada' };
  if (task.due_date) {
    const today = new Date().toISOString().slice(0, 10);
    if (task.due_date < today) return { tone: 'danger', label: 'Atrasada' };
    if (task.due_date === today) return { tone: 'warning', label: 'Vence hoje' };
  }
  return { tone: 'neutral', label: null };
}

export function TaskRow({ task, onToggle, readOnly }: Props) {
  const { tone, label } = statusOf(task);
  const isDone = task.status === 'done';
  return (
    <div
      className={[
        'flex items-start gap-md py-3 border-b border-border last:border-0',
        isDone ? 'opacity-60' : '',
      ].join(' ')}
    >
      {!readOnly && (
        <button
          type="button"
          onClick={() => onToggle?.(task)}
          aria-label={isDone ? 'Reabrir tarefa' : 'Concluir tarefa'}
          className={[
            'mt-0.5 h-6 w-6 shrink-0 rounded-md border grid place-items-center transition-colors focus-ring',
            isDone
              ? 'bg-success border-success text-white'
              : 'border-border hover:border-brand text-transparent hover:text-brand',
          ].join(' ')}
        >
          <Check size={14} strokeWidth={3} />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <div className={['text-body-md', isDone ? 'line-through' : ''].join(' ')}>
          {task.title}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
          {task.due_date && <span className="tabular-nums">📅 {fmtDayMonth(task.due_date)}</span>}
          {task.projects?.name && <span>• {task.projects.name}</span>}
          {task.context === 'personal' && <span>• pessoal</span>}
        </div>
      </div>

      {label && <Badge tone={tone}>{label}</Badge>}
    </div>
  );
}
