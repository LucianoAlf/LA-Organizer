import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Trash2, Pencil, MapPin, Calendar, Clock, Megaphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { EventTaskSheet } from '../components/EventTaskSheet';
import {
  SECTORS,
  SECTOR_LABELS,
  TASK_STATUS_LABELS,
  unitsLabel,
  formatEventRange,
} from '../types';
import type { EventSector, EventType, SchoolEvent, Task } from '../types';

interface EventTask extends Task {
  assigned_collab?: { id: string; full_name: string } | null;
}

export function EventoDetalhe() {
  const { id: eventId } = useParams<{ id: string }>();
  const { collaborator, role } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'director' || role === 'coordinator';

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<EventTask | null>(null);
  const [defaultSector, setDefaultSector] = useState<EventSector | null>(null);
  const [collapsed, setCollapsed] = useState<Set<EventSector>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: event, isLoading: evLoading, error: evError, refetch } = useQuery({
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

  const { data: typeRow } = useQuery({
    queryKey: ['event-type', event?.event_type],
    queryFn: async () => {
      const { data } = await supabase
        .from('event_types')
        .select('*')
        .eq('id', event!.event_type)
        .maybeSingle();
      return (data ?? null) as EventType | null;
    },
    enabled: !!event?.event_type,
  });

  const { data: linkedAnnouncements = [] } = useQuery({
    queryKey: ['event-announcements', eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, body, status, created_at, scheduled_at')
        .eq('source_event_id', eventId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
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

  if (evLoading) {
    return (
      <div className="space-y-md">
        <PageHeader title="Evento" backTo="/mais/agenda-escolar" />
        <LoadingState rows={4} />
      </div>
    );
  }
  if (evError || !event) {
    return (
      <div className="space-y-md">
        <PageHeader title="Evento" backTo="/mais/agenda-escolar" />
        <ErrorState
          title="Evento não encontrado"
          description={evError ? (evError as Error).message : 'Verifica se o link tá certo.'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const isCancelled = event.status === 'cancelled';

  return (
    <div className="space-y-md">
      <PageHeader
        title={event.title}
        subtitle={isCancelled ? 'Cancelado' : (typeRow?.label ?? 'Evento')}
        backTo="/mais/agenda-escolar"
      />

      {/* Hero: imagem + meta */}
      <section className="bg-bg-surface rounded-xl border border-border overflow-hidden">
        {event.image_url && (
          <img
            src={event.image_url}
            alt={event.title}
            className="w-full max-h-72 object-cover border-b border-border"
          />
        )}
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {typeRow && (
              <span
                className="text-caption rounded-md px-2 py-0.5 font-medium"
                style={{
                  backgroundColor: typeRow.color_hex + '22',
                  color: typeRow.color_hex,
                }}
              >
                {typeRow.emoji} {typeRow.label}
              </span>
            )}
            {isCancelled && <Badge tone="danger">Cancelado</Badge>}
          </div>

          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-body-sm">
            <Calendar size={14} className="text-fg-muted mt-0.5" />
            <span className="tabular-nums">
              {formatEventRange(event.event_date, event.end_date)}
              {event.is_all_day ? ' · dia inteiro' : ''}
            </span>
            {!event.is_all_day && event.start_time && (
              <>
                <Clock size={14} className="text-fg-muted mt-0.5" />
                <span className="tabular-nums">{event.start_time.slice(0, 5)}</span>
              </>
            )}
            <MapPin size={14} className="text-fg-muted mt-0.5" />
            <span>
              {unitsLabel(event.units, event.unit)}
              {event.location ? ` · ${event.location}` : ''}
            </span>
          </div>

          {event.description && (
            <p className="text-body text-fg whitespace-pre-wrap pt-2 border-t border-border">
              {event.description}
            </p>
          )}
        </div>
      </section>

      {/* Comunicados vinculados a este evento (visível pra todos) */}
      {linkedAnnouncements.length > 0 && (
        <section className="bg-bg-surface rounded-xl border border-border p-4 space-y-2">
          <div className="flex items-center gap-2 text-caption uppercase font-semibold text-fg-muted">
            <Megaphone size={12} />
            Comunicados deste evento ({linkedAnnouncements.length})
          </div>
          <ul className="divide-y divide-border">
            {linkedAnnouncements.map(ann => {
              const previewBody = (ann.body || '').slice(0, 100);
              const statusLabel = ann.status === 'sent' ? 'Enviado'
                : ann.status === 'scheduled' ? 'Agendado'
                : ann.status === 'sending' ? 'Enviando'
                : ann.status === 'cancelled' ? 'Cancelado' : ann.status;
              const tone = ann.status === 'sent' ? 'text-success'
                : ann.status === 'cancelled' ? 'text-fg-muted line-through'
                : 'text-warning';
              return (
                <li key={ann.id} className="py-2">
                  {canEdit ? (
                    <Link to={`/mais/comunicados/${ann.id}`} className="block hover:text-tom transition-colors">
                      <p className="text-body-sm line-clamp-2">{previewBody}</p>
                      <p className={`text-caption ${tone}`}>{statusLabel}</p>
                    </Link>
                  ) : (
                    <>
                      <p className="text-body-sm line-clamp-2">{previewBody}</p>
                      <p className={`text-caption ${tone}`}>{statusLabel}</p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Tarefas por setor (mantido — só visível pra liderança que pode editar tasks de evento) */}
      {canEdit && (
        <>
          <h3 className="text-body-sm uppercase tracking-wide text-fg-muted font-semibold px-1">
            Tarefas do evento
          </h3>
          {tLoading ? (
            <LoadingState rows={2} />
          ) : (
            SECTORS.map(sector => {
              const sectorTasks = tasksBySector[sector];
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
                            className="mt-1 focus-ring accent-tom"
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
                        className="w-full mt-2 py-2 flex items-center justify-center gap-1 text-caption text-fg-muted hover:text-tom border border-dashed border-border rounded-lg focus-ring"
                      >
                        <Plus size={14} /> Adicionar tarefa
                      </button>
                    </div>
                  )}
                </section>
              );
            })
          )}
        </>
      )}

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
