// web/src/components/TaskGroupCard.tsx
// Card do grupo nas listas do dia (Hoje/Semana) — tela aprovada no Companion.
// Mostra filhas relevantes do dia (due<=hoje não-done + done hoje) e resume o resto.
import { TaskCheckbox } from './TaskCheckbox';
import { Badge } from './Badge';
import { cycleLabel } from '../lib/taskGroups';
import type { Task } from '../types';

interface Props {
  group: Task;                       // mãe com subtasks carregadas
  viewYmd: string;                   // dia da lista (YYYY-MM-DD)
  onToggleChild: (child: Task, done: boolean) => void;
  onOpen: (group: Task) => void;     // abre TaskGroupSheet
}

function brDay(ymd: string | null | undefined): string {
  if (!ymd) return '';
  return `dia ${Number(ymd.slice(8, 10))}`;
}

export function TaskGroupCard({ group, viewYmd, onToggleChild, onOpen }: Props) {
  const kids = group.subtasks ?? [];
  const total = kids.filter(k => k.status !== 'cancelled').length;
  const done = kids.filter(k => k.status === 'done').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const todayKids = kids.filter(k =>
    k.status !== 'cancelled' && (
      (k.status !== 'done' && k.due_date != null && k.due_date <= viewYmd) ||
      (k.status === 'done' && (k.completed_at ?? '').slice(0, 10) === viewYmd)
    )
  );
  const restKids = kids.filter(k => k.status !== 'cancelled' && k.status !== 'done' && !todayKids.includes(k));
  const ciclo = group.recurrence_parent_id && group.due_date ? cycleLabel(group.due_date) : null;

  return (
    <article className="surface overflow-hidden">
      <button type="button" onClick={() => onOpen(group)} className="w-full text-left p-md pb-2 focus-ring">
        <div className="flex items-center gap-2">
          <span aria-hidden>🗂️</span>
          <span className="text-body-md font-semibold min-w-0 flex-1 truncate">{group.title}</span>
          {group.work_group?.name && (
            <Badge tone="success">👥 {group.work_group.name}</Badge>
          )}
          <span className="text-body-sm text-fg-muted tabular-nums shrink-0">
            {done}/{total}{ciclo ? ` · ${ciclo}` : ''}{group.due_date ? ` · prazo ${brDay(group.due_date)}` : ''}
          </span>
        </div>
        <div className="mt-2 h-1 w-full bg-bg-elevated rounded-full overflow-hidden" role="progressbar"
          aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-tom transition-all" style={{ width: `${pct}%` }} />
        </div>
      </button>

      {todayKids.length > 0 && (
        <div className="border-t border-border bg-bg-subtle px-md py-1">
          {todayKids.map(k => {
            const isDone = k.status === 'done';
            const overdue = !isDone && k.due_date != null && k.due_date < viewYmd;
            const hm = k.due_time ? k.due_time.slice(0, 5) : null;
            return (
              <div key={k.id} className="flex items-center gap-2.5 py-2 border-b border-border/60 last:border-b-0">
                <TaskCheckbox done={isDone} overdue={overdue} size="sm"
                  onClick={() => onToggleChild(k, !isDone)} />
                <span className={['text-body-sm min-w-0 flex-1 truncate', isDone ? 'line-through text-fg-muted' : 'text-fg'].join(' ')}>
                  {k.title}
                </span>
                <span className={['text-body-sm shrink-0 tabular-nums', overdue ? 'text-danger' : 'text-fg-muted'].join(' ')}>
                  {overdue ? `atrasada (${brDay(k.due_date)})` : k.due_date === viewYmd ? `hoje${hm ? ` · 🕐 ${hm}` : ''}` : ''}
                </span>
              </div>
            );
          })}
          {restKids.length > 0 && (
            <button type="button" onClick={() => onOpen(group)}
              className="w-full text-left py-2 text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm">
              ▸ +{restKids.length} no mês — {restKids.slice(0, 4).map(k => `${k.title.split(' ').slice(-1)[0]} (${Number((k.due_date ?? '').slice(8, 10) || '?')})`).join(', ')}{restKids.length > 4 ? '…' : ''}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
