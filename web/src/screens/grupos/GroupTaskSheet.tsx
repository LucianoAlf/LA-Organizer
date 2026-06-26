// web/src/screens/grupos/GroupTaskSheet.tsx
// Edição de tarefa do POOL (spec 2026-06-10) — primeiro CRUD de task de grupo do app.
// readOnly: não-membro (gestor) visualiza sem salvar — nunca falhar em silêncio.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdaptiveSheet } from '../../components/AdaptiveSheet';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { DateInput } from '../../components/DateInput';
import { TimeInput } from '../../components/TimeInput';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { showToast } from '../../components/Toast';
import type { PoolTaskRow } from '../../hooks/useGroupWorkspace';

const PRESETS = [
  { min: 0, label: 'Na hora' }, { min: 60, label: '1h antes' }, { min: 120, label: '2h antes' }, { min: 1440, label: '1 dia antes' },
] as const;

interface Props {
  open: boolean; task: PoolTaskRow | null; groupName: string; readOnly: boolean;
  onClose: () => void;
  onSave: (input: { id: string; title: string; description: string | null; due_date: string | null; due_time: string | null; reminderIsos: string[]; dueChanged: boolean }) => Promise<void>;
  onCancelTask: (id: string) => Promise<void>;
  onReopen?: (task: PoolTaskRow) => void;
}

export function GroupTaskSheet({ open, task, groupName, readOnly, onClose, onSave, onCancelTask, onReopen }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [time, setTime] = useState('');
  const [mins, setMins] = useState<number[]>([]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && task) {
      setTitle(task.title); setDescription(task.description ?? '');
      setDue(task.due_date ?? ''); setTime(task.due_time ? task.due_time.slice(0, 5) : '');
      setMins([]); setConfirmCancel(false);
    }
  }, [open, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Descrição auto-cresce com o conteúdo (até um teto, depois rola) — não corta texto longo.
  useEffect(() => {
    const el = descRef.current;
    if (!el || !open) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 320) + 'px';
  }, [description, open]);

  const pendingExisting = useMemo(() =>
    (task?.task_reminders ?? []).filter(r => !r.sent_at).length, [task]);

  if (!task) return null;
  const isDone = task.status === 'done';
  const dueChangedLive = (due || null) !== (task.due_date ?? null);
  const reminderSub = !due
    ? 'selecione um prazo primeiro'
    : pendingExisting === 0
      ? 'vão pra TODOS os membros'
      : mins.length > 0 || dueChangedLive
        ? `vão pra TODOS os membros · ${pendingExisting} agendado(s) serão substituídos ao salvar`
        : `vão pra TODOS os membros · ${pendingExisting} agendado(s) mantidos`;

  async function save() {
    if (!task) return;
    if (!title.trim()) { showToast({ kind: 'error', title: 'Coloca um título.' }); return; }
    setSaving(true);
    try {
      // Lembretes: âncora = due + hora (ou 09:00), offset fixo -03:00 (padrão do projeto).
      const baseMs = due ? new Date(`${due}T${time || '09:00'}:00-03:00`).getTime() : null;
      const reminderIsos = baseMs ? mins.map(m => new Date(baseMs - m * 60000).toISOString()) : [];
      await onSave({
        id: task.id, title, description: description || null,
        due_date: due || null, due_time: time ? `${time}:00` : null,
        reminderIsos, dueChanged: (due || null) !== (task.due_date ?? null),
      });
      showToast({ kind: 'success', title: 'Tarefa do grupo atualizada' });
      onClose();
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      showToast({ kind: 'error', title: m === 'SEM_PERMISSAO' ? 'Só membros do grupo editam' : 'Não consegui salvar', msg: m === 'SEM_PERMISSAO' ? 'Entra no grupo pela ⚙ ou pede pra um membro.' : undefined });
    } finally { setSaving(false); }
  }

  async function cancelTask() {
    if (!task) return;
    setCancelling(true);
    try {
      await onCancelTask(task.id);
      setConfirmCancel(false);
      onClose();
      showToast({ kind: 'success', title: 'Tarefa cancelada' });
    } catch {
      showToast({ kind: 'error', title: 'Não consegui cancelar' });
    } finally { setCancelling(false); }
  }

  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Editar tarefa do grupo" size="sm">
      <div className="space-y-md">
        <p className="text-body-sm text-fg-muted">
          👥 {groupName} · criada por {task.creator_name ?? '—'}
          {isDone && task.completed_by_name ? ` · concluída por ${task.completed_by_name}` : readOnly ? ' · só membros editam' : ' · qualquer membro pode editar'}
        </p>
        <Field label="Título">
          <input value={title} disabled={readOnly} onChange={e => setTitle(e.target.value)} maxLength={200}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom disabled:opacity-60" />
        </Field>
        <Field label="Descrição" sub="opcional">
          <textarea ref={descRef} value={description} disabled={readOnly} onChange={e => setDescription(e.target.value)} rows={4} maxLength={2000}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom resize-y disabled:opacity-60 overflow-y-auto" />
        </Field>
        {/* DateInput/TimeInput não têm prop disabled — readOnly bloqueia via pointer-events. */}
        <div className={`flex gap-sm ${readOnly ? 'pointer-events-none opacity-60' : ''}`}>
          <Field label="Prazo"><DateInput value={due} onChange={setDue} /></Field>
          <Field label="Hora" sub="opcional"><TimeInput value={time} onChange={setTime} /></Field>
        </div>
        {!isDone && (
          <Field label="Lembretes" sub={reminderSub}>
            <div className="flex flex-wrap gap-xs">
              {PRESETS.map(p => {
                const on = mins.includes(p.min);
                return (
                  <button key={p.min} type="button" disabled={readOnly || !due}
                    onClick={() => setMins(prev => on ? prev.filter(m => m !== p.min) : [...prev, p.min])}
                    className={`h-8 px-sm rounded-sm border text-body-sm focus-ring ${on ? 'border-tom text-tom bg-tom/10' : 'border-border text-fg-muted'} disabled:opacity-50`}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
        <div className="flex items-center gap-sm pt-sm">
          {!readOnly && !isDone && (
            <Button variant="danger" size="sm" onClick={() => setConfirmCancel(true)}>Cancelar tarefa</Button>
          )}
          {!readOnly && isDone && onReopen && (
            <Button variant="secondary" size="sm" onClick={() => { onReopen(task); onClose(); }}>Reabrir</Button>
          )}
          <div className="ml-auto flex gap-sm">
            <Button variant="secondary" size="md" onClick={onClose}>Fechar</Button>
            {!readOnly && <Button variant="primary" size="md" loading={saving} onClick={save}>Salvar</Button>}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar esta tarefa do grupo?"
        description={`"${task.title}" sai do pool de todo mundo. Dá pra reverter depois pelo banco, mas ninguém mais vê.`}
        confirmLabel="Cancelar tarefa"
        confirmVariant="danger"
        isPending={cancelling}
        onConfirm={cancelTask}
        onClose={() => setConfirmCancel(false)}
      />
    </AdaptiveSheet>
  );
}
