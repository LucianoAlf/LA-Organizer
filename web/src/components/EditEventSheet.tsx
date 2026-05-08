import { useState, useEffect, FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { CustomSelect } from './CustomSelect';
import { DateTimeInput } from './DateTimeInput';
import { useEventCategories } from '../hooks/useEventCategories';
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
  const [categoryId, setCategoryId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [locationText, setLocationText] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const eventCategories = useEventCategories();

  useEffect(() => {
    if (open && event) {
      setTitle(event.title || '');
      setCategoryId(event.category_id || '');
      setStartAt(isoToLocalInput(event.start_at));
      setEndAt(isoToLocalInput(event.end_at));
      setLocationText(event.location_text || '');
      setMeetingUrl(event.meeting_url || '');
      setValidationError(null);
      setConfirmCancel(false);
      setConfirmDelete(false);
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
    setValidationError(null);
    if (!event) return;
    if (!title.trim()) {
      setValidationError('Título é obrigatório.');
      return;
    }
    if (!startAt) {
      setValidationError('Início inválido (data + hora).');
      return;
    }
    if (!endAt) {
      setValidationError('Fim inválido (data + hora).');
      return;
    }
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      setValidationError('Fim precisa ser depois do início.');
      return;
    }
    if (!categoryId) {
      setValidationError('Escolhe uma categoria.');
      return;
    }
    const cat = eventCategories.byId(categoryId);
    if (!cat) {
      setValidationError('Categoria inválida.');
      return;
    }
    update.mutate({
      title: title.trim().slice(0, 200),
      category_id: cat.id,
      // Sprint 22.26 — context derivado da categoria escolhida (work/personal).
      context: cat.context,
      start_at: localInputToIso(startAt),
      end_at: localInputToIso(endAt),
      location_text: locationText.trim() ? locationText.trim().slice(0, 200) : null,
      meeting_url: isOnlineLike && meetingUrl.trim() ? meetingUrl.trim().slice(0, 500) : null,
    });
  };

  const onCancel = () => {
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    update.mutate({ status: 'cancelled' });
  };
  const onComplete = () => update.mutate({ status: 'done' });

  // Sprint 22.28 — delete real (apaga do DB; diferente de cancel que mantem
  // historico). Confirm inline obrigatorio antes de executar.
  const deleteEvent = useMutation({
    mutationFn: async () => {
      if (!collaborator || !event) throw new Error('no_event');
      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', event.id)
        .eq('collaborator_id', collaborator.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      onClose();
    },
  });

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

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Categoria</div>
            <CustomSelect
              value={categoryId}
              placeholder="— Escolher categoria —"
              onChange={setCategoryId}
              options={[
                ...eventCategories.workCategories.map(c => ({ value: c.id, label: c.label })),
                ...eventCategories.personalCategories.map(c => ({
                  value: c.id, label: c.label,
                  sublabel: c.is_system ? undefined : 'minha',
                })),
              ]}
            />
            <div className="text-body-sm text-fg-muted mt-1.5">
              {eventCategories.byId(categoryId)?.context === 'personal'
                ? 'Compromisso pessoal · só você vê.'
                : 'Compromisso de trabalho · coordenação enxerga.'}
            </div>
          </div>

          <div className="space-y-md">
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Início</div>
              <DateTimeInput value={startAt} onChange={setStartAt} />
            </div>
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Fim</div>
              <DateTimeInput value={endAt} onChange={setEndAt} invalid={Boolean(endBeforeStart)} />
            </div>
          </div>
          {endBeforeStart && (
            <p role="alert" className="text-body-sm text-danger">Fim precisa ser depois do início.</p>
          )}
          {validationError && (
            <p role="alert" className="text-body-sm text-danger">{validationError}</p>
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
            {confirmCancel ? (
              <div className="surface p-sm bg-danger/5 border-danger/30 space-y-sm" role="alert">
                <div className="text-body-sm text-fg">
                  Cancelar este compromisso? Ele fica como histórico, não some.
                </div>
                <div className="flex items-center gap-sm">
                  <Button
                    type="button"
                    variant="danger"
                    onClick={onCancel}
                    disabled={update.isPending}
                    fullWidth
                  >
                    Sim, cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setConfirmCancel(false)}
                    disabled={update.isPending}
                    fullWidth
                  >
                    Voltar
                  </Button>
                </div>
              </div>
            ) : confirmDelete ? (
              <div className="surface p-sm bg-danger/5 border-danger/30 space-y-sm" role="alert">
                <div className="text-body-sm text-fg">
                  Excluir este compromisso? Some pra sempre. Não dá pra desfazer.
                </div>
                <div className="flex items-center gap-sm">
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => deleteEvent.mutate()}
                    disabled={deleteEvent.isPending}
                    loading={deleteEvent.isPending}
                    fullWidth
                  >
                    Sim, excluir
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleteEvent.isPending}
                    fullWidth
                  >
                    Voltar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-sm">
                  <Button type="button" variant="secondary" onClick={onComplete} disabled={update.isPending || event.status === 'done'}>
                    Concluir
                  </Button>
                  <Button type="button" variant="secondary" onClick={onCancel} disabled={update.isPending || event.status === 'cancelled'}>
                    Cancelar evento
                  </Button>
                  <Button type="button" variant="ghost" onClick={onClose} className="ml-auto">Fechar</Button>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={update.isPending || deleteEvent.isPending}
                  className="text-body-sm text-danger hover:text-danger/80 focus-ring rounded-sm px-2 py-1 self-start"
                >
                  Excluir compromisso
                </button>
              </>
            )}
          </div>
        </form>
      )}
    </BottomSheet>
  );
}
