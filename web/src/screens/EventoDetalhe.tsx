import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Trash2, Pencil } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { EventTaskSheet } from '../components/EventTaskSheet';
import {
  SECTORS,
  SECTOR_LABELS,
  TASK_STATUS_LABELS,
  formatEventDate,
  unitLabel,
} from '../types';
import type { EventSector, SchoolEvent, Task } from '../types';

interface EventTask extends Task {
  assigned_collab?: { id: string; full_name: string } | null;
}

export function EventoDetalhe() {
  const { id: eventId } = useParams<{ id: string }>();
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<EventTask | null>(null);
  const [defaultSector, setDefaultSector] = useState<EventSector | null>(null);
  const [collapsed, setCollapsed] = useState<Set<EventSector>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: event, isLoading: evLoading, error: evError } = useQuery({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('school_events')
        .select('*')
        .eq('id', eventId)
        .single();
      if (error) throw error;
      return data as SchoolEvent;
    },
    enabled: !!eventId,
  });

  const { data: tasks = [], isLoading: tLoading } = useQuery({
    queryKey: ['event-tasks', eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, assigned_collab:assigned_to(id, full_name)')
        .eq('school_event_id', eventId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as EventTask[];
    },
    enabled: !!eventId,
  });

  const toggleStatus = useMutation({
    mutationFn: async (task: EventTask) => {
      const next = task.status === 'done' ? 'pending' : 'done';
      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator!.id,
      });
      const { error } = await supabase
        .from('tasks')
        .update({
          status: next,
          completed_at: next === 'done' ? new Date().toISOString() : null,
          completed_by: next === 'done' ? collaborator!.id : null,
        })
        .eq('id', task.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['event-tasks', eventId] }),
  });

  const deleteTask = useMutation({
    mutationFn: async (taskId: string) => {
      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator!.id,
      });
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ['event-tasks', eventId] });
    },
  });

  const tasksBySector: Record<EventSector, EventTask[]> = {
    logistica: [], tecnica: [], pedagogico: [], comunicacao: [], producao: [],
  };
  for (const t of tasks) {
    if (t.event_sector && SECTORS.includes(t.event_sector)) {
      tasksBySector[t.event_sector].push(t);
    }
  }

  const toggleCollapsed = (sector: EventSector) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  };

  const openCreate = (sector: EventSector) => {
    setEditingTask(null);
    setDefaultSector(sector);
    setSheetOpen(true);
  };

  const openEdit = (task: EventTask) => {
    setEditingTask(task);
    setDefaultSector(null);
    setSheetOpen(true);
  };

  if (evLoading) return <p className="text-body-sm text-fg-muted">Carregando...</p>;
  if (evError || !event) return <p className="text-danger text-body-sm">Evento não encontrado.</p>;

  return (
    <div className="space-y-4">
      <PageHeader
        title={event.title}
        subtitle={`${formatEventDate(event.event_date, event.start_time)}${event.location ? ` · ${event.location}` : ''} · ${unitLabel(event.unit)}`}
        backTo="/mais/agenda-escolar"
      />

      {tLoading && <p className="text-body-sm text-fg-muted">Carregando tarefas...</p>}

      {!tLoading && SECTORS.map(sector => {
        const sectorTasks = tasksBySector[sector];
        // Default: open if has tasks, collapsed if empty (unless user toggled)
        const shouldShow = sectorTasks.length > 0 ? !collapsed.has(sector) : collapsed.has(sector);
        return (
          <section key={sector} className="bg-bg-surface rounded-xl border border-border">
            <button
              type="button"
              onClick={() => toggleCollapsed(sector)}
              className="w-full flex items-center justify-between p-3 focus-ring"
            >
              <div className="flex items-center gap-2">
                {shouldShow ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span className="text-body font-medium">{SECTOR_LABELS[sector]}</span>
                <span className="text-caption text-fg-muted">({sectorTasks.length})</span>
              </div>
            </button>

            {shouldShow && (
              <div className="px-3 pb-3 space-y-2">
                {sectorTasks.map(task => (
                  <div key={task.id} className="flex items-start gap-2 py-2 border-t border-border">
                    <input
                      type="checkbox"
                      checked={task.status === 'done'}
                      onChange={() => toggleStatus.mutate(task)}
                      className="mt-1 focus-ring"
                      aria-label={`Marcar ${task.title} como concluída`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-body ${task.status === 'done' ? 'line-through text-fg-muted' : 'text-fg'}`}>
                        {task.title}
                      </p>
                      <p className="text-caption text-fg-muted">
                        {task.assigned_collab?.full_name ?? '—'}
                        {task.due_date ? ` · ${task.due_date.slice(8, 10)}/${task.due_date.slice(5, 7)}` : ''}
                        {task.status !== 'pending' && task.status !== 'done'
                          ? ` · ${TASK_STATUS_LABELS[task.status]}`
                          : ''}
                      </p>
                      {task.notes && (
                        <p className="text-caption text-fg-muted mt-1 italic">{task.notes}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => openEdit(task)}
                      className="h-8 w-8 grid place-items-center text-fg-muted hover:text-fg focus-ring rounded"
                      aria-label="Editar"
                    >
                      <Pencil size={14} />
                    </button>
                    {confirmDelete === task.id ? (
                      <button
                        type="button"
                        onClick={() => deleteTask.mutate(task.id)}
                        className="text-caption text-danger px-2 focus-ring rounded"
                      >
                        Confirmar?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDelete(task.id);
                          setTimeout(() => setConfirmDelete(prev => (prev === task.id ? null : prev)), 3000);
                        }}
                        className="h-8 w-8 grid place-items-center text-fg-muted hover:text-danger focus-ring rounded"
                        aria-label="Excluir"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => openCreate(sector)}
                  className="w-full mt-2 py-2 flex items-center justify-center gap-1 text-caption text-fg-muted hover:text-brand border border-dashed border-border rounded-lg focus-ring"
                >
                  <Plus size={14} /> Adicionar tarefa
                </button>
              </div>
            )}
          </section>
        );
      })}

      {sheetOpen && event && (
        <EventTaskSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          event={event}
          task={editingTask}
          defaultSector={defaultSector}
        />
      )}
    </div>
  );
}
