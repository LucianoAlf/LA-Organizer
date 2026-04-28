import { useState, useEffect, FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import type { CalendarEvent } from '../types';

interface Props {
  open: boolean;
  event: CalendarEvent | null;
  onClose: () => void;
}

// "2026-04-29T17:00:00+00:00" (UTC) ou "2026-04-29T14:00:00-03:00" (SP) → "2026-04-29T14:00" (datetime-local em SP).
// Normaliza qualquer ISO para o instante em America/Sao_Paulo e devolve no formato que <input type="datetime-local"> aceita.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const spMs = d.getTime() - 3 * 60 * 60 * 1000; // -03:00 fixo (sem DST no Brasil)
  const sp = new Date(spMs);
  return sp.toISOString().slice(0, 16);
}

const localInputToIso = (local: string) => `${local}:00-03:00`;

export function EditEventSheet({ open, event, onClose }: Props) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [locationText, setLocationText] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');

  useEffect(() => {
    if (open && event) {
      setTitle(event.title || '');
      setStartAt(isoToLocalInput(event.start_at));
      setEndAt(isoToLocalInput(event.end_at));
      setLocationText(event.location_text || '');
      setMeetingUrl(event.meeting_url || '');
    }
  }, [open, event]);

  const isOnlineLike = event?.modality === 'online' || event?.modality === 'hibrido';

  const update = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      if (!collaborator || !event) throw new Error('no_event');
      const { error } = await supabase
        .from('events')
        .update(patch)
        .eq('id', event.id)
        .eq('collaborator_id', collaborator.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['hoje'] });
      qc.invalidateQueries({ queryKey: ['semana'] });
      onClose();
    },
  });

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    if (!event) return;
    if (!title.trim() || !startAt || !endAt) return;
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) return;
    update.mutate({
      title: title.trim().slice(0, 200),
      start_at: localInputToIso(startAt),
      end_at: localInputToIso(endAt),
      location_text: locationText.trim() ? locationText.trim().slice(0, 200) : null,
      meeting_url: isOnlineLike && meetingUrl.trim() ? meetingUrl.trim().slice(0, 500) : null,
    });
  };

  const onCancel = () => update.mutate({ status: 'cancelled' });
  const onComplete = () => update.mutate({ status: 'done' });

  const endBeforeStart = startAt && endAt && new Date(endAt).getTime() <= new Date(startAt).getTime();

  return (
    <BottomSheet open={open && Boolean(event)} onClose={onClose} title="Editar compromisso">
      {event && (
        <form onSubmit={onSave} className="space-y-md">
          <label className="block">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Título</div>
            <input
              type="text"
              required
              maxLength={200}
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg focus-ring"
            />
          </label>

          <div className="grid grid-cols-2 gap-md">
            <label className="block">
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Início</div>
              <input
                type="datetime-local"
                required
                value={startAt}
                onChange={e => setStartAt(e.target.value)}
                className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg focus-ring"
              />
            </label>
            <label className="block">
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Fim</div>
              <input
                type="datetime-local"
                required
                value={endAt}
                onChange={e => setEndAt(e.target.value)}
                className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg focus-ring"
              />
            </label>
          </div>
          {endBeforeStart && (
            <p role="alert" className="text-body-sm text-danger">Fim precisa ser depois do início.</p>
          )}

          <label className="block">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Local</div>
            <input
              type="text"
              maxLength={200}
              value={locationText}
              onChange={e => setLocationText(e.target.value)}
              placeholder={isOnlineLike ? 'opcional' : 'sala, endereço…'}
              className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg focus-ring"
            />
          </label>

          {isOnlineLike && (
            <label className="block">
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Link da reunião</div>
              <input
                type="url"
                maxLength={500}
                value={meetingUrl}
                onChange={e => setMeetingUrl(e.target.value)}
                placeholder="https://meet.google.com/…"
                className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg focus-ring"
              />
            </label>
          )}

          {update.error && (
            <p role="alert" className="text-body-sm text-danger">
              Não consegui salvar. {(update.error as Error).message}
            </p>
          )}

          <div className="flex flex-col gap-sm pt-2">
            <Button type="submit" loading={update.isPending} fullWidth disabled={Boolean(endBeforeStart)}>
              Salvar
            </Button>
            <div className="flex items-center gap-sm">
              <Button type="button" variant="secondary" onClick={onComplete} disabled={update.isPending || event.status === 'done'}>
                Concluir
              </Button>
              <Button type="button" variant="secondary" onClick={onCancel} disabled={update.isPending || event.status === 'cancelled'}>
                Cancelar evento
              </Button>
              <Button type="button" variant="ghost" onClick={onClose} className="ml-auto">Fechar</Button>
            </div>
          </div>
        </form>
      )}
    </BottomSheet>
  );
}
