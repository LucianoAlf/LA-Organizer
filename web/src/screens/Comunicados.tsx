import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ComunicadoSheet } from '../components/ComunicadoSheet';
import { PageHeader } from '../components/PageHeader';
import { audienceLabel } from '../types';
import type { Announcement, AnnouncementJob } from '../types';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendado',
  sending: 'Enviando',
  sent: 'Enviado',
  cancelled: 'Cancelado',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'text-fg-muted',
  scheduled: 'text-warning',
  sending: 'text-brand',
  sent: 'text-success',
  cancelled: 'text-danger',
};

export function Comunicados() {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['comunicados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
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

  const { mutate: cancelAnnouncement } = useMutation({
    mutationFn: async (id: string) => {
      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator!.id,
      });
      const { error } = await supabase
        .from('announcements')
        .update({ status: 'cancelled' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { setCancelError(''); queryClient.invalidateQueries({ queryKey: ['comunicados'] }); },
    onError: (err: Error) => setCancelError(err.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Comunicados" subtitle="Anúncios enviados para a equipe" backTo="/mais" />

      {isLoading && <p className="text-body-sm text-fg-muted">Carregando...</p>}

      {!isLoading && announcements.length === 0 && (
        <p className="text-body-sm text-fg-muted">Nenhum comunicado enviado ainda.</p>
      )}

      {cancelError && <p className="text-danger text-body-sm">{cancelError}</p>}

      <ul className="space-y-2">
        {announcements.map(ann => {
          const counts = jobCounts[ann.id];
          return (
            <li key={ann.id} className="bg-bg-surface rounded-xl border border-border p-4 space-y-1.5">
              <p className="text-body line-clamp-2">{ann.body}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-body-sm text-fg-muted">
                  {audienceLabel(ann.audience)}
                </span>
                <span className={`text-body-sm font-medium ${STATUS_COLOR[ann.status] ?? ''}`}>
                  {STATUS_LABEL[ann.status] ?? ann.status}
                  {ann.status === 'sending' && counts
                    ? ` ${counts.sent}/${counts.total}`
                    : ''}
                </span>
                {ann.scheduled_at && ann.status === 'scheduled' && (
                  <span className="text-body-sm text-fg-muted">
                    {new Date(ann.scheduled_at).toLocaleString('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                )}
              </div>
              {(ann.status === 'scheduled' || ann.status === 'sending') && (
                <button
                  type="button"
                  onClick={() => cancelAnnouncement(ann.id)}
                  className="text-body-sm text-danger underline focus:outline-none focus-visible:ring-2"
                >
                  Cancelar comunicado
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="fixed bottom-24 right-4 h-14 w-14 rounded-full bg-brand text-white shadow-lg flex items-center justify-center focus-ring"
        aria-label="Novo comunicado"
      >
        <Plus size={24} />
      </button>

      <ComunicadoSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
