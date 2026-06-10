// Módulo Anotações — BottomSheet do lote "⚡ Virar tarefas" (decisão do brainstorm:
// tarefas nascem PRONTAS — responsável + prazo em lote, ajuste fino por linha —
// senão "vira tarefa" só muda o trabalho de lugar). Criação usa o MESMO caminho do
// QuickCreateSheet (insert em tasks + notifyTaskDelegated quando delega).
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { notifyTaskDelegated } from '../../lib/tomEngine';
import { showToast } from '../../components/Toast';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { CustomSelect } from '../../components/CustomSelect';
import { DateInput } from '../../components/DateInput';
import { todaySP } from '../../utils/date';
import { useCollabRoster, useNotes, type Note } from '../../hooks/useNotes';
import type { NoteLine } from '../../lib/noteLines';

interface Props {
  open: boolean;
  onClose: () => void;
  note: Note;
  lines: NoteLine[];
  onDone: () => void;
}

interface Draft {
  lineNo: number;
  title: string;
  assignee: string | null; // null = usa o lote
  due: string | null;      // null = usa o lote; '' = sem prazo
}

function addDaysSP(days: number): string {
  const d = new Date(`${todaySP()}T12:00:00-03:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextFridaySP(): string {
  const d = new Date(`${todaySP()}T12:00:00-03:00`);
  const diff = (5 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function VirarTarefasSheet({ open, onClose, note, lines, onDone }: Props) {
  const { meuId } = useNotes();
  const roster = useCollabRoster();
  const qc = useQueryClient();

  const [batchAssignee, setBatchAssignee] = useState<string>(meuId);
  const [batchDue, setBatchDue] = useState<string>(''); // '' = sem prazo
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [fineTune, setFineTune] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) {
      setBatchAssignee(meuId);
      setBatchDue('');
      setFineTune(new Set());
      setDrafts(lines.map((l) => ({ lineNo: l.lineNo, title: l.text.slice(0, 200), assignee: null, due: null })));
    }
  }, [open, lines, meuId]);

  const criar = useMutation({
    mutationFn: async () => {
      let okCount = 0;
      for (const d of drafts) {
        const assignedTo = d.assignee ?? batchAssignee;
        const dueRaw = d.due ?? batchDue;
        const { data, error } = await supabase.from('tasks').insert({
          title: d.title.trim().slice(0, 200) || 'Tarefa da anotação',
          description: `📒 Da anotação: "${note.title || 'Sem título'}"`,
          assigned_to: assignedTo,
          created_by: meuId,
          source: 'manual',
          status: 'pending',
          context: 'work',
          priority: 'medium',
          due_date: dueRaw || null,
        }).select('id').single();
        if (error) throw error;
        if (data?.id) {
          const { error: le } = await supabase.from('note_task_links').insert({
            note_id: note.id, task_id: data.id as string, line_no: d.lineNo,
          });
          if (le) console.warn('[VirarTarefas] link err:', le.message);
          // Delegou → fluxos de notificação vigentes (mesmo caminho do QuickCreate).
          if (assignedTo !== meuId) void notifyTaskDelegated(data.id as string);
          okCount++;
        }
      }
      return okCount;
    },
    onSuccess: (okCount) => {
      qc.invalidateQueries({ queryKey: ['note-task-links', note.id] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      showToast({ kind: 'success', title: `${okCount} tarefa${okCount === 1 ? '' : 's'} criada${okCount === 1 ? '' : 's'} da anotação` });
      onDone();
    },
    onError: (e: unknown) => {
      showToast({ kind: 'error', title: 'Não consegui criar as tarefas', msg: e instanceof Error ? e.message : undefined });
    },
  });

  const rosterOpts = (roster.data ?? []).map((c) => ({ value: c.id, label: c.id === meuId ? `${c.full_name} (eu)` : c.full_name }));

  return (
    <BottomSheet open={open} onClose={onClose} title={`⚡ Criar ${drafts.length} tarefa${drafts.length === 1 ? '' : 's'}`}>
      <div className="space-y-md">
        <Field label="Pra quem" sub="Aplica a todas (dá pra ajustar uma a uma abaixo)">
          <CustomSelect value={batchAssignee} options={rosterOpts} onChange={(v) => setBatchAssignee(String(v))} />
        </Field>
        <Field label="Pra quando" sub="Em branco = sem prazo">
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              <Button variant={batchDue === todaySP() ? 'primary' : 'secondary'} size="sm" onClick={() => setBatchDue(todaySP())}>Hoje</Button>
              <Button variant={batchDue === addDaysSP(1) ? 'primary' : 'secondary'} size="sm" onClick={() => setBatchDue(addDaysSP(1))}>Amanhã</Button>
              <Button variant={batchDue === nextFridaySP() ? 'primary' : 'secondary'} size="sm" onClick={() => setBatchDue(nextFridaySP())}>Sexta</Button>
              <Button variant={batchDue === '' ? 'primary' : 'secondary'} size="sm" onClick={() => setBatchDue('')}>Sem prazo</Button>
            </div>
            <DateInput value={batchDue} onChange={(v) => setBatchDue(v)} />
          </div>
        </Field>

        <div className="space-y-2">
          {drafts.map((d, i) => {
            const tuned = fineTune.has(d.lineNo);
            return (
              <div key={d.lineNo} className="surface p-2 rounded-md border border-border space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={d.title}
                    onChange={(e) => setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    className="flex-1 bg-bg-surface border border-border rounded-md p-2 text-fg text-body-sm focus:outline-none focus:border-tom"
                  />
                  <button
                    onClick={() => {
                      const next = new Set(fineTune);
                      if (tuned) { next.delete(d.lineNo); setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, assignee: null, due: null } : x))); }
                      else next.add(d.lineNo);
                      setFineTune(next);
                    }}
                    className={`text-[11px] shrink-0 rounded px-2 py-1 focus-ring ${tuned ? 'bg-tom text-black font-semibold' : 'text-fg-muted border border-border'}`}
                  >ajustar</button>
                </div>
                {tuned && (
                  <div className="grid grid-cols-2 gap-2">
                    <CustomSelect
                      value={d.assignee ?? batchAssignee}
                      options={rosterOpts}
                      onChange={(v) => setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, assignee: String(v) } : x)))}
                      size="sm"
                    />
                    <DateInput
                      value={d.due ?? batchDue}
                      onChange={(v) => setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, due: v } : x)))}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Button variant="primary" disabled={criar.isPending || drafts.length === 0} onClick={() => criar.mutate()}>
          {criar.isPending ? 'Criando…' : 'Criar'}
        </Button>
      </div>
    </BottomSheet>
  );
}
