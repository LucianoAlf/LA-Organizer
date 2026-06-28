import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAgendaTasks } from './agenda/hooks/useAgendaTasks';
import { useAgendaEvents } from './agenda/hooks/useAgendaEvents';
import type { AgendaFilters } from './agenda/hooks/useAgendaFilters';
import { getMonthGrid } from './agenda/lib/monthGrid';
import { MonthGrid } from './agenda/mobile/MonthGrid';
import { MonthDaySheet } from './agenda/mobile/MonthDaySheet';
import { Fab } from '../components/Fab';
import { QuickCreateSheet } from '../components/QuickCreateSheet';

// Mês = visão geral: mostra tudo (sem as pills de contexto do Dia/Semana).
const ALL_FILTERS: AgendaFilters = { trabalho: true, pessoal: true, delegadas: true };

function firstOfThisMonth(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1);
}

export function Mes() {
  const navigate = useNavigate();
  const [viewMonth, setViewMonth] = useState<Date>(firstOfThisMonth);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const grid = getMonthGrid(viewMonth);
  const from = grid[0];
  const last = grid[grid.length - 1];
  const to = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59);

  const { tasks } = useAgendaTasks({ from, to, filters: ALL_FILTERS });
  const { events } = useAgendaEvents({ from, to, filters: ALL_FILTERS });

  const monthLabelRaw = viewMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const monthLabel = monthLabelRaw.charAt(0).toUpperCase() + monthLabelRaw.slice(1);
  const now = new Date();
  const isCurMonth = now.getFullYear() === viewMonth.getFullYear() && now.getMonth() === viewMonth.getMonth();
  const stepMonth = (delta: number) => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <div className="space-y-lg">
      <div className="surface px-md py-2 flex items-center gap-2">
        <button type="button" onClick={() => stepMonth(-1)} aria-label="Mês anterior" className="h-8 w-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated focus-ring">
          <ChevronLeft size={18} />
        </button>
        <span className="flex-1 text-center text-body-md text-fg">{monthLabel}</span>
        <button type="button" onClick={() => stepMonth(1)} aria-label="Próximo mês" className="h-8 w-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated focus-ring">
          <ChevronRight size={18} />
        </button>
        {!isCurMonth && (
          <button type="button" onClick={() => setViewMonth(firstOfThisMonth())} className="ml-1 px-2 py-1 text-body-sm rounded-sm bg-bg-elevated text-fg-secondary hover:text-fg focus-ring">
            Mês atual
          </button>
        )}
      </div>

      <MonthGrid monthDate={viewMonth} tasks={tasks} events={events} onDayClick={setSelectedDay} />

      <Fab onClick={() => setSheetOpen(true)} label="Novo" ariaLabel="Criar novo item" />
      <QuickCreateSheet open={sheetOpen} onClose={() => setSheetOpen(false)} defaultDueDate={selectedDay ?? undefined} />
      <MonthDaySheet
        open={Boolean(selectedDay)}
        ymd={selectedDay}
        onClose={() => setSelectedDay(null)}
        onOpenFullDay={(ymd) => navigate(`/hoje?date=${ymd}`)}
      />
    </div>
  );
}
