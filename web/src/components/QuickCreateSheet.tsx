import { useState, useEffect, FormEvent } from 'react';
import { RecurrencePicker } from './RecurrencePicker';
import { materializeSeriesClient } from '../lib/materialize-recurrence';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListTodo, CalendarClock, UserPlus, FolderKanban } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { todaySP } from '../utils/date';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { CustomSelect } from './CustomSelect';
import { DateInput } from './DateInput';
import { DateTimeInput } from './DateTimeInput';
import { TimeInput } from './TimeInput';
import { EisenhowerPicker } from './EisenhowerPicker';
import { ParticipantsPicker } from './ParticipantsPicker';
import { RemindersField } from './RemindersField';
import { useEventCategories } from '../hooks/useEventCategories';
import { notifyTaskDelegated, notifyEventInvites } from '../lib/tomEngine';
import { showToast } from './Toast';
import {
  MODALITY_LABELS,
  type EventModality,
  type TaskContext,
} from '../types';
import { createGroup } from '../lib/taskGroups';
import { dayOfMonthToYmd } from '../lib/taskGroupDates';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill date (e.g., from /semana when adding to a specific day). Defaults to today. */
  defaultDueDate?: string;
}

type Kind = 'task' | 'event' | 'delegated' | 'group';

const MODALITIES: EventModality[] = ['presencial', 'online', 'hibrido'];
// Sentinel value usado no CustomSelect pra acionar "criar nova categoria pessoal".
const NEW_CATEGORY_VALUE = '__new__';
// Presets de lembrete por subtarefa de grupo (minutos antes do prazo) — paridade
// com os chips do RemindersField das tarefas.
const GROUP_REMINDER_PRESETS = [
  { min: 0, label: 'Na hora' },
  { min: 15, label: '15min antes' },
  { min: 30, label: '30min antes' },
  { min: 60, label: '1h antes' },
  { min: 120, label: '2h antes' },
  { min: 1440, label: '1 dia antes' },
] as const;

