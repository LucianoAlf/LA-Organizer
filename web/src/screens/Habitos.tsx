// Sprint 11 Bloco C — tela de hábitos.
// Lista hábitos ativos do colaborador, mostra streak, permite marcar "fiz hoje"
// com optimistic update + upsert em habit_logs. Privacy: só o próprio user
// vê seus hábitos (RLS já garante via collaborator_id).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';

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
};

function todayBRT(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function fetchHabits(collabId: string): Promise<HabitWithLog[]> {
  const { data: habits, error } = await supabase
    .from('habits')
    .select('id, name, icon, current_streak, best_streak, is_active')
    .eq('collaborator_id', collabId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const list = (habits || []) as Habit[];
  if (list.length === 0) return [];
  const today = todayBRT();
  const ids = list.map(h => h.id);
  const { data: logs } = await supabase
    .from('habit_logs')
    .select('habit_id, is_completed')
    .in('habit_id', ids)
    .eq('log_date', today);
  const doneSet = new Set((logs || []).filter(l => l.is_completed).map(l => l.habit_id));
  return list.map(h => ({ ...h, done_today: doneSet.has(h.id) }));
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

  const { data: habits = [], isLoading, error } = useQuery({
    queryKey: ['habits', collabId],
    queryFn: () => collabId ? fetchHabits(collabId) : Promise.resolve([]),
    enabled: Boolean(collabId && supabaseConfigured),
  });

  const toggle = useMutation({
    mutationFn: (h: HabitWithLog) => toggleHabit(h, collabId!),
    onMutate: async (h) => {
      await qc.cancelQueries({ queryKey: ['habits', collabId] });
      const prev = qc.getQueryData<HabitWithLog[]>(['habits', collabId]);
      qc.setQueryData<HabitWithLog[]>(['habits', collabId], (old) =>
        (old || []).map(x => x.id === h.id ? { ...x, done_today: !x.done_today } : x),
      );
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
        <ul className="surface divide-y divide-border">
          {habits.map(h => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => toggle.mutate(h)}
                disabled={toggle.isPending}
                className="w-full flex items-center gap-md p-md hover:bg-bg-elevated focus-ring text-left"
              >
                <span
                  className={[
                    'h-7 w-7 shrink-0 rounded-full border grid place-items-center transition-colors',
                    h.done_today
                      ? 'bg-success border-success text-white'
                      : 'border-border text-transparent',
                  ].join(' ')}
                  aria-hidden
                >
                  <Check size={16} strokeWidth={3} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className={['text-body-md', h.done_today ? 'line-through text-fg-muted' : ''].join(' ')}>
                    {h.icon ? `${h.icon} ` : ''}{h.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-body-sm text-fg-muted">
                    {(h.current_streak ?? 0) > 0 && (
                      <span aria-label={`streak atual ${h.current_streak} dias`}>
                        🔥 {h.current_streak} {h.current_streak === 1 ? 'dia' : 'dias'}
                      </span>
                    )}
                    {(h.best_streak ?? 0) > (h.current_streak ?? 0) && (
                      <span className="text-fg-muted">recorde: {h.best_streak}</span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-body-sm text-fg-muted">
        💡 Hábitos são pessoais. Nem coordenador nem diretor enxergam.
      </p>
    </div>
  );
}
