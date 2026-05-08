// Sprint 22.30 — EditTaskSheet: edit completo de uma task existente.
// Antes: TaskRow so tinha Reagendar (data) e Excluir. Faltava editar titulo,
// alternar context (work<->personal), trocar prioridade Eisenhower e mexer em
// hora (remind_at).
//
// RescheduleSheet continua existindo — atalho rapido pra "so reagendar".
// EditTaskSheet eh o "edit completo" via menu RowMenu > Editar.

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { todaySP } from '../utils/date';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { DateInput } from './DateInput';
import { TimeInput } from './TimeInput';
import { EisenhowerPicker } from './EisenhowerPicker';
import type { Task, TaskContext } from '../types';

interface Props {
  open: boolean;
  task: Task | null;
  onClose: () => void;
}

function timeFromIso(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return fmt.format(d);  // "HH:MM"
}

export function EditTaskSheet({ open, task, onClose }: Props) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [context, setContext] = useState<TaskContext>('work');
  const [due, setDue] = useState('');
  const [time, setTime] = useState('');
  const [quadrant, setQuadrant] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sprint 22.31 — dep eh task?.id (nao task ref). Evita reset de state quando
  // queryClient refetcha em background e a referencia muda mas o id eh o mesmo.
  // Bug observado: usuario mudava data, refetch chegava, state era resetado pro
  // due_date antigo da task; ao salvar enviava o valor antigo.
  useEffect(() => {
    if (open && task) {
      setTitle(task.title || '');
      setContext(task.context);
      setDue(task.due_date || todaySP());
      setTime(timeFromIso(task.remind_at));
      setQuadrant((task.eisenhower_quadrant as number | null) ?? null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const update = useMutation({
    mutationFn: async () => {
      if (!collaborator || !task) throw new Error('no_task');
      const t = title.trim();
      if (t.length < 2) throw new Error('Título curto demais.');
      if (!due) throw new Error('Coloca uma data válida.');
      const remindAt = time ? `${due}T${time}:00-03:00` : null;
      const patch = {
        title: t.slice(0, 200),
        context,
        due_date: due,
        remind_at: remindAt,
        eisenhower_quadrant: quadrant,
      };
      const { data, error: e } = await supabase
        .from('tasks')
        .update(patch)
        .eq('id', task.id)
        .select('id');
      if (e) throw e;
      if (!data || data.length === 0) {
        throw new Error('Não consegui salvar (sem permissão ou tarefa removida).');
      }
      return patch;
    },
    onSuccess: async (patch) => {
      // Sprint 22.32 — optimistic: aplica patch direto no cache de TODAS queries
      // que comecam com ['tasks'] pra UI refletir IMEDIATO (antes do refetch).
      // Bug observado: invalidateQueries marca stale mas re-render so chega no
      // proximo tick; user via dot/cor antiga. Agora atualiza na hora.
      if (!task) return;
      qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(t => t.id === task.id ? { ...t, ...patch } as Task : t);
      });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
  });

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    update.mutate(undefined, {
      onError: (err) => setError(err instanceof Error ? err.message : String(err)),
    });
  };

  return (
    <BottomSheet open={open && Boolean(task)} onClose={onClose} title="Editar tarefa">
      {task && (
        <form onSubmit={onSave} className="space-y-md">
          <label className="block">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Título</div>
            <input
              type="text"
              required
              maxLength={200}
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg focus-ring"
            />
          </label>

          {/* Sprint 22.31 — em delegadas (assigned_to != self), mostra "Delegada
              para X" read-only e esconde toggle Trabalho/Pessoal (delegada e
              sempre work — privacidade). */}
          {task.assigned_to !== collaborator?.id ? (
            <div className="rounded-md border border-border bg-bg-elevated p-3">
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1">Delegada para</div>
              <div className="text-body-md text-fg">
                {task.assignee?.full_name ?? '—'}
              </div>
              <div className="text-body-sm text-fg-muted mt-1">
                Tarefa de trabalho · só {task.assignee?.full_name?.split(' ')[0] ?? 'a pessoa'} pode marcar como feita (você também pode dar baixa do seu lado).
              </div>
            </div>
          ) : (
            <fieldset>
              <legend className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Tipo</legend>
              <div role="radiogroup" className="grid grid-cols-2 gap-2">
                {([
                  { v: 'work', label: 'Trabalho' },
                  { v: 'personal', label: 'Pessoal' },
                ] as const).map(o => {
                  const active = context === o.v;
                  return (
                    <button
                      key={o.v}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setContext(o.v)}
                      className={[
                        'h-11 rounded-md border text-body-md font-semibold transition-colors focus-ring',
                        active
                          ? 'bg-tom text-white border-tom'
                          : 'bg-bg-subtle text-fg-secondary border-border',
                      ].join(' ')}
                    >{o.label}</button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div>
            <div className="flex items-baseline gap-md flex-wrap mb-1.5">
              <span className="text-label uppercase tracking-wide text-fg-muted">Para quando</span>
              <span className="text-label uppercase tracking-wide text-fg-muted">
                Lembrar às <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional</span>
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <DateInput value={due} onChange={setDue} />
              <TimeInput value={time} onChange={setTime} />
              {time && (
                <button
                  type="button"
                  onClick={() => setTime('')}
                  className="text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm px-2 py-1"
                >
                  limpar
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
              <span>Prioridade</span>
              <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional</span>
            </div>
            <EisenhowerPicker value={quadrant} onChange={setQuadrant} />
          </div>

          {error && (
            <p role="alert" className="text-body-sm text-danger">{error}</p>
          )}

          <div className="flex items-center gap-md pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={update.isPending} fullWidth>Salvar</Button>
          </div>
        </form>
      )}
    </BottomSheet>
  );
}
