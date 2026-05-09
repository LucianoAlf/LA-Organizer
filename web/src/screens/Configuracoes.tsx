import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { Button } from '../components/Button';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

interface Prefs {
  briefing_time: string;
  personal_briefing_time: string;
  closing_time: string;
  planning_day: number;
  coaching_intensity: 'light' | 'normal' | 'hard';
  notify_deadline_alerts: boolean;
  notify_overdue_alerts: boolean;
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

// HH:MM:SS → HH:MM
const trimSec = (t: string) => (t || '').slice(0, 5);
// HH:MM → HH:MM:00 (DB time format)
const padSec = (t: string) => (t.length === 5 ? t + ':00' : t);

async function fetchPrefs(collabId: string): Promise<Prefs | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('briefing_time, personal_briefing_time, closing_time, planning_day, coaching_intensity, notify_deadline_alerts, notify_overdue_alerts')
    .eq('collaborator_id', collabId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Prefs | null;
}

export function Configuracoes() {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<Prefs | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['user_preferences', collaborator?.id],
    queryFn: () => collaborator ? fetchPrefs(collaborator.id) : Promise.resolve(null),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  useEffect(() => {
    if (data) setForm({ ...data, briefing_time: trimSec(data.briefing_time), personal_briefing_time: trimSec(data.personal_briefing_time), closing_time: trimSec(data.closing_time) });
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
          coaching_intensity: p.coaching_intensity,
          notify_deadline_alerts: p.notify_deadline_alerts,
          notify_overdue_alerts: p.notify_overdue_alerts,
        })
        .eq('collaborator_id', collaborator.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setSavedAt(Date.now());
      qc.invalidateQueries({ queryKey: ['user_preferences'] });
    },
  });

  if (!supabaseConfigured) return <EmptyState icon={<Settings size={32} />} title="Configure Supabase" />;
  if (isLoading || !form) return <LoadingState rows={4} />;
  if (error) return <EmptyState title="Erro" description={(error as Error).message} />;

  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); save.mutate(form); };

  return (
    <div className="space-y-lg">
      <PageHeader title="Configurações" subtitle="Como o TOM te procura no WhatsApp." backTo="/mais" />

      <form onSubmit={onSubmit} className="space-y-md">
        <section className="surface p-md space-y-md">
          <h3 className="text-card-title">Horários</h3>

          <Field label="Briefing pessoal" hint="Mensagem da manhã sobre o dia">
            <input
              type="time"
              required
              value={form.personal_briefing_time}
              onChange={e => setForm({ ...form, personal_briefing_time: e.target.value })}
              className="input"
            />
          </Field>

          <Field label="Briefing trabalho" hint="Plano de trabalho do dia (dias úteis)">
            <input
              type="time"
              required
              value={form.briefing_time}
              onChange={e => setForm({ ...form, briefing_time: e.target.value })}
              className="input"
            />
          </Field>

          <Field label="Fechamento do dia" hint="Revisão do que foi feito (dias úteis)">
            <input
              type="time"
              required
              value={form.closing_time}
              onChange={e => setForm({ ...form, closing_time: e.target.value })}
              className="input"
            />
          </Field>

          <Field label="Planejamento semanal" hint="Dia do ritual de planejamento da semana">
            <select
              value={form.planning_day}
              onChange={e => setForm({ ...form, planning_day: Number(e.target.value) })}
              className="input"
            >
              {DOWS.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}
            </select>
          </Field>
        </section>

        <section className="surface p-md space-y-md">
          <h3 className="text-card-title">Intensidade</h3>
          <p className="text-body-sm text-fg-muted -mt-2">Como o TOM cobra você. Não muda o que cobra, muda como.</p>

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
                      ? 'border-brand bg-brand/10 text-fg'
                      : 'border-border bg-bg-subtle text-fg-secondary hover:text-fg',
                  ].join(' ')}
                >
                  <div className={['text-body-md font-semibold', active ? 'text-brand' : ''].join(' ')}>{i.label}</div>
                  <div className="text-body-sm text-fg-muted leading-tight">{i.hint}</div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="surface p-md space-y-md">
          <h3 className="text-card-title">Notificações</h3>

          <Toggle
            label="Alertas de prazo (D-1)"
            hint="Te avisa um dia antes de vencer"
            value={form.notify_deadline_alerts}
            onChange={v => setForm({ ...form, notify_deadline_alerts: v })}
          />
          <Toggle
            label="Alertas de atraso"
            hint="Cobra quando passou do prazo"
            value={form.notify_overdue_alerts}
            onChange={v => setForm({ ...form, notify_overdue_alerts: v })}
          />
        </section>

        <div className="flex items-center gap-md">
          <Button type="submit" leadingIcon={<Save size={18} />} loading={save.isPending}>Salvar</Button>
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="text-body-sm text-success">✓ Salvo</span>
          )}
          {save.error && (
            <span className="text-body-sm text-danger">{(save.error as Error).message}</span>
          )}
        </div>
      </form>

      {/* Local utility class for inputs/selects — applied via :where() to avoid Tailwind layer noise */}
      <style>{`
        .input {
          width: 100%; height: 44px; padding: 0 12px;
          background: rgb(var(--bg-elevated));
          border: 1px solid rgb(var(--border));
          color: rgb(var(--fg-primary));
          border-radius: 10px;
          font: inherit;
        }
        .input:focus { outline: none; box-shadow: 0 0 0 2px rgb(var(--bg-app)), 0 0 0 4px #E91451; }
      `}</style>
    </div>
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
          value ? 'bg-brand' : 'bg-bg-elevated border border-border',
        ].join(' ')}
      >
        <span
          aria-hidden
          className={[
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform',
            value ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  );
}
