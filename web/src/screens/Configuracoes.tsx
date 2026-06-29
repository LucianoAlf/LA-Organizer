import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, PauseCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { Button } from '../components/Button';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { BottomSheet } from '../components/BottomSheet';
import { CustomSelect } from '../components/CustomSelect';
import { TimeInput } from '../components/TimeInput';
import { DateInput } from '../components/DateInput';
import { showToast } from '../components/Toast';
import { NavCustomizer } from '../components/NavCustomizer';

interface Prefs {
  briefing_time: string;
  personal_briefing_time: string;
  closing_time: string;
  planning_day: number;
  planning_time: string;
  monthly_planning_time: string;
  monthly_closing_time: string;
  max_daily_tasks: number;
  coaching_intensity: 'light' | 'normal' | 'hard';
  notify_deadline_alerts: boolean;
  reminder_lead: 'same_day' | 'eve_and_day' | 'daily';
  notify_overdue_alerts: boolean;
  notify_team_summary: boolean;
  do_not_disturb_until: string | null;
  do_not_disturb_reason: string | null;
  task_checkin_times: string[];
  quiet_weekends: boolean;
  quiet_days: number[];
  quiet_reason: string | null;
  quiet_start_time_work: string;
  quiet_end_time_work: string;
  quiet_days_work: number[];
  quiet_weekends_work: boolean;
  quiet_start_time_personal: string;
  quiet_end_time_personal: string;
  quiet_days_personal: number[];
  quiet_weekends_personal: boolean;
  notify_deadline_alerts_personal: boolean;
  notify_overdue_alerts_personal: boolean;
}

interface GovPrefs {
  digest_enabled: boolean;
  send_time: string | null;
  show_scorecard: boolean;
  show_compromissos: boolean;
  show_tarefas: boolean;
}

const DOWS = [
  { v: 0, label: 'Domingo' },
  { v: 1, label: 'Segunda' },
  { v: 2, label: 'Terça' },
  { v: 3, label: 'Quarta' },
  { v: 4, label: 'Quinta' },
  { v: 5, label: 'Sexta' },
  { v: 6, label: 'Sábado' },
];

const INTENSITIES = [
  { v: 'light', label: 'Leve', hint: 'TOM cobra com leveza' },
  { v: 'normal', label: 'Normal', hint: 'Cobrança equilibrada' },
  { v: 'hard', label: 'Duro', hint: 'TOM cobra direto e forte' },
] as const;

const trimSec = (t: string) => (t || '').slice(0, 5);
const padSec = (t: string) => (t.length === 5 ? t + ':00' : t);

const PREF_COLS = 'briefing_time, personal_briefing_time, closing_time, planning_day, planning_time, monthly_planning_time, monthly_closing_time, max_daily_tasks, coaching_intensity, notify_deadline_alerts, notify_overdue_alerts, notify_team_summary, do_not_disturb_until, do_not_disturb_reason, task_checkin_times, quiet_weekends, quiet_days, quiet_reason, quiet_start_time_work, quiet_end_time_work, quiet_days_work, quiet_weekends_work, quiet_start_time_personal, quiet_end_time_personal, quiet_days_personal, quiet_weekends_personal, notify_deadline_alerts_personal, notify_overdue_alerts_personal';

async function fetchPrefs(collabId: string): Promise<Prefs | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select(PREF_COLS)
    .eq('collaborator_id', collabId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Prefs | null;
}

function formatDndUntil(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return fmt.format(d);
}

