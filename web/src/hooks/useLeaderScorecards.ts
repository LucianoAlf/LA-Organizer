// web/src/hooks/useLeaderScorecards.ts
// Lê a ÚLTIMA semana disponível de leader_scorecards (RLS libera p/ director) +
// junta o nome do líder. Se a semana corrente ainda não foi gerada pelo cron,
// mostra a última fechada (o consumidor exibe o selo "semana de DD/MM").
import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../lib/supabase';

export interface LeaderScorecard {
  leader_id: string;
  week_start: string;
  closure_rate: number | null;
  tasks_closed: number;
  tasks_overdue: number;
  tasks_stuck: number;
  top_bottlenecks: { category: string; count: number }[] | null;
  insights: string | null;
  delta_vs_prev: Record<string, unknown> | null;
  leader: {
    id: string; full_name: string; preferred_name: string | null;
    role: string; function_role: string | null;
  } | null;
}

export function useLeaderScorecards() {
  return useQuery({
    queryKey: ['leader-scorecards'],
    enabled: supabaseConfigured,
    queryFn: async (): Promise<{ weekStart: string | null; rows: LeaderScorecard[] }> => {
      const { data: latest } = await supabase
        .from('leader_scorecards').select('week_start')
        .order('week_start', { ascending: false }).limit(1).maybeSingle();
      if (!latest?.week_start) return { weekStart: null, rows: [] };
      const { data, error } = await supabase
        .from('leader_scorecards')
        .select('leader_id, week_start, closure_rate, tasks_closed, tasks_overdue, tasks_stuck, top_bottlenecks, insights, delta_vs_prev, leader:collaborators!leader_id(id, full_name, preferred_name, role, function_role)')
        .eq('week_start', latest.week_start);
      if (error) throw error;
      return { weekStart: latest.week_start, rows: (data ?? []) as unknown as LeaderScorecard[] };
    },
  });
}
