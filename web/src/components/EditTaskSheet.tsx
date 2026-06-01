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
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { DateInput } from './DateInput';
import { TimeInput } from './TimeInput';
import { EisenhowerPicker } from './EisenhowerPicker';
import { RemindersField } from './RemindersField';
import { useReminders } from '../screens/agenda/hooks/useReminders';
import { notifyTaskUpdated } from '../lib/tomEngine';
import { showToast } from './Toast';
import { RecurrencePicker } from './RecurrencePicker';
import { RecurrenceScopeDialog } from './RecurrenceScopeDialog';
import { editTaskSeries, type TaskPatch } from '../lib/editTaskSeries';
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
  const [dueTime, setDueTime] = useState('');  // HH:MM ('' = sem horário)
  const [quadrant, setQuadrant] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reminderTimes, setReminderTimes] = useState<string[]>([]);
  const reminders = useReminders('task', task?.id);

  // Sprint 23 — recorrência. recurrenceRule = regra atual editável; seriesRuleOriginal =
  // regra da série ao abrir (pra detectar mudança). Ocorrências materializadas não têm
  // recurrence_rule próprio — buscamos o template via recurrence_parent_id.
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(task?.recurrence_rule ?? null);
  const [seriesRuleOriginal, setSeriesRuleOriginal] = useState<string | null>(task?.recurrence_rule ?? null);
  const [scopeOpen, setScopeOpen] = useState(false);
  // reminderDirty: o user mexeu nos lembretes? Só passamos reminderTimes pro editTaskSeries
  // quando true, pra não apagar lembretes que o user não tocou.
  const [reminderDirty, setReminderDirty] = useState(false);

  // Sprint 22.31 — dep eh task?.id (nao task ref). Evita reset de state quando
  // queryClient refetcha em background e a referencia muda mas o id eh o mesmo.
  // Bug observado: usuario mudava data, refetch chegava, state era resetado pro
  // due_date antigo da task; ao salvar enviava o valor antigo.
  useEffect(() => {
    if (open && task) {
      setTitle(task.title || '');
      setContext(task.context);
      setDue(task.due_date || todaySP());
      setDueTime((task.due_time ?? '').slice(0, 5));
      setQuadrant((task.eisenhower_quadrant as number | null) ?? null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);
  // Sincroniza lembretes do servidor quando task muda ou data chega.
  useEffect(() => {
    setReminderTimes(reminders.localTimes);
    setReminderDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, reminders.localTimes.length]);

  // Sprint 23 — busca a regra da série ao abrir. Se a task é o próprio template
  // (recurrence_rule), usa direto; se é ocorrência (recurrence_parent_id), busca o pai.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (task?.recurrence_rule) {
        setRecurrenceRule(task.recurrence_rule);
        setSeriesRuleOriginal(task.recurrence_rule);
        return;
      }
      if (task?.recurrence_parent_id) {
        const { data } = await supabase
          .from('tasks')
          .select('recurrence_rule')
          .eq('id', task.recurrence_parent_id)
          .single();
        const r = (data as { recurrence_rule: string | null } | null)?.recurrence_rule ?? null;
        if (!cancelled) { setRecurrenceRule(r); setSeriesRuleOriginal(r); }
      } else {
        setRecurrenceRule(null);
        setSeriesRuleOriginal(null);
      }
    })();
    return () => { cancelled = true; };
  }, [task?.id, task?.recurrence_rule, task?.recurrence_parent_id]);

  const update = useMutation({
    mutationFn: async () => {
      if (!collaborator || !task) throw new Error('no_task');
      const t = title.trim();
      if (t.length < 2) throw new Error('Título curto demais.');
      if (!due) throw new Error('Coloca uma data válida.');
      // remind_at (single) deprecated em favor de task_reminders (multi).
      // Setamos null pra não conflitar; lembretes vêm via reminders.sync abaixo.
      const patch = {
        title: t.slice(0, 200),
        context,
        due_date: due,
        due_time: dueTime || null,
        remind_at: null,
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
      // Sprint 22.34m — se delegada (created_by != assigned_to), avisa o assignee.
      if (task.created_by && task.assigned_to && task.created_by !== task.assigned_to && task.created_by === collaborator.id) {
        const r = await notifyTaskUpdated(task.id, 'edited');
        if (r.ok && (r.sent ?? 0) > 0) {
          showToast({ kind: 'success', title: 'Tarefa atualizada', msg: 'TOM avisou pelo WhatsApp.' });
        } else if (!r.ok) {
          showToast({ kind: 'error', title: 'Tarefa atualizada', msg: `Salvou, mas notificação falhou (${r.reason}).` });
        }
      }
      return patch;
    },
    onSuccess: async (patch) => {
      // Sprint 22.32b — keys explicitas (setQueriesData com prefix tava nao
      // disparando re-render confiavel). Atualiza cada chave + refetchQueries
      // pra garantir sync com server.
      if (!task || !collaborator) return;
      const keys: readonly (readonly [string, string, string | undefined])[] = [
        ['tasks', 'hoje', collaborator.id],
        ['tasks', 'delegated', collaborator.id],
      ];
      for (const key of keys) {
        qc.setQueryData<Task[]>([...key], (old) => {
          if (!old) return old;
          return old.map(t => t.id === task.id ? ({ ...t, ...patch } as Task) : t);
        });
      }
      await qc.refetchQueries({ queryKey: ['tasks'], type: 'active' });
      // Sincroniza task_reminders (DELETE-all + INSERT-new).
      try { await reminders.sync(reminderTimes); } catch (e) { console.warn('[EditTaskSheet] reminders sync err:', e); }
      onClose();
    },
  });

  // Sprint 23 — série = task tem rule/parent OU o user acabou de ligar recorrência.
  const isSeries = Boolean(task?.recurrence_parent_id || task?.recurrence_rule) || (recurrenceRule != null);
  const ruleChanged = (recurrenceRule ?? null) !== (seriesRuleOriginal ?? null);

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isSeries) { setScopeOpen(true); return; }
    update.mutate(undefined, {
      onError: (err) => setError(err instanceof Error ? err.message : String(err)),
    });
  };

  async function doSaveSeries(scope: 'only_this' | 'this_and_future') {
    setScopeOpen(false);
    setError(null);
    if (!task || !collaborator) return;
    const t = title.trim();
    if (t.length < 2) { setError('Título curto demais.'); return; }
    if (!due) { setError('Coloca uma data válida.'); return; }

    const patch: TaskPatch = {
      title: t.slice(0, 200),
      context,
      due_time: dueTime || null,
      eisenhower_quadrant: quadrant != null ? String(quadrant) : null,
    };
    const newRule = ruleChanged ? recurrenceRule : undefined;
    // reminderTimes são datetime-local "YYYY-MM-DDTHH:MM"; editTaskSeries espera ["HH:MM"]
    // (re-ancora a cada ocorrência). Converte pegando a parte após "T". Só envia se o user
    // mexeu (senão undefined = preserva lembretes existentes).
    const reminderArg = reminderDirty
      ? reminderTimes.map(local => local.split('T')[1]?.slice(0, 5)).filter((s): s is string => Boolean(s))
      : undefined;

    const res = await editTaskSeries(
      { id: task.id, recurrence_parent_id: task.recurrence_parent_id ?? null, due_date: due },
      scope, patch, newRule, reminderArg,
    );
    if (!res.ok) { setError('Não consegui salvar: ' + (res.error ?? '')); return; }
    await qc.invalidateQueries({ queryKey: ['tasks'] });
    await qc.refetchQueries({ queryKey: ['tasks'], type: 'active' });
    if (task.created_by && task.assigned_to && task.created_by !== task.assigned_to && task.created_by === collaborator.id) {
      try { await notifyTaskUpdated(task.id, 'edited'); } catch { /* notificação best-effort */ }
    }
    showToast({ kind: 'success', title: 'Tarefa atualizada' });
    onClose();
  }

  return (
    <AdaptiveSheet open={open && Boolean(task)} onClose={onClose} title="Editar tarefa" size="md">
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
                          ? 'bg-tom text-black border-tom'
                          : 'bg-bg-subtle text-fg-secondary border-border',
                      ].join(' ')}
                    >{o.label}</button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Para quando</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <DateInput value={due} onChange={setDue} />
              </div>
              <div className="w-28 shrink-0">
                {/* Sprint 30 — horário-alvo da tarefa (opcional). */}
                <TimeInput value={dueTime} onChange={setDueTime} />
              </div>
            </div>
          </div>

          {/* Lembretes — RemindersField shared.
              Sprint 30 — âncora = horário da tarefa (dueTime) quando definido; senão 09:00.
              Persistência: task_reminders table via useReminders('task', id). */}
          <RemindersField
            referenceDateTime={due ? `${due}T${dueTime || '09:00'}` : ''}
            value={reminderTimes}
            onChange={(v) => { setReminderTimes(v); setReminderDirty(true); }}
          />

          {/* Sprint 23 — recorrência (logo abaixo de "Para quando" + lembretes). */}
          <div>
            <RecurrencePicker value={recurrenceRule} onChange={setRecurrenceRule} startDate={due} />
            {(task.recurrence_rule || task.recurrence_parent_id) && (
              <p className="text-[11px] text-fg-muted mt-1">🔁 Tarefa recorrente — alterações valem desta data em diante.</p>
            )}
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
      <RecurrenceScopeDialog
        open={scopeOpen}
        onClose={() => setScopeOpen(false)}
        onChoose={doSaveSeries}
      />
    </AdaptiveSheet>
  );
}
