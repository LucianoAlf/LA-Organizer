import { useState, useEffect, FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { CustomSelect } from './CustomSelect';
import { DateTimeInput } from './DateTimeInput';
import { EisenhowerPicker } from './EisenhowerPicker';
import { ParticipantsPicker } from './ParticipantsPicker';
import { useEventCategories } from '../hooks/useEventCategories';
import { notifyEventInvites } from '../lib/tomEngine';
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
  // Sprint 22.50b — múltiplos lembretes. Array de datetime-local strings.
  const [reminderTimes, setReminderTimes] = useState<string[]>([]);
  const [originalReminders, setOriginalReminders] = useState<Array<{ id: string; remindAtLocal: string }>>([]);
  const [quadrant, setQuadrant] = useState<number | null>(null);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [originalParticipantIds, setOriginalParticipantIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const eventCategories = useEventCategories();

  // Sprint 22.32 — colabs ativos pra picker.
  const { data: collaborators = [] } = useQuery({
    queryKey: ['collaborators-active', collaborator?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators').select('id, full_name, role').eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) return [];
      return ((data ?? []) as Array<{ id: string; full_name: string; role: string }>)
        .filter(c => c.id !== collaborator?.id);
    },
    enabled: open && Boolean(collaborator?.id),
    staleTime: 5 * 60_000,
  });

  // Sprint 22.32 — fetch participants do evento sendo editado.
  const { data: existingParticipants = [] } = useQuery({
    queryKey: ['event-participants', event?.id],
    queryFn: async () => {
      if (!event) return [];
      const { data, error } = await supabase
        .from('event_participants')
        .select('id, collaborator_id, status')
        .eq('event_id', event.id);
      if (error) return [];
      return (data ?? []) as Array<{ id: string; collaborator_id: string; status: string }>;
    },
    enabled: open && Boolean(event?.id),
  });

  // Sprint 22.31 — dep event?.id em vez de event ref pra nao resetar state
  // quando refetch do React Query chega em background.
  useEffect(() => {
    if (open && event) {
      setTitle(event.title || '');
      setCategoryId(event.category_id || '');
      setStartAt(isoToLocalInput(event.start_at));
      setEndAt(isoToLocalInput(event.end_at));
      setLocationText(event.location_text || '');
      setMeetingUrl(event.meeting_url || '');
      // Sprint 22.50b — lembretes carregados via query separada (effect abaixo).
      setQuadrant(event.eisenhower_quadrant ?? null);
      setValidationError(null);
      setConfirmCancel(false);
      setConfirmDelete(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id]);

  // Sprint 22.32 — quando carrega lista de participants do banco, popula state.
  useEffect(() => {
    const ids = existingParticipants.map(p => p.collaborator_id);
    setParticipantIds(ids);
    setOriginalParticipantIds(ids);
  }, [existingParticipants]);

  // Sprint 22.50b — fetch lembretes existentes do evento.
  const { data: existingReminders = [] } = useQuery({
    queryKey: ['event-reminders', event?.id],
    queryFn: async () => {
      if (!event) return [];
      const { data, error } = await supabase
        .from('event_reminders')
        .select('id, remind_at')
        .eq('event_id', event.id)
        .order('remind_at', { ascending: true });
      if (error) return [];
      return (data ?? []) as Array<{ id: string; remind_at: string }>;
    },
    enabled: open && Boolean(event?.id),
  });

  useEffect(() => {
    const mapped = existingReminders.map(r => ({ id: r.id, remindAtLocal: isoToLocalInput(r.remind_at) }));
    setOriginalReminders(mapped);
    setReminderTimes(mapped.map(r => r.remindAtLocal));
  }, [existingReminders]);

  const isOnlineLike = event?.modality === 'online' || event?.modality === 'hibrido';

  const update = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      if (!collaborator || !event) throw new Error('no_event');
      const { data, error } = await supabase
        .from('events')
        .update(patch)
        .eq('id', event.id)
        .eq('collaborator_id', collaborator.id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Não consegui salvar (sem permissão ou compromisso removido).');
      }
      return patch;
    },
    onSuccess: (patch) => {
      // Sprint 22.32 — optimistic: aplica patch no cache events imediato.
      if (event) {
        qc.setQueriesData<unknown>({ queryKey: ['events'] }, (old: unknown) => {
          if (!Array.isArray(old)) return old;
          return (old as Array<{ id: string }>).map(e =>
            e.id === event.id ? { ...e, ...patch } : e,
          );
        });
      }
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
      eisenhower_quadrant: quadrant,
    }, {
      onSuccess: () => {
        // Sprint 22.32 — diff de participants e aplica add/remove.
        if (event && collaborator) {
          const orig = new Set(originalParticipantIds);
          const next = new Set(participantIds);
          const toAdd = participantIds.filter(id => !orig.has(id));
          const toRemove = originalParticipantIds.filter(id => !next.has(id));
          (async () => {
            try {
              if (toAdd.length > 0) {
                const rows = toAdd.map(pid => ({
                  event_id: event.id,
                  collaborator_id: pid,
                  invited_by: collaborator.id,
                  status: 'invited' as const,
                }));
                await supabase.from('event_participants').insert(rows);
              }
              if (toRemove.length > 0) {
                await supabase.from('event_participants')
                  .delete()
                  .eq('event_id', event.id)
                  .in('collaborator_id', toRemove);
              }
              qc.invalidateQueries({ queryKey: ['event-participants', event.id] });
              // Sprint 22.33 — endpoint filtra participants com notified_at NULL,
              // entao chamar sempre eh idempotente. So ressoa pra novos add.
              if (toAdd.length > 0) void notifyEventInvites(event.id);
            } catch (e) {
              console.warn('[EditEventSheet] participants diff err:', e instanceof Error ? e.message : e);
            }
          })();

          // Sprint 22.50b — diff de lembretes. Insert pra times novos, delete pra removidos.
          (async () => {
            try {
              const origLocal = new Set(originalReminders.map(r => r.remindAtLocal));
              const nextLocal = new Set(reminderTimes);
              const toInsert = [...nextLocal].filter(t => !origLocal.has(t));
              const toDelete = originalReminders.filter(r => !nextLocal.has(r.remindAtLocal)).map(r => r.id);
              if (toInsert.length > 0) {
                const rows = toInsert.map(t => ({
                  event_id: event.id,
                  remind_at: localInputToIso(t),
                }));
                await supabase.from('event_reminders').insert(rows);
              }
              if (toDelete.length > 0) {
                await supabase.from('event_reminders').delete().in('id', toDelete);
              }
              qc.invalidateQueries({ queryKey: ['event-reminders', event.id] });
            } catch (e) {
              console.warn('[EditEventSheet] reminders diff err:', e instanceof Error ? e.message : e);
            }
          })();
        }
      },
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

          {/* Sprint 22.50b — Múltiplos lembretes. Chips toggleáveis (selecionados ficam
              olive). Lista os horários customizados abaixo com botão Remover. */}
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
              <span>Lembretes</span>
              <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">selecione quantos quiser</span>
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {[
                { label: 'Na hora', minutes: 0 },
                { label: '15min antes', minutes: 15 },
                { label: '30min antes', minutes: 30 },
                { label: '1h antes', minutes: 60 },
                { label: '2h antes', minutes: 120 },
                { label: '1 dia antes', minutes: 60 * 24 },
              ].map(p => {
                // Calcula o local-string que esse preset representaria pra startAt atual.
                const presetLocal = (() => {
                  if (!startAt) return '';
                  const t = new Date(localInputToIso(startAt)).getTime() - p.minutes * 60_000;
                  return isoToLocalInput(new Date(t).toISOString());
                })();
                const active = presetLocal && reminderTimes.includes(presetLocal);
                return (
                  <button
                    key={p.minutes}
                    type="button"
                    onClick={() => {
                      if (!presetLocal) return;
                      setReminderTimes(prev => active
                        ? prev.filter(t => t !== presetLocal)
                        : [...prev, presetLocal].sort());
                    }}
                    disabled={!startAt}
                    className={[
                      'px-3 py-1 rounded-full text-body-sm border transition-colors focus-ring',
                      active
                        ? 'bg-tom text-black border-tom'
                        : 'bg-bg-elevated text-fg-muted border-border hover:text-fg disabled:opacity-50',
                    ].join(' ')}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            {reminderTimes.length > 0 ? (
              <ul className="space-y-2">
                {reminderTimes.map((t, idx) => (
                  <li key={`${t}-${idx}`} className="flex items-center gap-2">
                    <DateTimeInput
                      value={t}
                      onChange={(v) => setReminderTimes(prev => {
                        const next = [...prev];
                        next[idx] = v;
                        return next;
                      })}
                    />
                    <button
                      type="button"
                      onClick={() => setReminderTimes(prev => prev.filter((_, i) => i !== idx))}
                      className="px-2 py-1 text-body-sm rounded-sm bg-bg-elevated text-danger hover:opacity-80 focus-ring whitespace-nowrap"
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-sm text-fg-muted">Sem lembretes. Toque num preset acima pra adicionar.</p>
            )}
          </div>

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

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
              <span>Prioridade</span>
              <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional</span>
            </div>
            <EisenhowerPicker value={quadrant} onChange={setQuadrant} />
          </div>

          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
              <span>Participantes</span>
              <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional</span>
            </div>
            <ParticipantsPicker
              options={collaborators}
              value={participantIds}
              onChange={setParticipantIds}
            />
            <div className="text-body-sm text-fg-muted mt-1.5">
              {participantIds.length === 0
                ? 'Sem convidados.'
                : `${participantIds.length} pessoa${participantIds.length > 1 ? 's' : ''} convidada${participantIds.length > 1 ? 's' : ''}.`}
            </div>
          </div>

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
              <div className="flex items-center gap-sm flex-wrap">
                <Button type="button" variant="secondary" onClick={onComplete} disabled={update.isPending || event.status === 'done'}>
                  Concluir
                </Button>
                <Button type="button" variant="secondary" onClick={onCancel} disabled={update.isPending || event.status === 'cancelled'}>
                  Cancelar evento
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setConfirmDelete(true)}
                  disabled={update.isPending || deleteEvent.isPending}
                >
                  Excluir
                </Button>
              </div>
            )}
          </div>
        </form>
      )}
    </BottomSheet>
  );
}
