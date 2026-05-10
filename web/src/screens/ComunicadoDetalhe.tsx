import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Send, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { RowMenu } from '../components/RowMenu';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { ComunicadoSheet } from '../components/ComunicadoSheet';
import { showToast } from '../components/Toast';
import { audienceLabel } from '../types';
import type { Announcement, AnnouncementAudience } from '../types';

interface JobRow {
  id: string;
  recipient_id: string | null;
  phone: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  sent_at: string | null;
  confirmed_at: string | null;
  confirmation_response: string | null;
  reminder_sent_at: string | null;
  recipient: { id: string; full_name: string; unit: string | null } | null;
}

type AnnouncementFull = Announcement & {
  requires_confirmation?: boolean;
  confirmation_question?: string | null;
  rejection_reason?: string | null;
  scheduled_at?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  pending_approval: 'Aguardando aprovação',
  scheduled: 'Agendado',
  sending: 'Enviando',
  sent: 'Enviado',
  cancelled: 'Cancelado',
  rejected: 'Rejeitado',
};

const JOB_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  sent: 'Entregue',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function unitLabelShort(u: string | null): string {
  if (!u) return '';
  const map: Record<string, string> = { barra: 'Barra', recreio: 'Recreio', campo_grande: 'Campo Grande', all: 'Geral' };
  return map[u] ?? u;
}

