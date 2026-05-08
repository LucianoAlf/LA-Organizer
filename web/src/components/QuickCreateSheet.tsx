import { useState, useEffect, FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ListTodo, CalendarClock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { todaySP } from '../utils/date';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { CustomSelect } from './CustomSelect';
import { DateInput } from './DateInput';
import { DateTimeInput } from './DateTimeInput';
import {
  CATEGORY_LABELS,
  MODALITY_LABELS,
  defaultContextForCategory,
  type Category,
  type EventModality,
  type TaskContext,
} from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill date (e.g., from /semana when adding to a specific day). Defaults to today. */
  defaultDueDate?: string;
}

type Kind = 'task' | 'event';

const CATEGORIES: Category[] = ['la_music', 'mentoria', 'aula_particular', 'outra_escola', 'estudio', 'pessoal'];
const MODALITIES: EventModality[] = ['presencial', 'online', 'hibrido'];

export function QuickCreateSheet({ open, onClose, defaultDueDate }: Props) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const today = defaultDueDate || todaySP();

  const [kind, setKind] = useState<Kind>('task');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  // task
  const [taskCtx, setTaskCtx] = useState<TaskContext>('work');
  const [due, setDue] = useState(today);

  // event
  const [category, setCategory] = useState<Category>('la_music');
  const [startAt, setStartAt] = useState(`${today}T09:00`);
  const [endAt, setEndAt] = useState(`${today}T10:00`);
  const [modality, setModality] = useState<EventModality>('presencial');
  const [locationText, setLocationText] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');

  // Reset when reopening
  useEffect(() => {
    if (open) {
      setError(null);
      setKind('task');
      setTitle('');
      setTaskCtx('work');
      setDue(today);
      setCategory('la_music');
      setStartAt(`${today}T09:00`);
      setEndAt(`${today}T10:00`);
      setModality('presencial');
      setLocationText('');
      setMeetingUrl('');
    }
  }, [open, today]);

  // Auto-extend end_at to start_at + 60min if user changes start_at past end_at
  useEffect(() => {
    if (!startAt) return;
    if (!endAt || new Date(endAt) <= new Date(startAt)) {
      const s = new Date(startAt);
      s.setMinutes(s.getMinutes() + 60);
      const yyyy = s.getFullYear();
      const mm = String(s.getMonth() + 1).padStart(2, '0');
      const dd = String(s.getDate()).padStart(2, '0');
      const hh = String(s.getHours()).padStart(2, '0');
      const mi = String(s.getMinutes()).padStart(2, '0');
      setEndAt(`${yyyy}-${mm}-${dd}T${hh}:${mi}`);
    }
  }, [startAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const createTask = useMutation({
    mutationFn: async () => {
      if (!collaborator) throw new Error('no_session');
      const { error: e } = await supabase.from('tasks').insert({
        title: title.trim().slice(0, 200),
        assigned_to: collaborator.id,
        created_by: collaborator.id,
        source: 'manual',
        status: 'pending',
        context: taskCtx,
        priority: 'medium',
        due_date: due,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
  });

  const createEvent = useMutation({
    mutationFn: async () => {
      if (!collaborator) throw new Error('no_session');
      // Convert local datetime-local strings → ISO with -03:00 offset (SP).
      const startIso = `${startAt}:00-03:00`;
      const endIso = `${endAt}:00-03:00`;
      if (new Date(endIso) <= new Date(startIso)) throw new Error('end_before_start');
      const ctx = defaultContextForCategory(category);
      const payload = {
        title: title.trim().slice(0, 200),
        collaborator_id: collaborator.id,
        created_by: collaborator.id,
        source: 'manual' as const,
        status: 'scheduled' as const,
        context: ctx,
        category,
        start_at: startIso,
        end_at: endIso,
        modality,
        location_text: locationText.trim() || null,
        meeting_url: (modality === 'online' || modality === 'hibrido') && meetingUrl.trim()
          ? meetingUrl.trim()
          : null,
      };
      const { error: e } = await supabase.from('events').insert(payload);
      if (e) throw e;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Coloca um título.');
      return;
    }
    if (kind === 'task') {
      if (!due) {
        setError('Coloca uma data válida (DD/MM/AAAA).');
        return;
      }
      createTask.mutate();
    } else {
      if (!startAt) {
        setError('Coloca início válido (data + hora).');
        return;
      }
      if (!endAt) {
        setError('Coloca fim válido (data + hora).');
        return;
      }
      createEvent.mutate();
    }
  };

  const submitting = createTask.isPending || createEvent.isPending;
  const submitError = (createTask.error || createEvent.error) as Error | null;
  const errorText = error
    || (submitError?.message === 'end_before_start' ? 'fim precisa ser depois do início' : submitError?.message);

  const showMeetingUrl = kind === 'event' && (modality === 'online' || modality === 'hibrido');

  return (
    <BottomSheet open={open} onClose={onClose} title="Novo">
      {/* Kind selector */}
      <div role="tablist" className="grid grid-cols-2 gap-2 mb-md">
        <KindButton active={kind === 'task'} onClick={() => setKind('task')} icon={<ListTodo size={16} />} label="Tarefa" hint="algo a fazer" />
        <KindButton active={kind === 'event'} onClick={() => setKind('event')} icon={<CalendarClock size={16} />} label="Compromisso" hint="com horário" />
      </div>

      <form onSubmit={onSubmit} className="space-y-md">
        {/* Title — both */}
        <label className="block">
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Título</div>
          <input
            type="text"
            required
            autoFocus
            maxLength={200}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={kind === 'task' ? 'Ex.: Ligar pro pai do aluno X' : 'Ex.: Reunião com Henrique'}
            className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring"
          />
        </label>

        {kind === 'task' ? (
          <>
            <fieldset>
              <legend className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Tipo</legend>
              <div role="radiogroup" className="grid grid-cols-2 gap-2">
                {([
                  { v: 'work', label: 'Trabalho' },
                  { v: 'personal', label: 'Pessoal' },
                ] as const).map(o => {
                  const active = taskCtx === o.v;
                  return (
                    <button
                      key={o.v}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setTaskCtx(o.v)}
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
            <label className="block">
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Para quando</div>
              <DateInput value={due} onChange={setDue} />
            </label>
          </>
        ) : (
          <>
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Categoria</div>
              <CustomSelect
                value={category}
                onChange={(v) => setCategory(v as Category)}
                options={CATEGORIES.map(c => ({ value: c, label: CATEGORY_LABELS[c] }))}
              />
              <div className="text-body-sm text-fg-muted mt-1.5">
                {category === 'pessoal'
                  ? 'Compromisso pessoal · só você vê.'
                  : 'Compromisso de trabalho · coordenação enxerga.'}
              </div>
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
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setModality(m)}
                      className={[
                        'h-11 rounded-md border text-body-sm font-semibold transition-colors focus-ring',
                        active
                          ? 'bg-tom text-white border-tom'
                          : 'bg-bg-subtle text-fg-secondary border-border',
                      ].join(' ')}
                    >{MODALITY_LABELS[m]}</button>
                  );
                })}
              </div>
            </fieldset>

            <label className="block">
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">
                {modality === 'presencial' ? 'Local' : 'Local (físico, opcional)'}
              </div>
              <input
                type="text"
                maxLength={200}
                value={locationText}
                onChange={e => setLocationText(e.target.value)}
                placeholder={modality === 'presencial' ? 'Ex.: LA Recreio sala 2' : 'Ex.: LA Recreio'}
                className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring"
              />
            </label>

            {showMeetingUrl && (
              <label className="block">
                <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Link da reunião</div>
                <input
                  type="url"
                  maxLength={500}
                  value={meetingUrl}
                  onChange={e => setMeetingUrl(e.target.value)}
                  placeholder="https://meet.google.com/..."
                  className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring"
                />
              </label>
            )}
          </>
        )}

        {errorText && (
          <p className="text-body-sm text-danger" role="alert">
            Não consegui criar. {errorText}
          </p>
        )}

        <div className="flex items-center gap-md pt-2">
          <Button type="submit" loading={submitting} fullWidth>Criar</Button>
        </div>
      </form>
    </BottomSheet>
  );
}

function KindButton({
  active, onClick, icon, label, hint,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'rounded-md border px-3 py-3 text-left transition-colors focus-ring',
        active
          ? 'border-tom bg-tom/10'
          : 'border-border bg-bg-subtle hover:bg-bg-elevated',
      ].join(' ')}
    >
      <div className={['flex items-center gap-2 text-body-md font-semibold', active ? 'text-tom' : 'text-fg'].join(' ')}>
        {icon}
        {label}
      </div>
      <div className="text-body-sm text-fg-muted leading-tight mt-0.5">{hint}</div>
    </button>
  );
}
