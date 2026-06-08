import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, AlertTriangle, CheckCircle2, CalendarClock } from 'lucide-react';
import { supabaseConfigured } from '../lib/supabase';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/Badge';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { formatEventTimeRange } from '../lib/events';
import { fetchMyTeamSnapshot } from '../lib/team-snapshot';

export function DashboardTimeMobile() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['team-snapshot'],
    queryFn: fetchMyTeamSnapshot,
    enabled: supabaseConfigured,
  });

  if (!supabaseConfigured) return <EmptyState icon={<Users size={32} />} title="Configure Supabase" />;
  if (isLoading) return <LoadingState rows={4} />;
  if (error) return <EmptyState title="Erro" description={(error as Error).message} />;
  if (!data) return null;

  const { team, allCollabs, responded, noResponse, completedToday, dueToday, overdueCount, overdueByPerson, events, eventsByCollab } = data;

  const nameOf = (id: string) => allCollabs.find(t => t.id === id)?.full_name?.split(' ')[0] ?? id.slice(0, 6);
  const evCount = (id: string) => eventsByCollab[id] ?? 0;

  return (
    <div className="space-y-lg">
      <PageHeader title="Time" subtitle="Visão de coordenação · só dados de trabalho" backTo="/mais" />

      {/* Fase D2 — 5 stats: 3 cols no mobile, 5 cols no desktop pra uma unica linha. */}
      <div className="grid grid-cols-3 lg:grid-cols-5 gap-sm">
        <StatCard label="No time" value={team.length} />
        <StatCard label="Concluídas" value={completedToday} tone={completedToday ? 'success' : 'neutral'} />
        <StatCard label="Pra hoje" value={dueToday} tone={dueToday ? 'tom' : 'neutral'} />
        <StatCard label="Atrasadas" value={overdueCount} tone={overdueCount ? 'danger' : 'neutral'} />
        <StatCard label="Compromissos" value={events.length} tone={events.length ? 'tom' : 'neutral'} />
      </div>

      {events.length > 0 && (
        <section className="surface p-md">
          <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
            <CalendarClock size={14} /> Compromissos hoje · {events.length}
          </div>
          <ul className="mt-md divide-y divide-border">
            {events.slice(0, 5).map(e => (
              <li key={e.id} className="py-2 flex items-baseline gap-md text-body-sm">
                <span className="text-brand font-semibold tabular-nums shrink-0">{formatEventTimeRange(e.start_at, e.end_at).split('–')[0]}</span>
                <Link to={`/time/${e.collaborator_id}`} className="text-fg-secondary hover:text-fg shrink-0">
                  {nameOf(e.collaborator_id || '')}
                </Link>
                <span className="text-fg truncate">{e.title}</span>
              </li>
            ))}
            {events.length > 5 && (
              <li className="py-2 text-body-sm text-fg-muted">+ {events.length - 5} compromisso(s)</li>
            )}
          </ul>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-md">
        <div className="surface p-md">
          <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
            <CheckCircle2 size={14} /> Respondeu briefing
          </div>
          {responded.length === 0 ? (
            <p className="text-body-sm text-fg-muted mt-md">Ninguém respondeu ainda hoje.</p>
          ) : (
            <ul className="mt-md flex flex-wrap gap-2">
              {responded.map(id => (
                <li key={id}>
                  <Link to={`/time/${id}`} className="inline-block">
                    <Badge tone="success">
                      {nameOf(id)}{evCount(id) > 0 ? ` · ${evCount(id)}📅` : ''}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="surface p-md">
          <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
            <AlertTriangle size={14} /> Sem resposta
          </div>
          {noResponse.length === 0 ? (
            <p className="text-body-sm text-fg-muted mt-md">Time todo respondeu. 👽</p>
          ) : (
            <ul className="mt-md flex flex-wrap gap-2">
              {noResponse.map(id => (
                <li key={id}>
                  <Link to={`/time/${id}`} className="inline-block">
                    <Badge tone="warning">
                      {nameOf(id)}{evCount(id) > 0 ? ` · ${evCount(id)}📅` : ''}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {overdueByPerson.length > 0 && (
        <section className="surface p-md">
          <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
            <AlertTriangle size={14} /> Atrasos por pessoa
          </div>
          <ul className="mt-md flex flex-wrap gap-2">
            {overdueByPerson.map(({ assigned_to, count }) => (
              <li key={assigned_to}>
                <Link to={`/time/${assigned_to}`} className="inline-block">
                  <Badge tone="danger">{nameOf(assigned_to)}: {count}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
