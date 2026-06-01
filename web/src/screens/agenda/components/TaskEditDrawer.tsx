// TaskEditDrawer — espelha EventEditDrawer pra editar tarefas existentes.
// Abre pré-preenchido com dados do banco. Substitui o QuickCreateSheet zerado
// que era usado erroneamente como modal de edição (semanticamente errado:
// modal = ação focada de criação; drawer = inspecionar+editar contexto).

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { DetailDrawer } from '../../../design/primitives/DetailDrawer';
import { DateInput } from '../../../components/DateInput';
import { TimeInput } from '../../../components/TimeInput';
import { Button } from '../../../components/Button';
import { EisenhowerPicker } from '../../../components/EisenhowerPicker';
import { RemindersField } from '../../../components/RemindersField';
import { RecurrencePicker } from '../../../components/RecurrencePicker';
import { RecurrenceScopeDialog } from '../../../components/RecurrenceScopeDialog';
import { editTaskSeries, type TaskPatch } from '../../../lib/editTaskSeries';
import { notifyTaskUpdated } from '../../../lib/tomEngine';
import { showToast } from '../../../components/Toast';
import { supabase } from '../../../lib/supabase';
import { useCollaboratorNames } from '../hooks/useCollaboratorNames';
import { useReminders } from '../hooks/useReminders';
import type { TaskForPanel } from '../hooks/useAgendaTasks';

