import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { BottomSheet } from './BottomSheet';
import { SECTORS, SECTOR_LABELS } from '../types';
import type { EventSector, SchoolEvent, Task, TaskStatus } from '../types';

interface CollabOption {
  id: string;
  full_name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  event: SchoolEvent;
  task: Task | null;          // null = create, Task = edit
  defaultSector: EventSector | null;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'pending', label: 'Pendente' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'awaiting_confirmation', label: 'Aguardando confirmação' },
  { value: 'done', label: 'Concluída' },
  { value: 'cancelled', label: 'Cancelada' },
];

export function EventTaskSheet({ open, onClose, event, task, defaultSector }: Props) {
  const { collaborator, ensureSession } = useAuth();
  const queryClient = useQueryClient();

  const isEdit = !!task;

  const [title, setTitle] = useState('');
  const [sector, setSector] = useState<EventSector>('logistica');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [supportTeam, setSupportTeam] = useState<string[]>([]);
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [error, setError] = useState('');

  // Sync state quando o sheet abre ou a task em edição muda.
  // defaultSector / event.event_date / collaborator?.id excluídos das deps de
  // propósito: se incluídos, qualquer recarga assíncrona dessas props re-executa
  // o effect enquanto o sheet está aberto, sobrescrevendo o que o usuário digitou.
  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title);
      setSector((task.event_sector as EventSector) ?? 'logistica');
      setAssignedTo(task.assigned_to);
      setDueDate(task.due_date ?? event.event_date);
      setNotes(task.notes ?? '');
      setSupportTeam(task.support_team ?? []);
      setStatus(task.status);
    } else {
      setTitle('');
      setSector(defaultSector ?? 'logistica');
      setAssignedTo(collaborator?.id ?? '');
      setDueDate(event.event_date);
      setNotes('');
      setSupportTeam([]);
      setStatus('pending');
    }
    setError('');
  }, [open, task]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load collaborators (filtered by event unit if set; null-unit collaborators always included)
  const { data: collabs = [] } = useQuery({
    queryKey: ['collaborators-for-event', event.unit],
    queryFn: async () => {
      let q = supabase
        .from('collaborators')
        .select('id, full_name')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (event.unit) q = q.or(`unit.eq.${event.unit},unit.is.null`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CollabOption[];
    },
    enabled: open,
  });

  const canSave = title.trim().length > 0 && !!assignedTo && !!dueDate;

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      setError('');
      // Sprint 27 — refresh transparente antes do throw
      const collab = collaborator ?? await ensureSession();
      if (!collab) throw new Error('no_session');

      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collab.id,
      });

      const payload = {
        title: title.trim().slice(0, 200),
        assigned_to: assignedTo,
        due_date: dueDate,
        status,
        event_sector: sector,
        notes: notes.trim() || null,
        support_team: supportTeam.length > 0 ? supportTeam : null,
        school_event_id: event.id,
      };

      if (isEdit && task) {
        const { error: upErr } = await supabase
          .from('tasks')
          .update(payload)
          .eq('id', task.id);
        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await supabase.from('tasks').insert({
          ...payload,
          created_by: collab.id,
          source: 'manual',
          context: 'work',
          priority: 'medium',
        });
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-tasks', event.id] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <BottomSheet open={open} onClose={onClose} title={isEdit ? 'Editar tarefa' : 'Nova tarefa'}>
      <div className="space-y-4 pb-4">
        <div>
          <label className="text-caption text-fg-muted block mb-1">Título *</label>
          <input
            type="text"
            maxLength={200}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            placeholder="Ex.: Montar palco"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Setor *</label>
          <select
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            value={sector}
            onChange={e => setSector(e.target.value as EventSector)}
          >
            {SECTORS.map(s => (
              <option key={s} value={s}>{SECTOR_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Responsável *</label>
          <select
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            value={assignedTo}
            onChange={e => setAssignedTo(e.target.value)}
          >
            <option value="">Selecione…</option>
            {collabs.map(c => (
              <option key={c.id} value={c.id}>{c.full_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Apoio (opcional)</label>
          <select
            multiple
            size={Math.min(5, Math.max(2, collabs.length))}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            value={supportTeam}
            onChange={e => {
              const opts = Array.from(e.target.selectedOptions).map(o => o.value);
              setSupportTeam(opts);
            }}
          >
            {collabs
              .filter(c => c.id !== assignedTo)
              .map(c => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
          </select>
          <p className="text-caption text-fg-muted mt-1">Segure Ctrl/Cmd para selecionar múltiplos.</p>
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Prazo *</label>
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
          />
          <p className="text-caption text-fg-muted mt-1">Padrão: dia do evento ({event.event_date}).</p>
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Observações (opcional)</label>
          <textarea
            rows={3}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            placeholder="Detalhes, links, instruções…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Status</label>
          <select
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
            value={status}
            onChange={e => setStatus(e.target.value as TaskStatus)}
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-danger text-caption">{error}</p>}

        <button
          type="button"
          disabled={!canSave || isPending}
          onClick={() => mutate()}
          className="w-full py-3 bg-brand text-white rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {isPending ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar tarefa'}
        </button>
      </div>
    </BottomSheet>
  );
}
