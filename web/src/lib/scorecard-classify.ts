// web/src/lib/scorecard-classify.ts
// PORT de src/services/scorecard-builder.js:202-209 — MESMA regra do digest do TOM.
//   🔴 Atenção: closure < 0.60 OU 3+ atrasadas OU 2+ travadas (precisa ter tarefas)
//   🟡 Olhar:   closure < 0.85 OU 1+ atrasadas (precisa ter tarefas)
//   🟢 Ritmo:   todos os demais (incluindo sem tarefas registradas)

export interface ScoreLite {
  closure_rate: number;
  tasks_closed: number;
  tasks_overdue: number;
  tasks_stuck: number;
}

export type ScoreBucket = 'atencao' | 'olhar' | 'ritmo';

export function classifyScorecard(sc: ScoreLite): ScoreBucket {
  const hasNoTasks = sc.tasks_closed === 0 && sc.tasks_overdue === 0 && sc.tasks_stuck === 0;
  if (!hasNoTasks && (sc.closure_rate < 0.60 || sc.tasks_overdue >= 3 || sc.tasks_stuck >= 2)) return 'atencao';
  if (!hasNoTasks && (sc.closure_rate < 0.85 || sc.tasks_overdue >= 1)) return 'olhar';
  return 'ritmo';
}

export const BUCKET_META: Record<ScoreBucket, { dot: string; label: string }> = {
  atencao: { dot: '#ef5b5b', label: 'Atenção' },
  olhar: { dot: '#f5a623', label: 'Olhar de perto' },
  ritmo: { dot: '#3ECF8E', label: 'No ritmo' },
};
