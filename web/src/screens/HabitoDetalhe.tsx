// Sprint 22.54 — Detalhe de hábito.
// - Header: ícone + nome + edit button + frequency/reminder meta
// - StreakRing grande com cor do hábito
// - Heatmap individual dos últimos 90 dias (cor do hábito por intensidade=feito/pulado)
// - Lista dos últimos 30 dias com notes editáveis inline
// - Quick toggle "feito hoje" no topo

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { StreakRing } from '../components/StreakRing';
import { EditHabitSheet } from '../components/EditHabitSheet';
import { RowMenu } from '../components/RowMenu';
import { HabitQuantChart, type HabitQuantPoint } from '../components/HabitQuantChart';

type Habit = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  frequency: 'daily' | 'weekdays' | 'weekly' | 'custom_days';
  custom_days: number[] | null;
  reminder_time: string | null;
  notify_whatsapp: boolean;
  current_streak: number | null;
  best_streak: number | null;
  is_active: boolean;
  habit_type?: 'binary' | 'quantitative' | null;
  target_value?: number | null;
  unit?: string | null;
};

type Log = { id: string; log_date: string; is_completed: boolean; notes: string | null; value?: number | null };

const FREQ_LABEL: Record<Habit['frequency'], string> = {
  daily: 'Todo dia',
  weekdays: 'Seg–Sex',
  weekly: '1x por semana',
  custom_days: 'Dias específicos',
};

const HEATMAP_DAYS = 90;
const LOG_DAYS = 30;

