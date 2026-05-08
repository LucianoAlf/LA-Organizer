import { useState, useEffect, FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListTodo, CalendarClock, UserPlus } from 'lucide-react';
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
import { ParticipantsPicker } from './ParticipantsPicker';
import { useEventCategories } from '../hooks/useEventCategories';
import { notifyTaskDelegated, notifyEventInvites } from '../lib/tomEngine';
import { showToast } from './Toast';
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

type Kind = 'task' | 'event' | 'delegated';

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
  // Sprint 22.31 — Delegada: a quem atribuir (collaborator id). Quando kind='delegated'.
  const [delegateTo, setDelegateTo] = useState<string>('');

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
  // Sprint 22.32 — participants do compromisso (collaborator ids).
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  // Sprint 22.34i — detecção de conflito de horário antes de criar evento.
  // null = sem conflito pendente; array = lista de eventos sobrepondo o horário.
  const [pendingConflict, setPendingConflict] = useState<Array<{ id: string; title: string; range: string }> | null>(null);

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
      setDelegateTo('');
      setCategoryId(defaultCategoryId);
      setCreatingCat(false);
      setNewCatLabel('');
      setStartAt(`${today}T09:00`);
      setEndAt(`${today}T10:00`);
      setModality('presencial');
      setLocationText('');
      setMeetingUrl('');
      setEventQuadrant(null);
      setParticipantIds([]);
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

  // Sprint 22.31 — colabs ativos pra delegacao (exclui o proprio user).
  const { data: collaborators = [] } = useQuery({
    queryKey: ['collaborators-active', collaborator?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name, role')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) return [];
      return ((data ?? []) as Array<{ id: string; full_name: string; role: string }>)
        .filter(c => c.id !== collaborator?.id);
    },
    enabled: (kind === 'delegated' || kind === 'event') && Boolean(collaborator?.id),
    staleTime: 5 * 60_000,
  });

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

  // Sprint 22.31 — delegacao: cria task pro outro (assigned_to != self).
  // Sempre context='work' (delegacao pessoal nao faz sentido entre 2 pessoas
  // por privacidade — tasks pessoais sao do dono e visiveis so pra ele).
  const createDelegated = useMutation({
    mutationFn: async () => {
      if (!collaborator) throw new Error('no_session');
      if (!delegateTo) throw new Error('no_assignee');
      const remindAt = taskTime ? `${due}T${taskTime}:00-03:00` : null;
      const { data, error: e } = await supabase.from('tasks').insert({
        title: title.trim().slice(0, 200),
        assigned_to: delegateTo,
        created_by: collaborator.id,
        source: 'manual',
        status: 'pending',
        context: 'work',
        priority: 'medium',
        due_date: due,
        remind_at: remindAt,
        eisenhower_quadrant: taskQuadrant,
      }).select('id').single();
      if (e) throw e;
      if (!data?.id) throw new Error('Não consegui criar a tarefa.');
      // Sprint 22.34j — awaited + toast feedback.
      const r = await notifyTaskDelegated(data.id as string);
      if (r.ok) {
        showToast({ kind: 'success', title: 'Tarefa delegada', msg: 'TOM mandou WhatsApp pra pessoa.' });
      } else {
        showToast({ kind: 'error', title: 'WhatsApp não enviado', msg: `Tarefa salva, mas notificação falhou (${r.reason}).` });
      }
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
      const { data: inserted, error: e } = await supabase
        .from('events')
        .insert(payload)
        .select('id')
        .single();
      if (e) throw e;
      if (!inserted?.id) throw new Error('Não consegui criar o evento.');
      // Sprint 22.32 — insere participants escolhidos.
      if (participantIds.length > 0) {
        const rows = participantIds.map(pid => ({
          event_id: inserted.id as string,
          collaborator_id: pid,
          invited_by: collaborator.id,
          status: 'invited' as const,
        }));
        const { error: pe } = await supabase.from('event_participants').insert(rows);
        if (pe) {
          // Evento criado com sucesso, mas participants falhou. Loga e segue.
          console.warn('[QuickCreate] event_participants insert err:', pe.message);
          showToast({ kind: 'error', title: 'Compromisso criado', msg: 'Mas não consegui salvar os participantes.' });
        } else {
          // Sprint 22.34j — awaited + toast feedback.
          const r = await notifyEventInvites(inserted.id as string);
          if (r.ok) {
            const n = r.sent ?? participantIds.length;
            showToast({
              kind: 'success',
              title: 'Compromisso criado',
              msg: n > 0 ? `TOM mandou convite pelo WhatsApp pra ${n} ${n === 1 ? 'pessoa' : 'pessoas'}.` : 'Sem participantes elegíveis pra notificar.',
            });
          } else {
            showToast({
              kind: 'error',
              title: 'Compromisso criado',
              msg: `Mas convite por WhatsApp falhou (${r.reason}). Tenta de novo no menu do compromisso.`,
            });
          }
        }
      } else {
        showToast({ kind: 'success', title: 'Compromisso criado' });
      }
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

  // Sprint 22.34i — checa se há outros eventos do user que sobrepõem o horário.
  // Retorna array dos conflitos (vazio = sem conflito).
  async function checkEventConflict(startIso: string, endIso: string) {
    if (!collaborator) return [];
    const { data } = await supabase
      .from('events')
      .select('id, title, start_at, end_at')
      .eq('collaborator_id', collaborator.id)
      .neq('status', 'cancelled')
      .lt('start_at', endIso)
      .gt('end_at', startIso)
      .limit(5);
    return (data || []).map(ev => {
      const s = new Date(ev.start_at);
      const e = new Date(ev.end_at);
      const fmt = (d: Date) => new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d);
      return { id: ev.id, title: ev.title, range: `${fmt(s)}–${fmt(e)}` };
    });
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPendingConflict(null);
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
    } else if (kind === 'delegated') {
      if (!delegateTo) {
        setError('Escolhe pra quem delegar.');
        return;
      }
      if (!due) {
        setError('Coloca uma data válida (DD/MM/AAAA).');
        return;
      }
      createDelegated.mutate();
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
      // Sprint 22.34i — checa conflito antes de criar.
      const startIso = `${startAt}:00-03:00`;
      const endIso = `${endAt}:00-03:00`;
      checkEventConflict(startIso, endIso).then(conflicts => {
        if (conflicts.length > 0) {
          setPendingConflict(conflicts);
        } else {
          createEvent.mutate();
        }
      });
    }
  };

  // Sprint 22.34i — confirma criação ignorando conflito.
  const onConfirmConflict = () => {
    setPendingConflict(null);
    createEvent.mutate();
  };

  const submitting = createTask.isPending || createEvent.isPending || createDelegated.isPending;
  const submitError = (createTask.error || createEvent.error || createDelegated.error) as Error | null;
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
      <div role="tablist" className="grid grid-cols-3 gap-2 mb-md">
        <KindButton active={kind === 'task'} onClick={() => setKind('task')} icon={<ListTodo size={20} />} label="Tarefa" hint="algo a fazer" />
        <KindButton active={kind === 'event'} onClick={() => setKind('event')} icon={<CalendarClock size={20} />} label="Compromisso" hint="com horário" />
        <KindButton active={kind === 'delegated'} onClick={() => setKind('delegated')} icon={<UserPlus size={20} />} label="Delegar" hint="pra alguém do time" />
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
            placeholder={
              kind === 'task' ? 'Ex.: Ligar pro pai do aluno X'
              : kind === 'delegated' ? 'Ex.: Buscar material no Megadisconildo'
              : 'Ex.: Reunião com Henrique'
            }
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
        ) : kind === 'delegated' ? (
          <>
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Pra quem</div>
              <CustomSelect
                value={delegateTo}
                placeholder="— Escolher pessoa —"
                onChange={setDelegateTo}
                options={collaborators.map(c => ({
                  value: c.id,
                  label: c.full_name,
                  sublabel: c.role,
                }))}
              />
              <div className="text-body-sm text-fg-muted mt-1.5">
                Tarefa de trabalho · vai aparecer na aba "Delegadas" sua e em "Trabalho" da pessoa.
              </div>
            </div>

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
            </div>

            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
                <span>Prioridade</span>
                <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional</span>
              </div>
              <EisenhowerPicker value={taskQuadrant} onChange={setTaskQuadrant} />
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

            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
                <span>Participantes</span>
                <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional</span>
              </div>
              <ParticipantsPicker
                options={collaborators}
                value={participantIds}
                onChange={setParticipantIds}
              />
              <div className="text-body-sm text-fg-muted mt-1.5">
                {participantIds.length === 0
                  ? 'Sem convidados · só você fica com esse compromisso.'
                  : `${participantIds.length} pessoa${participantIds.length > 1 ? 's' : ''} · TOM avisa pelo WhatsApp.`}
              </div>
            </div>
          </>
        )}

        {errorText && (
          <p className="text-body-sm text-danger" role="alert">
            Não consegui criar. {errorText}
          </p>
        )}

        {/* Sprint 22.34i — banner de conflito de horário. */}
        {pendingConflict && pendingConflict.length > 0 && (
          <div className="rounded-md border border-warning bg-warning/10 p-3 space-y-2" role="alert">
            <div className="text-body-sm font-semibold text-warning">
              ⚠ Conflito de horário
            </div>
            <div className="text-body-sm text-fg">
              Você já tem {pendingConflict.length === 1 ? 'um compromisso' : `${pendingConflict.length} compromissos`} nesse horário:
            </div>
            <ul className="text-body-sm text-fg-secondary space-y-0.5">
              {pendingConflict.map(c => (
                <li key={c.id}>• <span className="tabular-nums">{c.range}</span> — {c.title}</li>
              ))}
            </ul>
            <div className="text-body-sm text-fg-muted pt-1">
              Quer ajustar o horário ou marcar mesmo assim?
            </div>
          </div>
        )}

        <div className="flex items-center gap-md pt-2">
          {pendingConflict && pendingConflict.length > 0 ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setPendingConflict(null)}>
                Voltar e ajustar
              </Button>
              <Button type="button" loading={submitting} fullWidth onClick={onConfirmConflict}>
                Criar mesmo assim
              </Button>
            </>
          ) : (
            <Button type="submit" loading={submitting} fullWidth>Criar</Button>
          )}
        </div>
      </form>
    </BottomSheet>
  );
}

function KindButton({
  active, onClick, icon, label, hint,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  // Sprint 22.32 — layout vertical (icone -> label -> hint) pra acomodar 3 kinds
  // (Tarefa, Compromisso, Delegar) sem texto se atropelar em telas estreitas.
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'rounded-md border px-2 py-3 text-center transition-colors focus-ring',
        'flex flex-col items-center gap-1.5',
        active
          ? 'border-tom bg-tom/10'
          : 'border-border bg-bg-subtle hover:bg-bg-elevated',
      ].join(' ')}
    >
      <span className={active ? 'text-tom' : 'text-fg-muted'}>{icon}</span>
      <div className={['text-body-md font-semibold leading-tight', active ? 'text-tom' : 'text-fg'].join(' ')}>
        {label}
      </div>
      <div className="text-body-sm text-fg-muted leading-tight">{hint}</div>
    </button>
  );
}
