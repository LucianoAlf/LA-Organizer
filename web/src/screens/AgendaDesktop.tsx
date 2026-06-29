import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { shiftReminderRowsByReschedule } from '../lib/reminderShift';
import { useAuth } from '../contexts/AuthContext';
import { localYmd, todaySP } from '../utils/date';

import { AgendaShell, type AgendaView } from './agenda/AgendaShell';
import { AgendaDesktopLeftPanel } from './agenda/leftPanel/AgendaDesktopLeftPanel';
import { DayView } from './agenda/views/DayView';
import { WeekView } from './agenda/views/WeekView';
import { MonthView } from './agenda/views/MonthView';
import { QuickCreateSheet } from '../components/QuickCreateSheet';
import { Fab } from '../components/Fab';
import { EventEditDrawer } from './agenda/components/EventEditDrawer';
import { TaskEditDrawer } from './agenda/components/TaskEditDrawer';
import { TaskGroupSheet } from '../components/TaskGroupSheet';
import { DelegateTaskSheet } from '../components/DelegateTaskSheet';
import { ConvertToEventSheet } from '../components/ConvertToEventSheet';
import { hasCoordLevel } from '../lib/permissions';
import { toggleChildWithCascade } from '../lib/taskGroups';
import { useAgendaFilters } from './agenda/hooks/useAgendaFilters';
import { useAgendaEvents, type EventForGrid } from './agenda/hooks/useAgendaEvents';
import { useAgendaTasks, type TaskForPanel } from './agenda/hooks/useAgendaTasks';
import { useNoPrazoTasks } from './agenda/hooks/useNoPrazoTasks';
import { useCollaboratorNames } from './agenda/hooks/useCollaboratorNames';
import { TaskDetailSheet } from '../components/TaskDetailSheet';
import { TaskChecklistSection } from '../components/TaskChecklistSection';
import { taskDetailMeta } from '../lib/taskDetail';

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
  // todaySP, não toISOString: depois das 21h BRT o dia UTC já é o seguinte.
  const dateIso = params.get('date') ?? todaySP();
  const currentDate = useMemo(() => new Date(`${dateIso}T00:00:00`), [dateIso]);

  const { filters, toggle, currentContext, changeContext } = useAgendaFilters();
  const [miniMonth, setMiniMonth] = useState<Date>(startOfMonth(currentDate));
  const [quickCreate, setQuickCreate] = useState<{ open: boolean; dueDate?: string }>({ open: false });
  const [editingEvent, setEditingEvent] = useState<EventForGrid | null>(null);
  const [editingTask, setEditingTask] = useState<TaskForPanel | null>(null);
  const [readingTask, setReadingTask] = useState<TaskForPanel | null>(null);
  const names = useCollaboratorNames();
  const [delegateTask, setDelegateTask] = useState<TaskForPanel | null>(null);
  const [convertTask, setConvertTask] = useState<TaskForPanel | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const canDelegate = collaborator ? hasCoordLevel(collaborator) : false;

  const { from, to } = useMemo(() => {
    if (view === 'day') return { from: startOfDay(currentDate), to: endOfDay(currentDate) };
    if (view === 'week') return { from: startOfWeek(currentDate), to: endOfWeek(currentDate) };
    return { from: startOfMonth(currentDate), to: endOfMonth(currentDate) };
  }, [view, currentDate]);

  const { events } = useAgendaEvents({ from, to, filters });
  const { tasks, groups } = useAgendaTasks({ from, to, filters });

  // Contagens por contexto — refletem a janela visível do painel atual.
  const contextCounts = useMemo(() => {
    const todayIso = localYmd(currentDate);
    let inRange: (iso: string) => boolean;
    if (view === 'day') {
      inRange = (iso) => iso <= todayIso;
    } else if (view === 'week') {
      const s = startOfWeek(currentDate);
      const e = new Date(s); e.setDate(s.getDate() + 6);
      const sIso = localYmd(s);
      const eIso = localYmd(e);
      inRange = (iso) => iso >= sIso && iso <= eIso;
    } else {
      const sIso = localYmd(new Date(miniMonth.getFullYear(), miniMonth.getMonth(), 1));
      const eIso = localYmd(new Date(miniMonth.getFullYear(), miniMonth.getMonth() + 1, 0));
      inRange = (iso) => iso >= sIso && iso <= eIso;
    }
    const tInRange = (t: typeof tasks[number]) => {
      const d = (t.scheduled_date ?? t.due_date ?? '').slice(0, 10);
      return !!d && inRange(d);
    };
    const work = tasks.filter(t => t.context === 'work' && t.status !== 'done' && tInRange(t)).length
               + events.filter(e => e.context === 'work' && inRange(e.start_at.slice(0, 10))).length;
    const personal = tasks.filter(t => t.context === 'personal' && t.status !== 'done' && tInRange(t)).length
                   + events.filter(e => e.context === 'personal' && inRange(e.start_at.slice(0, 10))).length;
    const delegated = tasks.filter(t => t.delegated_to != null && t.status !== 'done' && tInRange(t)).length;
    return { work, personal, delegated };
  }, [tasks, events, view, currentDate, miniMonth]);

  // Listas filtradas pelo contexto ativo — passadas ao painel esquerdo e timegrid.
  const tasksFiltered = useMemo(() => {
    if (currentContext === 'delegated') return tasks.filter(t => t.delegated_to != null);
    return tasks.filter(t => t.context === currentContext);
  }, [tasks, currentContext]);

  // NOPRAZO-TASK-INVISIBLE-PWA — tarefas sem prazo (fonte isolada), filtradas pelo MESMO currentContext.
  const noPrazoAll = useNoPrazoTasks();
  const noPrazoFiltered = useMemo(() => {
    if (currentContext === 'delegated') return noPrazoAll.filter(t => t.delegated_to != null);
    return noPrazoAll.filter(t => t.context === currentContext);
  }, [noPrazoAll, currentContext]);

  const eventsFiltered = useMemo(() => {
    if (currentContext === 'delegated') return [];
    return events.filter(e => e.context === currentContext);
  }, [events, currentContext]);

  // Mutations — update/delete events e update tasks (create event/task vem do QuickCreateSheet).
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

  const updateTask = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.from('tasks').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda-tasks'] }),
  });

  const deleteTask = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
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
    next.set('date', localYmd(d));
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
    setQuickCreate({ open: true });
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
    const oldStartIso = ev.start_at;
    const durationMs = new Date(ev.end_at).getTime() - new Date(ev.start_at).getTime();
    const newStartIso = newStart.toISOString();
    const patch: Partial<EventForGrid> = {
      start_at: newStartIso,
      end_at: new Date(newStart.getTime() + durationMs).toISOString(),
    };
    try {
      await updateEvent.mutateAsync({ id: ev.id, patch });
      // EVENT-RESCHED-REMINDER-PWA — drag move: lembretes PENDENTES acompanham o novo
      // início (offset-preserving, igual o engine; sent_at != null fica como histórico).
      try {
        const { data: rems } = await supabase
          .from('event_reminders').select('id, remind_at')
          .eq('event_id', ev.id).is('sent_at', null);
        for (const s of shiftReminderRowsByReschedule(rems ?? [], oldStartIso, newStartIso)) {
          await supabase.from('event_reminders').update({ remind_at: s.remind_at }).eq('id', s.id);
        }
      } catch (e) {
        console.warn('[AgendaDesktop] reminder shift on drop err:', e);
      }
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
      ? (() => {
          const wd = currentDate.toLocaleDateString('pt-BR', { weekday: 'long' });
          const dm = currentDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
          return `${wd} · ${dm}`;
        })()
      : view === 'week'
      ? formatWeekRange(currentDate)
      : miniMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

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
        onNewClick={() => setQuickCreate({ open: true })}
        currentContext={currentContext}
        contextCounts={contextCounts}
        onChangeContext={changeContext}
        leftRail={
          <AgendaDesktopLeftPanel
            view={view}
            currentDate={currentDate}
            weekStart={startOfWeek(currentDate)}
            monthDate={miniMonth}
            tasks={tasksFiltered}
            noPrazo={noPrazoFiltered}
            events={eventsFiltered}
            habitsDay={[]}
            habitsWeek={[]}
            groups={groups}
            onTaskClick={(t) => setReadingTask(t)}
            onToggleTaskDone={(t) =>
              updateTask.mutate({
                id: t.id,
                patch: { status: t.status === 'done' ? 'pending' : 'done' },
              })
            }
            onEventClick={setEditingEvent}
            onToggleEventDone={(e) =>
              updateEvent.mutate({
                id: e.id,
                patch: { status: e.status === 'done' ? 'scheduled' : 'done' } as Partial<EventForGrid>,
              })
            }
            onToggleHabit={() => {}}
            onPickDay={(d) => { setDate(d); setView('day'); }}
            onOpenGroup={(id) => setOpenGroupId(id)}
            onToggleGroupChild={async (child, done) => {
              try {
                await toggleChildWithCascade(child as unknown as Parameters<typeof toggleChildWithCascade>[0], done);
                qc.invalidateQueries({ queryKey: ['agenda-tasks'] });
                qc.invalidateQueries({ queryKey: ['task-groups'] });
              } catch (e) {
                console.error('[AgendaDesktop] toggleChildWithCascade err:', e);
              }
            }}
          />
        }
        rightRail={null}
      >
        {view === 'day' && (
          <DayView
            date={currentDate}
            events={events}
            onSlotClick={(d) => setQuickCreate({ open: true, dueDate: localYmd(d) })}
            onEventClick={setEditingEvent}
            onEventDrop={onEventDrop}
            onEventResize={onEventResize}
          />
        )}
        {view === 'week' && (
          <WeekView
            weekStart={startOfWeek(currentDate)}
            events={events}
            onSlotClick={(d) => setQuickCreate({ open: true, dueDate: localYmd(d) })}
            onEventClick={setEditingEvent}
            onEventDrop={onEventDrop}
            onEventResize={onEventResize}
          />
        )}
        {view === 'month' && (
          <MonthView
            monthDate={miniMonth}
            events={events}
            onDayClick={(d) => { setDate(d); setView('day'); }}
            onEventClick={setEditingEvent}
          />
        )}
      </AgendaShell>

      <QuickCreateSheet
        open={quickCreate.open}
        onClose={() => setQuickCreate({ open: false })}
        defaultDueDate={quickCreate.dueDate}
      />

      {/* FAB "+ Novo" no canto inf-direito — paridade com mobile, abre o QuickCreateSheet
          (que tem 3 segmented: Tarefa / Compromisso / Delegar). */}
      <Fab
        onClick={() => setQuickCreate({ open: true, dueDate: localYmd(currentDate) })}
        label="Novo"
        ariaLabel="Criar tarefa, compromisso ou delegar"
      />

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

      <TaskEditDrawer
        task={editingTask}
        open={!!editingTask}
        onClose={() => setEditingTask(null)}
        onSave={async (id, patch) => {
          try {
            await updateTask.mutateAsync({ id, patch });
          } catch {
            toast.error('Não foi possível salvar a tarefa.');
          }
        }}
        onDelete={async (id) => {
          try {
            await deleteTask.mutateAsync(id);
          } catch {
            toast.error('Não foi possível deletar a tarefa.');
          }
        }}
        onTransformToEvent={(t) => { setEditingTask(null); setConvertTask(t); }}
        onDelegate={(t) => { setEditingTask(null); setDelegateTask(t); }}
        canDelegate={canDelegate}
      />

      {readingTask && (() => {
        const rt = readingTask;
        const meta = taskDetailMeta({
          meId: collabId ?? null,
          assigned_to: rt.assigned_to ?? null,
          created_by: rt.created_by ?? null,
          assigned_group_id: rt.assigned_group_id ?? null,
          creatorName: rt.creator_name ?? null,
          assigneeName: names.firstName(rt.delegated_to) ?? null,
          groupName: rt.work_group_name ?? null,
        });
        const isDone = rt.status === 'done';
        return (
          <TaskDetailSheet
            open
            onClose={() => setReadingTask(null)}
            title={rt.title}
            metaLine={meta.label}
            description={rt.description}
            isRecurring={Boolean(rt.recurrence_rule || rt.recurrence_parent_id)}
            isDone={isDone}
            onEdit={() => { setReadingTask(null); setEditingTask(rt); }}
            checklist={<TaskChecklistSection parent={{ id: rt.id, context: rt.context, assigned_to: rt.assigned_to ?? null, assigned_group_id: rt.assigned_group_id ?? null }} meId={collabId} editable />}
          />
        );
      })()}

      <DelegateTaskSheet open={Boolean(delegateTask)} task={delegateTask} onClose={() => setDelegateTask(null)} />
      <ConvertToEventSheet open={Boolean(convertTask)} task={convertTask} onClose={() => setConvertTask(null)} />
      <TaskGroupSheet
        open={Boolean(openGroupId)}
        groupId={openGroupId}
        onClose={() => setOpenGroupId(null)}
        onEditChild={(child) => { setOpenGroupId(null); setEditingTask(child as unknown as TaskForPanel); }}
      />

    </>
  );
}