function todayBRT(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = todayBRT();
  const [y, m, d] = today.split('-').map(Number);
  for (let i = 0; i < n; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - i);
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`);
  }
  return out;
}

function brShort(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : ymd;
}

function dowShort(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][dt.getUTCDay()];
}

export function HabitoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['habit-detail', id, collaborator?.id],
    queryFn: async (): Promise<{ habit: Habit; logs: Log[]; reminders: string[] } | null> => {
      if (!id || !collaborator) return null;
      const { data: habit, error: hErr } = await supabase
        .from('habits')
        .select('id, name, icon, color, frequency, custom_days, reminder_time, notify_whatsapp, current_streak, best_streak, is_active, habit_type, target_value, unit')
        .eq('id', id)
        .eq('collaborator_id', collaborator.id)
        .single();
      if (hErr || !habit) throw hErr ?? new Error('not_found');
      const since = lastNDays(HEATMAP_DAYS).slice(-1)[0];
      const [logsRes, remindersRes] = await Promise.all([
        supabase.from('habit_logs')
          .select('id, log_date, is_completed, notes, value')
          .eq('habit_id', id)
          .gte('log_date', since)
          .order('log_date', { ascending: false }),
        supabase.from('habit_reminders')
          .select('time')
          .eq('habit_id', id)
          .eq('is_active', true)
          .order('time', { ascending: true }),
      ]);
      return {
        habit: habit as Habit,
        logs: (logsRes.data ?? []) as Log[],
        reminders: ((remindersRes.data ?? []) as Array<{ time: string }>).map(r => r.time.slice(0, 5)),
      };
    },
    enabled: Boolean(id && collaborator?.id && supabaseConfigured),
  });

  const habit = data?.habit ?? null;
  const logs = useMemo(() => data?.logs ?? [], [data?.logs]);

  const heatmapDays = useMemo(() => {
    const ymds = lastNDays(HEATMAP_DAYS);
    const doneSet = new Set(logs.filter(l => l.is_completed).map(l => l.log_date));
    return ymds.map(ymd => ({ ymd, done: doneSet.has(ymd) }));
  }, [logs]);

  const last30Logs = useMemo(() => {
    const ymds = new Set(lastNDays(LOG_DAYS));
    return logs.filter(l => ymds.has(l.log_date));
  }, [logs]);

  const adherence30 = useMemo(() => {
    const window = lastNDays(30);
    const doneSet = new Set(logs.filter(l => l.is_completed).map(l => l.log_date));
    const done = window.filter(d => doneSet.has(d)).length;
    return done / 30;
  }, [logs]);

  const quantChartData = useMemo<HabitQuantPoint[]>(() => {
    const tgt = Number(habit?.target_value ?? 0);
    const valueByDay = new Map(logs.map(l => [l.log_date, Number(l.value ?? 0)]));
    return lastNDays(14).slice().reverse().map(ymd => {
      const v = valueByDay.get(ymd) ?? 0;
      return { label: brShort(ymd), value: v, hit: tgt > 0 && v >= tgt };
    });
  }, [logs, habit?.target_value]);

  const today = todayBRT();
  const todayLog = logs.find(l => l.log_date === today);
  const doneToday = Boolean(todayLog?.is_completed);

  const isQuant = habit?.habit_type === 'quantitative' && Number(habit?.target_value) > 0;
  const todayValue = Number(todayLog?.value ?? 0);
  const target = Number(habit?.target_value ?? 0);
  const quantPct = isQuant && target > 0 ? Math.min(100, Math.round((todayValue / target) * 100)) : 0;
  const remaining = isQuant ? Math.max(0, target - todayValue) : 0;

  // NOTA: recalc_habit_streak(p_habit_id uuid) CONFIRMADA no banco — mesma RPC do toggle binário.
  const addAmount = useMutation({
    mutationFn: async (delta: number) => {
      if (!habit || !collaborator) return;
      const newValue = Math.max(0, todayValue + delta);
      const isCompleted = newValue >= target;
      if (todayLog) {
        await supabase.from('habit_logs').update({
          value: newValue,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
        }).eq('id', todayLog.id);
      } else {
        await supabase.from('habit_logs').insert({
          habit_id: habit.id,
          collaborator_id: collaborator.id,
          log_date: today,
          value: newValue,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
        });
      }
      await supabase.rpc('recalc_habit_streak', { p_habit_id: habit.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habit-detail', id] });
      qc.invalidateQueries({ queryKey: ['habits'] });
    },
  });

  const toggleToday = useMutation({
    mutationFn: async () => {
      if (!habit || !collaborator) return;
      const newDone = !doneToday;
      if (todayLog) {
        await supabase.from('habit_logs').update({
          is_completed: newDone,
          completed_at: newDone ? new Date().toISOString() : null,
        }).eq('id', todayLog.id);
      } else {
        await supabase.from('habit_logs').insert({
          habit_id: habit.id,
          collaborator_id: collaborator.id,
          log_date: today,
          is_completed: newDone,
          completed_at: newDone ? new Date().toISOString() : null,
        });
      }
      await supabase.rpc('recalc_habit_streak', { p_habit_id: habit.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habit-detail', id] });
      qc.invalidateQueries({ queryKey: ['habits'] });
    },
  });

  // Sprint 22.54b — exclusão soft via RowMenu, navega de volta na hora.
  const remove = useMutation({
    mutationFn: async () => {
      if (!habit || !collaborator) throw new Error('no_habit');
      const { error } = await supabase
        .from('habits')
        .update({ is_active: false })
        .eq('id', habit.id)
        .eq('collaborator_id', collaborator.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits'] });
      qc.removeQueries({ queryKey: ['habit-detail', id] });
      navigate('/habitos');
    },
  });

  const saveNote = useMutation({
    mutationFn: async ({ logId, notes }: { logId: string; notes: string }) => {
      const { error: nErr } = await supabase.from('habit_logs').update({ notes: notes.trim() || null }).eq('id', logId);
      if (nErr) throw nErr;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['habit-detail', id] }),
  });

  if (!supabaseConfigured) return <EmptyState title="Configure Supabase" />;
  if (isLoading) return <LoadingState rows={4} />;
  if (error || !habit) {
    return (
      <div className="space-y-md">
        <button type="button" onClick={() => navigate('/habitos')} className="flex items-center gap-2 text-fg-muted focus-ring">
          <ArrowLeft size={16} /> Voltar
        </button>
        <EmptyState title="Hábito não encontrado" description="Pode ter sido removido ou não pertence a você." />
      </div>
    );
  }

  const color = habit.color || '#10B981';

  return (
    <div className="space-y-lg">
      <button type="button" onClick={() => navigate('/habitos')} className="flex items-center gap-2 text-fg-muted focus-ring">
        <ArrowLeft size={16} /> Voltar
      </button>

      {/* Header */}
      <header className="flex items-start gap-md">
        <span className="text-3xl shrink-0">{habit.icon || '💪'}</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-section-title flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
            {habit.name}
          </h2>
          <p className="text-body-sm text-fg-muted mt-1">
            {FREQ_LABEL[habit.frequency]}
            {(data?.reminders.length ?? 0) > 0 && (
              <> · ⏰ {data!.reminders.join(' · ')}{habit.notify_whatsapp ? ' · WhatsApp' : ''}</>
            )}
          </p>
        </div>
        <RowMenu
          items={[
            { label: 'Editar', onClick: () => setEditOpen(true) },
            {
              label: 'Excluir hábito',
              danger: true,
              confirm: 'Excluir esse hábito? O histórico fica salvo, mas ele some das suas listas.',
              onClick: () => remove.mutate(),
            },
          ]}
        />
      </header>

      {/* Stats: ring + numbers + toggle hoje */}
      <section className="surface p-md flex items-center gap-md">
        <StreakRing adherence={adherence30} streak={habit.current_streak} size={88} stroke={7} color={color}
          progress={isQuant ? Math.min(1, todayValue / target) : undefined} />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="text-body-sm text-fg-muted">Aderência 30 dias</div>
          <div className="text-card-title tabular-nums">{Math.round(adherence30 * 100)}%</div>
          {(habit.best_streak ?? 0) > 0 && (
            <div className="text-body-sm text-fg-muted">
              Recorde: <span className="text-fg tabular-nums">{habit.best_streak}</span> dias
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => toggleToday.mutate()}
          disabled={toggleToday.isPending}
          aria-label={doneToday ? 'desmarcar hoje' : 'marcar feito hoje'}
          className={[
            'h-12 w-12 shrink-0 rounded-full border-2 grid place-items-center transition-colors focus-ring',
            doneToday ? 'border-success bg-success text-white' : 'border-border text-transparent hover:border-tom',
          ].join(' ')}
        >
          <Check size={22} strokeWidth={3} />
        </button>
      </section>

      {/* Progresso do dia — só hábito quantitativo. Barra dedicada (não remapeia o anel). */}
      {isQuant && (
        <section className="surface p-md space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-label uppercase tracking-wide text-fg-muted">Hoje</div>
            <div className="text-body-sm text-fg-muted tabular-nums">
              {todayValue.toLocaleString('pt-BR')} / {target.toLocaleString('pt-BR')} {habit.unit}
            </div>
          </div>
          <div className="h-3 w-full rounded-full bg-bg-elevated overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${quantPct}%`, backgroundColor: color }}
            />
          </div>
          <div className="text-body-sm text-fg-muted tabular-nums">
            {remaining > 0
              ? `Faltam ${remaining.toLocaleString('pt-BR')} ${habit.unit}`
              : '✅ Meta batida hoje!'}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {[
              Math.round(target / 12) || 1,
              Math.round(target / 6) || 1,
              Math.round(target / 4) || 1,
            ].map((step, i) => (
              <button
                key={i}
                type="button"
                onClick={() => addAmount.mutate(step)}
                disabled={addAmount.isPending}
                className="px-3 py-1.5 rounded-full text-body-sm border border-border bg-bg-elevated text-fg hover:border-tom focus-ring tabular-nums"
              >
                +{step.toLocaleString('pt-BR')} {habit.unit}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { const v = prompt('Quanto adicionar?'); const n = v ? parseFloat(v.replace(',', '.')) : NaN; if (n > 0) addAmount.mutate(n); }}
              disabled={addAmount.isPending}
              className="px-3 py-1.5 rounded-full text-body-sm border border-dashed border-border text-fg-muted hover:text-fg focus-ring"
            >
              + outro
            </button>
          </div>
        </section>
      )}

      {/* Histórico quantitativo — valor por dia vs meta (últimos 14 dias). */}
      {isQuant && (
        <section className="surface p-md space-y-2">
          <div className="flex items-baseline justify-between">
            <div className="text-label uppercase tracking-wide text-fg-muted">Últimos 14 dias</div>
            <div className="text-body-sm text-fg-muted">meta {target.toLocaleString('pt-BR')} {habit.unit}</div>
          </div>
          <HabitQuantChart data={quantChartData} target={target} unit={habit.unit || ''} color={color} />
        </section>
      )}

      {/* Heatmap individual — 90 dias, colorido com a cor do hábito. */}
      <section className="surface p-md space-y-2">
        <div className="text-label uppercase tracking-wide text-fg-muted">Últimos {HEATMAP_DAYS} dias</div>
        <div className="grid grid-cols-[repeat(15,1fr)] gap-1">
          {heatmapDays.slice().reverse().map(d => (
            <div
              key={d.ymd}
              title={`${dowShort(d.ymd)} ${brShort(d.ymd)} — ${d.done ? 'feito' : 'pulou'}`}
              className="aspect-square rounded-sm"
              style={{
                backgroundColor: d.done ? color : 'rgb(var(--bg-elevated))',
                opacity: d.done ? 1 : 0.4,
              }}
            />
          ))}
        </div>
      </section>

      {/* Lista de logs com notes editáveis. */}
      <section className="space-y-sm">
        <div className="text-label uppercase tracking-wide text-fg-muted px-1">Histórico recente</div>
        {last30Logs.length === 0 ? (
          <div className="surface p-md text-body-sm text-fg-muted">
            Nenhum registro nos últimos {LOG_DAYS} dias. Marque feito hoje pra começar.
          </div>
        ) : (
          <ul className="surface divide-y divide-border">
            {last30Logs.map(l => {
              const isDraft = draftNotes[l.id] !== undefined;
              const noteValue = isDraft ? draftNotes[l.id] : (l.notes ?? '');
              return (
                <li key={l.id} className="p-md space-y-2">
                  <div className="flex items-center gap-md">
                    <span
                      aria-hidden
                      className={[
                        'h-5 w-5 shrink-0 rounded-full border grid place-items-center',
                        l.is_completed ? 'bg-success border-success text-white' : 'border-border',
                      ].join(' ')}
                    >
                      {l.is_completed && <Check size={12} strokeWidth={3} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-body-md tabular-nums">
                        {dowShort(l.log_date)} {brShort(l.log_date)}
                      </div>
                      <div className="text-body-sm text-fg-muted">
                        {l.is_completed ? 'feito' : 'pulou'}
                      </div>
                    </div>
                  </div>
                  <div>
                    <textarea
                      value={noteValue}
                      onChange={e => setDraftNotes(prev => ({ ...prev, [l.id]: e.target.value }))}
                      onBlur={() => {
                        if (isDraft && noteValue !== (l.notes ?? '')) {
                          saveNote.mutate({ logId: l.id, notes: noteValue });
                        }
                        setDraftNotes(prev => {
                          const next = { ...prev };
                          delete next[l.id];
                          return next;
                        });
                      }}
                      placeholder="Anotação opcional…"
                      maxLength={500}
                      rows={2}
                      className="w-full px-3 py-2 rounded-md bg-bg-elevated border border-border text-body-sm text-fg placeholder:text-fg-muted focus-ring resize-none"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <EditHabitSheet
        open={editOpen}
        habit={editOpen ? habit : null}
        onClose={() => setEditOpen(false)}
      />
    </div>
  );
}
