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
import { TimeInput } from './TimeInput';
import { EisenhowerPicker } from './EisenhowerPicker';
import { useEventCategories } from '../hooks/useEventCategories';
import {
  MODALITY_LABELS,
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

const MODALITIES: EventModality[] = ['presencial', 'online', 'hibrido'];
// Sentinel value usado no CustomSelect pra acionar "criar nova categoria pessoal".
const NEW_CATEGORY_VALUE = '__new__';

export function QuickCreateSheet({ open, onClose, defaultDueDate }: Props) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const today = defaultDueDate || todaySP();

  const eventCategories = useEventCategories();
  // Default: la_music quando carrega.
  const defaultCategoryId = eventCategories.bySlug('la_music')?.id ?? '';

  const [kind, setKind] = useState<Kind>('task');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  // task
  const [taskCtx, setTaskCtx] = useState<TaskContext>('work');
  const [due, setDue] = useState(today);
  // Sprint 22.27 — hora opcional pra Tarefa. Quando preenchida, vira `remind_at`
  // (NAO compromisso). Comportamento: lembrete em horario X, sem bloquear agenda.
  const [taskTime, setTaskTime] = useState<string>('');
  // Sprint 22.29 (Bucket 3) — Eisenhower picker manual. null = sem classificacao
  // (TOM pode classificar depois via skill priorizacao-inteligente).
  const [taskQuadrant, setTaskQuadrant] = useState<number | null>(null);

  // event
  const [categoryId, setCategoryId] = useState<string>('');
  const [creatingCat, setCreatingCat] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [startAt, setStartAt] = useState(`${today}T09:00`);
  const [endAt, setEndAt] = useState(`${today}T10:00`);
  const [modality, setModality] = useState<EventModality>('presencial');
  const [locationText, setLocationText] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  // Sprint 22.30 — compromisso tambem ganhou Eisenhower opcional.
  const [eventQuadrant, setEventQuadrant] = useState<number | null>(null);

  // Sincroniza default de categoria quando lista carrega tardiamente.
  useEffect(() => {
    if (!categoryId && defaultCategoryId) setCategoryId(defaultCategoryId);
  }, [defaultCategoryId, categoryId]);

  // Reset when reopening
  useEffect(() => {
    if (open) {
      setError(null);
      setKind('task');
      setTitle('');
      setTaskCtx('work');
      setDue(today);
      setTaskTime('');
      setTaskQuadrant(null);
      setCategoryId(defaultCategoryId);
      setCreatingCat(false);
      setNewCatLabel('');
      setStartAt(`${today}T09:00`);
      setEndAt(`${today}T10:00`);
      setModality('presencial');
      setLocationText('');
      setMeetingUrl('');
      setEventQuadrant(null);
    }
  }, [open, today, defaultCategoryId]);

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
      // Sprint 22.27 — se taskTime preenchida, monta remind_at (timestamp SP).
      // remind_at != compromisso: nao bloqueia agenda, so notifica.
      const remindAt = taskTime ? `${due}T${taskTime}:00-03:00` : null;
      const { error: e } = await supabase.from('tasks').insert({
        title: title.trim().slice(0, 200),
        assigned_to: collaborator.id,
        created_by: collaborator.id,
        source: 'manual',
        status: 'pending',
        context: taskCtx,
        priority: 'medium',
        due_date: due,
        remind_at: remindAt,
        eisenhower_quadrant: taskQuadrant,
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
      const cat = eventCategories.byId(categoryId);
      if (!cat) throw new Error('Categoria inválida');
      // Convert local datetime-local strings → ISO with -03:00 offset (SP).
      const startIso = `${startAt}:00-03:00`;
      const endIso = `${endAt}:00-03:00`;
      if (new Date(endIso) <= new Date(startIso)) throw new Error('end_before_start');
      const payload = {
        title: title.trim().slice(0, 200),
        collaborator_id: collaborator.id,
        created_by: collaborator.id,
        source: 'manual' as const,
        status: 'scheduled' as const,
        context: cat.context,
        category_id: cat.id,
        start_at: startIso,
        end_at: endIso,
        modality,
        location_text: locationText.trim() || null,
        meeting_url: (modality === 'online' || modality === 'hibrido') && meetingUrl.trim()
          ? meetingUrl.trim()
          : null,
        eisenhower_quadrant: eventQuadrant,
      };
      const { error: e } = await supabase.from('events').insert(payload);
      if (e) throw e;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      onClose();
    },
  });

  // Sprint 22.26 — cria categoria pessoal nova e seleciona automaticamente.
  async function handleCreateNewCategory() {
    const label = newCatLabel.trim();
    if (label.length < 2) {
      setError('Nome da categoria curto demais.');
      return;
    }
    try {
      const cat = await eventCategories.createPersonal(label);
      setCategoryId(cat.id);
      setCreatingCat(false);
      setNewCatLabel('');
      setError(null);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(`Não consegui criar a categoria. ${m}`);
    }
  }

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
      if (creatingCat) {
        setError('Termina de criar a categoria antes (ou cancela).');
        return;
      }
      if (!categoryId) {
        setError('Escolhe uma categoria.');
        return;
      }
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
  // Sprint 22.28 — categorizar erro de submit pra mensagem amigavel.
  function friendlyError(err: Error | null): string | null {
    if (!err) return null;
    const m = err.message?.toLowerCase() ?? '';
    if (m === 'end_before_start') return 'Fim precisa ser depois do início.';
    if (m === 'no_session') return 'Sua sessão expirou. Faz login de novo.';
    if (m.includes('row-level security') || m.includes('policy')) {
      return 'Você não tem permissão pra criar isso. Confere com o coordenador.';
    }
    if (m.includes('check constraint')) {
      return 'Algum campo veio fora do formato esperado. Tenta de novo.';
    }
    if (m.includes('failed to fetch') || m.includes('network')) {
      return 'Sem conexão. Tenta de novo daqui a pouco.';
    }
    return err.message ?? 'Não consegui criar.';
  }
  const errorText = error || friendlyError(submitError);

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
            <div>
              <div className="flex items-baseline gap-md flex-wrap mb-1.5">
                <span className="text-label uppercase tracking-wide text-fg-muted">Para quando</span>
                <span className="text-label uppercase tracking-wide text-fg-muted">
                  Lembrar às <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional</span>
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <DateInput value={due} onChange={setDue} />
                <TimeInput value={taskTime} onChange={setTaskTime} />
                {taskTime && (
                  <button
                    type="button"
                    onClick={() => setTaskTime('')}
                    aria-label="Limpar hora"
                    className="text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm px-2 py-1"
                  >
                    limpar
                  </button>
                )}
              </div>
              <div className="text-body-sm text-fg-muted mt-1.5">
                {taskTime
                  ? 'Lembrete · TOM avisa nesse horário. Não bloqueia agenda.'
                  : 'Sem hora · tarefa fica em aberto no dia.'}
              </div>
            </div>

            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
                <span>Prioridade</span>
                <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional</span>
              </div>
              <EisenhowerPicker value={taskQuadrant} onChange={setTaskQuadrant} />
              <div className="text-body-sm text-fg-muted mt-1.5">
                {taskQuadrant === null
                  ? 'Sem prioridade · TOM pode classificar depois.'
                  : 'Você definiu manualmente · TOM respeita.'}
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Categoria</div>
              {creatingCat ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    autoFocus
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                    placeholder="Ex.: Academia, médico, jiu-jitsu..."
                    maxLength={60}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void handleCreateNewCategory(); }
                      if (e.key === 'Escape') { setCreatingCat(false); setNewCatLabel(''); }
                    }}
                    className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setCreatingCat(false); setNewCatLabel(''); }}
                      className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring border border-border"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCreateNewCategory()}
                      disabled={newCatLabel.trim().length < 2}
                      className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold disabled:opacity-50 focus-ring"
                    >
                      Criar categoria pessoal
                    </button>
                  </div>
                  <div className="text-body-sm text-fg-muted">
                    Categoria pessoal · só você vê.
                  </div>
                </div>
              ) : (
                <>
                  <CustomSelect
                    value={categoryId}
                    placeholder="— Escolher categoria —"
                    onChange={(v) => {
                      if (v === NEW_CATEGORY_VALUE) {
                        setCreatingCat(true);
                        setNewCatLabel('');
                        return;
                      }
                      setCategoryId(v);
                    }}
                    options={[
                      ...eventCategories.workCategories.map(c => ({
                        value: c.id,
                        label: c.label,
                        sublabel: c.is_system ? undefined : 'pessoal',
                      })),
                      ...eventCategories.personalCategories.map(c => ({
                        value: c.id,
                        label: c.label,
                        sublabel: c.is_system ? undefined : 'minha',
                      })),
                      { value: NEW_CATEGORY_VALUE, label: '+ Nova categoria pessoal', sublabel: 'criar' },
                    ]}
                  />
                  <div className="text-body-sm text-fg-muted mt-1.5">
                    {eventCategories.byId(categoryId)?.context === 'personal'
                      ? 'Compromisso pessoal · só você vê.'
                      : 'Compromisso de trabalho · coordenação enxerga.'}
                  </div>
                </>
              )}
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

            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
                <span>Prioridade</span>
                <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional</span>
              </div>
              <EisenhowerPicker value={eventQuadrant} onChange={setEventQuadrant} />
            </div>
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
