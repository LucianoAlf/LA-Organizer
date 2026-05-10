import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Save, PauseCircle } from 'lucide-react';
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
  notify_overdue_alerts: boolean;
  notify_team_summary: boolean;
  do_not_disturb_until: string | null;
  do_not_disturb_reason: string | null;
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

const PREF_COLS = 'briefing_time, personal_briefing_time, closing_time, planning_day, planning_time, monthly_planning_time, monthly_closing_time, max_daily_tasks, coaching_intensity, notify_deadline_alerts, notify_overdue_alerts, notify_team_summary, do_not_disturb_until, do_not_disturb_reason';

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
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dndOpen, setDndOpen] = useState(false);

  const isLeadership = role === 'director' || role === 'coordinator' || role === 'manager';

  const { data, isLoading, error } = useQuery({
    queryKey: ['user_preferences', collaborator?.id],
    queryFn: () => collaborator ? fetchPrefs(collaborator.id) : Promise.resolve(null),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  useEffect(() => {
    if (data) {
      setForm({
        ...data,
        briefing_time: trimSec(data.briefing_time),
        personal_briefing_time: trimSec(data.personal_briefing_time),
        closing_time: trimSec(data.closing_time),
        planning_time: trimSec(data.planning_time),
        monthly_planning_time: trimSec(data.monthly_planning_time),
        monthly_closing_time: trimSec(data.monthly_closing_time),
      });
    }
  }, [data]);

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
          notify_overdue_alerts: p.notify_overdue_alerts,
          notify_team_summary: p.notify_team_summary,
        })
        .eq('collaborator_id', collaborator.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setSavedAt(Date.now());
      qc.invalidateQueries({ queryKey: ['user_preferences'] });
      showToast({ kind: 'success', title: 'Configurações salvas' });
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao salvar', msg: err.message });
    },
  });

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

  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); save.mutate(form); };

  return (
    <div className="space-y-lg">
      <PageHeader title="Configurações" subtitle="Como o TOM te procura no WhatsApp." backTo="/mais" />

      <form onSubmit={onSubmit} className="space-y-md">
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
          <Toggle label="Alertas de prazo (D-1)" hint="Te avisa um dia antes de vencer"
            value={form.notify_deadline_alerts}
            onChange={v => setForm({ ...form, notify_deadline_alerts: v })} />
          <Toggle label="Alertas de atraso" hint="Cobra quando passou do prazo"
            value={form.notify_overdue_alerts}
            onChange={v => setForm({ ...form, notify_overdue_alerts: v })} />
          {isLeadership && (
            <Toggle label="Resumo do time" hint="Recebe panorama da equipe (só liderança)"
              value={form.notify_team_summary}
              onChange={v => setForm({ ...form, notify_team_summary: v })} />
          )}
        </Section>

        <div className="flex items-center gap-md">
          <Button type="submit" leadingIcon={<Save size={18} />} loading={save.isPending}>Salvar</Button>
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="text-body-sm text-success">✓ Salvo</span>
          )}
        </div>
      </form>

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
