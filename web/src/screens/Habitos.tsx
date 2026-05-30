// Sprint 11 Bloco C — tela de hábitos.
// Sprint 11 F2+ / Sessão B — adiciona Heatmap (agregado 30d) + StreakRing por hábito.
// Mostra ritmo geral do user (heatmap) + aderência individual (ring colorido).
// Privacy: só o próprio user vê seus hábitos (RLS via collaborator_id).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { StreakRing } from '../components/StreakRing';
import { HabitsHeatmap } from '../components/HabitsHeatmap';
import { Fab } from '../components/Fab';
import { EditHabitSheet } from '../components/EditHabitSheet';

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

type HabitWithLog = Habit & {
  done_today: boolean;
  /** Bool array dos últimos 30 dias, index 0 = hoje, 29 = 30 dias atrás. */
  last30: boolean[];
  /** Sprint 22.54 — aderência 0..1 frequency-aware (denominador = dias esperados na janela). */
  adherence30: number;
  /** Valor acumulado de hoje (hábito quantitativo); 0 se binário ou sem log. */
  today_value: number;
};

// Sprint 22.54 — quantos dias na janela seriam ESPERADOS pra esse hábito.
function expectedDaysForHabit(h: Habit, days: string[]): number {
  if (h.frequency === 'daily') return days.length;
  const dows = days.map(ymd => {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12));
    const dow = dt.getUTCDay(); // 0=dom..6=sab
    return dow === 0 ? 7 : dow; // 1=seg..7=dom
  });
  if (h.frequency === 'weekdays') return dows.filter(d => d >= 1 && d <= 5).length;
  // weekly e custom_days usam custom_days. weekly sem custom_days → 1x/semana = janela/7.
  const cd = Array.isArray(h.custom_days) ? h.custom_days.map(Number) : [];
  if (cd.length === 0) {
    return h.frequency === 'weekly' ? Math.max(1, Math.round(days.length / 7)) : days.length;
  }
  return dows.filter(d => cd.includes(d)).length;
}

type HabitsData = {
  habits: HabitWithLog[];
  /** Heatmap agregado: 1 entry por dia dos últimos 30. */
  heatmap: { ymd: string; count: number; total: number }[];
};

const WINDOW_DAYS = 30;

function todayBRT(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// Gera lista de YMDs dos últimos N dias, do mais recente (index 0) ao mais antigo.
function lastNDaysYmd(n: number): string[] {
  const out: string[] = [];
  const today = todayBRT();
  const [y, m, d] = today.split('-').map(Number);
  for (let i = 0; i < n; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - i);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    out.push(`${yy}-${mm}-${dd}`);
  }
  return out;
}

async function fetchHabits(collabId: string): Promise<HabitsData> {
  const { data: habits, error } = await supabase
    .from('habits')
    .select('id, name, icon, color, frequency, custom_days, reminder_time, notify_whatsapp, current_streak, best_streak, is_active, habit_type, target_value, unit')
    .eq('collaborator_id', collabId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const list = (habits || []) as Habit[];
  if (list.length === 0) return { habits: [], heatmap: [] };

  const ids = list.map(h => h.id);
  const days = lastNDaysYmd(WINDOW_DAYS); // [hoje, ontem, ..., 29 dias atrás]
  const sinceYmd = days[days.length - 1];

  const { data: logs } = await supabase
    .from('habit_logs')
    .select('habit_id, log_date, is_completed, value')
    .in('habit_id', ids)
    .gte('log_date', sinceYmd);

  // Index logs por habit_id+log_date pra lookup O(1).
  const doneSet = new Set<string>();
  for (const l of (logs || [])) {
    if (l.is_completed) doneSet.add(`${l.habit_id}|${l.log_date}`);
  }

  const today = days[0];
  const todayValueByHabit = new Map<string, number>();
  for (const l of (logs || [])) {
    if (l.log_date === today && l.value != null) todayValueByHabit.set(l.habit_id, Number(l.value));
  }
  const habitsAug: HabitWithLog[] = list.map(h => {
    const last30 = days.map(ymd => doneSet.has(`${h.id}|${ymd}`));
    const doneCount = last30.filter(Boolean).length;
    // Sprint 22.54 — denominador = dias ESPERADOS na janela (frequency-aware).
    const expected = Math.max(1, expectedDaysForHabit(h, days));
    const adherence = Math.min(1, doneCount / expected);
    return {
      ...h,
      done_today: doneSet.has(`${h.id}|${today}`),
      last30,
      adherence30: adherence,
      today_value: todayValueByHabit.get(h.id) ?? 0,
    };
  });

  // Heatmap agregado: para cada dia, count de hábitos done / total ativos.
  const heatmap = days.map(ymd => {
    let count = 0;
    for (const h of list) {
      if (doneSet.has(`${h.id}|${ymd}`)) count++;
    }
    return { ymd, count, total: list.length };
  });

  return { habits: habitsAug, heatmap };
}

async function toggleHabit(habit: HabitWithLog, collabId: string) {
  const today = todayBRT();
  const newDone = !habit.done_today;
  // Upsert: SELECT-then-UPDATE/INSERT (compatível com schema atual sem unique constraint).
  const { data: existing } = await supabase
    .from('habit_logs')
    .select('id')
    .eq('habit_id', habit.id)
    .eq('log_date', today)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from('habit_logs')
      .update({
        is_completed: newDone,
        completed_at: newDone ? new Date().toISOString() : null,
      })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    // Sprint 21.8.1 — habit_logs não tem coluna `source` no schema. Remover do INSERT.
    const { error } = await supabase
      .from('habit_logs')
      .insert({
        habit_id: habit.id,
        collaborator_id: collabId,
        log_date: today,
        is_completed: newDone,
        completed_at: newDone ? new Date().toISOString() : null,
      });
    if (error) throw error;
  }
  // Sprint 22.52 — RPC recalcula streak no servidor (espelha engine.js calcHabitStreak).
  const { error: rpcErr } = await supabase.rpc('recalc_habit_streak', { p_habit_id: habit.id });
  if (rpcErr) console.warn('[Habitos] recalc_habit_streak err:', rpcErr.message);
}

