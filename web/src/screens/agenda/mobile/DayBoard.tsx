import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../../../lib/supabase';
import { fetchEventsForDay } from '../../../lib/events';
import { fetchTasksForDay } from '../../../lib/dayItems';
import { useMyGroupIds } from '../../../hooks/useWorkGroups';
import { useTaskTransform } from '../../../hooks/useTaskTransform';
import { TaskRow } from '../../../components/TaskRow';
import { EventRow } from '../../../components/EventRow';
import { EditEventSheet } from '../../../components/EditEventSheet';
import { EditTaskSheet } from '../../../components/EditTaskSheet';
import { RescheduleSheet } from '../../../components/RescheduleSheet';
import { TaskDetailSheet } from '../../../components/TaskDetailSheet';
import { TaskChecklistSection } from '../../../components/TaskChecklistSection';
import { EmptyState } from '../../../components/EmptyState';
import { taskDetailMeta } from '../../../lib/taskDetail';
import { CalendarClock, ListTodo } from 'lucide-react';
import type { Task, CalendarEvent } from '../../../types';

export function DayBoard({ ymd }: { ymd: string }) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const tt = useTaskTransform();
  const myGroupIds = useMyGroupIds();

  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [readingTask, setReadingTask] = useState<Task | null>(null);
  const [reschedulingTask, setReschedulingTask] = useState<Task | null>(null);

  const enabled = Boolean(collaborator?.id && supabaseConfigured);
  const groupKey = (myGroupIds.data ?? []).join(',');

  const { data: tasks = [] } = useQuery({
    queryKey: ['agenda-day-tasks', collaborator?.id, ymd, groupKey],
    queryFn: () => fetchTasksForDay(collaborator!.id, ymd, myGroupIds.data ?? []),
    enabled,
  });
  const { data: events = [] } = useQuery({
    queryKey: ['agenda-day-events', collaborator?.id, ymd],
    queryFn: () => fetchEventsForDay(collaborator!.id, ymd),
    enabled,
  });

  const invalidateAll = () => {
    for (const k of [['agenda-day-tasks'], ['agenda-day-events'], ['agenda-tasks'], ['agenda-events'], ['tasks'], ['events']]) {
      qc.invalidateQueries({ queryKey: k });
    }
  };

  const toggleTask = useMutation({
    mutationFn: async (task: Task) => {
      const isDone = task.status === 'done';
      const { error } = await supabase.from('tasks').update(
        isDone
          ? { status: 'pending', completed_at: null, completed_by: null }
          : { status: 'done', completed_at: new Date().toISOString(), completed_by: collaborator?.id },
      ).eq('id', task.id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });
  const deleteTask = useMutation({
    mutationFn: async (task: Task) => {
      const { error } = await supabase.from('tasks').delete().eq('id', task.id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });
  const toggleEventDone = useMutation({
    mutationFn: async (event: CalendarEvent) => {
      const next = event.status === 'done' ? 'scheduled' : 'done';
      const { data, error } = await supabase.from('events').update({ status: next }).eq('id', event.id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Sem permissão para alterar este compromisso.');
    },
    onSuccess: invalidateAll,
  });
  const cancelEvent = useMutation({
    mutationFn: async (event: CalendarEvent) => {
      const { data, error } = await supabase.from('events').update({ status: 'cancelled' }).eq('id', event.id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Sem permissão para cancelar este compromisso.');
    },
    onSuccess: invalidateAll,
  });
  const deleteEvent = useMutation({
    mutationFn: async (event: CalendarEvent) => {
      const { error } = await supabase.from('events').delete().eq('id', event.id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const isEmpty = tasks.length === 0 && events.length === 0;

  return (
    <div className="space-y-md">
      {isEmpty && (
        <EmptyState icon={<ListTodo size={28} />} title="Nada nesse dia" description="Toque no + pra criar uma tarefa ou compromisso." />
      )}

      {events.length > 0 && (
        <section className="surface px-md">
          <div className="flex items-center gap-2 py-3 border-b border-border text-label uppercase tracking-wide text-fg-muted">
            <CalendarClock size={14} /> Compromissos
          </div>
          {events.map(e => (
            <EventRow
              key={e.id}
              event={e}
              onClick={setEditingEvent}
              onToggleDone={(ev) => toggleEventDone.mutate(ev)}
              onCancel={(ev) => cancelEvent.mutate(ev)}
              onDelete={(ev) => deleteEvent.mutate(ev)}
            />
          ))}
        </section>
      )}

      {tasks.length > 0 && (
        <section className="space-y-sm">
          {tasks.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              onOpen={setReadingTask}
              onToggle={(task) => toggleTask.mutate(task)}
              onEdit={setEditingTask}
              onReschedule={setReschedulingTask}
              onDelete={(task) => deleteTask.mutate(task)}
              onTransformToEvent={tt.canConvert(t) ? tt.openConvert : undefined}
              onDelegate={tt.canDelegate(t) ? tt.openDelegate : undefined}
            />
          ))}
        </section>
      )}

      <EditEventSheet open={Boolean(editingEvent)} event={editingEvent} onClose={() => setEditingEvent(null)} />
      <RescheduleSheet open={Boolean(reschedulingTask)} task={reschedulingTask} onClose={() => setReschedulingTask(null)} />
      <EditTaskSheet open={Boolean(editingTask)} task={editingTask} onClose={() => setEditingTask(null)} onTransform={tt.onEditSheetTransform} canDelegate={tt.canDelegateAny} />
      {readingTask && (() => {
        const rt = readingTask;
        const meta = taskDetailMeta({
          meId: collaborator?.id ?? null,
          assigned_to: rt.assigned_to ?? null,
          created_by: rt.created_by ?? null,
          assigned_group_id: rt.assigned_group_id ?? null,
          creatorName: rt.creator?.preferred_name ?? rt.creator?.full_name ?? null,
          assigneeName: rt.assignee?.full_name ?? null,
          groupName: (rt as Task & { work_group?: { name?: string } | null }).work_group?.name ?? null,
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
            canComplete={!isDone}
            onComplete={() => { toggleTask.mutate(rt); setReadingTask(null); }}
            onEdit={() => { setEditingTask(rt); setReadingTask(null); }}
            checklist={<TaskChecklistSection parent={{ id: rt.id, context: rt.context, assigned_to: rt.assigned_to ?? null, assigned_group_id: rt.assigned_group_id ?? null }} meId={collaborator?.id} editable />}
          />
        );
      })()}
      {tt.sheets}
    </div>
  );
}
