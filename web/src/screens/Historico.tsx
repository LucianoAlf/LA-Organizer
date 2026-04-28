import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History as HistoryIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { todaySP, ymdAddDays, brShort, dowShort } from '../utils/date';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { StatCard } from '../components/StatCard';
import type { Task } from '../types';

interface DayStats {
  ymd: string;
  total: number;
  done: number;
  hadBriefing: boolean;
}

const RANGE_DAYS = 30;

async function fetchHistorico(collabId: string, startYmd: string, endYmd: string) {
  // Tasks within window where the user was assignee.
  const { data: tasksData, error: tErr } = await supabase
    .from('tasks')
    .select('id, status, due_date, completed_at, context, assigned_to')
    .eq('assigned_to', collabId)
    .eq('context', 'work')
    .gte('due_date', startYmd)
    .lte('due_date', endYmd);
  if (tErr) throw tErr;

  // Briefings sent (any) for this user in the window.
  const { data: briefData, error: bErr } = await supabase
    .from('ritual_logs')
    .select('reference_date, ritual_type, status')
    .eq('collaborator_id', collabId)
    .in('ritual_type', ['daily_briefing','briefing_trabalho'])
    .gte('reference_date', startYmd)
    .lte('reference_date', endYmd);
  if (bErr) throw bErr;

  return { tasks: (tasksData ?? []) as unknown as Task[], briefings: briefData ?? [] };
}

export function Historico() {
  const { collaborator } = useAuth();
  const today = todaySP();
  const start = ymdAddDays(today, -(RANGE_DAYS - 1));

  const { data, isLoading, error } = useQuery({
    queryKey: ['historico', collaborator?.id, start, today],
    queryFn: () => collaborator ? fetchHistorico(collaborator.id, start, today) : Promise.resolve(null),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  const days = useMemo<DayStats[]>(() => {
    if (!data) return [];
    const map = new Map<string, DayStats>();
    for (let i = 0; i < RANGE_DAYS; i++) {
      const d = ymdAddDays(start, i);
      map.set(d, { ymd: d, total: 0, done: 0, hadBriefing: false });
    }
    for (const t of data.tasks) {
      if (!t.due_date) continue;
      const s = map.get(t.due_date); if (!s) continue;
      s.total++;
      if (t.status === 'done') s.done++;
    }
    for (const b of data.briefings) {
      const s = map.get(b.reference_date); if (!s) continue;
      if (b.status === 'sent') s.hadBriefing = true;
    }
    return [...map.values()].reverse(); // most recent first
  }, [data, start]);

  // Filter: only weekdays AND days that had any activity (had briefing or had tasks).
  // Empty weekend days clutter the list with no signal.
  const visible = useMemo(() => {
    return days.filter(d => {
      const [y, m, dd] = d.ymd.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, dd, 12)).getUTCDay();
      const isWeekend = dow === 0 || dow === 6;
      const hasSignal = d.total > 0 || d.hadBriefing;
      return !isWeekend || hasSignal;
    });
  }, [days]);

  // KPIs (whole window, work tasks only)
  const totalTasks = days.reduce((a, d) => a + d.total, 0);
  const totalDone = days.reduce((a, d) => a + d.done, 0);
  const completionPct = totalTasks ? Math.round((totalDone / totalTasks) * 100) : 0;
  const daysActive = days.filter(d => d.total > 0 || d.hadBriefing).length;

  return (
    <div className="space-y-lg">
      <header>
        <h2 className="text-screen-title">Histórico</h2>
        <p className="text-body-sm text-fg-muted mt-1">Últimos {RANGE_DAYS} dias · trabalho</p>
      </header>

      {!supabaseConfigured ? (
        <EmptyState icon={<HistoryIcon size={32} />} title="Configure Supabase" />
      ) : isLoading ? (
        <LoadingState rows={4} />
      ) : error ? (
        <EmptyState title="Erro" description={(error as Error).message} />
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-3 gap-sm">
            <StatCard label="Concluídas" value={totalDone} tone={totalDone ? 'success' : 'neutral'} />
            <StatCard label="Total" value={totalTasks} />
            <StatCard
              label="Aderência"
              value={`${completionPct}%`}
              tone={completionPct >= 70 ? 'success' : completionPct >= 40 ? 'warning' : 'danger'}
            />
          </div>

          <p className="text-body-sm text-fg-muted">
            <span className="tabular-nums">{daysActive}</span> de {RANGE_DAYS} dias com atividade.
          </p>

          <section className="surface overflow-hidden divide-y divide-border">
            {visible.length === 0 ? (
              <EmptyState
                icon={<HistoryIcon size={32} />}
                title="Sem registros"
                description="Quando você responder rituais ou completar tarefas, aparece aqui."
              />
            ) : (
              visible.map(d => <DayRow key={d.ymd} d={d} today={today} />)
            )}
          </section>
        </>
      )}
    </div>
  );
}

function DayRow({ d, today }: { d: DayStats; today: string }) {
  const isToday = d.ymd === today;
  const pct = d.total ? Math.round((d.done / d.total) * 100) : null;
  const tone =
    d.total === 0 && !d.hadBriefing ? 'idle' :
    pct === null ? 'briefed' :
    pct >= 80 ? 'good' :
    pct >= 50 ? 'mid' : 'low';

  const dotColor = {
    idle: 'bg-bg-elevated',
    briefed: 'bg-info',
    low: 'bg-danger',
    mid: 'bg-warning',
    good: 'bg-success',
  }[tone];

  const right =
    tone === 'idle' ? <span className="text-fg-muted">—</span> :
    tone === 'briefed' ? <span className="text-fg-muted">briefing</span> :
    <>
      <span className={pct! >= 80 ? 'text-success' : pct! >= 50 ? 'text-warning' : 'text-danger'}>
        {d.done}
      </span>
      <span className="text-fg-muted">/{d.total}</span>
      <span className="text-fg-muted ml-2 tabular-nums">{pct}%</span>
    </>;

  return (
    <div className="flex items-center gap-md p-md">
      <span aria-hidden className={['inline-block w-2.5 h-2.5 rounded-full shrink-0', dotColor].join(' ')} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={['text-label uppercase tracking-wide', isToday ? 'text-brand' : 'text-fg-muted'].join(' ')}>
            {dowShort(d.ymd)}
          </span>
          <span className={['text-body-md tabular-nums', isToday ? '' : 'text-fg-secondary'].join(' ')}>
            {brShort(d.ymd)}
          </span>
          {isToday && <span className="text-label uppercase tracking-wide text-brand">hoje</span>}
        </div>
      </div>
      <div className="text-body-sm tabular-nums">{right}</div>
    </div>
  );
}