export interface TaskEditDrawerProps {
  task: TaskForPanel | null;
  open: boolean;
  onClose: () => void;
  /** Patch parcial pra UPDATE no Supabase. Não inclui id.
   *  Usa Record genérico porque o status do banco aceita 'cancelled' mas o
   *  TaskForPanel (tipo de display) filtra esse status. */
  onSave: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

type Status = 'pending' | 'in_progress' | 'done' | 'cancelled';

interface FormState {
  title: string;
  description: string;
  context: 'work' | 'personal';
  status: Status;
  due_date: string;        // YYYY-MM-DD
  due_time: string;        // HH:MM ('' = sem horário definido)
  remind_time: string;     // HH:MM ('' = sem lembrete)
  eisenhower_quadrant: number | null;
}

function buildInitialForm(t: TaskForPanel): FormState {
  // Status do banco pode ser 'overdue' (derivado) ou 'delegated' — normaliza pra
  // editáveis. Overdue vira pending (já que due_date < hoje continua atrasada).
  const rawStatus = t.status === 'overdue' || t.status === 'delegated' ? 'pending' : t.status;
  return {
    title: t.title,
    description: t.description ?? '',
    context: t.context,
    status: rawStatus as Status,
    due_date: (t.due_date ?? t.scheduled_date ?? '').slice(0, 10),
    due_time: (t.due_time ?? '').slice(0, 5),
    remind_time: t.remind_at ? new Date(t.remind_at).toTimeString().slice(0, 5) : '',
    eisenhower_quadrant: t.eisenhower_quadrant ?? null,
  };
}

export function TaskEditDrawer(p: TaskEditDrawerProps) {
  const t = p.task;
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState | null>(t ? buildInitialForm(t) : null);
  const [reminderTimes, setReminderTimes] = useState<string[]>([]);
  const names = useCollaboratorNames();
  const reminders = useReminders('task', t?.id);

  // Sprint 23 — recorrência. recurrenceRule = regra atual editável; seriesRuleOriginal =
  // regra da série ao abrir (pra detectar mudança). Ocorrências materializadas não têm
  // recurrence_rule próprio — buscamos o template via recurrence_parent_id.
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(t?.recurrence_rule ?? null);
  const [seriesRuleOriginal, setSeriesRuleOriginal] = useState<string | null>(t?.recurrence_rule ?? null);
  const [scopeOpen, setScopeOpen] = useState(false);
  // reminderDirty: o user mexeu nos lembretes? Só passamos reminderTimes pro editTaskSeries
  // quando true, pra não apagar lembretes que o user não tocou.
  const [reminderDirty, setReminderDirty] = useState(false);

  // Resetar quando trocar de task.
  useEffect(() => {
    setForm(t ? buildInitialForm(t) : null);
  }, [t?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  // Sincroniza lembretes do servidor quando task muda ou data chega.
  useEffect(() => {
    setReminderTimes(reminders.localTimes);
    setReminderDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id, reminders.localTimes.length]);

  // Sprint 23 — busca a regra da série ao abrir. Se a task é o próprio template
  // (recurrence_rule), usa direto; se é ocorrência (recurrence_parent_id), busca o pai.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (t?.recurrence_rule) {
        setRecurrenceRule(t.recurrence_rule);
        setSeriesRuleOriginal(t.recurrence_rule);
        return;
      }
      if (t?.recurrence_parent_id) {
        const { data } = await supabase
          .from('tasks')
          .select('recurrence_rule')
          .eq('id', t.recurrence_parent_id)
          .single();
        const r = (data as { recurrence_rule: string | null } | null)?.recurrence_rule ?? null;
        if (!cancelled) { setRecurrenceRule(r); setSeriesRuleOriginal(r); }
      } else {
        setRecurrenceRule(null);
        setSeriesRuleOriginal(null);
      }
    })();
    return () => { cancelled = true; };
  }, [t?.id, t?.recurrence_rule, t?.recurrence_parent_id]);

  const patch = useMemo(() => {
    if (!form || !t) return null;
    const remindAt = form.remind_time && form.due_date
      ? `${form.due_date}T${form.remind_time}:00-03:00`
      : null;
    return {
      title: form.title.trim().slice(0, 200),
      description: form.description.trim() || null,
      context: form.context,
      status: form.status,
      due_date: form.due_date || null,
      due_time: form.due_time || null,
      remind_at: remindAt,
      eisenhower_quadrant: form.eisenhower_quadrant,
    };
  }, [form, t]);

  if (!t || !form) {
    return <DetailDrawer open={false} onClose={p.onClose} title="">{null}</DetailDrawer>;
  }

  const error = validate(form);

  // Sprint 23 — série = task tem rule/parent OU o user acabou de ligar recorrência.
  const isSeries = Boolean(t.recurrence_parent_id || t.recurrence_rule) || (recurrenceRule != null);
  const ruleChanged = (recurrenceRule ?? null) !== (seriesRuleOriginal ?? null);

  const handleSave = async () => {
    if (error || !patch) return;
    if (isSeries) { setScopeOpen(true); return; }
    await p.onSave(t.id, patch);
    // Sincroniza lembretes em task_reminders (DELETE-all + INSERT-new).
    try { await reminders.sync(reminderTimes); } catch (e) { console.warn('[TaskEditDrawer] reminders sync err:', e); }
    p.onClose();
  };

  async function doSaveSeries(scope: 'only_this' | 'this_and_future') {
    setScopeOpen(false);
    if (!t || !form) return;
    if (validate(form)) return;

    const seriesPatch: TaskPatch = {
      title: form.title.trim().slice(0, 200),
      description: form.description.trim() || null,
      context: form.context,
      due_time: form.due_time || null,
      eisenhower_quadrant: form.eisenhower_quadrant != null ? String(form.eisenhower_quadrant) : null,
    };
    const newRule = ruleChanged ? recurrenceRule : undefined;
    // reminderTimes são datetime-local "YYYY-MM-DDTHH:MM"; editTaskSeries espera ["HH:MM"]
    // (re-ancora a cada ocorrência). Converte pegando a parte após "T". Só envia se o user
    // mexeu (senão undefined = preserva lembretes existentes).
    const reminderArg = reminderDirty
      ? reminderTimes.map(local => local.split('T')[1]?.slice(0, 5)).filter((s): s is string => Boolean(s))
      : undefined;

    const res = await editTaskSeries(
      { id: t.id, recurrence_parent_id: t.recurrence_parent_id ?? null, due_date: form.due_date },
      scope, seriesPatch, newRule, reminderArg,
    );
    if (!res.ok) {
      showToast({ kind: 'error', title: 'Tarefa', msg: 'Não consegui salvar: ' + (res.error ?? '') });
      return;
    }
    await qc.invalidateQueries({ queryKey: ['tasks'] });
    await qc.invalidateQueries({ queryKey: ['agenda-tasks'] });
    if (t.delegated_to) {
      try { await notifyTaskUpdated(t.id, 'edited'); } catch { /* notificação best-effort */ }
    }
    showToast({ kind: 'success', title: 'Tarefa atualizada' });
    p.onClose();
  }

  const handleDelete = async () => {
    if (!confirm('Deletar essa tarefa? Essa ação não pode ser desfeita.')) return;
    await p.onDelete(t.id);
    p.onClose();
  };

  const delegatedName = names.firstName(t.delegated_to);
  const createdLabel = t.created_at
    ? new Date(t.created_at).toLocaleDateString('pt-BR')
    : null;

  return (
    <>
    <DetailDrawer
      open={p.open}
      onClose={p.onClose}
      title="Editar tarefa"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleDelete}>
            <Trash2 size={14} /> Deletar
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={p.onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!!error}>Salvar</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="Título">
          <input
            value={form.title}
            maxLength={200}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full h-9 px-2 rounded-md bg-bg-surface border border-border text-fg"
          />
        </Field>

        <Field label="Descrição">
          <textarea
            value={form.description}
            maxLength={2000}
            rows={3}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Detalhes da tarefa, contexto, links..."
            className="w-full px-2 py-1.5 rounded-md bg-bg-surface border border-border text-fg resize-y placeholder:text-fg-muted"
          />
        </Field>

        <Field label="Contexto">
          <div className="flex gap-2">
            {(['work', 'personal'] as const).map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setForm({ ...form, context: c })}
                className={['h-8 px-3 rounded-md text-[12px] focus-ring',
                  form.context === c ? 'bg-tom text-black font-semibold' : 'bg-bg-elevated text-fg-muted'].join(' ')}
              >
                {c === 'work' ? 'Trabalho' : 'Pessoal'}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Status">
          <div className="flex gap-2 flex-wrap">
            {([
              { v: 'pending',     label: 'Pendente'   },
              { v: 'in_progress', label: 'Em curso'   },
              { v: 'done',        label: '✓ Feita'    },
              { v: 'cancelled',   label: '✕ Cancelada'},
            ] as const).map(s => (
              <button
                key={s.v}
                type="button"
                onClick={() => setForm({ ...form, status: s.v })}
                className={['h-8 px-3 rounded-md text-[12px] focus-ring',
                  form.status === s.v ? 'bg-tom text-black font-semibold' : 'bg-bg-elevated text-fg-muted'].join(' ')}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Para quando">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <DateInput value={form.due_date} onChange={(d) => setForm({ ...form, due_date: d })} />
            </div>
            <div className="w-24 shrink-0">
              {/* Sprint 30 — horário-alvo da tarefa (opcional). Vazio = sem horário. */}
              <TimeInput value={form.due_time} onChange={(h) => setForm({ ...form, due_time: h })} />
            </div>
          </div>
        </Field>

        {/* Lembretes — RemindersField shared (multi-select).
            Persistência: task_reminders table via useReminders('task', t.id).
            Sprint 30 — âncora dos lembretes = horário da tarefa (due_time) quando
            definido; senão 09:00 (default histórico). TOM dispatcher lê task_reminders. */}
        <RemindersField
          referenceDateTime={form.due_date ? `${form.due_date}T${form.due_time || '09:00'}` : ''}
          value={reminderTimes}
          onChange={(v) => { setReminderTimes(v); setReminderDirty(true); }}
        />

        {/* Sprint 23 — recorrência (logo abaixo de "Para quando" + lembretes).
            RecurrencePicker renderiza seu próprio label "Repetição". */}
        <div>
          <RecurrencePicker value={recurrenceRule} onChange={setRecurrenceRule} startDate={form.due_date} />
          {(t.recurrence_rule || t.recurrence_parent_id) && (
            <p className="text-[11px] text-fg-muted mt-1">🔁 Tarefa recorrente — alterações valem desta data em diante.</p>
          )}
        </div>

        <Field label="Prioridade">
          <EisenhowerPicker
            value={form.eisenhower_quadrant}
            onChange={(q) => setForm({ ...form, eisenhower_quadrant: q })}
          />
        </Field>

        {delegatedName && (
          <Field label="Delegada pra">
            <div className="flex items-center gap-2 text-[13px] text-fg">
              <span>→ {delegatedName}</span>
              <span className="text-[10px] text-fg-muted">(pra mudar pessoa, deletar e recriar via Delegar)</span>
            </div>
          </Field>
        )}

        <div className="text-[10px] text-fg-muted pt-2 border-t border-border">
          {t.source ? `Criado por ${t.source}` : 'Criado'}
          {createdLabel ? ` · ${createdLabel}` : ''}
        </div>

        {error && <div className="text-[12px] text-danger">{error}</div>}
      </div>
    </DetailDrawer>
    <RecurrenceScopeDialog
      open={scopeOpen}
      onClose={() => setScopeOpen(false)}
      onChoose={doSaveSeries}
    />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1">{label}</div>
      {children}
    </div>
  );
}

function validate(f: FormState): string | null {
  if (!f.title.trim()) return 'Título obrigatório';
  if (f.remind_time && !f.due_date) return 'Pra ter lembrete, precisa de data.';
  return null;
}
