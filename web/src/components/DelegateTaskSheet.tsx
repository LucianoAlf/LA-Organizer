// web/src/components/DelegateTaskSheet.tsx
// Delega uma tarefa existente a um membro da equipe. Client-side: UPDATE da task
// + notifyTaskDelegated (TOM manda WhatsApp). Picker restrito à equipe do líder.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { CustomSelect } from './CustomSelect';
import { DateInput } from './DateInput';
import { useDelegableMembers } from '../hooks/useDelegableMembers';
import { notifyTaskDelegated, notifyWatchersAdded } from '../lib/tomEngine';
import { WatchersPicker } from './WatchersPicker';
import { useTaskWatchers, useReplaceWatchers } from '../hooks/useTaskWatchers';
import { showToast } from './Toast';
import type { TransformableTask } from '../types';

interface Props { open: boolean; task: TransformableTask | null; onClose: () => void; }

export function DelegateTaskSheet({ open, task, onClose }: Props) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const membersQ = useDelegableMembers(open);
  const watchersQ = useTaskWatchers(task?.id ?? null, open);
  const replaceWatchers = useReplaceWatchers();

  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [cc, setCc] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !task) return;
    setAssignee('');
    setDue(task.due_date || '');
    setNote(task.description ?? '');
    setCc(watchersQ.data ?? []);
    setError(null);
  }, [open, task?.id, watchersQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const delegate = useMutation({
    mutationFn: async () => {
      if (!collaborator || !task) throw new Error('no_task');
      if (!assignee) throw new Error('Escolhe pra quem delegar.');
      if (assignee === collaborator.id) throw new Error('Não dá pra delegar pra você mesmo.');
      const { data, error: e } = await supabase.from('tasks').update({
        assigned_to: assignee,
        delegated_to: assignee,
        delegated_at: new Date().toISOString(),
        status: 'delegated',
        due_date: due || null,
        description: note.trim() || null,
      }).eq('id', task.id).eq('assigned_to', collaborator.id).select('id');
      if (e) throw e;
      if (!data || data.length === 0) {
        throw new Error('Você não tem permissão pra delegar essa tarefa.');
      }
      const r = await notifyTaskDelegated(task.id);
      await replaceWatchers.mutateAsync({ taskId: task.id, next: cc });
      if (cc.length) { void notifyWatchersAdded(task.id, cc); }
      return r;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['agenda-tasks'] });
      if (r.ok) showToast({ kind: 'success', title: 'Tarefa delegada', msg: 'TOM mandou WhatsApp pra pessoa.' });
      else showToast({ kind: 'error', title: 'WhatsApp não enviado', msg: `Tarefa delegada, mas a notificação falhou (${r.reason}).` });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const options = (membersQ.data ?? []).map(m => ({ value: m.id, label: m.full_name, sublabel: m.role }));

  return (
    <AdaptiveSheet open={open && Boolean(task)} onClose={onClose} title="Delegar tarefa" size="md">
      {task && (
        <div className="space-y-md">
          <div className="rounded-md border border-border bg-bg-elevated p-3 text-body-sm text-fg-muted">
            Tarefa: <span className="text-fg font-medium">{task.title}</span>
          </div>

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Delegar para · sua equipe</div>
            <CustomSelect
              value={assignee}
              placeholder={membersQ.isLoading ? 'Carregando…' : '— Escolher pessoa —'}
              onChange={setAssignee}
              options={options}
            />
            {!membersQ.isLoading && options.length === 0 && (
              <p className="text-body-sm text-fg-muted mt-1.5">Nenhum membro disponível na sua equipe.</p>
            )}
          </div>

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Prazo (opcional)</div>
            <DateInput value={due} onChange={setDue} />
          </div>

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Em cópia (opcional)</div>
            <WatchersPicker
              value={cc}
              onChange={setCc}
              excludeIds={[assignee, collaborator?.id ?? ''].filter(Boolean)}
              enabled={open}
            />
            <p className="text-body-sm text-fg-muted mt-1">Acompanham e recebem a cobrança junto — sem precisar concluir.</p>
          </div>

          <label className="block">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Recado (opcional)</div>
            <textarea rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)}
              placeholder="Contexto pra pessoa que vai receber…"
              className="w-full px-3 py-2 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring resize-y" />
            <p className="text-body-sm text-fg-muted mt-1">Some na tarefa da pessoa. TOM avisa pelo WhatsApp na hora.</p>
          </label>

          {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}

          <div className="flex items-center gap-md pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="button" loading={delegate.isPending} fullWidth
              disabled={!assignee}
              onClick={() => { setError(null); delegate.mutate(); }}>
              Delegar e avisar
            </Button>
          </div>
        </div>
      )}
    </AdaptiveSheet>
  );
}
