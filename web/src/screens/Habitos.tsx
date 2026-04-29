// Sprint 11 Bloco C — tela de hábitos.
// Sprint 11 F2+ / Sessão B — adiciona Heatmap (agregado 30d) + StreakRing por hábito.
// Mostra ritmo geral do user (heatmap) + aderência individual (ring colorido).
// Privacy: só o próprio user vê seus hábitos (RLS via collaborator_id).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { StreakRing } from '../components/StreakRing';
import { HabitsHeatmap } from '../components/HabitsHeatmap';

type Habit = {
  id: string;
  name: string;
  icon: string | null;
  current_streak: number | null;
  best_streak: number | null;
  is_active: boolean;
};

type HabitWithLog = Habit & {
  done_today: boolean;
  /** Bool array dos últimos 30 dias, index 0 = hoje, 29 = 30 dias atrás. */
  last30: boolean[];
  /** Aderência 0..1 dos últimos 30d (count_done / 30). */
  adherence30: number;
};

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
    .select('id, name, icon, current_streak, best_streak, is_active')
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
    .select('habit_id, log_date, is_completed')
    .in('habit_id', ids)
    .gte('log_date', sinceYmd);

  // Index logs por habit_id+log_date pra lookup O(1).
  const doneSet = new Set<string>();
  for (const l of (logs || [])) {
    if (l.is_completed) doneSet.add(`${l.habit_id}|${l.log_date}`);
  }

  const today = days[0];
  const habitsAug: HabitWithLog[] = list.map(h => {
    const last30 = days.map(ymd => doneSet.has(`${h.id}|${ymd}`));
    const doneCount = last30.filter(Boolean).length;
    return {
      ...h,
      done_today: doneSet.has(`${h.id}|${today}`),
      last30,
      adherence30: doneCount / WINDOW_DAYS,
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
    const { error } = await supabase
      .from('habit_logs')
      .insert({
        habit_id: habit.id,
        collaborator_id: collabId,
        log_date: today,
        is_completed: newDone,
        completed_at: newDone ? new Date().toISOString() : null,
        source: 'manual',
      });
    if (error) throw error;
  }
}

export function Habitos() {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const collabId = collaborator?.id;

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
          description="Crie pelo TOM no WhatsApp: 'criar hábito academia' ou 'novo hábito leitura'"
        />
      ) : (
        <>
          {/* Heatmap agregado — visão de ritmo do mês. */}
          <HabitsHeatmap days={heatmap} />

          {/* Lista de hábitos com StreakRing à esquerda + checkbox direita. */}
          <ul className="surface divide-y divide-border">
            {habits.map(h => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => toggle.mutate(h)}
                  disabled={toggle.isPending}
                  className="w-full flex items-center gap-md p-md hover:bg-bg-elevated focus-ring text-left"
                >
                  <StreakRing
                    adherence={h.adherence30}
                    streak={h.current_streak}
                  />
                  <div className="min-w-0 flex-1">
                    <div className={['text-body-md', h.done_today ? 'line-through text-fg-muted' : ''].join(' ')}>
                      {h.icon ? `${h.icon} ` : ''}{h.name}
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-body-sm text-fg-muted">
                      <span className="tabular-nums">
                        {Math.round(h.adherence30 * 100)}% nos últimos 30d
                      </span>
                      {(h.best_streak ?? 0) > (h.current_streak ?? 0) && (
                        <span>· recorde: {h.best_streak}</span>
                      )}
                    </div>
                  </div>
                  {/* Checkbox marca done hoje. */}
                  <span
                    className={[
                      'h-7 w-7 shrink-0 rounded-full border grid place-items-center transition-colors',
                      h.done_today
                        ? 'bg-success border-success text-white'
                        : 'border-border text-transparent',
                    ].join(' ')}
                    aria-label={h.done_today ? 'concluído hoje' : 'marcar feito'}
                  >
                    <Check size={16} strokeWidth={3} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="text-body-sm text-fg-muted">
        💡 Hábitos são pessoais. Nem coordenador nem diretor enxergam.
      </p>
    </div>
  );
}
