import { useState, useEffect, FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { todaySP } from '../utils/date';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { DateInput } from './DateInput';
import type { Task } from '../types';

// Sprint 11.2 hotfix — formatador inline pro horário em America/Sao_Paulo.
// Bug observado: modal mostrava só a data ("Atual: 29/04") sem o horário do
// remind_at, ficando inconsistente com o TaskRow (que mostra ⏰ 14h).
function fmtTimeBR(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const hh = parts.find(p => p.type === 'hour')?.value || '00';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  return mm === '00' ? `${parseInt(hh, 10)}h` : `${parseInt(hh, 10)}h${mm}`;
}

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
      // Se a task tinha remind_at, preservar o HORÁRIO mas atualizar pra nova data.
      // Sem isso, reagendar acabava deixando lembrete na data antiga (visualmente
      // "ficou no dia errado"). Concatena novo YMD + hora original em -03:00.
      if (task.remind_at) {
        const orig = new Date(task.remind_at);
        if (!isNaN(orig.getTime())) {
          const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
          }).formatToParts(orig);
          const hh = parts.find(p => p.type === 'hour')?.value || '00';
          const mm = parts.find(p => p.type === 'minute')?.value || '00';
          update.remind_at = `${date}T${hh}:${mm}:00-03:00`;
        }
      }
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
                {task.remind_at && (
                  <span className="ml-1.5">
                    <span aria-hidden>⏰</span> {fmtTimeBR(task.remind_at)}
                  </span>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Novo prazo</div>
            <DateInput value={date} onChange={setDate} />
          </div>

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
