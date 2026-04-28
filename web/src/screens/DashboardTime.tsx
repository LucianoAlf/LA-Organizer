import { useQuery } from '@tanstack/react-query';
import { Users, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { todaySP } from '../utils/date';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/Badge';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';

interface TeamSnapshot {
  team: { id: string; full_name: string; role: string }[];
  responded: string[]; // collaborator_ids
  noResponse: string[];
  completedToday: number;
  dueToday: number;
  overdue: { id: string; title: string; assigned_to: string; due_date: string }[];
}

async function fetchTeamSnapshot(myId: string): Promise<TeamSnapshot> {
  const today = todaySP();
  // Active onboarded team minus self.
  const { data: teamRaw } = await supabase
    .from('collaborators')
    .select('id, full_name, role')
    .eq('is_active', true)
    .eq('onboarding_completed', true);
  const team = (teamRaw ?? []).filter(c => c.id !== myId);

  // Today's daily_briefing/sent rows.
  const { data: briefings } = await supabase
    .from('ritual_logs')
    .select('collaborator_id, sent_at')
    .eq('reference_date', today)
    .eq('ritual_type', 'daily_briefing')
    .eq('status', 'sent');

  const responded: string[] = [];
  const noResponse: string[] = [];
  for (const c of team) {
    const b = (briefings ?? []).find(x => x.collaborator_id === c.id);
    if (!b) continue; // briefing not sent → don't classify
    const { count } = await supabase
      .from('conversation_history')
      .select('id', { count: 'exact', head: true })
      .eq('collaborator_id', c.id)
      .eq('direction', 'inbound')
      .gte('created_at', b.sent_at);
    if ((count ?? 0) > 0) responded.push(c.id);
    else noResponse.push(c.id);
  }

  // Work tasks today.
  const todayStart = today + 'T00:00:00-03:00';
  const todayEnd = today + 'T23:59:59-03:00';
  const { count: completedToday = 0 } = await supabase
    .from('tasks').select('id', { count: 'exact', head: true })
    .eq('context', 'work').eq('status', 'done')
    .gte('completed_at', todayStart).lte('completed_at', todayEnd);
  const { count: dueToday = 0 } = await supabase
    .from('tasks').select('id', { count: 'exact', head: true })
    .eq('context', 'work').eq('due_date', today);

  const { data: overdueRaw } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, due_date')
    .eq('context', 'work')
    .lt('due_date', today)
    .not('status', 'in', '(done,cancelled)')
    .limit(50);

  return {
    team,
    responded,
    noResponse,
    completedToday: completedToday ?? 0,
    dueToday: dueToday ?? 0,
    overdue: overdueRaw ?? [],
  };
}

export function DashboardTime() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['team-snapshot'],
    queryFn: async () => {
      const { data: me } = await supabase.auth.getUser();
      if (!me?.user?.email) throw new Error('Sem sessão');
      const { data: collab } = await supabase.from('collaborators').select('id').eq('email', me.user.email).maybeSingle();
      if (!collab) throw new Error('Sem colaborador');
      return fetchTeamSnapshot(collab.id);
    },
    enabled: supabaseConfigured,
  });

  if (!supabaseConfigured) return <EmptyState icon={<Users size={32} />} title="Configure Supabase" />;
  if (isLoading) return <LoadingState rows={4} />;
  if (error) return <EmptyState title="Erro" description={(error as Error).message} />;
  if (!data) return null;

  const { team, responded, noResponse, completedToday, dueToday, overdue } = data;
  const overdueByPerson = new Map<string, number>();
  for (const t of overdue) overdueByPerson.set(t.assigned_to, (overdueByPerson.get(t.assigned_to) ?? 0) + 1);

  const nameOf = (id: string) => team.find(t => t.id === id)?.full_name?.split(' ')[0] ?? id.slice(0, 6);

  return (
    <div className="space-y-lg">
      <header>
        <h2 className="text-screen-title">Time</h2>
        <p className="text-body-sm text-fg-muted mt-1">Visão de coordenação · só dados de trabalho</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-sm">
        <StatCard label="No time" value={team.length} />
        <StatCard label="Concluídas hoje" value={completedToday} tone={completedToday ? 'success' : 'neutral'} />
        <StatCard label="Pra hoje" value={dueToday} tone="brand" />
        <StatCard label="Atrasadas" value={overdue.length} tone={overdue.length ? 'danger' : 'neutral'} />
      </div>

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
                <li key={id}><Badge tone="success">{nameOf(id)}</Badge></li>
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
                <li key={id}><Badge tone="warning">{nameOf(id)}</Badge></li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {overdue.length > 0 && (
        <section className="surface p-md">
          <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
            <AlertTriangle size={14} /> Atrasos por pessoa
          </div>
          <ul className="mt-md flex flex-wrap gap-2">
            {[...overdueByPerson.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => (
              <li key={id}><Badge tone="danger">{nameOf(id)}: {n}</Badge></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