export function Configuracoes() {
  const { collaborator, role } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<Prefs | null>(null);
  // Sprint AutoSaveConfig — debounce auto-save com indicador discreto.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saved'>('idle');
  const initialFormJson = useRef<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dndOpen, setDndOpen] = useState(false);
  const [silenceTab, setSilenceTab] = useState<'work' | 'personal'>('work');

  const isLeadership = role === 'director' || role === 'coordinator' || role === 'manager';

  const { data, isLoading, error } = useQuery({
    queryKey: ['user_preferences', collaborator?.id],
    queryFn: () => collaborator ? fetchPrefs(collaborator.id) : Promise.resolve(null),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  useEffect(() => {
    if (data) {
      const next = {
        ...data,
        briefing_time: trimSec(data.briefing_time),
        personal_briefing_time: trimSec(data.personal_briefing_time),
        closing_time: trimSec(data.closing_time),
        planning_time: trimSec(data.planning_time),
        monthly_planning_time: trimSec(data.monthly_planning_time),
        monthly_closing_time: trimSec(data.monthly_closing_time),
        task_checkin_times: (data.task_checkin_times || []).map(trimSec),
        quiet_start_time_work: trimSec(data.quiet_start_time_work),
        quiet_end_time_work: trimSec(data.quiet_end_time_work),
        quiet_start_time_personal: trimSec(data.quiet_start_time_personal),
        quiet_end_time_personal: trimSec(data.quiet_end_time_personal),
        quiet_days_work: Array.isArray(data.quiet_days_work) ? data.quiet_days_work : [],
        quiet_days_personal: Array.isArray(data.quiet_days_personal) ? data.quiet_days_personal : [],
        quiet_weekends_work: !!data.quiet_weekends_work,
        quiet_weekends_personal: !!data.quiet_weekends_personal,
        reminder_lead: data.reminder_lead || 'eve_and_day',
      };
      setForm(next);
      // Baseline: serializa o estado inicial pra detectar "houve mudança real"
      // e não disparar auto-save no primeiro paint.
      initialFormJson.current = JSON.stringify(next);
    }
  }, [data]);

  // Sprint AutoSaveConfig — debounce de 800ms. Quando form muda e difere
  // da baseline serializada, agenda save. Cancela timer se houver nova edição
  // antes do prazo. Validação leve: TimeInputs precisam estar completos (HH:MM)
  // ou vazios — evita salvar "08:0" enquanto a pessoa ainda digita.
  useEffect(() => {
    if (!form || initialFormJson.current === null) return;
    const formJson = JSON.stringify(form);
    if (formJson === initialFormJson.current) return;  // sem mudança vs baseline

    // Valida times — só dispara se todos estão completos
    const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
    const timeFields: (keyof Prefs)[] = [
      'briefing_time', 'personal_briefing_time', 'closing_time',
      'planning_time', 'monthly_planning_time', 'monthly_closing_time',
    ];
    const partial = timeFields.some(f => {
      const v = (form as any)[f];
      return v && !HHMM.test(v);
    });
    if (partial) return;
    const partialCheckins = (form.task_checkin_times || []).some(t => t && !HHMM.test(t));
    if (partialCheckins) return;

    // Agenda save
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setSaveStatus('pending');
    debounceTimer.current = setTimeout(() => {
      save.mutate(form, {
        onSuccess: () => {
          initialFormJson.current = JSON.stringify(form);
          setSaveStatus('saved');
          if (savedToastTimer.current) clearTimeout(savedToastTimer.current);
          savedToastTimer.current = setTimeout(() => setSaveStatus('idle'), 1800);
        },
        onError: () => setSaveStatus('idle'),
      });
    }, 800);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const save = useMutation({
    mutationFn: async (p: Prefs) => {
      if (!collaborator) throw new Error('no_session');
      const { error } = await supabase
        .from('user_preferences')
        .update({
          briefing_time: padSec(p.briefing_time),
          personal_briefing_time: padSec(p.personal_briefing_time),
          closing_time: padSec(p.closing_time),
          planning_day: p.planning_day,
          planning_time: padSec(p.planning_time),
          monthly_planning_time: padSec(p.monthly_planning_time),
          monthly_closing_time: padSec(p.monthly_closing_time),
          max_daily_tasks: p.max_daily_tasks,
          coaching_intensity: p.coaching_intensity,
          notify_deadline_alerts: p.notify_deadline_alerts,
          reminder_lead: p.reminder_lead,
          notify_overdue_alerts: p.notify_overdue_alerts,
          notify_team_summary: p.notify_team_summary,
          // NÃO ordenar: o save é recarregado nas linhas indexadas por posição;
          // ordenar reembaralha os campos e parece "reverter" pro usuário (bug Gabi 2026-05-30).
          // A ordem é irrelevante pro dispatcher (itera e checa cada horário).
          task_checkin_times: (p.task_checkin_times || []).filter(Boolean).map(padSec),
          quiet_weekends: !!p.quiet_weekends,
          quiet_days: Array.isArray(p.quiet_days) ? [...new Set(p.quiet_days.filter(n => n >= 0 && n <= 6))].sort() : [],
          quiet_reason: p.quiet_reason || null,
          quiet_start_time_work: p.quiet_start_time_work ? padSec(p.quiet_start_time_work) : null,
          quiet_end_time_work: p.quiet_end_time_work ? padSec(p.quiet_end_time_work) : null,
          quiet_days_work: Array.isArray(p.quiet_days_work) ? [...new Set(p.quiet_days_work.filter(n => n >= 0 && n <= 6))].sort() : [],
          quiet_weekends_work: !!p.quiet_weekends_work,
          quiet_start_time_personal: p.quiet_start_time_personal ? padSec(p.quiet_start_time_personal) : null,
          quiet_end_time_personal: p.quiet_end_time_personal ? padSec(p.quiet_end_time_personal) : null,
          quiet_days_personal: Array.isArray(p.quiet_days_personal) ? [...new Set(p.quiet_days_personal.filter(n => n >= 0 && n <= 6))].sort() : [],
          quiet_weekends_personal: !!p.quiet_weekends_personal,
          notify_deadline_alerts_personal: p.notify_deadline_alerts_personal,
          notify_overdue_alerts_personal: p.notify_overdue_alerts_personal,
        })
        .eq('collaborator_id', collaborator.id);
      if (error) throw error;
    },
    onSuccess: () => {
      // Status visual é controlado pelo debounce no useEffect — sem toast aqui
      // pra não spammar a cada save automático.
      qc.invalidateQueries({ queryKey: ['user_preferences'] });
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao salvar', msg: err.message });
    },
  });

  // Sprint SaveOnLeave — o auto-save tem debounce de 800ms. Se a pessoa marcava
  // (ex.: "domingo em silêncio") e SAÍA da tela / fechava o app antes disso, o
  // save pendente era cancelado pelo cleanup do debounce e PERDIDO — sem erro,
  // sem aviso. Era a causa de "marquei o silêncio e o TOM continuou mandando".
  // Aqui forçamos o flush do pendente ao sair: unmount (trocou de tela),
  // visibilitychange=hidden (trocou de app/aba) e pagehide (fechou — PWA/celular).
  const latestFormRef = useRef<Prefs | null>(null);
  useEffect(() => { latestFormRef.current = form; }, [form]);

  useEffect(() => {
    const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
    const TIME_FIELDS: (keyof Prefs)[] = [
      'briefing_time', 'personal_briefing_time', 'closing_time',
      'planning_time', 'monthly_planning_time', 'monthly_closing_time',
    ];
    const flush = () => {
      const f = latestFormRef.current;
      if (!f || initialFormJson.current === null) return;
      const formJson = JSON.stringify(f);
      if (formJson === initialFormJson.current) return;            // nada mudou vs baseline
      // mesma validação leve do debounce: não salva time parcial ("08:0")
      if (TIME_FIELDS.some(k => { const v = (f as any)[k]; return v && !HHMM.test(v); })) return;
      if ((f.task_checkin_times || []).some(t => t && !HHMM.test(t))) return;
      if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
      initialFormJson.current = formJson;                          // baseline atualizada → não re-salva
      save.mutate(f);                                              // dispara já (fire-and-forget, sem setState)
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();                                                     // saiu da tela → salva o pendente
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sprint VoiceToggle — carrega voice_enabled de collaborators (separado de user_preferences)
  const voiceQuery = useQuery({
    queryKey: ['collab-voice', collaborator?.id],
    queryFn: async () => {
      if (!collaborator?.id) return null;
      const { data, error } = await supabase
        .from('collaborators')
        .select('voice_enabled')
        .eq('id', collaborator.id)
        .single();
      if (error) throw error;
      return data?.voice_enabled ?? true;
    },
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });
  const voiceEnabled = voiceQuery.data ?? true;

  const voiceMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!collaborator) throw new Error('no_session');
      const { error } = await supabase
        .from('collaborators')
        .update({ voice_enabled: enabled })
        .eq('id', collaborator.id);
      if (error) throw error;
    },
    onSuccess: (_data, enabled) => {
      qc.invalidateQueries({ queryKey: ['collab-voice'] });
      showToast({
        kind: 'success',
        title: enabled ? 'Voz do TOM ligada 🎙️' : 'Voz do TOM desligada 🤫',
        msg: enabled ? 'TOM volta a mandar áudio quando fizer sentido.' : 'Só texto a partir de agora.',
      });
    },
    onError: (err: Error) => showToast({ kind: 'error', title: 'Erro ao salvar', msg: err.message }),
  });

  // Fase 6b — config de governança (tabela governance_prefs, separada). Padrão se sem linha.
  const govQuery = useQuery({
    queryKey: ['governance_prefs', collaborator?.id],
    queryFn: async (): Promise<GovPrefs> => {
      if (!collaborator?.id) return { digest_enabled: true, send_time: null, show_scorecard: true, show_compromissos: true, show_tarefas: true };
      const { data } = await supabase
        .from('governance_prefs')
        .select('digest_enabled, send_time, show_scorecard, show_compromissos, show_tarefas')
        .eq('collaborator_id', collaborator.id)
        .maybeSingle();
      return (data as GovPrefs) ?? { digest_enabled: true, send_time: null, show_scorecard: true, show_compromissos: true, show_tarefas: true };
    },
    enabled: Boolean(collaborator?.id && supabaseConfigured && isLeadership),
  });
  const [govForm, setGovForm] = useState<GovPrefs | null>(null);
  useEffect(() => {
    if (govQuery.data) setGovForm({ ...govQuery.data, send_time: govQuery.data.send_time ? trimSec(govQuery.data.send_time) : null });
  }, [govQuery.data]);

  const govMutation = useMutation({
    mutationFn: async (p: GovPrefs) => {
      if (!collaborator) throw new Error('no_session');
      const { error } = await supabase.from('governance_prefs').upsert({
        collaborator_id: collaborator.id,
        digest_enabled: p.digest_enabled,
        send_time: p.send_time ? padSec(p.send_time) : null,
        show_scorecard: p.show_scorecard,
        show_compromissos: p.show_compromissos,
        show_tarefas: p.show_tarefas,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'collaborator_id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['governance_prefs'] }),
    onError: (err: Error) => showToast({ kind: 'error', title: 'Erro ao salvar', msg: err.message }),
  });

  // Atualiza local + salva (horário só salva quando completo HH:MM ou vazio).
  const updateGov = (patch: Partial<GovPrefs>) => {
    setGovForm(prev => {
      const next = { ...(prev as GovPrefs), ...patch };
      const t = next.send_time || '';
      if (t === '' || /^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) govMutation.mutate(next);
      return next;
    });
  };

  const dndMutation = useMutation({
    mutationFn: async ({ untilIso, reason }: { untilIso: string | null; reason: string | null }) => {
      if (!collaborator) throw new Error('no_session');
      const { error } = await supabase
        .from('user_preferences')
        .update({
          do_not_disturb_until: untilIso,
          do_not_disturb_reason: reason,
        })
        .eq('collaborator_id', collaborator.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user_preferences'] });
      setDndOpen(false);
      showToast({ kind: 'success', title: 'TOM atualizado' });
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha', msg: err.message });
    },
  });

  const dndActive = useMemo(() => {
    if (!form?.do_not_disturb_until) return false;
    return new Date(form.do_not_disturb_until).getTime() > Date.now();
  }, [form?.do_not_disturb_until]);

  if (!supabaseConfigured) return <EmptyState icon={<Settings size={32} />} title="Configure Supabase" />;
  if (isLoading || !form) return <LoadingState rows={4} />;
  if (error) return <EmptyState title="Erro" description={(error as Error).message} />;

  return (
    <div className="space-y-lg pb-24">
      <PageHeader title="Configurações" subtitle="Como o TOM te procura no WhatsApp." backTo="/mais" />

      {/* Indicador discreto de auto-save — Sprint AutoSaveConfig */}
      <div className="h-5 flex items-center justify-end px-1 -mt-2 text-body-sm" aria-live="polite">
        {saveStatus === 'pending' && <span className="text-fg-muted">salvando…</span>}
        {saveStatus === 'saved' && <span className="text-success">✓ salvo</span>}
      </div>

      <div className="space-y-md">
        {/* Navegação rápida — customização do bottom nav (4 slots + Mais fixo) */}
        <Section title="Navegação rápida">
          <NavCustomizer />
        </Section>

        {/* Rituais diários */}
        <Section title="Rituais diários">
          <Field label="Briefing pessoal" hint="Mensagem da manhã sobre o dia">
            <TimeInput value={form.personal_briefing_time}
              onChange={v => setForm({ ...form, personal_briefing_time: v })} />
          </Field>
          <Field label="Briefing trabalho" hint="Plano de trabalho do dia (dias úteis)">
            <TimeInput value={form.briefing_time}
              onChange={v => setForm({ ...form, briefing_time: v })} />
          </Field>
          <Field label="Fechamento do dia" hint="Revisão do que foi feito (dias úteis)">
            <TimeInput value={form.closing_time}
              onChange={v => setForm({ ...form, closing_time: v })} />
          </Field>
        </Section>

        {/* Check-ins de tarefas */}
        <Section title="Lembretes de tarefas" subtitle="TOM te avisa nos horários que você escolher com suas tarefas pendentes do dia.">
          {(form.task_checkin_times || []).map((t, i) => (
            <Field key={i} label={`Check-in ${i + 1}`}>
              <div className="flex items-center gap-2">
                <TimeInput value={t}
                  onChange={v => {
                    const updated = [...form.task_checkin_times];
                    updated[i] = v;
                    setForm({ ...form, task_checkin_times: updated });
                  }} />
                <button type="button"
                  onClick={() => setForm({ ...form, task_checkin_times: form.task_checkin_times.filter((_, j) => j !== i) })}
                  className="text-fg-muted hover:text-error transition-colors text-sm px-2 py-1 rounded">
                  ✕
                </button>
              </div>
            </Field>
          ))}
          {(form.task_checkin_times || []).length < 6 && (
            <button type="button"
              onClick={() => setForm({ ...form, task_checkin_times: [...(form.task_checkin_times || []), '12:00'] })}
              className="text-tom text-sm font-medium hover:opacity-80 transition-opacity">
              + Adicionar horário
            </button>
          )}
        </Section>

        {/* Rituais semanais */}
        <Section title="Rituais semanais">
          <Field label="Dia do planejamento" hint="Quando TOM dispara o planejamento da semana">
            <CustomSelect
              value={String(form.planning_day)}
              options={DOWS.map(d => ({ value: String(d.v), label: d.label }))}
              onChange={(v) => setForm({ ...form, planning_day: Number(v) })}
              size="sm"
            />
          </Field>
          <Field label="Horário do planejamento" hint="Hora do dia escolhido acima">
            <TimeInput value={form.planning_time}
              onChange={v => setForm({ ...form, planning_time: v })} />
          </Field>
        </Section>

        {/* Rituais mensais */}
        <Section title="Rituais mensais">
          <Field label="Planejamento mensal">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center px-2 py-1 rounded-md bg-tom/15 text-tom text-caption font-semibold">
                1ª segunda do mês
              </span>
              <TimeInput value={form.monthly_planning_time}
                onChange={v => setForm({ ...form, monthly_planning_time: v })} />
            </div>
          </Field>
          <Field label="Fechamento mensal">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center px-2 py-1 rounded-md bg-tom/15 text-tom text-caption font-semibold">
                Última sexta do mês
              </span>
              <TimeInput value={form.monthly_closing_time}
                onChange={v => setForm({ ...form, monthly_closing_time: v })} />
            </div>
          </Field>
        </Section>

        {/* Foco */}
        <Section title="Foco do dia">
          <Field
            label={`Tarefas máximas por dia: ${form.max_daily_tasks}`}
            hint="TOM não dispara mais tarefas que isso no briefing — força foco"
          >
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={form.max_daily_tasks}
              onChange={e => setForm({ ...form, max_daily_tasks: Number(e.target.value) })}
              className="w-full accent-tom"
            />
            <div className="flex justify-between text-caption text-fg-muted mt-0.5">
              <span>1</span><span>5</span><span>10</span>
            </div>
          </Field>
        </Section>

        {/* Intensidade */}
        <Section title="Intensidade" subtitle="Como o TOM cobra você. Não muda o que cobra, muda como.">
          <div role="radiogroup" className="grid grid-cols-3 gap-2">
            {INTENSITIES.map(i => {
              const active = form.coaching_intensity === i.v;
              return (
                <button
                  type="button"
                  key={i.v}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setForm({ ...form, coaching_intensity: i.v })}
                  className={[
                    'rounded-md border px-3 py-3 text-left transition-colors focus-ring',
                    active
                      ? 'border-tom bg-tom/10 text-fg'
                      : 'border-border bg-bg-subtle text-fg-secondary hover:text-fg',
                  ].join(' ')}
                >
                  <div className={['text-body-md font-semibold', active ? 'text-tom' : ''].join(' ')}>{i.label}</div>
                  <div className="text-body-sm text-fg-muted leading-tight">{i.hint}</div>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Notificações */}
        <Section title="Notificações">
          <Field label="Antecedência de lembrete" hint="Quando o TOM te lembra de tarefa com prazo">
            <CustomSelect
              value={form.reminder_lead}
              options={[
                { value: 'same_day', label: 'Só no dia' },
                { value: 'eve_and_day', label: 'Véspera + dia' },
                { value: 'daily', label: 'Todos os dias' },
              ]}
              onChange={(v) => setForm({ ...form, reminder_lead: v as 'same_day' | 'eve_and_day' | 'daily' })}
              size="sm"
            />
          </Field>
          <Toggle label="Alertas de atraso" hint="Cobra quando passou do prazo"
            value={form.notify_overdue_alerts}
            onChange={v => setForm({ ...form, notify_overdue_alerts: v })} />
          {isLeadership && (
            <Toggle label="Resumo do time" hint="Recebe panorama da equipe (só liderança)"
              value={form.notify_team_summary}
              onChange={v => setForm({ ...form, notify_team_summary: v })} />
          )}
        </Section>

        {/* Voz do TOM — opt-in/opt-out individual de áudios */}
        <Section title="Voz do TOM" subtitle="Quando desligado, TOM responde só por texto. A frequência geral continua igual.">
          <Toggle
            label="Receber áudios do TOM"
            hint="Você também pode falar &quot;TOM, para de mandar áudio&quot; / &quot;TOM, manda áudio de novo&quot;."
            value={voiceEnabled}
            onChange={v => voiceMutation.mutate(v)}
          />
        </Section>

        {/* Governança — digest do time (Fase 6b). Visível pra liderança. */}
        {isLeadership && govForm && (
          <Section title="Governança (digest do time)" subtitle="O resumo diário do seu time que o TOM te manda no WhatsApp — scorecard + compromissos + tarefas numa mensagem só.">
            <Toggle
              label="Receber o digest de governança"
              hint="Desligado = o TOM não te manda o resumo do time."
              value={govForm.digest_enabled}
              onChange={v => updateGov({ digest_enabled: v })}
            />
            {govForm.digest_enabled && (
              <>
                <Field label="Horário de envio" hint="Vazio = padrão (9h pro CEO; 14h pros líderes / 9h no sábado).">
                  <div className="flex items-center gap-2">
                    <TimeInput value={govForm.send_time || ''} onChange={v => updateGov({ send_time: v })} />
                    {govForm.send_time && (
                      <button type="button" onClick={() => updateGov({ send_time: '' })}
                        className="text-body-sm text-fg-muted hover:text-fg underline underline-offset-2">
                        usar padrão
                      </button>
                    )}
                  </div>
                </Field>
                <Toggle label="🏆 Scorecard" hint="Semáforo dos líderes + badges."
                  value={govForm.show_scorecard} onChange={v => updateGov({ show_scorecard: v })} />
                <Toggle label="🎖️ Compromissos" hint="Compromissos do time em aberto."
                  value={govForm.show_compromissos} onChange={v => updateGov({ show_compromissos: v })} />
                <Toggle label="📋 Tarefas" hint="Tarefas atrasadas do time + diagnóstico."
                  value={govForm.show_tarefas} onChange={v => updateGov({ show_tarefas: v })} />
              </>
            )}
          </Section>
        )}

        {/* Finanças — gerenciamento de categorias personalizadas (saiu do dashboard do financeiro) */}
        <Section title="Finanças">
          <Link
            to="/financeiro/categorias"
            className="flex items-center justify-between gap-3 rounded-md bg-bg-elevated border border-border px-3 py-3 hover:border-tom/40 focus-ring transition-colors"
          >
            <div className="min-w-0">
              <div className="text-body-md text-fg">Categorias personalizadas</div>
              <div className="text-body-sm text-fg-muted">Criar e remover suas categorias de gastos e receitas.</div>
            </div>
            <span className="text-fg-muted text-lg shrink-0" aria-hidden>›</span>
          </Link>
        </Section>

      </div>

      {/* Abas Pessoal/Trabalho — compartilhadas pelas seções de silêncio abaixo */}
      <Section title="🔕 Silêncio diário" subtitle="Trabalho = suas atividades na LA Music. Pessoal = sua vida e trabalhos seus fora da LA Music.">
        <div className="flex gap-2">
          {(['work', 'personal'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setSilenceTab(tab)}
              className={`h-9 px-4 rounded-md text-body-sm font-semibold border transition ${
                silenceTab === tab
                  ? 'bg-tom text-bg-app border-tom'
                  : 'bg-bg-surface border-border text-fg-muted hover:border-tom/60'
              }`}
            >
              {tab === 'work' ? 'Trabalho' : 'Pessoal'}
            </button>
          ))}
        </div>

        <p className="text-body-sm text-fg-muted">
          Em qual horário você NÃO quer ser cobrado de {silenceTab === 'work' ? 'trabalho' : 'coisas pessoais'}.
          Deixe vazio para não ter silêncio neste contexto.
        </p>
        <div className="flex items-center gap-2">
          <TimeInput
            value={(form as any)[`quiet_start_time_${silenceTab}`] || ''}
            onChange={v => setForm({ ...form, [`quiet_start_time_${silenceTab}`]: v })}
          />
          <span className="text-fg-muted">até</span>
          <TimeInput
            value={(form as any)[`quiet_end_time_${silenceTab}`] || ''}
            onChange={v => setForm({ ...form, [`quiet_end_time_${silenceTab}`]: v })}
          />
          {((form as any)[`quiet_start_time_${silenceTab}`] || (form as any)[`quiet_end_time_${silenceTab}`]) && (
            <button
              type="button"
              onClick={() => setForm({ ...form, [`quiet_start_time_${silenceTab}`]: '', [`quiet_end_time_${silenceTab}`]: '' })}
              className="text-body-sm text-fg-muted hover:text-fg underline underline-offset-2"
            >
              limpar
            </button>
          )}
        </div>
        {(form as any)[`quiet_start_time_${silenceTab}`] && (form as any)[`quiet_end_time_${silenceTab}`] && (
          <p className="text-body-sm text-fg-muted">
            🔕 TOM em silêncio de {silenceTab === 'work' ? 'trabalho' : 'pessoal'} das{' '}
            {(form as any)[`quiet_start_time_${silenceTab}`]} às {(form as any)[`quiet_end_time_${silenceTab}`]}.
          </p>
        )}
      </Section>

      {/* Dias de silêncio — por contexto (usa a aba selecionada acima) */}
      <Section title="Dias de silêncio" subtitle={`Dias em que o TOM não cobra ${silenceTab === 'work' ? 'trabalho (LA Music)' : 'coisas pessoais'}. Use as abas acima pra trocar de contexto.`}>
        {(() => {
          const qDays: number[] = (form as any)[`quiet_days_${silenceTab}`] || [];
          const qWeekends: boolean = !!(form as any)[`quiet_weekends_${silenceTab}`];
          return (
            <>
              <div className="grid grid-cols-7 gap-1">
                {DOWS.map(d => {
                  const isOn = (qWeekends && (d.v === 0 || d.v === 6)) || qDays.includes(d.v);
                  const fromWeekend = qWeekends && (d.v === 0 || d.v === 6);
                  return (
                    <button
                      key={d.v}
                      type="button"
                      onClick={() => {
                        if (fromWeekend) return;
                        const next = isOn ? qDays.filter(n => n !== d.v) : [...qDays, d.v].sort();
                        setForm({ ...form, [`quiet_days_${silenceTab}`]: next });
                      }}
                      className={`h-12 rounded-md text-body-sm font-medium border transition ${
                        isOn ? 'bg-tom text-bg-app border-tom' : 'bg-bg-surface border-border text-fg-muted hover:border-tom/60'
                      } ${fromWeekend ? 'opacity-80 cursor-not-allowed' : ''}`}
                      title={fromWeekend ? 'Vem de "Fim de semana inteiro"' : ''}
                    >
                      {d.label.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={qWeekends ? 'primary' : 'secondary'}
                  onClick={() => setForm({ ...form, [`quiet_weekends_${silenceTab}`]: !qWeekends })}
                >
                  {qWeekends ? '✓ Fim de semana inteiro' : 'Fim de semana inteiro'}
                </Button>
                {(qWeekends || qDays.length > 0) && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setForm({ ...form, [`quiet_weekends_${silenceTab}`]: false, [`quiet_days_${silenceTab}`]: [] })}
                  >
                    Limpar todos
                  </Button>
                )}
              </div>
              {(qWeekends || qDays.length > 0) && (
                <p className="text-body-sm text-fg-muted">
                  🔕 Silêncio de {silenceTab === 'work' ? 'trabalho' : 'pessoal'}: {(() => {
                    const ativos = new Set<number>(qDays);
                    if (qWeekends) { ativos.add(0); ativos.add(6); }
                    return [...ativos].sort().map(v => DOWS.find(d => d.v === v)?.label).join(', ');
                  })()}.
                </p>
              )}
            </>
          );
        })()}
      </Section>

      {/* Pausar TOM (DND) */}
      <Section title="Pausar TOM">
        {dndActive ? (
          <div className="space-y-2">
            <p className="text-body-sm">
              TOM em silêncio até <strong>{formatDndUntil(form.do_not_disturb_until)}</strong>.
              {form.do_not_disturb_reason && (
                <span className="block text-fg-muted">Motivo: {form.do_not_disturb_reason}</span>
              )}
            </p>
            <Button
              variant="ghost"
              onClick={() => dndMutation.mutate({ untilIso: null, reason: null })}
              disabled={dndMutation.isPending}
            >
              Despausar agora
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-body-sm text-fg-muted">
              Pausa as mensagens do TOM por um período. Briefings, lembretes e cobranças ficam em silêncio.
            </p>
            <Button
              variant="secondary"
              leadingIcon={<PauseCircle size={18} />}
              onClick={() => setDndOpen(true)}
            >
              Pausar TOM
            </Button>
          </div>
        )}
      </Section>

      <DndSheet
        open={dndOpen}
        onClose={() => setDndOpen(false)}
        onConfirm={(untilIso, reason) => dndMutation.mutate({ untilIso, reason })}
        pending={dndMutation.isPending}
      />

      <style>{`
        .input {
          width: 100%; height: 44px; padding: 0 12px;
          background: rgb(var(--bg-elevated));
          border: 1px solid rgb(var(--border));
          color: rgb(var(--fg-primary));
          border-radius: 10px;
          font: inherit;
        }
        .input:focus { outline: none; box-shadow: 0 0 0 2px rgb(var(--bg-app)), 0 0 0 4px #A3BE50; }
      `}</style>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="surface p-md space-y-md">
      <div>
        <h3 className="text-card-title">{title}</h3>
        {subtitle && <p className="text-body-sm text-fg-muted mt-1">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-body-sm text-fg-muted mt-1.5">{hint}</div>}
    </label>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-md">
      <div className="flex-1 min-w-0">
        <div className="text-body-md">{label}</div>
        {hint && <div className="text-body-sm text-fg-muted mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={[
          'relative w-11 h-6 rounded-full transition-colors shrink-0 focus-ring',
          value ? 'bg-tom' : 'bg-bg-elevated border border-border',
        ].join(' ')}
      >
        <span aria-hidden
          className={[
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform',
            value ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  );
}

function DndSheet({ open, onClose, onConfirm, pending }: {
  open: boolean;
  onClose: () => void;
  onConfirm: (untilIso: string | null, reason: string | null) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState('');
  const [customDate, setCustomDate] = useState('');
  const [customTime, setCustomTime] = useState('');

  function pause(hours: number) {
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    onConfirm(until, reason.trim() || null);
  }
  function pauseUntilTomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    onConfirm(d.toISOString(), reason.trim() || null);
  }
  function pauseCustom() {
    if (!customDate || !customTime) {
      showToast({ kind: 'error', title: 'Data e hora obrigatórios' });
      return;
    }
    const iso = new Date(`${customDate}T${customTime}:00-03:00`).toISOString();
    onConfirm(iso, reason.trim() || null);
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Pausar TOM">
      <div className="space-y-md">
        <div>
          <label className="text-caption text-fg-muted block mb-1">Motivo (opcional)</label>
          <input type="text" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="ex: reunião, dia em casa, viagem"
            className="input" />
        </div>

        <div>
          <p className="text-caption uppercase font-semibold text-fg-muted mb-2">Por quanto tempo?</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => pause(1)} disabled={pending} fullWidth>1 hora</Button>
            <Button variant="secondary" onClick={() => pause(4)} disabled={pending} fullWidth>4 horas</Button>
            <Button variant="secondary" onClick={pauseUntilTomorrow} disabled={pending} fullWidth>Até amanhã 8h</Button>
            <Button variant="secondary" onClick={() => pause(24 * 7)} disabled={pending} fullWidth>1 semana</Button>
          </div>
        </div>

        <div>
          <p className="text-caption uppercase font-semibold text-fg-muted mb-2">Personalizado</p>
          <div className="grid grid-cols-2 gap-2">
            <DateInput value={customDate} onChange={setCustomDate} />
            <TimeInput value={customTime} onChange={setCustomTime} />
          </div>
          <Button onClick={pauseCustom} disabled={pending || !customDate || !customTime} fullWidth className="mt-2">
            Pausar até essa data
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
