import { useMemo, useState } from 'react';
import { RowMenu } from '../../components/RowMenu';
import type { TaskForPanel } from './hooks/useAgendaTasks';

export interface TasksPanelProps {
  view: 'day' | 'week';
  currentDate: Date;
  weekStart: Date;
  tasks: TaskForPanel[];
  onTaskClick: (t: TaskForPanel) => void;
  onToggleDone: (t: TaskForPanel) => void;
  onCreateTask: (date: Date) => void;
  /** Editar (abre sheet/drawer da tarefa). Recebe task. */
  onEditTask: (t: TaskForPanel) => void;
  /** Reagendar (pede nova data e atualiza). Recebe task. */
  onRescheduleTask: (t: TaskForPanel) => void;
  /** Excluir tarefa. Recebe task. AgendaDesktop deve fazer confirm + delete. */
  onDeleteTask: (t: TaskForPanel) => void;
}

const LS = 'agenda.tasksPanel.collapsed';

export function TasksPanel(p: TasksPanelProps) {
  const inRange = useMemo(() => {
    const todayIso = p.currentDate.toISOString().slice(0, 10);
    const weekEnd = new Date(p.weekStart);
    weekEnd.setDate(p.weekStart.getDate() + 6);
    return p.tasks.filter(t => {
      const date = t.scheduled_date ?? t.due_date;
      if (!date) return false;
      const iso = date.slice(0, 10);
      if (p.view === 'day') return iso === todayIso;
      return (
        iso >= p.weekStart.toISOString().slice(0, 10) &&
        iso <= weekEnd.toISOString().slice(0, 10)
      );
    });
  }, [p.tasks, p.view, p.currentDate, p.weekStart]);

  const today = new Date().toISOString().slice(0, 10);
  const overdue = inRange.filter(
    t => t.due_date && t.due_date < today && t.status !== 'done',
  );
  const todayTasks = inRange.filter(
    t => t.status !== 'done' && (t.scheduled_date ?? '').slice(0, 10) === today,
  );
  const done = inRange.filter(t => t.status === 'done');

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(LS) ?? '{}'); }
    catch { return {}; }
  });
  const toggle = (k: string) =>
    setCollapsed(prev => {
      const next = { ...prev, [k]: !prev[k] };
      try { localStorage.setItem(LS, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });

  const renderRow = (t: TaskForPanel, done = false) => (
    <TaskRow
      key={t.id}
      task={t}
      onClick={p.onTaskClick}
      onToggle={p.onToggleDone}
      onEdit={p.onEditTask}
      onReschedule={p.onRescheduleTask}
      onDelete={p.onDeleteTask}
      done={done}
    />
  );

  return (
    <aside className="w-[320px] shrink-0 border-l border-border bg-bg-surface flex flex-col">
      <header className="px-3 py-3 border-b border-border">
        <div className="text-[13px] font-semibold text-fg">Tarefas</div>
        <div className="text-[11px] text-fg-muted">
          {p.view === 'day'
            ? p.currentDate.toLocaleDateString('pt-BR', {
                weekday: 'short', day: '2-digit', month: '2-digit',
              })
            : 'Semana'}
          {' · '}
          {todayTasks.length + overdue.length} pendentes
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-[12px]">
        <Section title={`ATRASADAS (${overdue.length})`} k="overdue"
          collapsed={collapsed.overdue ?? overdue.length === 0}
          onToggle={() => toggle('overdue')}>
          {overdue.map(t => renderRow(t))}
        </Section>
        <Section title={`PRA HOJE (${todayTasks.length})`} k="today"
          collapsed={!!collapsed.today} onToggle={() => toggle('today')}>
          {todayTasks.map(t => renderRow(t))}
        </Section>
        <Section title={`CONCLUÍDAS (${done.length})`} k="done"
          collapsed={collapsed.done ?? true} onToggle={() => toggle('done')}>
          {done.map(t => renderRow(t, true))}
        </Section>
      </div>
      <div className="px-3 py-2 border-t border-border">
        <button
          onClick={() => p.onCreateTask(p.currentDate)}
          className="w-full h-8 rounded-md bg-bg-elevated border border-border text-[12px] text-fg hover:bg-bg-elevated2 focus-ring"
        >
          + Tarefa
        </button>
      </div>
    </aside>
  );
}

function Section({
  title, collapsed, onToggle, children,
}: {
  title: string; k: string; collapsed: boolean;
  onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <section>
      <button onClick={onToggle}
        className="w-full text-left text-[10px] uppercase tracking-wider text-fg-muted font-semibold py-1 hover:text-fg focus-ring rounded">
        {collapsed ? '▶' : '▼'} {title}
      </button>
      {!collapsed && <div className="space-y-1">{children}</div>}
    </section>
  );
}

function TaskRow({
  task, onClick, onToggle, onEdit, onReschedule, onDelete, done,
}: {
  task: TaskForPanel;
  onClick: (t: TaskForPanel) => void;
  onToggle: (t: TaskForPanel) => void;
  onEdit: (t: TaskForPanel) => void;
  onReschedule: (t: TaskForPanel) => void;
  onDelete: (t: TaskForPanel) => void;
  done?: boolean;
}) {
  return (
    <div className="group flex items-start gap-2 px-2 py-1.5 rounded hover:bg-bg-elevated">
      <input
        type="checkbox"
        checked={task.status === 'done'}
        onChange={() => onToggle(task)}
        className="mt-0.5 accent-tom"
      />
      <button
        onClick={() => onClick(task)}
        className={[
          'flex-1 text-left text-[12px] text-fg truncate focus-ring rounded',
          done ? 'opacity-60 line-through' : '',
        ].join(' ')}
      >
        {task.title}
      </button>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <RowMenu
          items={[
            { label: 'Editar', onClick: () => onEdit(task) },
            { label: 'Reagendar', onClick: () => onReschedule(task) },
            {
              label: 'Excluir tarefa',
              danger: true,
              confirm: 'Excluir essa tarefa? Essa ação não pode ser desfeita.',
              onClick: () => onDelete(task),
            },
          ]}
        />
      </div>
    </div>
  );
}
