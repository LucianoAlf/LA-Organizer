import { MiniCalendar } from './components/MiniCalendar';
import type { AgendaFilters } from './hooks/useAgendaFilters';
import type { TaskForPanel } from './hooks/useAgendaTasks';

export interface AgendaLeftRailProps {
  miniMonth: Date;
  selectedDay: Date | null;
  daysWithEvents: Set<string>;
  tasks: TaskForPanel[];
  filters: AgendaFilters;
  onToggleFilter: (k: keyof AgendaFilters) => void;
  onMiniMonthChange: (next: Date) => void;
  onMiniDayClick: (day: Date) => void;
  onCountClick: (which: 'today' | 'done' | 'overdue') => void;
}

const CHIP_COLOR = {
  trabalho: '#A3BE50',
  pessoal: '#7B61FF',
  delegadas: '#06B6D4',
} as const;

export function AgendaLeftRail(p: AgendaLeftRailProps) {
  // delegated_to já vem como virtual derivado do hook useAgendaTasks
  // (created_by=eu E assigned_to!=eu → delegated_to=assigned_to, senão null)
  const isDelegated = (t: TaskForPanel) => t.delegated_to !== null;

  const today = new Date().toISOString().slice(0, 10);
  const counts = {
    today: p.tasks.filter(
      t => (t.scheduled_date ?? '').slice(0, 10) === today && t.status !== 'done',
    ).length,
    done: p.tasks.filter(t => t.status === 'done').length,
    overdue: p.tasks.filter(
      t => t.due_date && t.due_date < today && t.status !== 'done',
    ).length,
  };
  const chipCounts = {
    trabalho: p.tasks.filter(t => t.context === 'work' && !isDelegated(t)).length,
    pessoal: p.tasks.filter(t => t.context === 'personal').length,
    delegadas: p.tasks.filter(t => isDelegated(t)).length,
  };
  return (
    <aside className="w-[260px] shrink-0 border-r border-border bg-bg-surface overflow-y-auto flex flex-col">
      <MiniCalendar
        monthDate={p.miniMonth}
        selectedDay={p.selectedDay}
        daysWithEvents={p.daysWithEvents}
        onMonthChange={p.onMiniMonthChange}
        onDayClick={p.onMiniDayClick}
      />
      <div className="px-3 py-2 border-t border-border space-y-1.5">
        <CountRow label="PRA HOJE" value={counts.today} onClick={() => p.onCountClick('today')} />
        <CountRow
          label="CONCLUÍDAS"
          value={counts.done}
          onClick={() => p.onCountClick('done')}
          colorClass="text-success"
        />
        <CountRow
          label="ATRASADAS"
          value={counts.overdue}
          onClick={() => p.onCountClick('overdue')}
          colorClass="text-danger"
        />
      </div>
      <div className="px-3 py-2 border-t border-border">
        <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-2">
          Filtrar
        </div>
        {(['trabalho', 'pessoal', 'delegadas'] as const).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => p.onToggleFilter(k)}
            className={[
              'w-full flex items-center justify-between px-2 h-8 rounded-md text-[12px] focus-ring transition',
              p.filters[k] ? 'text-fg' : 'text-fg-muted opacity-60',
            ].join(' ')}
          >
            <span className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: CHIP_COLOR[k] }}
              />
              <span className="capitalize">{k}</span>
            </span>
            <span className="tabular-nums">{chipCounts[k]}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function CountRow({
  label,
  value,
  onClick,
  colorClass,
}: {
  label: string;
  value: number;
  onClick: () => void;
  colorClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-2 h-8 hover:bg-bg-elevated rounded-md focus-ring"
    >
      <span className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">
        {label}
      </span>
      <span
        className={['text-[14px] font-bold tabular-nums', colorClass ?? 'text-fg'].join(' ')}
      >
        {value}
      </span>
    </button>
  );
}
