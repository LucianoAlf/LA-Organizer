// web/src/screens/DashboardTimeDesktop.tsx
// CEO desktop da /time (Fase 2 — Task 6). Master-detail:
//   topo  = KPIs honestos (CeoKpiStrip)
//   esq.  = "Precisa de você hoje" (NeedsYouToday) + semáforo de líderes (LeaderSemaphore)
//   dir.  = drill do líder selecionado → time → pessoa (TeamDrillPanel)
// O DesktopShell já cuida de altura/scroll/padding — NÃO adicionar fixed/overflow/px-* aqui.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { supabaseConfigured } from '../lib/supabase';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { fetchMyTeamSnapshot } from '../lib/team-snapshot';
import { useLeaderScorecards } from '../hooks/useLeaderScorecards';
import { CeoKpiStrip } from '../components/team/CeoKpiStrip';
import { NeedsYouToday } from '../components/team/NeedsYouToday';
import { LeaderSemaphore } from '../components/team/LeaderSemaphore';
import { TeamDrillPanel } from '../components/team/TeamDrillPanel';
import { LeaderDesktop } from './LeaderDesktop';
import { membersOf } from '../lib/team-routing';
import { todaySP, startOfWeekMonday, brShort } from '../utils/date';

export function DashboardTimeDesktop() {
  const [sel, setSel] = useState<string | null>(null);

  const {
    data: snapshot,
    isLoading: snapLoading,
    error: snapError,
  } = useQuery({
    queryKey: ['team-snapshot'],
    queryFn: fetchMyTeamSnapshot,
    enabled: supabaseConfigured,
  });

  const { data: scData, isLoading: scLoading } = useLeaderScorecards();
  const scorecards = scData?.rows ?? [];
  const weekStart = scData?.weekStart ?? null;

  if (!supabaseConfigured) {
    return <EmptyState icon={<Users size={32} />} title="Configure Supabase" />;
  }
  if (snapLoading || scLoading) return <LoadingState rows={5} />;
  if (snapError) return <EmptyState title="Erro" description={(snapError as Error).message} />;
  if (!snapshot) return null;

  // Multi-tenant (Fase 3): só o CEO vê o semáforo de TODOS os líderes + drill.
  // Líder (ou diretor com time) vê a view escopada ao próprio time.
  if (!snapshot.isCeo) {
    return <LeaderDesktop snapshot={snapshot} scorecards={scorecards} weekStart={weekStart} />;
  }

  // Semáforo = só LÍDERES DE VERDADE (têm time). Tira "líder-fantasma":
  // Rafinha/Hugo/Ana/Admin/Anne têm scorecard mas não lideram ninguém ativo →
  // reportam direto ao CEO, não entram no semáforo de líderes (organograma 08/06).
  const leaderScorecards = scorecards.filter(sc => {
    const lc = snapshot.allCollabs.find(c => c.id === sc.leader_id);
    return !!lc && membersOf(lc, snapshot.allCollabs).length > 0;
  });

  // Selo de semana: só aparece se o scorecard não for da semana corrente
  // (cron de segunda ainda não rodou → mostra a última fechada, honestamente).
  const currentWeek = startOfWeekMonday(todaySP());
  const showWeekBadge = weekStart != null && weekStart !== currentWeek;

  return (
    <div className="space-y-lg">
      <PageHeader title="Time" subtitle="Visão de coordenação · só dados de trabalho" backTo="/mais" />

      <CeoKpiStrip snapshot={snapshot} />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(360px,42%)] gap-md items-start">
        {/* Master — esquerda */}
        <div className="space-y-md min-w-0">
          <NeedsYouToday snapshot={snapshot} scorecards={leaderScorecards} />

          {showWeekBadge && (
            <div className="text-body-sm text-fg-muted">
              Scorecards da semana de <span className="text-fg-secondary font-medium">{brShort(weekStart)}</span>
            </div>
          )}

          <LeaderSemaphore scorecards={leaderScorecards} selected={sel} onSelect={setSel} />
        </div>

        {/* Detail — direita */}
        <TeamDrillPanel
          leaderId={sel}
          allCollabs={snapshot.allCollabs}
          snapshot={snapshot}
          scorecards={leaderScorecards}
        />
      </div>
    </div>
  );
}
