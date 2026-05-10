import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ComunicadoSheet } from '../components/ComunicadoSheet';
import { PageHeader } from '../components/PageHeader';
import { Fab } from '../components/Fab';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { CustomSelect } from '../components/CustomSelect';
import { RowMenu } from '../components/RowMenu';
import { Badge } from '../components/Badge';
import { showToast } from '../components/Toast';
import { audienceLabel } from '../types';
import type { Announcement, AnnouncementAudience, AnnouncementJob } from '../types';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  pending_approval: 'Aguardando aprovação',
  scheduled: 'Agendado',
  sending: 'Enviando',
  sent: 'Enviado',
  cancelled: 'Cancelado',
  rejected: 'Rejeitado',
};

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-bg-elevated text-fg-muted',
  pending_approval: 'bg-warning/10 text-warning',
  scheduled: 'bg-warning/10 text-warning',
  sending: 'bg-tom/15 text-tom',
  sent: 'bg-success/15 text-success',
  cancelled: 'bg-bg-elevated text-fg-muted line-through',
  rejected: 'bg-danger/15 text-danger',
};

const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'pending_approval', label: 'Aguardando' },
  { value: 'scheduled', label: 'Agendado' },
  { value: 'sending', label: 'Enviando' },
  { value: 'sent', label: 'Enviado' },
  { value: 'cancelled', label: 'Cancelado' },
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
}

export function Comunicados() {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resendInitial, setResendInitial] = useState<{ body: string; audience: AnnouncementAudience } | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');

  const { data: announcements = [], isLoading, error: annError, refetch } = useQuery({
    queryKey: ['comunicados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return data as Announcement[];
    },
  });

  const sendingIds = announcements.filter(a => a.status === 'sending').map(a => a.id);
  const { data: jobCounts = {} } = useQuery({
    queryKey: ['comunicados-jobs', sendingIds],
    enabled: sendingIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('announcement_jobs')
        .select('announcement_id, status')
        .in('announcement_id', sendingIds);
      const counts: Record<string, { sent: number; total: number }> = {};
      for (const job of (data as AnnouncementJob[] || [])) {
        if (!counts[job.announcement_id]) counts[job.announcement_id] = { sent: 0, total: 0 };
        counts[job.announcement_id].total++;
        if (job.status === 'sent') counts[job.announcement_id].sent++;
      }
      return counts;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator!.id });
      const { error } = await supabase.from('announcements').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comunicados'] });
      showToast({ kind: 'success', title: 'Comunicado cancelado' });
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao cancelar', msg: err.message });
    },
  });

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const a of announcements) set.add(monthKey(a.created_at));
    return [...set].sort().reverse();
  }, [announcements]);

  const filtered = useMemo(() => {
    return announcements.filter(a => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (monthFilter && monthKey(a.created_at) !== monthFilter) return false;
      return true;
    });
  }, [announcements, statusFilter, monthFilter]);

  const activeFilters = (statusFilter ? 1 : 0) + (monthFilter ? 1 : 0);

  function handleResend(ann: Announcement) {
    setResendInitial({ body: ann.body, audience: ann.audience });
    setSheetOpen(true);
  }

  return (
    <div className="space-y-md">
      <PageHeader title="Comunicados" subtitle="Anúncios para a equipe" backTo="/mais" />

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
            onClick={() => { setStatusFilter(''); setMonthFilter(''); }}
            className="text-caption text-brand underline focus-ring rounded-sm"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Conteúdo */}
      {isLoading ? (
        <LoadingState rows={3} />
      ) : annError ? (
        <ErrorState
          title="Não consegui carregar comunicados"
          description={(annError as Error).message}
          onRetry={() => refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={announcements.length === 0 ? 'Nenhum comunicado ainda' : 'Nenhum resultado'}
          description={announcements.length === 0
            ? 'Use o + para mandar o primeiro comunicado pra equipe.'
            : 'Ajuste os filtros ou limpa pra ver tudo.'}
        />
      ) : (
        <ul className="space-y-3">
          {filtered.map(ann => {
            const counts = jobCounts[ann.id];
            const canCancel = ann.status === 'scheduled' || ann.status === 'sending' || ann.status === 'pending_approval';
            const menuItems = [
              { label: 'Reenviar (duplicar)', onClick: () => handleResend(ann) },
            ];
            if (canCancel) {
              menuItems.push({
                label: 'Cancelar comunicado',
                danger: true,
                confirm: 'Cancelar esse comunicado?',
                onClick: () => cancelMutation.mutate(ann.id),
              } as { label: string; onClick: () => void; danger?: boolean; confirm?: string });
            }
            return (
              <li
                key={ann.id}
                className={[
                  'relative bg-bg-surface rounded-xl border border-border p-4 space-y-2',
                  'transition-all duration-150',
                  'hover:border-tom/40 hover:shadow-[0_0_0_1px_rgba(157,184,91,0.15),0_8px_24px_-12px_rgba(157,184,91,0.30)]',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-body line-clamp-3 pr-6">{ann.body}</p>
                  <div className="absolute top-3 right-3">
                    <RowMenu items={menuItems} />
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="neutral">{audienceLabel(ann.audience)}</Badge>
                  <span className={['text-caption font-semibold rounded-md px-2 py-0.5', STATUS_TONE[ann.status] ?? ''].join(' ')}>
                    {STATUS_LABEL[ann.status] ?? ann.status}
                    {ann.status === 'sending' && counts ? ` ${counts.sent}/${counts.total}` : ''}
                  </span>
                  {ann.scheduled_at && ann.status === 'scheduled' && (
                    <span className="text-caption text-fg-muted">⏰ {formatDate(ann.scheduled_at)}</span>
                  )}
                  <span className="text-caption text-fg-muted ml-auto">{formatDate(ann.created_at)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Fab
        onClick={() => { setResendInitial(null); setSheetOpen(true); }}
        label="Novo"
        ariaLabel="Novo comunicado"
      />

      <ComunicadoSheet
        open={sheetOpen}
        onClose={() => { setSheetOpen(false); setResendInitial(null); }}
        initial={resendInitial}
      />
    </div>
  );
}
