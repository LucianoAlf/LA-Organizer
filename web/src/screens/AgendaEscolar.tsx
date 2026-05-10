import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { EventoSheet } from '../components/EventoSheet';
import { PageHeader } from '../components/PageHeader';
import { Fab } from '../components/Fab';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { CustomSelect } from '../components/CustomSelect';
import { RowMenu } from '../components/RowMenu';
import { Badge } from '../components/Badge';
import { showToast } from '../components/Toast';
import { unitLabel, formatEventDate } from '../types';
import type { SchoolEventWithAnnouncements } from '../types';

// Prefixos usados pelo dispatcher pra distinguir announcements por etapa.
const STEP_PREFIXES = {
  leadership: '📅 Novo evento:',
  school: '📅 Em 3 dias:',
  unit: '📅 Amanhã:',
  dayOf: '📅 Hoje:',
};

// Cor por status do announcement (chip da etapa de comunicação).
const STATUS_TONE: Record<string, string> = {
  scheduled: 'bg-warning/10 text-warning',
  sending: 'bg-tom/15 text-tom',
  sent: 'bg-success/15 text-success',
  cancelled: 'bg-bg-elevated text-fg-muted line-through',
};

const STATUS_ICON: Record<string, string> = {
  scheduled: '⏳',
  sending: '📤',
  sent: '✓',
  cancelled: '✗',
};

const STATUS_OPTIONS = [
  { value: 'active', label: 'Ativos' },
  { value: 'cancelled', label: 'Cancelados' },
  { value: '', label: 'Todos' },
];

function monthKey(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
}

