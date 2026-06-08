// web/src/components/team/CeoKpiStrip.tsx
// Faixa de 5 KPIs honestos do topo do CEO desktop (Fase 2 — Task 6).
// Reusa StatCard; cada card é clicável (envolto em <button>) — onSelect é opcional
// e fica preparado pra filtro no futuro (v1: só visual, sem filtragem).
import { StatCard } from '../StatCard';
import type { TeamSnapshot } from '../../lib/team-snapshot';

export type KpiKey = 'team' | 'completed' | 'due' | 'overdue' | 'events';

interface Props {
  snapshot: TeamSnapshot;
  onSelect?: (key: KpiKey) => void;
}

export function CeoKpiStrip({ snapshot, onSelect }: Props) {
  const { team, completedToday, dueToday, overdueCount, events } = snapshot;

  const kpis: Array<{
    key: KpiKey;
    label: string;
    value: number;
    tone: 'neutral' | 'tom' | 'success' | 'danger';
  }> = [
    { key: 'team', label: 'No time', value: team.length, tone: 'neutral' },
    { key: 'completed', label: 'Concluídas', value: completedToday, tone: completedToday ? 'success' : 'neutral' },
    { key: 'due', label: 'Pra hoje', value: dueToday, tone: dueToday ? 'tom' : 'neutral' },
    { key: 'overdue', label: 'Atrasadas', value: overdueCount, tone: overdueCount ? 'danger' : 'neutral' },
    { key: 'events', label: 'Compromissos', value: events.length, tone: events.length ? 'tom' : 'neutral' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-sm">
      {kpis.map(k => (
        <button
          key={k.key}
          type="button"
          onClick={() => onSelect?.(k.key)}
          className="text-left rounded-md focus-ring transition-transform hover:-translate-y-0.5"
        >
          <StatCard label={k.label} value={k.value} tone={k.tone} className="h-full" />
        </button>
      ))}
    </div>
  );
}
