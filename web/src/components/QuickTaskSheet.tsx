import { useState, useEffect, FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { todaySP } from '../utils/date';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import type { TaskContext } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill due_date (e.g., from /semana when adding to a specific day). Defaults to today. */
  defaultDueDate?: string;
}

/**
 * Sprint 1 spec: 3 fields only — title (required), context (work|personal),
 * due_date (default today). NO project picker, recurring, priority, or remind_at.
 * Project link / Eisenhower / quadrant stay null; engine reprocesses on next briefing
 * cycle if needed. Auth/INSERT policy enforces ownership.
 */
export function QuickTaskSheet({ open, onClose, defaultDueDate }: Props) {
  const { collaborator, ensureSession } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [ctx, setCtx] = useState<TaskContext>('work');
  const [due, setDue] = useState(defaultDueDate || todaySP());

  // Reset form on open + sync default due_date
  useEffect(() => {
    if (open) {
      setTitle('');
      setCtx('work');
      setDue(defaultDueDate || todaySP());
    }
  }, [open, defaultDueDate]);

  const create = useMutation({
    mutationFn: async () => {
      // Sprint 27 — refresh transparente antes do throw
      const collab = collaborator ?? await ensureSession();
      if (!collab) throw new Error('no_session');
      const { error } = await supabase.from('tasks').insert({
        title: title.trim().slice(0, 200),
        assigned_to: collab.id,
        created_by: collab.id,
        source: 'manual', // CHECK constraint: manual|agent_*|checkpoint_decomposition|coordinator_assignment|system
        status: 'pending',
        context: ctx,
        priority: 'medium',
        due_date: due,
      });
      if (error) throw error;
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
    <BottomSheet open={open} onClose={onClose} title="Nova tarefa">
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

        <label className="block">
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Para quando</div>
          <input
            type="date"
            required
            value={due}
            onChange={e => setDue(e.target.value)}
            className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg focus-ring"
          />
        </label>

        {create.error && (
          <p className="text-body-sm text-danger" role="alert">
            Não consegui criar. {(create.error as Error).message}
          </p>
        )}

        <div className="flex items-center gap-md pt-2">
          <Button type="submit" loading={create.isPending} fullWidth>Criar</Button>
        </div>
      </form>
    </BottomSheet>
  );
}
