import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
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
  const [resendInitial, setResendInitial] = useState<{ body: string; audience: AnnouncementAudience; requires_confirmation?: boolean; attachment?: { url: string; type: 'image' | 'document'; mime: string; filename: string; size: number } | null } | null>(null);
  const [editTarget, setEditTarget] = useState<Announcement | null>(null);
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

  // Counts agregados por announcement: total/sent/confirmed.
  // Roda pra todos os anúncios visíveis (não só os "sending").
  const allIds = announcements.map(a => a.id);
  const { data: jobCounts = {} } = useQuery({
    queryKey: ['comunicados-jobs', allIds],
    enabled: allIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('announcement_jobs')
        .select('announcement_id, status, confirmed_at')
        .in('announcement_id', allIds);
      const counts: Record<string, { sent: number; total: number; confirmed: number }> = {};
      type JobRow = AnnouncementJob & { confirmed_at: string | null };
      for (const job of (data as JobRow[] || [])) {
        if (!counts[job.announcement_id]) counts[job.announcement_id] = { sent: 0, total: 0, confirmed: 0 };
        counts[job.announcement_id].total++;
        if (job.status === 'sent') counts[job.announcement_id].sent++;
        if (job.confirmed_at) counts[job.announcement_id].confirmed++;
      }
      return counts;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator!.id });
      // Hard delete — cascade remove announcement_jobs.
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comunicados'] });
      showToast({ kind: 'success', title: 'Comunicado excluído' });
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao excluir', msg: err.message });
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
    const a = ann as Announcement & {
      requires_confirmation?: boolean;
      attachment_url?: string | null;
      attachment_type?: 'image' | 'document' | null;
      attachment_mime?: string | null;
      attachment_filename?: string | null;
      attachment_size_bytes?: number | null;
    };
    setResendInitial({
      body: ann.body,
      audience: ann.audience,
      requires_confirmation: !!a.requires_confirmation,
      attachment: a.attachment_url && a.attachment_type ? {
        url: a.attachment_url,
        type: a.attachment_type,
        mime: a.attachment_mime || '',
        filename: a.attachment_filename || '',
        size: a.attachment_size_bytes || 0,
      } : null,
    });
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
            const canEdit = ann.status === 'pending_approval' || ann.status === 'scheduled';
            const menuItems: Array<{ label: string; onClick: () => void; danger?: boolean; confirm?: string }> = [];
            if (canEdit) {
              menuItems.push({ label: 'Editar', onClick: () => { setEditTarget(ann); setSheetOpen(true); } });
            }
            menuItems.push({ label: 'Reenviar (duplicar)', onClick: () => handleResend(ann) });
            menuItems.push({
              label: 'Excluir comunicado',
              danger: true,
              confirm: 'Excluir? Não dá pra desfazer.',
              onClick: () => deleteMutation.mutate(ann.id),
            });
            return (
              <li
                key={ann.id}
                className={[
                  'relative bg-bg-surface rounded-xl border border-border p-4',
                  'transition-all duration-150',
                  'hover:border-tom/40 hover:shadow-[0_0_0_1px_rgba(157,184,91,0.15),0_8px_24px_-12px_rgba(157,184,91,0.30)]',
                ].join(' ')}
              >
                <Link to={`/mais/comunicados/${ann.id}`} className="block space-y-2 pr-8">
                  <p className="text-body line-clamp-3">{ann.body}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone="neutral">{audienceLabel(ann.audience)}</Badge>
                    <span className={['text-caption font-semibold rounded-md px-2 py-0.5', STATUS_TONE[ann.status] ?? ''].join(' ')}>
                      {STATUS_LABEL[ann.status] ?? ann.status}
                      {ann.status === 'sending' && counts ? ` ${counts.sent}/${counts.total}` : ''}
                    </span>
                    {(ann as Announcement & { requires_confirmation?: boolean }).requires_confirmation && counts && (
                      <span className="inline-flex items-center gap-1 text-caption font-semibold rounded-md px-2 py-0.5 bg-tom/15 text-tom">
                        <CheckCircle2 size={12} /> {counts.confirmed}/{counts.sent || counts.total} confirmaram
                      </span>
                    )}
                    {ann.scheduled_at && ann.status === 'scheduled' && (
                      <span className="text-caption text-fg-muted">⏰ {formatDate(ann.scheduled_at)}</span>
                    )}
                    <span className="text-caption text-fg-muted ml-auto">{formatDate(ann.created_at)}</span>
                  </div>
                </Link>
                <div className="absolute top-3 right-3">
                  <RowMenu items={menuItems} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Fab
        onClick={() => { setResendInitial(null); setEditTarget(null); setSheetOpen(true); }}
        label="Novo"
        ariaLabel="Novo comunicado"
      />

      <ComunicadoSheet
        open={sheetOpen}
        onClose={() => { setSheetOpen(false); setResendInitial(null); setEditTarget(null); }}
        initial={resendInitial}
        editTarget={editTarget}
      />
    </div>
  );
}
