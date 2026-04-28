import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, CalendarClock, ListTodo, Activity, User } from 'lucide-react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { todaySP, ymdAddDays, dowShort } from '../utils/date';
import { fetchEventsForCollabRange } from '../lib/events';
import { StatCard } from '../components/StatCard';
import { TaskRow } from '../components/TaskRow';
import { EventRow } from '../components/EventRow';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import type { Task } from '../types';

interface PersonProfile {
  id: string;
  full_name: string;
  role: string;
  function_title: string | null;
  phone: string | null;
}

interface RitualLogRow {
  reference_date: string;
  ritual_type: string;
  status: string;
}

const RITUAL_WINDOW_DAYS = 7;

// Mascara: "••••{últimos 4}". Telefone curto/null devolve "—".
function maskPhone(phone: string | null): string {
  if (!phone) return '—';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 4) return '—';
  return '••••' + digits.slice(-4);
}

async function fetchPersonDetail(id: string) {
  const today = todaySP();
  const since = ymdAddDays(today, -(RITUAL_WINDOW_DAYS - 1));
  const upcomingEnd = ymdAddDays(today, RITUAL_WINDOW_DAYS - 1);

  const [collabRes, tasksRes, eventsTodayPromise, eventsRangePromise, ritualsRes] = await Promise.all([
    supabase
      .from('collaborators')
      .select('id, full_name, role, function_title, phone')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('tasks')
      .select('id, title, status, context, priority, due_date, project_id, assigned_to, created_by, completed_at, projects(name)')
      .eq('assigned_to', id)
      .eq('context', 'work')
      .not('status', 'in', '(done,cancelled)')
      .order('due_date', { ascending: true })
      .limit(20),
    fetchEventsForCollabRange(id, today, today, 'work'),
    fetchEventsForCollabRange(id, today, upcomingEnd, 'work'),
    // PRIVACY: select explícito sem `detail` nem `responded_at` etc. — fica só status/data/tipo.
    // Conteúdo de resposta nunca chega ao cliente, mesmo com RLS permitindo coord.
    supabase
      .from('ritual_logs')
      .select('reference_date, ritual_type, status')
      .eq('collaborator_id', id)
      .gte('reference_date', since)
      .lte('reference_date', today),
  ]);

  if (collabRes.error) throw collabRes.error;
  if (tasksRes.error) throw tasksRes.error;
  if (ritualsRes.error) throw ritualsRes.error;
  if (!collabRes.data) throw new Error('not_found');

  return {
    profile: collabRes.data as PersonProfile,
    tasks: (tasksRes.data ?? []) as unknown as Task[],
    eventsToday: eventsTodayPromise,
    eventsUpcoming: eventsRangePromise,
    rituals: (ritualsRes.data ?? []) as RitualLogRow[],
    today,
    since,
  };
}

export function PessoaDetalhe() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['pessoaDetalhe', id],
    queryFn: () => fetchPersonDetail(id!),
    enabled: Boolean(id && supabaseConfigured),
  });

  // 7 dias: para cada dia, contar rituals.status='sent'.
  const ritualByDay = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, number>();
    for (let i = 0; i < RITUAL_WINDOW_DAYS; i++) {
      const ymd = ymdAddDays(data.since, i);
      map.set(ymd, 0);
    }
    for (const r of data.rituals) {
      if (r.status !== 'sent') continue;
      const cur = map.get(r.reference_date);
      if (cur !== undefined) map.set(r.reference_date, cur + 1);
    }
    return [...map.entries()].map(([ymd, n]) => ({ ymd, count: n }));
  }, [data]);

  if (!supabaseConfigured) return <EmptyState icon={<User size={32} />} title="Configure Supabase" />;
  if (isLoading) return <LoadingState rows={4} />;
  if (error) return (
    <div className="space-y-md">
      <BackLink />
      <EmptyState title="Erro" description={(error as Error).message} />
    </div>
  );
  if (!data) return null;

  const { profile, tasks, eventsToday, eventsUpcoming, rituals } = data;
  const ritualsSent7d = rituals.filter(r => r.status === 'sent').length;

  return (
    <div className="space-y-lg">
      <BackLink />

      <header className="surface p-md flex items-start gap-md">
        <div className="h-12 w-12 rounded-full bg-bg-elevated grid place-items-center text-fg-muted shrink-0">
          <User size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-screen-title leading-tight">{profile.full_name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-fg-muted">
            <span className="capitalize">{profile.role}</span>
            {profile.function_title && <span>· {profile.function_title}</span>}
            <span className="tabular-nums">· {maskPhone(profile.phone)}</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-sm">
        <StatCard label="Tarefas abertas" value={tasks.length} tone={tasks.length ? 'brand' : 'neutral'} />
        <StatCard label="Compromissos hoje" value={eventsToday.length} tone={eventsToday.length ? 'brand' : 'neutral'} />
        <StatCard
          label="Rituais enviados"
          value={ritualsSent7d}
          tone={ritualsSent7d ? 'success' : 'neutral'}
          hint={`em ${RITUAL_WINDOW_DAYS}d`}
        />
      </div>

      <section className="surface p-md">
        <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
          <ListTodo size={14} /> Tarefas em aberto · trabalho
        </div>
        {tasks.length === 0 ? (
          <p className="mt-md text-body-sm text-fg-muted">Sem tarefas em aberto.</p>
        ) : (
          <div className="mt-2">
            {tasks.map(t => <TaskRow key={t.id} task={t} readOnly />)}
          </div>
        )}
      </section>

      <section className="surface p-md">
        <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
          <CalendarClock size={14} /> Próximos {RITUAL_WINDOW_DAYS} dias · compromissos
        </div>
        {eventsUpcoming.length === 0 ? (
          <p className="mt-md text-body-sm text-fg-muted">Nenhum compromisso na semana.</p>
        ) : (
          <div className="mt-2">
            {eventsUpcoming.slice(0, 10).map(e => <EventRow key={e.id} event={e} />)}
          </div>
        )}
      </section>

      <section className="surface p-md">
        <div className="flex items-center gap-2 text-label uppercase tracking-wide text-fg-muted">
          <Activity size={14} /> Rituais enviados · últimos {RITUAL_WINDOW_DAYS} dias
        </div>
        <p className="mt-1 text-body-sm text-fg-muted">
          Métrica operacional do TOM (entregues). Não confunde com aderência real do colaborador.
        </p>
        <div className="mt-md grid grid-cols-7 gap-1">
          {ritualByDay.map(({ ymd, count }) => {
            const [y, m, d] = ymd.split('-').map(Number);
            const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
            const isWeekend = dow === 0 || dow === 6;
            const tone = count > 0 ? 'bg-success' : isWeekend ? 'bg-bg-elevated' : 'bg-warning';
            return (
              <div key={ymd} className="text-center">
                <div className={['h-8 rounded-sm', tone].join(' ')} title={`${ymd}: ${count} ritual(is) enviado(s)`} />
                <div className="mt-1 text-label uppercase tracking-wide text-fg-muted">{dowShort(ymd).slice(0, 1)}</div>
                <div className="text-body-sm tabular-nums">{ymd.slice(8, 10)}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/time" className="inline-flex items-center gap-1 text-body-sm text-fg-muted hover:text-fg">
      <ChevronLeft size={16} /> voltar
    </Link>
  );
}
