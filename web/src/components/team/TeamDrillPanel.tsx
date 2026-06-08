// web/src/components/team/TeamDrillPanel.tsx
// Painel master-detail (lado direito) do CEO desktop (Fase 2 — Task 6).
// Selecionou um líder → mostra o scorecard dele no topo + a lista do time dele
// (membersOf), cada liderado com atrasos (overdueByPerson) e eventos do dia
// (eventsByCollab), levando ao drill da pessoa (/time/:id).
// Sem líder selecionado → estado vazio convidando a escolher um na esquerda.
import { Link } from 'react-router-dom';
import { Users, AlertTriangle, CalendarClock, ChevronRight } from 'lucide-react';
import type { TeamSnapshot, TeamCollab } from '../../lib/team-snapshot';
import type { LeaderScorecard } from '../../hooks/useLeaderScorecards';
import { membersOf } from '../../lib/team-routing';
import { classifyScorecard, BUCKET_META } from '../../lib/scorecard-classify';
import { EmptyState } from '../EmptyState';

interface Props {
  leaderId: string | null;
  allCollabs: TeamCollab[];
  snapshot: TeamSnapshot;
  scorecards: LeaderScorecard[];
}

const firstName = (c: TeamCollab) =>
  (c.preferred_name || c.full_name || '').split(' ')[0] || c.id.slice(0, 6);

export function TeamDrillPanel({ leaderId, allCollabs, snapshot, scorecards }: Props) {
  if (!leaderId) {
    return (
      <aside className="surface p-md h-full grid place-items-center">
        <EmptyState
          icon={<Users size={28} />}
          title="Nenhum líder selecionado"
          description="Selecione um líder à esquerda pra abrir o time dele."
        />
      </aside>
    );
  }

  const leader = allCollabs.find(c => c.id === leaderId) ?? null;
  if (!leader) {
    return (
      <aside className="surface p-md h-full grid place-items-center">
        <EmptyState title="Líder não encontrado" description="O scorecard não bate com um colaborador ativo." />
      </aside>
    );
  }

  const sc = scorecards.find(s => s.leader_id === leaderId) ?? null;
  // membersOf devolve Collab (tipo do routing, sem full_name); remapeia pros
  // TeamCollab originais de allCollabs pra ter nome/preferred_name na UI.
  const memberIds = new Set(membersOf(leader, allCollabs).map(c => c.id));
  const members = allCollabs.filter(c => memberIds.has(c.id));

  const overdueOf = (id: string) =>
    snapshot.overdueByPerson.find(o => o.assigned_to === id)?.count ?? 0;
  const eventsOf = (id: string) => snapshot.eventsByCollab[id] ?? 0;

  // Mais "quente" no topo: ordena por atrasos desc.
  const sortedMembers = [...members].sort((a, b) => overdueOf(b.id) - overdueOf(a.id));

  return (
    <aside className="surface p-md h-full overflow-y-auto space-y-md">
      {/* Cabeçalho — scorecard do próprio líder */}
      <header className="space-y-2">
        <div className="flex items-center gap-md">
          {sc && (
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: BUCKET_META[classifyScorecard(sc)].dot }}
              aria-hidden
            />
          )}
          <h3 className="text-card-title text-fg truncate">{firstName(leader)}</h3>
          <span className="text-body-sm text-fg-muted truncate">
            · {leader.role}
            {leader.function_role ? ` · ${leader.function_role}` : ''}
          </span>
        </div>

        {sc ? (
          <div className="flex flex-wrap items-center gap-x-md gap-y-1 text-body-sm">
            <span className="tabular-nums">
              <span className="text-fg font-semibold">{Math.round((sc.closure_rate ?? 0) * 100)}%</span>
              <span className="text-fg-muted"> fechamento</span>
            </span>
            <span className="tabular-nums">
              <span className={sc.tasks_overdue ? 'text-danger font-semibold' : 'text-fg-muted'}>
                {sc.tasks_overdue}
              </span>
              <span className="text-fg-muted"> atrasadas</span>
            </span>
            {sc.tasks_stuck > 0 && (
              <span className="tabular-nums">
                <span className="text-warning font-semibold">{sc.tasks_stuck}</span>
                <span className="text-fg-muted"> travadas</span>
              </span>
            )}
          </div>
        ) : (
          <p className="text-body-sm text-fg-muted">Sem scorecard desta semana pra este líder.</p>
        )}

        {sc?.insights && (
          <p className="rounded-md border border-tom/30 bg-tom/10 px-3 py-2 text-body-sm text-fg-secondary">
            {sc.insights}
          </p>
        )}
      </header>

      {/* Lista do time dele */}
      <div className="space-y-2">
        <div className="text-label uppercase tracking-wide text-fg-muted">
          Time · {members.length}
        </div>

        {members.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Ninguém é liderado por essa pessoa hoje.</p>
        ) : (
          <ul className="space-y-1.5">
            {sortedMembers.map(m => {
              const overdue = overdueOf(m.id);
              const events = eventsOf(m.id);
              return (
                <li key={m.id}>
                  <Link
                    to={`/time/${m.id}`}
                    className="flex items-center gap-md rounded-md border border-border bg-bg-surface px-3 py-2 hover:bg-bg-elevated transition-colors focus-ring"
                  >
                    <span className="font-medium text-fg shrink-0 truncate">{firstName(m)}</span>
                    <span className="flex items-center gap-md text-body-sm ml-auto shrink-0">
                      {overdue > 0 && (
                        <span className="inline-flex items-center gap-1 text-danger tabular-nums">
                          <AlertTriangle size={13} /> {overdue}
                        </span>
                      )}
                      {events > 0 && (
                        <span className="inline-flex items-center gap-1 text-tom tabular-nums">
                          <CalendarClock size={13} /> {events}
                        </span>
                      )}
                      {overdue === 0 && events === 0 && <span className="text-fg-muted">—</span>}
                      <ChevronRight size={15} className="text-fg-muted" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