function daysUntil(eventDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ev = new Date(eventDate + 'T00:00:00');
  return Math.round((ev.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function proximityBadge(eventDate: string): { label: string; tone: 'success' | 'warning' | 'neutral' } | null {
  const d = daysUntil(eventDate);
  if (d === 0) return { label: 'Hoje', tone: 'warning' };
  if (d === 1) return { label: 'Amanhã', tone: 'warning' };
  if (d > 0 && d <= 7) return { label: `Em ${d} dias`, tone: 'success' };
  return null;
}

function StepChip({
  label,
  announcement,
}: {
  label: string;
  announcement?: { status: string; scheduled_at: string | null };
}) {
  if (!announcement) {
    return (
      <span className="text-caption text-fg-muted opacity-50">
        {label} —
      </span>
    );
  }
  const icon = STATUS_ICON[announcement.status] ?? '·';
  const tone = STATUS_TONE[announcement.status] ?? '';
  const when = announcement.scheduled_at
    ? new Date(announcement.scheduled_at).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      })
    : 'agora';
  return (
    <span className={['text-caption rounded-md px-2 py-0.5', tone].join(' ')}>
      {label} {icon} {when}
    </span>
  );
}

export function AgendaEscolar() {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [monthFilter, setMonthFilter] = useState('');

  const { data: events = [], isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['agenda-escolar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('school_events')
        .select('*, announcements(id, body, status, scheduled_at, source_event_id)')
        .order('event_date', { ascending: true })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as SchoolEventWithAnnouncements[];
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (eventId: string) => {
      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator!.id,
      });
      const { error: evErr } = await supabase
        .from('school_events')
        .update({ status: 'cancelled' })
        .eq('id', eventId);
      if (evErr) throw evErr;
      await supabase
        .from('announcements')
        .update({ status: 'cancelled' })
        .eq('source_event_id', eventId)
        .in('status', ['scheduled', 'sending']);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agenda-escolar'] });
      showToast({ kind: 'success', title: 'Evento cancelado', msg: 'Comunicações pendentes também foram canceladas.' });
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao cancelar', msg: err.message });
    },
  });

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const ev of events) set.add(monthKey(ev.event_date));
    return [...set].sort();
  }, [events]);

  const filtered = useMemo(() => {
    return events.filter(ev => {
      if (statusFilter && ev.status !== statusFilter) return false;
      if (monthFilter && monthKey(ev.event_date) !== monthFilter) return false;
      return true;
    });
  }, [events, statusFilter, monthFilter]);

  const activeFilters = (statusFilter && statusFilter !== 'active' ? 1 : 0) + (monthFilter ? 1 : 0);

  return (
    <div className="space-y-md">
      <PageHeader
        title="Agenda Escolar"
        subtitle="Eventos institucionais da escola"
        backTo="/mais"
        right={
          <Link
            to="/mais/agenda-escolar/equipe"
            className="text-caption text-tom underline focus-ring rounded-sm whitespace-nowrap"
          >
            Equipe
          </Link>
        }
      />

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[140px]">
          <CustomSelect
            value={statusFilter}
            options={STATUS_OPTIONS}
            onChange={setStatusFilter}
            size="sm"
            placeholder="Status"
          />
        </div>
        <div className="flex-1 min-w-[140px]">
          <CustomSelect
            value={monthFilter}
            options={[
              { value: '', label: 'Todos os meses' },
              ...months.map(m => ({ value: m, label: monthLabel(m) })),
            ]}
            onChange={setMonthFilter}
            size="sm"
            placeholder="Mês"
          />
        </div>
        {activeFilters > 0 && (
          <button
            type="button"
            onClick={() => { setStatusFilter('active'); setMonthFilter(''); }}
            className="text-caption text-brand underline focus-ring rounded-sm"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Conteúdo */}
      {isLoading ? (
        <LoadingState rows={3} />
      ) : queryError ? (
        <ErrorState
          title="Não consegui carregar a agenda"
          description={(queryError as Error).message}
          onRetry={() => refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={events.length === 0 ? 'Nenhum evento ainda' : 'Nenhum resultado'}
          description={events.length === 0
            ? 'Use o + pra criar o primeiro evento institucional da escola.'
            : 'Ajuste os filtros ou limpa pra ver tudo.'}
        />
      ) : (
        <ul className="space-y-3">
          {filtered.map(ev => {
            const anns = ev.announcements ?? [];
            const leadAnn = anns.find(a => a.body.startsWith(STEP_PREFIXES.leadership));
            const schoolAnn = anns.find(a => a.body.startsWith(STEP_PREFIXES.school));
            const unitAnn = anns.find(a => a.body.startsWith(STEP_PREFIXES.unit));
            const dayOfAnn = anns.find(a => a.body.startsWith(STEP_PREFIXES.dayOf));
            const isCancelled = ev.status === 'cancelled';
            const prox = !isCancelled ? proximityBadge(ev.event_date) : null;

            const menuItems: Array<{ label: string; onClick: () => void; danger?: boolean; confirm?: string }> = [];
            if (!isCancelled) {
              menuItems.push({
                label: 'Cancelar evento',
                danger: true,
                confirm: 'Cancelar? Comunicações pendentes também serão canceladas.',
                onClick: () => cancelMutation.mutate(ev.id),
              });
            }
            return (
              <li
                key={ev.id}
                className={[
                  'relative bg-bg-surface rounded-xl border border-border p-4',
                  'transition-all duration-150',
                  isCancelled
                    ? 'opacity-60'
                    : 'hover:border-tom/40 hover:shadow-[0_0_0_1px_rgba(157,184,91,0.15),0_8px_24px_-12px_rgba(157,184,91,0.30)]',
                ].join(' ')}
              >
                <Link to={`/mais/eventos/${ev.id}`} className="block space-y-2 pr-8">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={['text-body font-medium', isCancelled ? 'line-through' : ''].join(' ')}>
                          {ev.title}
                        </p>
                        {prox && <Badge tone={prox.tone}>{prox.label}</Badge>}
                        {isCancelled && <Badge tone="danger">Cancelado</Badge>}
                      </div>
                      <p className="text-body-sm text-fg-muted mt-0.5">
                        {formatEventDate(ev.event_date, ev.start_time)}
                        {ev.location ? ` · ${ev.location}` : ''}
                      </p>
                    </div>
                    <span className="text-caption bg-bg-elevated border border-border rounded-md px-2 py-0.5 whitespace-nowrap shrink-0">
                      {unitLabel(ev.unit)}
                    </span>
                  </div>
                  {!isCancelled && (
                    <div className="flex flex-wrap gap-2">
                      {ev.notify_leadership && <StepChip label="Liderança" announcement={leadAnn} />}
                      {ev.notify_school && <StepChip label="Escola" announcement={schoolAnn} />}
                      {ev.notify_unit && <StepChip label="Unidade" announcement={unitAnn} />}
                      {ev.notify_day_of && <StepChip label="No dia" announcement={dayOfAnn} />}
                    </div>
                  )}
                </Link>
                {menuItems.length > 0 && (
                  <div className="absolute top-3 right-3">
                    <RowMenu items={menuItems} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Fab
        onClick={() => setSheetOpen(true)}
        label="Novo"
        ariaLabel="Novo evento"
      />

      <EventoSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
