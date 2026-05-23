import { X } from 'lucide-react';
import { EventChip } from './EventChip';
import type { EventForGrid } from '../hooks/useAgendaEvents';
import type { TaskForPanel } from '../hooks/useAgendaTasks';

export interface MonthDayDrawerProps {
  selectedDay: Date | null;
  events: EventForGrid[];
  tasks: TaskForPanel[];
  onClose: () => void;
  onEventClick: (event: EventForGrid) => void;
  onTaskClick: (task: TaskForPanel) => void;
  onCreateEvent: (date: Date) => void;
  onCreateTask: (date: Date) => void;
  onOpenDayView: (date: Date) => void;
}

export function MonthDayDrawer(p: MonthDayDrawerProps) {
  if (!p.selectedDay) {
    return (
      <div className="h-full flex items-center justify-center text-fg-muted text-[12px] p-4 text-center">
        Selecione um dia no calendário para ver eventos e tarefas
      </div>
    );
  }
  const d = p.selectedDay;
  const iso = d.toISOString().slice(0, 10);
  const dayEvents = p.events.filter(e => e.start_at.slice(0, 10) === iso);
  const dayTasks = p.tasks.filter(t => {
    const taskDate = t.scheduled_date ?? t.due_date;
    return taskDate?.slice(0, 10) === iso;
  });
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-border flex items-start justify-between">
        <div>
          <div className="text-[14px] font-semibold text-fg capitalize">
            {d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </div>
          <div className="text-[11px] text-fg-muted">
            {dayEvents.length} {dayEvents.length === 1 ? 'evento' : 'eventos'} · {dayTasks.length} {dayTasks.length === 1 ? 'tarefa' : 'tarefas'}
          </div>
        </div>
        <button onClick={p.onClose} className="text-fg-muted hover:text-fg focus-ring rounded"><X size={14}/></button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        <section>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1">Eventos do dia</div>
          {dayEvents.length === 0 ? (
            <div className="text-[11px] text-fg-muted italic">Nenhum evento</div>
          ) : (
            <div className="space-y-1">
              {dayEvents.map(ev => <EventChip key={ev.id} event={ev} onClick={p.onEventClick} />)}
            </div>
          )}
        </section>
        <section>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1">Tarefas do dia</div>
          {dayTasks.length === 0 ? (
            <div className="text-[11px] text-fg-muted italic">Nenhuma tarefa</div>
          ) : (
            <ul className="space-y-1">
              {dayTasks.map(t => (
                <li key={t.id}>
                  <button onClick={() => p.onTaskClick(t)}
                    className="w-full text-left text-[12px] text-fg hover:bg-bg-elevated rounded px-2 py-1 focus-ring">
                    {t.status === 'done' ? '☑' : '☐'} {t.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="px-3 py-2 border-t border-border space-y-2">
        <div className="flex gap-2">
          <button onClick={() => p.onCreateEvent(d)}
            className="flex-1 h-8 rounded-md bg-bg-elevated border border-border text-[12px] text-fg hover:bg-bg-elevated2 focus-ring">
            + Novo evento
          </button>
          <button onClick={() => p.onCreateTask(d)}
            className="flex-1 h-8 rounded-md bg-bg-elevated border border-border text-[12px] text-fg hover:bg-bg-elevated2 focus-ring">
            + Tarefa
          </button>
        </div>
        <button onClick={() => p.onOpenDayView(d)}
          className="w-full h-9 rounded-md bg-tom text-black text-[12px] font-semibold hover:opacity-90 focus-ring">
          Abrir vista Dia →
        </button>
      </div>
    </div>
  );
}
