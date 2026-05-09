import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { EventoSheet } from '../components/EventoSheet';
import { PageHeader } from '../components/PageHeader';
import { unitLabel, formatEventDate } from '../types';
import type { SchoolEventWithAnnouncements } from '../types';

const STEP_PREFIXES = {
  leadership: '📅 Novo evento:',
  school: '📅 Em 3 dias:',
  unit: '📅 Amanhã:',
  dayOf: '📅 Hoje:',
};

const STATUS_CHIP: Record<string, string> = {
  scheduled: '⏳',
  sending: '📤',
  sent: '✓',
  cancelled: '✗',
};

function StepChip({
  label,
  announcement,
}: {
  label: string;
  announcement?: { status: string; scheduled_at: string | null } | null;
}) {
  if (!announcement) return <span className="text-caption text-fg-muted">{label} —</span>;
  const chip = STATUS_CHIP[announcement.status] ?? '?';
  const when = announcement.scheduled_at
    ? new Date(announcement.scheduled_at).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      })
    : 'agora';
  return (
    <span className="text-caption text-fg-muted">
      {label} {chip} {when}
    </span>
  );
}

export function AgendaEscolar() {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['agenda-escolar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('school_events')
        .select('*, announcements(id, body, status, scheduled_at, source_event_id)')
        .eq('status', 'active')
        .order('event_date', { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as SchoolEventWithAnnouncements[];
    },
  });

  const { mutate: cancelEvent } = useMutation({
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
      setCancelError('');
      queryClient.invalidateQueries({ queryKey: ['agenda-escolar'] });
    },
    onError: (err: Error) => setCancelError(err.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agenda Escolar"
        subtitle="Eventos institucionais da escola"
        backTo="/mais"
        right={
          <Link
            to="/mais/agenda-escolar/equipe"
            className="text-caption text-brand underline focus-ring rounded whitespace-nowrap"
          >
            Equipe
          </Link>
        }
      />

      {isLoading && <p className="text-body-sm text-fg-muted">Carregando...</p>}

      {!isLoading && events.length === 0 && (
        <p className="text-body-sm text-fg-muted">Nenhum evento ativo.</p>
      )}

      {cancelError && <p className="text-danger text-body-sm">{cancelError}</p>}

      <ul className="space-y-2">
        {events.map(ev => {
          const anns = ev.announcements ?? [];
          const leadAnn = anns.find(a => a.body.startsWith(STEP_PREFIXES.leadership));
          const schoolAnn = anns.find(a => a.body.startsWith(STEP_PREFIXES.school));
          const unitAnn = anns.find(a => a.body.startsWith(STEP_PREFIXES.unit));
          const dayOfAnn = anns.find(a => a.body.startsWith(STEP_PREFIXES.dayOf));
          return (
            <li
              key={ev.id}
              className="bg-bg-surface rounded-xl border border-border p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-body font-medium">{ev.title}</p>
                  <p className="text-body-sm text-fg-muted">
                    {formatEventDate(ev.event_date, ev.start_time)}
                    {ev.location ? ` · ${ev.location}` : ''}
                  </p>
                </div>
                <span className="text-caption bg-bg-elevated border border-border rounded px-2 py-0.5 whitespace-nowrap">
                  {unitLabel(ev.unit)}
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                {ev.notify_leadership && <StepChip label="Liderança" announcement={leadAnn} />}
                {ev.notify_school && <StepChip label="Escola" announcement={schoolAnn} />}
                {ev.notify_unit && <StepChip label="Unidade" announcement={unitAnn} />}
                {ev.notify_day_of && <StepChip label="No dia" announcement={dayOfAnn} />}
              </div>
              <div className="flex items-center gap-3">
                <Link
                  to={`/mais/eventos/${ev.id}`}
                  className="text-caption text-brand underline focus-ring rounded"
                >
                  Tarefas do evento
                </Link>
                <button
                  type="button"
                  onClick={() => cancelEvent(ev.id)}
                  className="text-caption text-danger underline focus:outline-none focus-visible:ring-2"
                >
                  Cancelar evento
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="fixed bottom-24 right-4 h-14 w-14 rounded-full bg-brand text-white shadow-lg flex items-center justify-center focus-ring"
        aria-label="Novo evento"
      >
        <Plus size={24} />
      </button>

      <EventoSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
