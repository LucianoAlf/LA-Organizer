// web/src/components/ConvertToEventSheet.tsx
// Transforma uma tarefa existente em compromisso (events) e arquiva a tarefa
// (status='cancelled' + converted_to_event_id). Client-side, espelha o
// createEvent do QuickCreateSheet. DS: AdaptiveSheet + DateTimeInput + CustomSelect.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { DateTimeInput } from './DateTimeInput';
import { CustomSelect } from './CustomSelect';
import { useEventCategories } from '../hooks/useEventCategories';
import { showToast } from './Toast';
import { MODALITY_LABELS, type EventModality } from '../types';
import type { TransformableTask } from '../types';

const MODALITIES: EventModality[] = ['presencial', 'online', 'hibrido'];

interface Props { open: boolean; task: TransformableTask | null; onClose: () => void; }

export function ConvertToEventSheet({ open, task, onClose }: Props) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const eventCategories = useEventCategories();
  const defaultCategoryId = eventCategories.bySlug('la_music')?.id ?? '';

  const [categoryId, setCategoryId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [modality, setModality] = useState<EventModality>('presencial');
  const [locationText, setLocationText] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !task) return;
    const day = task.due_date || new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    setCategoryId(defaultCategoryId);
    setStartAt(`${day}T09:00`);
    setEndAt(`${day}T10:00`);
    setModality('presencial');
    setLocationText('');
    setMeetingUrl('');
    setError(null);
  }, [open, task?.id, defaultCategoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const showMeetingUrl = modality === 'online' || modality === 'hibrido';

  const convert = useMutation({
    mutationFn: async () => {
      if (!collaborator || !task) throw new Error('no_task');
      const cat = eventCategories.byId(categoryId);
      if (!cat) throw new Error('Escolhe uma categoria.');
      const startIso = `${startAt}:00-03:00`;
      const endIso = `${endAt}:00-03:00`;
      if (new Date(endIso) <= new Date(startIso)) throw new Error('Fim precisa ser depois do início.');
      const remindMs = new Date(startIso).getTime() - 60 * 60 * 1000;
      const remindAt = remindMs > Date.now() ? new Date(remindMs).toISOString() : null;

      const { data: ev, error: evErr } = await supabase.from('events').insert({
        title: task.title.slice(0, 200),
        description: task.description ?? null,
        collaborator_id: collaborator.id,
        created_by: collaborator.id,
        source: 'manual' as const,
        status: 'scheduled' as const,
        context: cat.context,
        category_id: cat.id,
        project_id: task.project_id ?? null,
        start_at: startIso,
        end_at: endIso,
        remind_at: remindAt,
        modality,
        location_text: locationText.trim() || null,
        meeting_url: showMeetingUrl && meetingUrl.trim() ? meetingUrl.trim() : null,
        eisenhower_quadrant: task.eisenhower_quadrant ?? null,
      }).select('id').single();
      if (evErr) throw evErr;
      if (!ev?.id) throw new Error('Não consegui criar o compromisso.');

      const { data: upData, error: upErr } = await supabase.from('tasks')
        .update({ status: 'cancelled', converted_to_event_id: ev.id })
        .eq('id', task.id)
        .select('id');
      // Não é transacional: se arquivar a tarefa falhar (erro OU 0 linhas por RLS),
      // compensa removendo o evento recém-criado pra NÃO duplicar cobrança
      // (tarefa ativa + evento). Best-effort: o delete também é client-side.
      if (upErr || !upData || upData.length === 0) {
        await supabase.from('events').delete().eq('id', ev.id);
        throw new Error('Não consegui arquivar a tarefa (sem permissão ou tarefa removida). Nada foi alterado.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['agenda-tasks'] });
      showToast({ kind: 'success', title: 'Tarefa virou compromisso' });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <AdaptiveSheet open={open && Boolean(task)} onClose={onClose} title="Transformar em compromisso" size="md">
      {task && (
        <div className="space-y-md">
          <div className="rounded-md border border-border bg-bg-elevated p-3 text-body-sm text-fg-muted">
            De: <span className="text-fg font-medium">{task.title}</span>
          </div>

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Categoria</div>
            <CustomSelect
              value={categoryId}
              placeholder="— Escolher categoria —"
              onChange={setCategoryId}
              options={[
                ...eventCategories.workCategories.map(c => ({ value: c.id, label: c.label })),
                ...eventCategories.personalCategories.map(c => ({ value: c.id, label: c.label, sublabel: 'pessoal' })),
              ]}
            />
          </div>

          <div className="space-y-md">
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Início</div>
              <DateTimeInput value={startAt} onChange={setStartAt} />
            </div>
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Fim</div>
              <DateTimeInput value={endAt} onChange={setEndAt} />
            </div>
          </div>

          <fieldset>
            <legend className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Modalidade</legend>
            <div role="radiogroup" className="grid grid-cols-3 gap-2">
              {MODALITIES.map(m => {
                const active = modality === m;
                return (
                  <button key={m} type="button" role="radio" aria-checked={active}
                    onClick={() => setModality(m)}
                    className={['h-11 rounded-md border text-body-sm font-semibold transition-colors focus-ring',
                      active ? 'bg-tom text-black border-tom' : 'bg-bg-subtle text-fg-secondary border-border'].join(' ')}
                  >{MODALITY_LABELS[m]}</button>
                );
              })}
            </div>
          </fieldset>

          <label className="block">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">
              {modality === 'presencial' ? 'Local' : 'Local (físico, opcional)'}
            </div>
            <input type="text" maxLength={200} value={locationText} onChange={e => setLocationText(e.target.value)}
              placeholder="Ex.: LA Recreio sala 2"
              className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring" />
          </label>

          {showMeetingUrl && (
            <label className="block">
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Link da reunião</div>
              <input type="url" maxLength={500} value={meetingUrl} onChange={e => setMeetingUrl(e.target.value)}
                placeholder="https://meet.google.com/..."
                className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring" />
            </label>
          )}

          <div className="rounded-md border border-warning bg-warning/10 p-3 text-body-sm text-fg">
            ⚠️ A tarefa original será arquivada (vira compromisso). Sem cobrança duplicada.
          </div>

          {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}

          <div className="flex items-center gap-md pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="button" loading={convert.isPending} fullWidth onClick={() => { setError(null); convert.mutate(); }}>
              Criar compromisso
            </Button>
          </div>
        </div>
      )}
    </AdaptiveSheet>
  );
}
