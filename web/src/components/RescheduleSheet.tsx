import { useState, useEffect, FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { todaySP } from '../utils/date';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import type { Task } from '../types';

interface Props {
  open: boolean;
  task: Task | null;
  onClose: () => void;
}

/**
 * Tap-to-pick reschedule. Uses native <input type="date"> — works on iOS/Android.
 * Updates tasks.due_date; if status was 'overdue', flips back to 'pending'.
 * RLS UPDATE policy already restricts to own tasks (assigned_to check).
 */
export function RescheduleSheet({ open, task, onClose }: Props) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const [date, setDate] = useState(task?.due_date || todaySP());

  useEffect(() => {
    if (open && task) setDate(task.due_date || todaySP());
  }, [open, task]);

  const reschedule = useMutation({
    mutationFn: async () => {
      if (!collaborator || !task) throw new Error('no_task');
      const update: Record<string, unknown> = { due_date: date };
      if (task.status === 'overdue') update.status = 'pending';
      const { error } = await supabase
        .from('tasks')
        .update(update)
        .eq('id', task.id)
        .eq('assigned_to', collaborator.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!task) return;
    if (date === task.due_date) { onClose(); return; }
    reschedule.mutate();
  };

  const sameDate = task && date === task.due_date;

  return (
    <BottomSheet open={open && Boolean(task)} onClose={onClose} title="Reagendar tarefa">
      {task && (
        <form onSubmit={onSubmit} className="space-y-md">
          <div className="rounded-md border border-border bg-bg-elevated p-3">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1">Tarefa</div>
            <div className="text-body-md">{task.title}</div>
            {task.due_date && (
              <div className="text-body-sm text-fg-muted mt-1 tabular-nums">
                Atual: {task.due_date.slice(8, 10)}/{task.due_date.slice(5, 7)}
              </div>
            )}
          </div>

          <label className="block">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Novo prazo</div>
            <input
              type="date"
              required
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg focus-ring"
            />
          </label>

          {reschedule.error && (
            <p role="alert" className="text-body-sm text-danger">
              Não consegui reagendar. {(reschedule.error as Error).message}
            </p>
          )}

          <div className="flex items-center gap-md pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={reschedule.isPending} fullWidth disabled={Boolean(sameDate)}>
              {sameDate ? 'Mesma data' : 'Reagendar'}
            </Button>
          </div>
        </form>
      )}
    </BottomSheet>
  );
}
