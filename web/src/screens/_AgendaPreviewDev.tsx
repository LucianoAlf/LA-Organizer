// Dev-only preview route — renderiza o AgendaShell completo com mock data, sem auth.
// Inclui fake sidebar global à esquerda pra mostrar como fica tudo junto.

import { useMemo, useState } from 'react';
import { CalendarDays, Rocket, ClipboardCheck, Sparkles, Users, Settings } from 'lucide-react';
import { AgendaShell, type AgendaView } from './agenda/AgendaShell';
import { AgendaLeftRail } from './agenda/AgendaLeftRail';
import { TasksPanel } from './agenda/TasksPanel';
import { DayView } from './agenda/views/DayView';
import { WeekView } from './agenda/views/WeekView';
import { MonthView } from './agenda/views/MonthView';
import { MonthDayDrawer } from './agenda/components/MonthDayDrawer';
import { useAgendaFilters } from './agenda/hooks/useAgendaFilters';
import type { EventForGrid } from './agenda/hooks/useAgendaEvents';
import type { TaskForPanel } from './agenda/hooks/useAgendaTasks';

function todayAt(hour: number, minute = 0): string {
  const d = new Date(); d.setHours(hour, minute, 0, 0); return d.toISOString();
}
function startOfWeek(d: Date) { const x=new Date(d); x.setDate(d.getDate()-d.getDay()); x.setHours(0,0,0,0); return x; }
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }

const MOCK_EVENTS: EventForGrid[] = [
  { id: 'e1', title: 'Reunião com Rodrigo', start_at: todayAt(7), end_at: todayAt(8),
    context: 'work', category: 'la_music', category_color: '#A3BE50',
    modality: 'presencial', location_text: 'Sede Barra', meeting_url: null,
    status: 'scheduled', project_id: null, source: 'manual' },
  { id: 'e2', title: 'Review do Sprint', start_at: todayAt(9), end_at: todayAt(10, 30),
    context: 'work', category: 'la_music', category_color: '#A3BE50',
    modality: 'online', location_text: null, meeting_url: 'https://meet.google.com/x',
    status: 'scheduled', project_id: null, source: 'tom' },
  { id: 'e3', title: 'Mentoria Levi', start_at: todayAt(11), end_at: todayAt(12),
    context: 'work', category: 'mentoria', category_color: '#7B61FF',
    modality: 'online', location_text: null, meeting_url: 'https://meet.google.com/y',
    status: 'scheduled', project_id: null, source: 'tom' },
  { id: 'e4', title: 'Academia', start_at: todayAt(13), end_at: todayAt(14),
    context: 'personal', category: 'pessoal', category_color: '#64748B',
    modality: 'presencial', location_text: 'Smart Fit', meeting_url: null,
    status: 'scheduled', project_id: null, source: 'manual' },
  { id: 'e5', title: 'Reunião pedagógica', start_at: todayAt(14, 30), end_at: todayAt(15, 30),
    context: 'work', category: 'la_music', category_color: '#A3BE50',
    modality: 'presencial', location_text: 'Sede Barra', meeting_url: null,
    status: 'scheduled', project_id: null, source: 'manual' },
  { id: 'e6', title: 'Gravação estúdio', start_at: todayAt(16), end_at: todayAt(17, 30),
    context: 'work', category: 'estudio', category_color: '#EC4899',
    modality: 'presencial', location_text: 'Estúdio', meeting_url: null,
    status: 'scheduled', project_id: null, source: 'manual' },
  { id: 'e7', title: '1:1 Peterson', start_at: todayAt(9, 30), end_at: todayAt(10),
    context: 'work', category: 'mentoria', category_color: '#7B61FF',
    modality: 'online', location_text: null, meeting_url: null,
    status: 'scheduled', project_id: null, source: 'manual' },
];

const todayIso = new Date().toISOString().slice(0, 10);
const MOCK_TASKS: TaskForPanel[] = [
  { id: 't1', title: 'Revisar checklist abertura', context: 'work', status: 'pending',
    scheduled_date: todayIso, due_date: todayIso, delegated_to: null },
  { id: 't2', title: 'Feedback prof. Peterson', context: 'work', status: 'pending',
    scheduled_date: todayIso, due_date: null, delegated_to: null },
  { id: 't3', title: 'Alinhar Festival de Cordas', context: 'work', status: 'pending',
    scheduled_date: todayIso, due_date: null, delegated_to: null },
  { id: 't4', title: 'Enviar relatório semanal', context: 'work', status: 'done',
    scheduled_date: todayIso, due_date: todayIso, delegated_to: null },
  { id: 't5', title: 'Consulta médica agendar', context: 'personal', status: 'pending',
    scheduled_date: todayIso, due_date: null, delegated_to: null },
];

