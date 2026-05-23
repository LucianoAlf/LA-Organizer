import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

import { AgendaShell, type AgendaView } from './agenda/AgendaShell';
import { AgendaLeftRail } from './agenda/AgendaLeftRail';
import { TasksPanel } from './agenda/TasksPanel';
import { DayView } from './agenda/views/DayView';
import { WeekView } from './agenda/views/WeekView';
import { MonthView } from './agenda/views/MonthView';
import { MonthDayDrawer } from './agenda/components/MonthDayDrawer';
import { QuickCreatePopover } from './agenda/components/QuickCreatePopover';
import { EventEditDrawer } from './agenda/components/EventEditDrawer';
import { useAgendaFilters } from './agenda/hooks/useAgendaFilters';
import { useAgendaEvents, type EventForGrid } from './agenda/hooks/useAgendaEvents';
import { useAgendaTasks } from './agenda/hooks/useAgendaTasks';

// Toast fallback — projeto não tem sonner/react-hot-toast instalado.
// Aceitável para dev (single-user). Produção: instalar sonner e trocar.
const toast = {
  error: (msg: string) => {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined') window.alert(msg);
    else console.error(msg);
  },
  success: (msg: string) => {
    console.info(msg);
  },
};

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setDate(d.getDate() - d.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfWeek(d: Date) {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function formatWeekRange(d: Date) {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return `${s.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} – ${e.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
}

export function AgendaDesktop() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { collaborator } = useAuth();
  const collabId = collaborator?.id;

  const view = (params.get('view') as AgendaView) || 'day';
  const dateIso = params.get('date') ?? new Date().toISOString().slice(0, 10);
  const currentDate = useMemo(() => new Date(`${dateIso}T00:00:00`), [dateIso]);

  const { filters, toggle } = useAgendaFilters();
  const [selectedMonthDay, setSelectedMonthDay] = useState<Date | null>(null);
  const [miniMonth, setMiniMonth] = useState<Date>(startOfMonth(currentDate));
  const [quickCreate, setQuickCreate] = useState<{
    x: number; y: number; date: Date; time?: Date; mode: 'event' | 'task';
  } | null>(null);
  const [editingEvent, setEditingEvent] = useState<EventForGrid | null>(null);
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);

  const { from, to } = useMemo(() => {
    if (view === 'day') return { from: startOfDay(currentDate), to: endOfDay(currentDate) };
    if (view === 'week') return { from: startOfWeek(currentDate), to: endOfWeek(currentDate) };
    return { from: startOfMonth(currentDate), to: endOfMonth(currentDate) };
  }, [view, currentDate]);

  const { events } = useAgendaEvents({ from, to, filters });
  const { tasks } = useAgendaTasks({ from, to, filters });

  // Mutations — supabase direto, padrão Hoje.tsx/Semana.tsx
  const createEvent = useMutation({
    mutationFn: async (payload: {
      title: string; start_at: string; end_at: string;
      category: string; context: 'work' | 'personal';
    }) => {
      const { error } = await supabase.from('events').insert({
        title: payload.title,
        start_at: payload.start_at,
        end_at: payload.end_at,
        category: payload.category,
        context: payload.context,
        collaborator_id: collabId,
        created_by: collabId,
        modality: 'presencial',
        source: 'manual',
        status: 'scheduled',
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda-events'] }),
  });

  const updateEvent = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<EventForGrid> }) => {
      const { error } = await supabase.from('events').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda-events'] }),
  });

  const deleteEvent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda-events'] }),
  });

  const createTask = useMutation({
    mutationFn: async (payload: {
      title: string; due_date: string; context: 'work' | 'personal';
    }) => {
      const { error } = await supabase.from('tasks').insert({
        title: payload.title,
        due_date: payload.due_date,
        context: payload.context,
        assigned_to: collabId,
        created_by: collabId,
        status: 'pending',
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda-tasks'] }),
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.from('tasks').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda-tasks'] }),
  });

  const setView = useCallback((v: AgendaView) => {
    const next = new URLSearchParams(params);
    next.set('view', v);
    navigate(`/agenda?${next.toString()}`, { replace: true });
  }, [params, navigate]);

  const setDate = useCallback((d: Date) => {
    const next = new URLSearchParams(params);
    next.set('date', d.toISOString().slice(0, 10));
    navigate(`/agenda?${next.toString()}`, { replace: true });
  }, [params, navigate]);

  const onPrev = useCallback(() => {
    const d = new Date(currentDate);
    if (view === 'day') d.setDate(d.getDate() - 1);
    else if (view === 'week') d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setDate(d);
    setMiniMonth(startOfMonth(d));
  }, [currentDate, view, setDate]);

  const onNext = useCallback(() => {
    const d = new Date(currentDate);
    if (view === 'day') d.setDate(d.getDate() + 1);
    else if (view === 'week') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setDate(d);
    setMiniMonth(startOfMonth(d));
  }, [currentDate, view, setDate]);

  const onToday = useCallback(() => {
    const t = new Date();
    setDate(t);
    setMiniMonth(startOfMonth(t));
  }, [setDate]);

  const openNewMenu = useCallback(() => {
    setNewMenu({ x: window.innerWidth - 200, y: 64 });
  }, []);

  // Atalhos via ref — evita closure velha sem re-registrar listener
  const handlerRef = useRef<(e: KeyboardEvent) => void>();
  handlerRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag && /^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    if ((e.target as HTMLElement)?.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'd') setView('day');
    else if (e.key === 'w') setView('week');
    else if (e.key === 'm') setView('month');
    else if (e.key === 't') onToday();
    else if (e.key === 'ArrowLeft') onPrev();
    else if (e.key === 'ArrowRight') onNext();
    else if (e.key === 'n') openNewMenu();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => handlerRef.current?.(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const onEventDrop = useCallback(async (ev: EventForGrid, newStart: Date) => {
    const durationMs = new Date(ev.end_at).getTime() - new Date(ev.start_at).getTime();
    const patch: Partial<EventForGrid> = {
      start_at: newStart.toISOString(),
      end_at: new Date(newStart.getTime() + durationMs).toISOString(),
    };
    try {
      await updateEvent.mutateAsync({ id: ev.id, patch });
    } catch {
      toast.error('Não foi possível atualizar o evento. Tente de novo.');
    }
  }, [updateEvent]);

  const onEventResize = useCallback(async (ev: EventForGrid, newDurMs: number) => {
    const start = new Date(ev.start_at);
    const patch: Partial<EventForGrid> = {
      end_at: new Date(start.getTime() + newDurMs).toISOString(),
    };
    try {
      await updateEvent.mutateAsync({ id: ev.id, patch });
    } catch {
      toast.error('Não foi possível redimensionar. Tente de novo.');
    }
  }, [updateEvent]);

  const centerLabel =
    view === 'day'
      ? currentDate.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
      : view === 'week'
      ? formatWeekRange(currentDate)
      : miniMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const daysWithEvents = useMemo(() => {
    const s = new Set<string>();
    events.forEach((e) => s.add(e.start_at.slice(0, 10)));
    return s;
  }, [events]);

  return (
    <>
      <AgendaShell
        view={view}
        currentDate={currentDate}
        centerLabel={centerLabel}
        onChangeView={setView}
        onPrev={onPrev}
        onNext={onNext}
        onToday={onToday}
        onNewClick={openNewMenu}
        leftRail={
          <AgendaLeftRail
            miniMonth={miniMonth}
            selectedDay={view === 'month' ? selectedMonthDay : currentDate}
            daysWithEvents={daysWithEvents}
            tasks={tasks}
            filters={filters}
            onToggleFilter={toggle}
            onMiniMonthChange={setMiniMonth}
            onMiniDayClick={(d) => { setDate(d); setView('day'); }}
            onCountClick={() => { /* TODO: filter tasks panel by which */ }}
          />
        }
        rightRail={
          view === 'month' ? (
            <div className="w-[320px] shrink-0 border-l border-border bg-bg-surface">
              <MonthDayDrawer
                selectedDay={selectedMonthDay}
                events={events}
                tasks={tasks}
                onClose={() => setSelectedMonthDay(null)}
                onEventClick={setEditingEvent}
                onTaskClick={() => { /* TODO: task edit drawer */ }}
                onCreateEvent={(d) => setQuickCreate({ x: window.innerWidth - 360, y: 120, date: d, mode: 'event' })}
                onCreateTask={(d) => setQuickCreate({ x: window.innerWidth - 360, y: 120, date: d, mode: 'task' })}
                onOpenDayView={(d) => { setDate(d); setView('day'); }}
              />
            </div>
          ) : (
            <TasksPanel
              view={view as 'day' | 'week'}
              currentDate={currentDate}
              weekStart={startOfWeek(currentDate)}
              tasks={tasks}
              onTaskClick={() => { /* TODO: task edit drawer */ }}
              onToggleDone={(t) =>
                updateTask.mutate({
                  id: t.id,
                  patch: { status: t.status === 'done' ? 'pending' : 'done' },
                })
              }
              onCreateTask={(d) => setQuickCreate({ x: window.innerWidth - 360, y: 120, date: d, mode: 'task' })}
            />
          )
        }
      >
        {view === 'day' && (
          <DayView
            date={currentDate}
            events={events}
            onSlotClick={(d) => setQuickCreate({
              x: window.innerWidth / 2 - 170, y: window.innerHeight / 2 - 100, date: d, time: d, mode: 'event',
            })}
            onEventClick={setEditingEvent}
            onEventDrop={onEventDrop}
            onEventResize={onEventResize}
          />
        )}
        {view === 'week' && (
          <WeekView
            weekStart={startOfWeek(currentDate)}
            events={events}
            onSlotClick={(d) => setQuickCreate({
              x: window.innerWidth / 2 - 170, y: window.innerHeight / 2 - 100, date: d, time: d, mode: 'event',
            })}
            onEventClick={setEditingEvent}
            onEventDrop={onEventDrop}
            onEventResize={onEventResize}
          />
        )}
        {view === 'month' && (
          <MonthView
            monthDate={miniMonth}
            events={events}
            selectedDay={selectedMonthDay}
            onDayClick={setSelectedMonthDay}
            onDayDoubleClick={(d) => { setDate(d); setView('day'); }}
            onEventClick={setEditingEvent}
            onEmptyAreaClick={(d) => setQuickCreate({
              x: window.innerWidth / 2 - 170, y: window.innerHeight / 2 - 100, date: d, mode: 'event',
            })}
          />
        )}
      </AgendaShell>

      {quickCreate && (
        <QuickCreatePopover
          mode={quickCreate.mode}
          anchor={quickCreate}
          onClose={() => setQuickCreate(null)}
          onCreate={async (payload) => {
            try {
              if (quickCreate.mode === 'event') {
                await createEvent.mutateAsync(payload as Parameters<typeof createEvent.mutateAsync>[0]);
              } else {
                await createTask.mutateAsync(payload as Parameters<typeof createTask.mutateAsync>[0]);
              }
            } catch {
              toast.error('Não foi possível criar. Tente de novo.');
            }
          }}
          onMoreOptions={(draft) => {
            setQuickCreate(null);
            // Abre EventEditDrawer com draft; tipo é parcial — cast intencional
            setEditingEvent(draft as unknown as EventForGrid);
          }}
        />
      )}

      <EventEditDrawer
        event={editingEvent}
        open={!!editingEvent}
        onClose={() => setEditingEvent(null)}
        onSave={async (id, patch) => {
          try {
            await updateEvent.mutateAsync({ id, patch });
          } catch {
            toast.error('Não foi possível salvar.');
          }
        }}
        onDelete={async (id) => {
          try {
            await deleteEvent.mutateAsync(id);
          } catch {
            toast.error('Não foi possível deletar.');
          }
        }}
      />

      {/* Menu inline + Novo — substitui window.confirm */}
      {newMenu && (
        <>
          <div className="fixed inset-0 z-[9997]" onClick={() => setNewMenu(null)} />
          <div
            className="fixed z-[9998] w-44 rounded-lg border border-border bg-bg-elevated shadow-xl py-1"
            style={{ top: newMenu.y, left: newMenu.x }}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-[13px] text-fg hover:bg-bg-elevated2 focus-ring"
              onClick={() => {
                setNewMenu(null);
                setQuickCreate({ x: newMenu.x, y: newMenu.y + 32, date: currentDate, mode: 'event' });
              }}
            >
              Evento
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-[13px] text-fg hover:bg-bg-elevated2 focus-ring"
              onClick={() => {
                setNewMenu(null);
                setQuickCreate({ x: newMenu.x, y: newMenu.y + 32, date: currentDate, mode: 'task' });
              }}
            >
              Tarefa
            </button>
          </div>
        </>
      )}
    </>
  );
}
