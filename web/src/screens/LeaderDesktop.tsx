// web/src/screens/LeaderDesktop.tsx
// View do LÍDER no desktop (Fase 3 — multi-tenant). Escopo travado: só o time
// dele, só trabalho. Diferente do CEO (que vê o semáforo de TODOS os líderes):
//   topo  = KPIs honestos escopados (CeoKpiStrip lê do snapshot já filtrado)
//   esq.  = "Precisa de você hoje" + fila do time (MyTeamQueue)
//   dir.  = "Você" (scorecard próprio + reconhecimento) + selo da semana
// Líder sem liderados no mapa → empty-state honesto.
// O DesktopShell cuida de altura/scroll/padding — não adicionar fixed/overflow aqui.
import { Users } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { CeoKpiStrip } from '../components/team/CeoKpiStrip';
import { NeedsYouToday } from '../components/team/NeedsYouToday';
import { MyTeamQueue } from '../components/team/MyTeamQueue';
import { YouCard } from '../components/team/YouCard';
import { todaySP, startOfWeekMonday, brShort } from '../utils/date';
import type { TeamSnapshot } from '../lib/team-snapshot';
import type { LeaderScorecard } from '../hooks/useLeaderScorecards';

interface Props {
  snapshot: TeamSnapshot;
  scorecards: LeaderScorecard[];
  weekStart: string | null;
}

export function LeaderDesktop({ snapshot, scorecards, weekStart }: Props) {
  const me = snapshot.allCollabs.find(c => c.id === snapshot.viewerId) ?? null;
  const myName = (me?.preferred_name || me?.full_name || '').split(' ')[0] || 'Você';
  const myScorecard = scorecards.find(s => s.leader_id === snapshot.viewerId) ?? null;

  // Líder sem liderados mapeados (mode 'none' do resolver) → empty-state honesto.
  if (snapshot.team.length === 0) {
    return (
      <div className="space-y-lg">
        <PageHeader title="Time" subtitle="Seu time · só trabalho" backTo="/mais" />
        <EmptyState
          icon={<Users size={32} />}
          title="Você não tem liderados diretos"
          description="O TOM ainda não mapeou um time pra você. Fala com o Alf pra ajustar os papéis (função/unidade)."
        />
        {myScorecard && <YouCard scorecard={myScorecard} name={myName} />}
      </div>
    );
  }

  const currentWeek = startOfWeekMonday(todaySP());
  const showWeekBadge = weekStart != null && weekStart !== currentWeek;

  return (
    <div className="space-y-lg">
      <PageHeader title="Time" subtitle="Seu time · só trabalho" backTo="/mais" />

      <CeoKpiStrip snapshot={snapshot} />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(320px,38%)] gap-md items-start">
        {/* Esquerda — ação do time */}
        <div className="space-y-md min-w-0">
          <NeedsYouToday snapshot={snapshot} scorecards={scorecards} />
          <MyTeamQueue snapshot={snapshot} />
        </div>

        {/* Direita — Você */}
        <div className="space-y-md">
          <YouCard scorecard={myScorecard} name={myName} />
          {showWeekBadge && (
            <div className="text-body-sm text-fg-muted">
              Scorecard da semana de{' '}
              <span className="text-fg-secondary font-medium">{brShort(weekStart)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
