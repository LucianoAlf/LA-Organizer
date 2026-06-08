// web/src/components/team/MyTeamQueue.tsx
// Lista do time do líder (Fase 3 — view do líder). Sempre visível (não é drill):
// cada liderado com atrasos (overdueByPerson) e eventos do dia (eventsByCollab),
// ordenado por "mais quente" (atraso desc), levando ao drill da pessoa (/time/:id).
// Mesmo padrão visual da lista do TeamDrillPanel, mas escopado ao próprio time.
import { Link } from 'react-router-dom';
import { Users, AlertTriangle, CalendarClock, ChevronRight } from 'lucide-react';
import type { TeamSnapshot, TeamCollab } from '../../lib/team-snapshot';

interface Props {
  snapshot: TeamSnapshot;
}

const firstName = (c: TeamCollab) =>
  (c.preferred_name || c.full_name || '').split(' ')[0] || c.id.slice(0, 6);

export function MyTeamQueue({ snapshot }: Props) {
  const { team, overdueByPerson, eventsByCollab, responded } = snapshot;

  const overdueOf = (id: string) => overdueByPerson.find(o => o.assigned_to === id)?.count ?? 0;
  const eventsOf = (id: string) => eventsByCollab[id] ?? 0;
  const respondedSet = new Set(responded);

  const sorted = [...team].sort((a, b) => overdueOf(b.id) - overdueOf(a.id));

  return (
    <section className="surface p-md space-y-md">
      <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
        <Users size={14} /> Seu time · {team.length}
      </div>

      {team.length === 0 ? (
        <p className="text-body-sm text-fg-muted">Você não tem liderados diretos no mapa do TOM.</p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map(m => {
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
                    {respondedSet.has(m.id) && (
                      <span className="text-success" title="Respondeu o briefing hoje">●</span>
                    )}
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
    </section>
  );
}