export function ComunicadoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const annQ = useQuery({
    queryKey: ['comunicado', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as AnnouncementFull | null;
    },
    enabled: !!id,
  });

  const jobsQ = useQuery({
    queryKey: ['comunicado-jobs', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcement_jobs')
        .select('id, recipient_id, phone, status, sent_at, confirmed_at, confirmation_response, reminder_sent_at, recipient:collaborators!announcement_jobs_recipient_id_fkey(id, full_name, unit)')
        .eq('announcement_id', id)
        .order('confirmed_at', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as JobRow[];
    },
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!id || !collaborator) return;
      await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator.id });
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comunicados'] });
      showToast({ kind: 'success', title: 'Comunicado excluído' });
      navigate('/mais/comunicados');
    },
    onError: (err: Error) => showToast({ kind: 'error', title: 'Falha', msg: err.message }),
  });

  const remindUnconfirmed = useMutation({
    mutationFn: async () => {
      const jobs = (jobsQ.data ?? []).filter(j => j.status === 'sent' && !j.confirmed_at);
      if (!jobs.length) return { count: 0 };
      const ids = jobs.map(j => j.id);
      // Reseta reminder_sent_at pra null pra que o cron envie de novo no próximo tick.
      const { error } = await supabase.from('announcement_jobs').update({ reminder_sent_at: null }).in('id', ids);
      if (error) throw error;
      return { count: ids.length };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['comunicado-jobs', id] });
      showToast({ kind: 'success', title: 'Lembrete agendado', msg: `${r?.count ?? 0} pessoa(s) serão lembradas no próximo tick.` });
    },
    onError: (err: Error) => showToast({ kind: 'error', title: 'Falha', msg: err.message }),
  });

  const stats = useMemo(() => {
    const all = jobsQ.data ?? [];
    return {
      total: all.length,
      sent: all.filter(j => j.status === 'sent').length,
      pending: all.filter(j => j.status === 'pending').length,
      failed: all.filter(j => j.status === 'failed').length,
      cancelled: all.filter(j => j.status === 'cancelled').length,
      confirmed: all.filter(j => j.confirmed_at).length,
      unconfirmed: all.filter(j => j.status === 'sent' && !j.confirmed_at).length,
    };
  }, [jobsQ.data]);

  if (annQ.isLoading) {
    return (
      <div className="space-y-md">
        <PageHeader title="Comunicado" backTo="/mais/comunicados" />
        <LoadingState rows={4} />
      </div>
    );
  }
  if (annQ.error || !annQ.data) {
    return (
      <div className="space-y-md">
        <PageHeader title="Comunicado" backTo="/mais/comunicados" />
        <ErrorState
          title="Não consegui carregar"
          description={annQ.error ? (annQ.error as Error).message : 'Comunicado não encontrado.'}
          onRetry={() => annQ.refetch()}
        />
      </div>
    );
  }

  const ann = annQ.data;
  const canRemind = ann.requires_confirmation && stats.unconfirmed > 0;
  const canEdit = ann.status === 'pending_approval' || ann.status === 'scheduled';

  return (
    <div className="space-y-md">
      <PageHeader
        title="Comunicado"
        subtitle={STATUS_LABEL[ann.status] ?? ann.status}
        backTo="/mais/comunicados"
        right={
          <RowMenu items={[
            ...(canEdit ? [{ label: 'Editar', onClick: () => setEditOpen(true) }] : []),
            { label: 'Excluir comunicado', danger: true, confirm: 'Excluir? Não dá pra desfazer.', onClick: () => deleteMutation.mutate() },
          ]} />
        }
      />

      {/* Body */}
      <section className="bg-bg-surface rounded-xl border border-border p-4 space-y-2">
        <p className="text-caption uppercase font-semibold text-fg-muted">Mensagem</p>
        <p className="text-body text-fg" style={{ whiteSpace: 'pre-wrap' }}>{ann.body}</p>
        {ann.requires_confirmation && (
          <p className="text-caption text-tom inline-flex items-center gap-1 mt-1">
            <CheckCircle2 size={12} />
            Pediu confirmação de leitura
          </p>
        )}
      </section>

      {/* Meta */}
      <section className="bg-bg-surface rounded-xl border border-border p-4 space-y-2">
        <p className="text-caption uppercase font-semibold text-fg-muted">Resumo</p>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <span className="text-body-sm text-fg-muted">Público</span>
          <span className="text-body text-fg">{audienceLabel(ann.audience as AnnouncementAudience)}</span>
          <span className="text-body-sm text-fg-muted">Criado em</span>
          <span className="text-body text-fg">{formatDate(ann.created_at)}</span>
          {ann.scheduled_at && (
            <>
              <span className="text-body-sm text-fg-muted">Agendado para</span>
              <span className="text-body text-fg">{formatDate(ann.scheduled_at)}</span>
            </>
          )}
          {ann.rejection_reason && (
            <>
              <span className="text-body-sm text-fg-muted">Rejeitado</span>
              <span className="text-body text-danger">{ann.rejection_reason}</span>
            </>
          )}
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatBox icon={<Send size={14} />} label="Enviados" value={stats.sent} total={stats.total} tone="success" />
        <StatBox icon={<Clock size={14} />} label="Pendentes" value={stats.pending} total={stats.total} tone="warning" />
        {ann.requires_confirmation && (
          <StatBox icon={<CheckCircle2 size={14} />} label="Confirmaram" value={stats.confirmed} total={stats.sent || stats.total} tone="tom" />
        )}
        {stats.failed > 0 && (
          <StatBox icon={<AlertCircle size={14} />} label="Falharam" value={stats.failed} total={stats.total} tone="danger" />
        )}
      </section>

      {/* Ação remind */}
      {canRemind && (
        <Button variant="secondary" onClick={() => remindUnconfirmed.mutate()} disabled={remindUnconfirmed.isPending} fullWidth>
          {remindUnconfirmed.isPending ? 'Agendando…' : `Lembrar ${stats.unconfirmed} pessoa(s) que não confirmaram`}
        </Button>
      )}

      {/* Lista por destinatário */}
      <section className="bg-bg-surface rounded-xl border border-border p-4 space-y-2">
        <p className="text-caption uppercase font-semibold text-fg-muted">Por destinatário</p>
        {jobsQ.isLoading ? (
          <LoadingState rows={3} />
        ) : jobsQ.error ? (
          <p className="text-danger text-body-sm">{(jobsQ.error as Error).message}</p>
        ) : !jobsQ.data || jobsQ.data.length === 0 ? (
          <EmptyState title="Sem destinatários" />
        ) : (
          <ul className="divide-y divide-border">
            {jobsQ.data.map(j => {
              const name = j.recipient?.full_name ?? j.phone;
              const confirmed = !!j.confirmed_at;
              const tone = confirmed
                ? 'success'
                : j.status === 'sent' ? 'warning'
                : j.status === 'failed' ? 'danger'
                : 'neutral';
              return (
                <li key={j.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-body truncate">{name}</p>
                    <p className="text-caption text-fg-muted">
                      {unitLabelShort(j.recipient?.unit ?? null)}
                      {j.sent_at && ` · entregue ${formatDate(j.sent_at)}`}
                      {confirmed && ` · ✅ confirmou ${formatDate(j.confirmed_at)}`}
                    </p>
                  </div>
                  <Badge tone={tone as 'success' | 'warning' | 'danger' | 'neutral'}>
                    {confirmed ? 'Confirmou' : JOB_STATUS_LABEL[j.status] ?? j.status}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ComunicadoSheet
        open={editOpen}
        onClose={() => { setEditOpen(false); qc.invalidateQueries({ queryKey: ['comunicado', id] }); }}
        editTarget={editOpen ? {
          id: ann.id,
          body: ann.body,
          audience: ann.audience as AnnouncementAudience,
          requires_confirmation: !!ann.requires_confirmation,
          scheduled_at: ann.scheduled_at,
          status: ann.status,
        } : null}
      />
    </div>
  );
}

function StatBox({ icon, label, value, total, tone }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  total: number;
  tone: 'success' | 'warning' | 'danger' | 'tom' | 'neutral';
}) {
  const toneClass: Record<string, string> = {
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    tom: 'text-tom',
    neutral: 'text-fg',
  };
  return (
    <div className="bg-bg-surface rounded-xl border border-border p-3">
      <div className={`flex items-center gap-1 text-caption ${toneClass[tone]}`}>{icon}<span className="text-fg-muted uppercase font-semibold">{label}</span></div>
      <p className="text-section-title mt-1 tabular-nums">
        {value}<span className="text-body-sm text-fg-muted">/{total}</span>
      </p>
    </div>
  );
}