export function QuickCreateSheet({ open, onClose, defaultDueDate }: Props) {
  const { collaborator, ensureSession } = useAuth();
  const qc = useQueryClient();
  const today = defaultDueDate || todaySP();

  const eventCategories = useEventCategories();
  // Default: la_music quando carrega.
  const defaultCategoryId = eventCategories.bySlug('la_music')?.id ?? '';

  const [kind, setKind] = useState<Kind>('task');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  // task
  const [taskCtx, setTaskCtx] = useState<TaskContext>('work');
  const [due, setDue] = useState(today);
  // Sprint 22.27 — hora opcional pra Tarefa. Quando preenchida, vira `remind_at`
  // (NAO compromisso). Comportamento: lembrete em horario X, sem bloquear agenda.
  const [taskTime, setTaskTime] = useState<string>('');
  // Sprint 23 — Multi-reminder pra task/delegada na criação rápida.
  // INSERT em task_reminders após criar a task (mesmo padrão do evento).
  const [taskReminderTimes, setTaskReminderTimes] = useState<string[]>([]);
  // Sprint 22.29 (Bucket 3) — Eisenhower picker manual. null = sem classificacao
  // (TOM pode classificar depois via skill priorizacao-inteligente).
  const [taskQuadrant, setTaskQuadrant] = useState<number | null>(null);
  // Sprint 22.31 — Delegada: a quem atribuir (collaborator id). Quando kind='delegated'.
  const [delegateTo, setDelegateTo] = useState<string>('');

  // Grupo (2026-06-09)
  const [groupMonthly, setGroupMonthly] = useState(true);
  const [groupDueDay, setGroupDueDay] = useState('');           // dia 1-31 (mensal)
  const [groupDueDate, setGroupDueDate] = useState('');         // YMD (sem repetição)
  // reminders = offsets em MINUTOS antes do prazo da subtarefa (mesmos presets do RemindersField).
  const [groupChildren, setGroupChildren] = useState<Array<{ title: string; day: string; time: string; reminders: number[] }>>([]);
  const [draftChild, setDraftChild] = useState<{ title: string; day: string; time: string; reminders: number[] }>({ title: '', day: '', time: '', reminders: [] });

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
  // Sprint 22.51 — múltiplos lembretes na criação rápida de evento.
  const [eventReminderTimes, setEventReminderTimes] = useState<string[]>([]);
  // Sprint 22.32 — participants do compromisso (collaborator ids).
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  // Sprint 22.34i — detecção de conflito de horário antes de criar evento.
  // null = sem conflito pendente; array = lista de eventos sobrepondo o horário.
  const [pendingConflict, setPendingConflict] = useState<Array<{ id: string; title: string; range: string }> | null>(null);
  // Sprint 29.4 — recorrência opcional (RRULE iCalendar)
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);

  // Sincroniza default de categoria quando lista carrega tardiamente.
  useEffect(() => {
    if (!categoryId && defaultCategoryId) setCategoryId(defaultCategoryId);
  }, [defaultCategoryId, categoryId]);

  // Reset when reopening — defaultCategoryId excluído das deps intencionalmente:
  // se incluído, o effect re-executa quando as categorias carregam de forma assíncrona
  // (defaultCategoryId muda de '' → UUID enquanto o sheet já está aberto), o que
  // reseta taskCtx para 'work' mesmo que o usuário já tenha selecionado 'Pessoal'.
  // O late-load effect abaixo cuida de inicializar categoryId quando as categorias chegam.
  useEffect(() => {
    if (open) {
      setError(null);
      setKind('task');
      setTitle('');
      setRecurrenceRule(null);
      setDescription('');
      setTaskCtx('work');
      setDue(today);
      setTaskTime('');
      setTaskReminderTimes([]);
      setTaskQuadrant(null);
      setDelegateTo('');
      setCategoryId(''); // late-load effect abaixo seta o default quando categorias carregam
      setCreatingCat(false);
      setNewCatLabel('');
      setStartAt(`${today}T09:00`);
      setEndAt(`${today}T10:00`);
      setModality('presencial');
      setLocationText('');
      setMeetingUrl('');
      setEventQuadrant(null);
      setParticipantIds([]);
      // Grupo
      setGroupMonthly(true);
      setGroupDueDay('');
      setGroupDueDate('');
      setGroupChildren([]);
      setDraftChild({ title: '', day: '', time: '', reminders: [] });
    }
  }, [open, today]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const collab = collaborator ?? await ensureSession();
      if (!collab) throw new Error('no_session');
      // Sprint 23 — task_reminders (multi) substitui o legado remind_at (single).
      // remind_at fica null quando há chips selecionados; os lembretes vão em tabela
      // separada que o TOM dispatcher já lê.
      const remindAt = (taskReminderTimes.length === 0 && taskTime)
        ? `${due}T${taskTime}:00-03:00`
        : null;
      const { data, error: e } = await supabase.from('tasks').insert({
        title: title.trim().slice(0, 200),
        description: description.trim() || null,
        assigned_to: collab.id,
        created_by: collab.id,
        source: 'manual',
        status: 'pending',
        context: taskCtx,
        priority: 'medium',
        due_date: due,
        remind_at: remindAt,
        eisenhower_quadrant: taskQuadrant,
        // Sprint 29.4 — recorrência opcional (vira TEMPLATE)
        recurrence_rule: recurrenceRule || null,
      }).select('*').single();
      if (e) throw e;
      // Sprint 29.4 — se template recorrente, materializa instâncias na hora
      if (data?.id && recurrenceRule) {
        const r = await materializeSeriesClient('tasks', data as { id: string; recurrence_rule: string });
        if (r.error) console.warn('[QuickCreate] materialize err:', r.error);
        else console.log(`[QuickCreate] materialized ${r.created} task instances (skipped=${r.skipped})`);
      }
      // Sprint 23 — insere task_reminders se houver chips selecionados.
      if (data?.id && taskReminderTimes.length > 0) {
        const rows = taskReminderTimes.map(t => ({
          task_id: data.id as string,
          remind_at: `${t}:00-03:00`,
        }));
        const { error: re } = await supabase.from('task_reminders').insert(rows);
        if (re) console.warn('[QuickCreate] task_reminders insert err:', re.message);
      }
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
      const collab = collaborator ?? await ensureSession();
      if (!collab) throw new Error('no_session');
      if (!delegateTo) throw new Error('no_assignee');
      const remindAt = (taskReminderTimes.length === 0 && taskTime)
        ? `${due}T${taskTime}:00-03:00`
        : null;
      const { data, error: e } = await supabase.from('tasks').insert({
        title: title.trim().slice(0, 200),
        description: description.trim() || null,
        assigned_to: delegateTo,
        created_by: collab.id,
        source: 'manual',
        status: 'pending',
        context: 'work',
        priority: 'medium',
        due_date: due,
        remind_at: remindAt,
        eisenhower_quadrant: taskQuadrant,
        // Sprint 29.4 — delegada com recorrência também vira template
        recurrence_rule: recurrenceRule || null,
      }).select('*').single();
      if (e) throw e;
      if (!data?.id) throw new Error('Não consegui criar a tarefa.');
      // Sprint 29.4 — materializa instâncias se for template
      if (recurrenceRule) {
        const r = await materializeSeriesClient('tasks', data as { id: string; recurrence_rule: string });
        if (r.error) console.warn('[QuickCreate delegated] materialize err:', r.error);
      }
      // Sprint 23 — task_reminders (multi) na criação delegada também.
      if (taskReminderTimes.length > 0) {
        const rows = taskReminderTimes.map(t => ({
          task_id: data.id as string,
          remind_at: `${t}:00-03:00`,
        }));
        const { error: re } = await supabase.from('task_reminders').insert(rows);
        if (re) console.warn('[QuickCreate] task_reminders insert err:', re.message);
      }
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
      const collab = collaborator ?? await ensureSession();
      if (!collab) throw new Error('no_session');
      const cat = eventCategories.byId(categoryId);
      if (!cat) throw new Error('Categoria inválida');
      // Convert local datetime-local strings → ISO with -03:00 offset (SP).
      const startIso = `${startAt}:00-03:00`;
      const endIso = `${endAt}:00-03:00`;
      if (new Date(endIso) <= new Date(startIso)) throw new Error('end_before_start');
      // Sprint 27 — default remind_at = 1h antes do start (se houver folga >= 1h).
      // Auditoria mostrou 3/8 eventos próximos sem lembrete; UX não pedia campo
      // e o usuário ficava sem aviso. Pra eventos com menos de 1h de folga, deixa
      // NULL (já é iminente, TOM avisaria tarde).
      const startMs = new Date(startIso).getTime();
      const remindMs = startMs - 60 * 60 * 1000;
      const remindAtDefault = remindMs > Date.now()
        ? new Date(remindMs).toISOString()
        : null;
      const payload = {
        title: title.trim().slice(0, 200),
        description: description.trim() || null,
        collaborator_id: collab.id,
        created_by: collab.id,
        source: 'manual' as const,
        status: 'scheduled' as const,
        context: cat.context,
        category_id: cat.id,
        start_at: startIso,
        end_at: endIso,
        remind_at: remindAtDefault,
        modality,
        location_text: locationText.trim() || null,
        meeting_url: (modality === 'online' || modality === 'hibrido') && meetingUrl.trim()
          ? meetingUrl.trim()
          : null,
        eisenhower_quadrant: eventQuadrant,
        // Sprint 29.4 — recorrência opcional (vira TEMPLATE)
        recurrence_rule: recurrenceRule || null,
      };
      const { data: inserted, error: e } = await supabase
        .from('events')
        .insert(payload)
        .select('*')
        .single();
      if (e) throw e;
      if (!inserted?.id) throw new Error('Não consegui criar o evento.');
      // Sprint 29.4 — materializa instâncias se template recorrente
      if (recurrenceRule) {
        const r = await materializeSeriesClient('events', inserted as { id: string; recurrence_rule: string });
        if (r.error) console.warn('[QuickCreate event] materialize err:', r.error);
        else console.log(`[QuickCreate event] materialized ${r.created} event instances`);
      }
      // Sprint 22.32 — insere participants escolhidos.
      if (participantIds.length > 0) {
        const rows = participantIds.map(pid => ({
          event_id: inserted.id as string,
          collaborator_id: pid,
          invited_by: collab.id,
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
      // Sprint 22.51 — lembretes selecionados na criação.
      // Sprint 23 — default T-15min se user não selecionou nenhum (audit 18/05: 57% sem lembrete).
      if (inserted?.id) {
        const reminderRows = eventReminderTimes.length > 0
          ? eventReminderTimes.map(t => ({
              event_id: inserted.id as string,
              remind_at: `${t}:00-03:00`,
            }))
          : [{
              event_id: inserted.id as string,
              remind_at: new Date(new Date(startIso).getTime() - 15 * 60 * 1000).toISOString(),
            }];
        const { error: re } = await supabase.from('event_reminders').insert(reminderRows);
        if (re) console.warn('[QuickCreate] event_reminders insert err:', re.message);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      setEventReminderTimes([]);
      onClose();
    },
  });

  const createGroupMut = useMutation({
    mutationFn: async () => {
      const collab = collaborator ?? await ensureSession();
      if (!collab) throw new Error('no_session');
      const children = groupChildren.map((c) => {
        const dayN = c.day ? Number(c.day) : null;
        const dueYmd = groupMonthly
          ? null
          : (dayN ? dayOfMonthToYmd(dayN, today) : null);
        // Offsets (min antes do prazo) → datetime-local SP. Âncora = dia da subtarefa
        // às HH:MM (ou 09:00). Offset fixo -03:00 (sem DST no Brasil atual).
        const baseYmd = groupMonthly ? dayOfMonthToYmd(dayN ?? 1, today) : (dueYmd ?? today);
        const baseMs = new Date(`${baseYmd}T${c.time || '09:00'}:00-03:00`).getTime();
        const reminderTimes = c.reminders.map((m) =>
          new Date(baseMs - m * 60000 - 3 * 3600000).toISOString().slice(0, 16)
        );
        return {
          title: c.title, dayOfMonth: dayN, due_date: dueYmd,
          due_time: c.time || null, reminderTimes,
        };
      });
      return createGroup({
        title: title.trim(), context: taskCtx, monthly: groupMonthly,
        groupDueDay: groupDueDay ? Number(groupDueDay) : null,
        groupDueDate: groupDueDate || null,
        children, collabId: collab.id,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task-groups'] });
      showToast({ kind: 'success', title: 'Grupo criado', msg: `${groupChildren.length} subtarefa${groupChildren.length === 1 ? '' : 's'}.` });
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
    } else if (kind === 'group') {
      if (groupChildren.length === 0) { setError('Adiciona pelo menos uma subtarefa.'); return; }
      createGroupMut.mutate();
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

  const submitting = createTask.isPending || createEvent.isPending || createDelegated.isPending || createGroupMut.isPending;
  const submitError = (createTask.error || createEvent.error || createDelegated.error || createGroupMut.error) as Error | null;
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
    <AdaptiveSheet open={open} onClose={onClose} title="Novo" size="sm">
      {/* Kind selector */}
      <div role="tablist" className="grid grid-cols-4 gap-2 mb-md">
        <KindButton active={kind === 'task'} onClick={() => setKind('task')} icon={<ListTodo size={18} />} label="Tarefa" hint="algo a fazer" />
        <KindButton active={kind === 'event'} onClick={() => setKind('event')} icon={<CalendarClock size={18} />} label="Compromisso" hint="com horário" />
        <KindButton active={kind === 'delegated'} onClick={() => setKind('delegated')} icon={<UserPlus size={18} />} label="Delegar" hint="pra alguém" />
        <KindButton active={kind === 'group'} onClick={() => setKind('group')} icon={<FolderKanban size={18} />} label="Grupo" hint="subtarefas" />
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
              : kind === 'group' ? 'Ex.: Conciliação Cartões'
              : 'Ex.: Reunião com Henrique'
            }
            className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring"
          />
        </label>

        {/* Descrição — vale pros 3 kinds. TOM consome esse campo. */}
        <label className="block">
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
            <span>Descrição</span>
            <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional</span>
          </div>
          <textarea
            rows={3}
            maxLength={2000}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={
              kind === 'task' ? 'Detalhes da tarefa, contexto, links...'
              : kind === 'delegated' ? 'O que a pessoa precisa fazer, contexto, prazo...'
              : 'Pauta, contexto, o que tratar...'
            }
            className="w-full px-3 py-2 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring resize-y"
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
                          ? 'bg-tom text-black border-tom'
                          : 'bg-bg-subtle text-fg-secondary border-border',
                      ].join(' ')}
                    >{o.label}</button>
                  );
                })}
              </div>
            </fieldset>
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
                <span>Para quando</span>
                <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">data + hora opcional</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <DateInput value={due} onChange={setDue} />
                <TimeInput value={taskTime} onChange={setTaskTime} />
                {taskTime && (
                  <button
                    type="button"
                    onClick={() => setTaskTime('')}
                    className="text-body-sm text-fg-muted hover:text-fg underline underline-offset-2"
                  >
                    limpar hora
                  </button>
                )}
              </div>
              {taskTime && taskReminderTimes.length === 0 && (
                <div className="text-body-sm text-fg-muted mt-1.5">
                  Vai virar lembrete às {taskTime} · TOM avisa pelo WhatsApp.
                </div>
              )}
            </div>
            <RecurrencePicker value={recurrenceRule} onChange={setRecurrenceRule} startDate={due} />

            {/* Sprint 23 — Multi-reminder (task_reminders). Ref = 09:00 da due_date. */}
            <RemindersField
              referenceDateTime={due ? `${due}T${taskTime || '09:00'}` : ''}
              value={taskReminderTimes}
              onChange={setTaskReminderTimes}
            />

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
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
                <span>Para quando</span>
                <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">data + hora opcional</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <DateInput value={due} onChange={setDue} />
                <TimeInput value={taskTime} onChange={setTaskTime} />
                {taskTime && (
                  <button
                    type="button"
                    onClick={() => setTaskTime('')}
                    className="text-body-sm text-fg-muted hover:text-fg underline underline-offset-2"
                  >
                    limpar hora
                  </button>
                )}
              </div>
              {taskTime && taskReminderTimes.length === 0 && (
                <div className="text-body-sm text-fg-muted mt-1.5">
                  TOM vai avisar pelo WhatsApp às {taskTime} no dia do prazo.
                </div>
              )}
            </div>
            <RecurrencePicker value={recurrenceRule} onChange={setRecurrenceRule} startDate={due} />

            {/* Sprint 23 — Multi-reminder (task_reminders) na delegação. */}
            <RemindersField
              referenceDateTime={due ? `${due}T${taskTime || '09:00'}` : ''}
              value={taskReminderTimes}
              onChange={setTaskReminderTimes}
            />

            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
                <span>Prioridade</span>
                <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional</span>
              </div>
              <EisenhowerPicker value={taskQuadrant} onChange={setTaskQuadrant} />
            </div>
          </>
        ) : kind === 'group' ? (
          <>
            <fieldset>
              <legend className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Tipo</legend>
              <div role="radiogroup" className="grid grid-cols-2 gap-2">
                {([{ v: 'work', label: 'Trabalho' }, { v: 'personal', label: 'Pessoal' }] as const).map(o => (
                  <button key={o.v} type="button" role="radio" aria-checked={taskCtx === o.v}
                    onClick={() => setTaskCtx(o.v)}
                    className={['h-11 rounded-md border text-body-md font-semibold transition-colors focus-ring',
                      taskCtx === o.v ? 'bg-tom text-black border-tom' : 'bg-bg-subtle text-fg-secondary border-border'].join(' ')}
                  >{o.label}</button>
                ))}
              </div>
            </fieldset>

            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
                <span>Subtarefas</span>
                <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">cada uma com seu prazo</span>
              </div>
              {groupChildren.map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2 mb-1.5">
                  <span className="inline-block h-4 w-4 rounded-full border-2 border-fg-muted shrink-0" aria-hidden />
                  <span className="text-body-sm min-w-0 flex-1 truncate">{c.title}</span>
                  {c.day && <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated text-tom">dia {c.day}</span>}
                  {c.time && <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated text-fg-secondary">🕐 {c.time}</span>}
                  {c.reminders.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated text-fg-secondary">🔔 {c.reminders.length}</span>}
                  <button type="button" aria-label="Remover"
                    onClick={() => setGroupChildren(prev => prev.filter((_, j) => j !== i))}
                    className="text-fg-muted hover:text-danger p-0.5">✕</button>
                </div>
              ))}
              <div className="rounded-md border border-dashed border-border p-3 space-y-2 bg-bg-elevated/40">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-4 w-4 rounded-full border-2 border-fg-muted shrink-0" aria-hidden />
                  <input type="text" maxLength={200} value={draftChild.title}
                    onChange={e => setDraftChild(d => ({ ...d, title: e.target.value }))}
                    placeholder="Ex.: Cartão Mercado Pago"
                    className="flex-1 min-w-0 bg-transparent text-body-sm text-fg placeholder:text-fg-muted focus:outline-none" />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="text" inputMode="numeric" maxLength={2} value={draftChild.day}
                    onChange={e => setDraftChild(d => ({ ...d, day: e.target.value.replace(/\D/g, '') }))}
                    placeholder="📅 dia"
                    className="w-20 h-8 px-2 rounded-full border border-border bg-bg-surface text-body-sm text-fg focus:outline-none focus:border-tom" />
                  <div className="w-24"><TimeInput value={draftChild.time} onChange={(t) => setDraftChild(d => ({ ...d, time: t }))} /></div>
                  <button type="button" disabled={!draftChild.title.trim()}
                    onClick={() => { setGroupChildren(prev => [...prev, draftChild]); setDraftChild({ title: '', day: '', time: '', reminders: [] }); }}
                    className="ml-auto h-8 px-4 rounded-full bg-tom text-black text-body-sm font-semibold disabled:opacity-50 focus-ring">
                    Adicionar
                  </button>
                </div>
                {/* Lembretes da subtarefa — mesmos presets do RemindersField das tarefas. */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wide text-fg-muted mr-0.5">🔔 Lembretes</span>
                  {GROUP_REMINDER_PRESETS.map(p => {
                    const on = draftChild.reminders.includes(p.min);
                    return (
                      <button key={p.min} type="button"
                        onClick={() => setDraftChild(d => ({
                          ...d,
                          reminders: on ? d.reminders.filter(m => m !== p.min) : [...d.reminders, p.min],
                        }))}
                        className={['h-7 px-2.5 rounded-full border text-[11px] focus-ring transition-colors',
                          on ? 'border-tom text-tom bg-tom/10' : 'border-border text-fg-muted hover:text-fg'].join(' ')}>
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <fieldset>
              <legend className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Repetição</legend>
              <div role="radiogroup" className="grid grid-cols-2 gap-2">
                {([{ v: true, label: 'Mensal' }, { v: false, label: 'Não repete' }] as const).map(o => (
                  <button key={String(o.v)} type="button" role="radio" aria-checked={groupMonthly === o.v}
                    onClick={() => setGroupMonthly(o.v)}
                    className={['h-11 rounded-md border text-body-sm font-semibold transition-colors focus-ring',
                      groupMonthly === o.v ? 'bg-tom text-black border-tom' : 'bg-bg-subtle text-fg-secondary border-border'].join(' ')}
                  >{o.label}</button>
                ))}
              </div>
              {groupMonthly && <p className="text-body-sm text-fg-muted mt-1.5">Renasce todo mês com os mesmos dias.</p>}
            </fieldset>

            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
                <span>Prazo do grupo</span>
                <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional · quando tudo deve estar pronto</span>
              </div>
              {groupMonthly ? (
                <input type="text" inputMode="numeric" maxLength={2} value={groupDueDay}
                  onChange={e => setGroupDueDay(e.target.value.replace(/\D/g, ''))}
                  placeholder="dia do mês (1-31)"
                  className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg placeholder:text-fg-muted focus-ring" />
              ) : (
                <DateInput value={groupDueDate} onChange={setGroupDueDate} />
              )}
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
                      className="h-9 px-3 rounded-md bg-tom text-black text-body-sm font-semibold disabled:opacity-50 focus-ring"
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
                <div className="mt-sm">
                  <RecurrencePicker value={recurrenceRule} onChange={setRecurrenceRule} startDate={startAt.slice(0, 10)} />
                </div>
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
                          ? 'bg-tom text-black border-tom'
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

            {/* Sprint 23 — Lembretes via RemindersField shared (paridade com EditEventSheet,
                EventEditDrawer e Task drawers). Inclui chip "2h antes" e custom datetime. */}
            <RemindersField
              referenceDateTime={startAt || ''}
              value={eventReminderTimes}
              onChange={setEventReminderTimes}
            />
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
    </AdaptiveSheet>
  );
}

function KindButton({
  active, onClick, icon, label, hint,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  // Sprint 22.32 — layout vertical (icone -> label -> hint). Com 4 kinds (grid-cols-4,
  // 10/06) a tipografia caiu um degrau pra caber em 375px sem quebrar linha.
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'rounded-md border px-1 py-2.5 text-center transition-colors focus-ring',
        'flex flex-col items-center gap-1 min-w-0',
        active
          ? 'border-tom bg-tom/10'
          : 'border-border bg-bg-subtle hover:bg-bg-elevated',
      ].join(' ')}
    >
      <span className={active ? 'text-tom' : 'text-fg-muted'}>{icon}</span>
      {/* 11px: "Compromisso" (11 chars) cabe inteiro no card de ~73px úteis a 375px — sem truncate. */}
      <div className={['text-[11px] font-semibold leading-tight', active ? 'text-tom' : 'text-fg'].join(' ')}>
        {label}
      </div>
      <div className="text-[9.5px] text-fg-muted leading-tight truncate max-w-full">{hint}</div>
    </button>
  );
}
