import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { AprovacaoSheet } from '../components/AprovacaoSheet';
import {
  audienceLabel,
  detectDuplicates,
  timeAgo,
  statusLabel,
  type Announcement,
  type AnnouncementWithMetrics,
} from '../types';

type RawRow = Announcement & {
  author?: { id: string; full_name: string | null } | null;
  reviewer?: { id: string; full_name: string | null } | null;
  jobs?: { status: string }[];
};

function aggregateJobs(rows: RawRow[]): AnnouncementWithMetrics[] {
  return rows.map(r => {
    const jobs = r.jobs ?? [];
    return {
      ...r,
      author_name: r.author?.full_name ?? null,
      reviewer_name: r.reviewer?.full_name ?? null,
      jobs_total: jobs.length,
      jobs_sent: jobs.filter(j => j.status === 'sent').length,
      jobs_failed: jobs.filter(j => j.status === 'failed').length,
      jobs_cancelled: jobs.filter(j => j.status === 'cancelled').length,
      jobs_pending: jobs.filter(j => j.status === 'pending').length,
    };
  });
}

export function Observabilidade() {
  const { collaborator, role } = useAuth();
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<Announcement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isDirector = role === 'director';

  const { data: items = [], isLoading, isError, error } = useQuery({
    queryKey: ['observabilidade'],
    queryFn: async (): Promise<AnnouncementWithMetrics[]> => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { data, error } = await supabase
        .from('announcements')
        .select(`
          *,
          author:collaborators!created_by(id, full_name),
          reviewer:collaborators!reviewed_by(id, full_name),
          jobs:announcement_jobs(status)
        `)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return aggregateJobs((data ?? []) as RawRow[]);
    },
    refetchInterval: 15_000,
  });

  const approveMut = useMutation({
    mutationFn: async (announcementId: string) => {
      if (!collaborator?.id) throw new Error('Sem sessão');
      await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator.id });
      const { error } = await supabase
        .from('announcements')
        .update({ status: 'scheduled', reviewed_by: collaborator.id })
        .eq('id', announcementId)
        .eq('status', 'pending_approval');
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['observabilidade'] }),
    onError: (e: any) => setActionError(e?.message ?? 'Erro ao aprovar.'),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string | null }) => {
      if (!collaborator?.id) throw new Error('Sem sessão');
      await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator.id });
      const { error } = await supabase
        .from('announcements')
        .update({
          status: 'rejected',
          reviewed_by: collaborator.id,
          rejection_reason: reason,
        })
        .eq('id', id)
        .eq('status', 'pending_approval');
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['observabilidade'] }),
    onError: (e: any) => setActionError(e?.message ?? 'Erro ao rejeitar.'),
  });

  const pending = items.filter(a => a.status === 'pending_approval');
  const live = items.filter(a => a.status === 'sending' || a.status === 'scheduled');
  const history = items.filter(
    a => !['pending_approval', 'scheduled', 'sending'].includes(a.status),
  );
  const duplicateIds = useMemo(() => detectDuplicates(items), [items]);

  return (
    <div className="space-y-lg">
      <header>
        <h2 className="text-section-title">Observabilidade</h2>
        <p className="text-body-sm text-fg-muted mt-1">
          Aprovações pendentes · fila ao vivo · histórico de envios
        </p>
      </header>

      {isError && (
        <div className="surface p-md border border-danger bg-danger/10 text-body-sm text-danger">
          Erro carregando comunicados: {(error as any)?.message ?? 'erro desconhecido'}
        </div>
      )}

      {duplicateIds.size > 0 && (
        <div className="surface p-md border border-warning bg-warning/10 text-body-sm">
          ⚠️ Atenção: há {duplicateIds.size} comunicado(s) ativo(s) para o mesmo público hoje.
          Verifique antes de aprovar para evitar duplicidade.
        </div>
      )}

      {actionError && (
        <div className="surface p-md border border-danger bg-danger/10 text-body-sm text-danger">
          {actionError}
          <button onClick={() => setActionError(null)} className="ml-2 underline">fechar</button>
        </div>
      )}

      {/* Bloco 1 — Fila de aprovação */}
      <section>
        <h3 className="text-body-md font-medium mb-md">Fila de aprovação</h3>
        {isLoading ? (
          <div className="text-body-sm text-fg-muted">Carregando...</div>
        ) : pending.length === 0 ? (
          <div className="surface p-md text-body-sm text-fg-muted">
            Nenhum comunicado aguardando aprovação.
          </div>
        ) : (
          <ul className="space-y-md">
            {pending.map(a => (
              <li key={a.id} className={`surface p-md ${duplicateIds.has(a.id) ? 'border-warning' : ''}`}>
                <div className="flex items-start justify-between gap-md">
                  <div className="flex-1 min-w-0">
                    <div className="text-body-sm text-fg-muted">
                      {a.author_name ?? 'desconhecido'} · {audienceLabel(a.audience)} · {timeAgo(a.created_at)}
                    </div>
                    <div className="text-body-md mt-1 break-words">
                      {a.body.length > 200 ? a.body.slice(0, 200) + '...' : a.body}
                    </div>
                  </div>
                  {isDirector && a.created_by !== collaborator?.id ? (
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => approveMut.mutate(a.id)}
                        disabled={approveMut.isPending}
                        className="h-8 px-3 rounded-sm bg-success/10 border border-success/40 text-success text-body-sm focus-ring"
                      >
                        ✅ Aprovar
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejecting(a)}
                        className="h-8 px-3 rounded-sm bg-danger/10 border border-danger/40 text-danger text-body-sm focus-ring"
                      >
                        ❌ Rejeitar
                      </button>
                    </div>
                  ) : isDirector && a.created_by === collaborator?.id ? (
                    <span className="text-body-sm text-fg-muted shrink-0">Autor — aguardando outro director</span>
                  ) : (
                    <span className="text-body-sm text-fg-muted shrink-0">Aguardando director</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Bloco 2 — Fila ao vivo */}
      {live.length > 0 && (
        <section>
          <h3 className="text-body-md font-medium mb-md">Fila ao vivo</h3>
          <ul className="space-y-md">
            {live.map(a => (
              <li key={a.id} className="surface p-md">
                <div className="text-body-sm text-fg-muted">
                  {statusLabel(a.status)} · {audienceLabel(a.audience)}
                  {a.scheduled_at && a.status === 'scheduled' && (
                    <> · agendado para {new Date(a.scheduled_at).toLocaleString('pt-BR')}</>
                  )}
                </div>
                <div className="text-body-md mt-1 break-words">
                  {a.body.length > 120 ? a.body.slice(0, 120) + '...' : a.body}
                </div>
                {a.status === 'sending' && a.jobs_total > 0 && (
                  <div className="mt-2 text-body-sm">
                    <div className="text-fg-muted">{a.jobs_sent} de {a.jobs_total} enviados</div>
                    <div className="h-1 bg-bg-elevated rounded-sm mt-1 overflow-hidden">
                      <div
                        className="h-full bg-brand transition-all"
                        style={{ width: `${(a.jobs_sent / a.jobs_total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Bloco 3 — Histórico recente */}
      <section>
        <h3 className="text-body-md font-medium mb-md">Histórico (últimos 30 dias)</h3>
        {history.length === 0 ? (
          <div className="surface p-md text-body-sm text-fg-muted">
            Nenhum comunicado finalizado nos últimos 30 dias.
          </div>
        ) : (
          <ul className="space-y-md">
            {history.map(a => (
              <li key={a.id} className="surface p-md">
                <div className="flex items-center justify-between gap-md">
                  <div className="flex-1 min-w-0">
                    <div className="text-body-sm text-fg-muted">
                      {statusLabel(a.status)} · {audienceLabel(a.audience)} · {new Date(a.created_at).toLocaleString('pt-BR')}
                    </div>
                    <div className="text-body-md mt-1 truncate">{a.body}</div>
                    {a.status === 'rejected' && a.rejection_reason && (
                      <div className="text-body-sm text-fg-muted italic mt-1">
                        Motivo: {a.rejection_reason}
                      </div>
                    )}
                  </div>
                  {a.status === 'sent' && (
                    <div className="text-body-sm text-fg-muted shrink-0 text-right">
                      {a.jobs_sent} env / {a.jobs_failed} falh / {a.jobs_cancelled} canc
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AprovacaoSheet
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        announcement={rejecting}
        onConfirm={async (reason) => {
          if (!rejecting) return;
          await rejectMut.mutateAsync({ id: rejecting.id, reason });
        }}
      />
    </div>
  );
}
