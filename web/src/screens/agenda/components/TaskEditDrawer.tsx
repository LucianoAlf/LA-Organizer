// TaskEditDrawer — espelha EventEditDrawer pra editar tarefas existentes.
// Abre pré-preenchido com dados do banco. Substitui o QuickCreateSheet zerado
// que era usado erroneamente como modal de edição (semanticamente errado:
// modal = ação focada de criação; drawer = inspecionar+editar contexto).

import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DetailDrawer } from '../../../design/primitives/DetailDrawer';
import { DateInput } from '../../../components/DateInput';
import { Button } from '../../../components/Button';
import { EisenhowerPicker } from '../../../components/EisenhowerPicker';
import { useCollaboratorNames } from '../hooks/useCollaboratorNames';
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
    remind_time: t.remind_at ? new Date(t.remind_at).toTimeString().slice(0, 5) : '',
    eisenhower_quadrant: t.eisenhower_quadrant ?? null,
  };
}

export function TaskEditDrawer(p: TaskEditDrawerProps) {
  const t = p.task;
  const [form, setForm] = useState<FormState | null>(t ? buildInitialForm(t) : null);
  const names = useCollaboratorNames();

  // Resetar quando trocar de task.
  useEffect(() => {
    setForm(t ? buildInitialForm(t) : null);
  }, [t?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

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
      remind_at: remindAt,
      eisenhower_quadrant: form.eisenhower_quadrant,
    };
  }, [form, t]);

  if (!t || !form) {
    return <DetailDrawer open={false} onClose={p.onClose} title="">{null}</DetailDrawer>;
  }

  const error = validate(form);

  const handleSave = async () => {
    if (error || !patch) return;
    await p.onSave(t.id, patch);
    p.onClose();
  };

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
          <DateInput value={form.due_date} onChange={(d) => setForm({ ...form, due_date: d })} />
        </Field>

        {/* Lembretes — mesmos 6 chips do EventEditDrawer e EditEventSheet referência.
            Referência pra tasks: 09:00 da due_date (manhã do dia da tarefa).
            Single-select por enquanto pq tasks.remind_at é coluna única. */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1 flex items-baseline gap-2">
            <span>Lembretes</span>
            <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">selecione um</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([
              { label: 'Na hora',       minutes: 0    },
              { label: '15min antes',   minutes: 15   },
              { label: '30min antes',   minutes: 30   },
              { label: '1h antes',      minutes: 60   },
              { label: '2h antes',      minutes: 120  },
              { label: '1 dia antes',   minutes: 1440 },
            ] as const).map(p => {
              if (!form.due_date) {
                // Sem data, chips desabilitados
                return (
                  <button
                    key={p.minutes}
                    type="button"
                    disabled
                    className="px-3 py-1 rounded-full text-[11px] border border-border bg-bg-elevated text-fg-muted/40 cursor-not-allowed"
                  >
                    {p.label}
                  </button>
                );
              }
              // Referência: 09:00 SP da due_date
              const refIso = `${form.due_date}T09:00:00-03:00`;
              const refMs = new Date(refIso).getTime();
              const presetMs = refMs - p.minutes * 60_000;
              const presetTime = new Date(presetMs).toTimeString().slice(0, 5);
              const active = form.remind_time === presetTime;
              return (
                <button
                  key={p.minutes}
                  type="button"
                  onClick={() => setForm({ ...form, remind_time: active ? '' : presetTime })}
                  className={[
                    'px-3 py-1 rounded-full text-[11px] border transition-colors focus-ring',
                    active
                      ? 'bg-tom text-black border-tom font-semibold'
                      : 'bg-bg-elevated text-fg-muted border-border hover:text-fg',
                  ].join(' ')}
                >
                  {p.label}
                </button>
              );
            })}
            {form.remind_time && (
              <button
                type="button"
                onClick={() => setForm({ ...form, remind_time: '' })}
                className="px-3 py-1 rounded-full text-[11px] border border-border bg-bg-elevated text-danger hover:opacity-80 focus-ring"
              >
                Sem lembrete
              </button>
            )}
          </div>
          {form.remind_time && form.due_date && (
            <p className="text-[10px] text-fg-muted mt-1.5">
              TOM vai avisar em {new Date(`${form.due_date}T${form.remind_time}:00-03:00`).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}.
            </p>
          )}
          {!form.due_date && (
            <p className="text-[10px] text-fg-muted mt-1.5">
              Coloca uma data primeiro pra escolher lembrete.
            </p>
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