export function Habitos() {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const collabId = collaborator?.id;
  // Sprint 22.53 — CRUD inline.
  const [sheetOpen, setSheetOpen] = useState(false);
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['habits', collabId],
    queryFn: () => collabId ? fetchHabits(collabId) : Promise.resolve({ habits: [], heatmap: [] } as HabitsData),
    enabled: Boolean(collabId && supabaseConfigured),
  });

  const habits = data?.habits ?? [];
  const heatmap = data?.heatmap ?? [];

  const toggle = useMutation({
    mutationFn: (h: HabitWithLog) => toggleHabit(h, collabId!),
    onMutate: async (h) => {
      await qc.cancelQueries({ queryKey: ['habits', collabId] });
      const prev = qc.getQueryData<HabitsData>(['habits', collabId]);
      qc.setQueryData<HabitsData>(['habits', collabId], (old) => {
        if (!old) return old;
        return {
          ...old,
          habits: old.habits.map(x => x.id === h.id ? { ...x, done_today: !x.done_today } : x),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['habits', collabId], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['habits', collabId] });
    },
  });

  return (
    <div className="space-y-lg">
      <header>
        <h2 className="text-section-title">Hábitos</h2>
        <p className="text-body-sm text-fg-muted mt-1">
          Privado · só você vê. Marque o que fez hoje.
        </p>
      </header>

      {!supabaseConfigured ? (
        <EmptyState icon={<Sparkles size={32} />} title="Configure Supabase" />
      ) : isLoading ? (
        <LoadingState rows={3} />
      ) : error ? (
        <EmptyState title="Erro" description={(error as Error).message} />
      ) : habits.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={32} />}
          title="Nenhum hábito ativo"
          description="Toque no + abaixo pra criar seu primeiro hábito. Ou peça pro TOM no WhatsApp."
        />
      ) : (
        <>
          {/* Heatmap agregado — visão de ritmo do mês. */}
          <HabitsHeatmap days={heatmap} />

          {/* Lista de hábitos. Tap no corpo abre EditHabitSheet; tap no check toggle done. */}
          <ul className="surface divide-y divide-border">
            {habits.map(h => (
              <li key={h.id} className="flex items-center gap-md p-md hover:bg-bg-elevated">
                <button
                  type="button"
                  onClick={() => navigate(`/habitos/${h.id}`)}
                  className="flex items-center gap-md flex-1 min-w-0 text-left focus-ring rounded-sm"
                >
                  <StreakRing
                    adherence={h.adherence30}
                    streak={h.current_streak}
                    color={h.color}
                  />
                  <div className="min-w-0 flex-1">
                    <div className={['text-body-md flex items-center gap-2', h.done_today ? 'line-through text-fg-muted' : ''].join(' ')}>
                      {h.color && (
                        <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: h.color }} />
                      )}
                      <span>{h.icon ? `${h.icon} ` : ''}{h.name}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-body-sm text-fg-muted">
                      <span className="tabular-nums">
                        {Math.round(h.adherence30 * 100)}% nos últimos 30d
                      </span>
                      {h.reminder_time && (
                        <span>· ⏰ {h.reminder_time.slice(0, 5)}</span>
                      )}
                      {(h.best_streak ?? 0) > (h.current_streak ?? 0) && (
                        <span>· recorde: {h.best_streak}</span>
                      )}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggle.mutate(h); }}
                  disabled={toggle.isPending}
                  aria-label={h.done_today ? 'desmarcar feito hoje' : 'marcar feito hoje'}
                  className={[
                    'h-9 w-9 shrink-0 rounded-full border grid place-items-center transition-colors focus-ring',
                    h.done_today
                      ? 'bg-success border-success text-white'
                      : 'border-border text-transparent hover:border-tom',
                  ].join(' ')}
                >
                  <Check size={18} strokeWidth={3} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Fab onClick={() => setSheetOpen(true)} label="Novo hábito" ariaLabel="Criar novo hábito" />
      <EditHabitSheet
        open={sheetOpen}
        habit={null}
        onClose={() => setSheetOpen(false)}
      />

      <p className="text-body-sm text-fg-muted">
        💡 Hábitos são pessoais. Nem coordenador nem diretor enxergam.
      </p>
    </div>
  );
}