// Fake sidebar global (visual only, pra mostrar a foto completa do desktop)
function FakeGlobalSidebar() {
  const items = [
    { label: 'Agenda', Icon: CalendarDays, active: true },
    { label: 'Projetos', Icon: Rocket },
    { label: 'Checklists', Icon: ClipboardCheck },
    { label: 'Hábitos', Icon: Sparkles },
    { label: 'Dashboard time', Icon: Users },
    { label: 'Configurações', Icon: Settings },
  ];
  return (
    <aside className="w-[240px] shrink-0 bg-bg-surface border-r border-border flex flex-col">
      <div className="h-14 flex items-center gap-3 px-4 border-b border-border">
        <div className="w-8 h-8 rounded-full bg-tom/30 grid place-items-center text-[14px]">👽</div>
        <div>
          <div className="text-[13px] font-semibold text-fg">TOM</div>
          <div className="text-[10px] text-fg-muted">LA Organizer</div>
        </div>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-fg-muted/60 font-semibold">Principal</div>
        {items.map(it => (
          <div key={it.label}
            className={['flex items-center gap-3 h-9 px-3 rounded-md text-[13px]',
              it.active ? 'bg-tom/15 text-tom font-medium' : 'text-fg-muted'].join(' ')}>
            <it.Icon size={16} />
            <span>{it.label}</span>
          </div>
        ))}
      </nav>
    </aside>
  );
}

export default function AgendaPreviewDev() {
  const [view, setView] = useState<AgendaView>('day');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedMonthDay, setSelectedMonthDay] = useState<Date | null>(new Date());
  const [miniMonth, setMiniMonth] = useState(startOfMonth(new Date()));
  const { filters, toggle } = useAgendaFilters();

  const daysWithEvents = useMemo(() => {
    const s = new Set<string>();
    MOCK_EVENTS.forEach(e => s.add(e.start_at.slice(0,10)));
    return s;
  }, []);

  const centerLabel =
    view === 'day' ? currentDate.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) :
    view === 'week' ? `${startOfWeek(currentDate).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} – ...` :
    miniMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="fixed inset-0 flex bg-bg-app text-fg">
      <FakeGlobalSidebar />
      <div className="flex-1 min-w-0">
        <AgendaShell
          view={view} currentDate={currentDate} centerLabel={centerLabel}
          onChangeView={setView}
          onPrev={() => {}} onNext={() => {}} onToday={() => setCurrentDate(new Date())}
          onNewClick={() => {}}
          leftRail={
            <AgendaLeftRail
              miniMonth={miniMonth}
              selectedDay={view === 'month' ? selectedMonthDay : currentDate}
              daysWithEvents={daysWithEvents}
              tasks={MOCK_TASKS} filters={filters}
              onToggleFilter={toggle}
              onMiniMonthChange={setMiniMonth}
              onMiniDayClick={(d) => { setCurrentDate(d); setView('day'); }}
              onCountClick={() => {}}
            />
          }
          rightRail={view === 'month' ? (
            <div className="w-[320px] shrink-0 border-l border-border bg-bg-surface">
              <MonthDayDrawer
                selectedDay={selectedMonthDay} events={MOCK_EVENTS} tasks={MOCK_TASKS}
                onClose={() => setSelectedMonthDay(null)}
                onEventClick={() => {}} onTaskClick={() => {}}
                onCreateEvent={() => {}} onCreateTask={() => {}}
                onOpenDayView={(d) => { setCurrentDate(d); setView('day'); }}
              />
            </div>
          ) : (
            <TasksPanel
              view={view as 'day'|'week'} currentDate={currentDate}
              weekStart={startOfWeek(currentDate)}
              tasks={MOCK_TASKS}
              events={MOCK_EVENTS}
              onEventClick={() => {}}
              onTaskClick={() => {}} onToggleDone={() => {}} onCreateTask={() => {}}
              onEditTask={() => {}} onRescheduleTask={() => {}} onDeleteTask={() => {}}
            />
          )}
        >
          {view === 'day' && (
            <DayView date={currentDate} events={MOCK_EVENTS}
              onSlotClick={() => {}} onEventClick={() => {}}
              onEventDrop={() => {}} onEventResize={() => {}} />
          )}
          {view === 'week' && (
            <WeekView weekStart={startOfWeek(currentDate)} events={MOCK_EVENTS}
              onSlotClick={() => {}} onEventClick={() => {}}
              onEventDrop={() => {}} onEventResize={() => {}} />
          )}
          {view === 'month' && (
            <MonthView monthDate={miniMonth} events={MOCK_EVENTS}
              selectedDay={selectedMonthDay}
              onDayClick={setSelectedMonthDay}
              onDayDoubleClick={(d) => { setCurrentDate(d); setView('day'); }}
              onEventClick={() => {}} onEmptyAreaClick={() => {}} />
          )}
        </AgendaShell>
      </div>
    </div>
  );
}
