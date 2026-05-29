import { useState, useEffect, FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { todaySP } from '../utils/date';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { DateInput } from './DateInput';
import { TimeInput } from './TimeInput';
import { RemindersField } from './RemindersField';
import type { TaskContext } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill due_date (e.g., from /semana when adding to a specific day). Defaults to today. */
  defaultDueDate?: string;
}

/**
 * Sprint 30 — Além de título/contexto/data, agora suporta horário-alvo (due_time)
 * e lembretes (task_reminders). Antes o lembrete criado no mobile não persistia
 * porque o sheet não tinha o campo. Project/Eisenhower seguem null.
 */
export function QuickTaskSheet({ open, onClose, defaultDueDate }: Props) {
  const { collaborator, ensureSession } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [ctx, setCtx] = useState<TaskContext>('work');
  const [due, setDue] = useState(defaultDueDate || todaySP());
  const [dueTime, setDueTime] = useState('');  // HH:MM ('' = sem horário)
  const [reminderTimes, setReminderTimes] = useState<string[]>([]);  // datetime-local SP

  // Reset form on open. defaultDueDate excluído das deps de propósito: se
  // incluído, o effect re-executa caso o pai recalcule a data enquanto o sheet
  // está aberto, sobrescrevendo a escolha do usuário.
  useEffect(() => {
    if (open) {
      setTitle('');
      setCtx('work');
      setDue(defaultDueDate || todaySP());
      setDueTime('');
      setReminderTimes([]);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useMutation({
    mutationFn: async () => {
      // Sprint 27 — refresh transparente antes do throw
      const collab = collaborator ?? await ensureSession();
      if (!collab) throw new Error('no_session');
      const { data, error } = await supabase.from('tasks').insert({
        title: title.trim().slice(0, 200),
        assigned_to: collab.id,
        created_by: collab.id,
        source: 'manual', // CHECK constraint: manual|agent_*|checkpoint_decomposition|coordinator_assignment|system
        status: 'pending',
        context: ctx,
        priority: 'medium',
        due_date: due,
        due_time: dueTime || null,
      }).select('id').single();
      if (error) throw error;
      // Sprint 30 — persiste lembretes em task_reminders (antes o mobile ignorava).
      if (data?.id && reminderTimes.length > 0) {
        const rows = reminderTimes.map(local => ({
          task_id: data.id,
          remind_at: `${local}:00-03:00`,
        }));
        const { error: remErr } = await supabase.from('task_reminders').insert(rows);
        if (remErr) throw remErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate();
  };

  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Nova tarefa" size="sm">
      <form onSubmit={onSubmit} className="space-y-md">
        <label className="block">
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Título</div>
          <input
            type="text"
            required
            autoFocus
            maxLength={200}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Ex.: Ligar pro pai do aluno X"
            className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring"
          />
        </label>

        <fieldset>
          <legend className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Tipo</legend>
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {([
              { v: 'work', label: 'Trabalho' },
              { v: 'personal', label: 'Pessoal' },
            ] as const).map(o => {
              const active = ctx === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setCtx(o.v)}
                  className={[
                    'h-11 rounded-md border text-body-md font-semibold transition-colors focus-ring',
                    active
                      ? 'bg-brand text-white border-brand'
                      : 'bg-bg-subtle text-fg-secondary border-border',
                  ].join(' ')}
                >{o.label}</button>
              );
            })}
          </div>
        </fieldset>

        <div className="block">
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Para quando</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <DateInput value={due} onChange={setDue} />
            </div>
            <div className="w-28 shrink-0">
              {/* Sprint 30 — horário-alvo opcional. */}
              <TimeInput value={dueTime} onChange={setDueTime} />
            </div>
          </div>
        </div>

        {/* Sprint 30 — lembretes na criação mobile (antes não existia → não persistia).
            Âncora = horário da tarefa quando definido; senão 09:00. */}
        <RemindersField
          referenceDateTime={due ? `${due}T${dueTime || '09:00'}` : ''}
          value={reminderTimes}
          onChange={setReminderTimes}
        />

        {create.error && (
          <p className="text-body-sm text-danger" role="alert">
            Não consegui criar. {(create.error as Error).message}
          </p>
        )}

        <div className="flex items-center gap-md pt-2">
          <Button type="submit" loading={create.isPending} fullWidth>Criar</Button>
        </div>
      </form>
    </AdaptiveSheet>
  );
}
