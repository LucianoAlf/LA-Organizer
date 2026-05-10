import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { DateInput } from './DateInput';
import { TimeInput } from './TimeInput';
import { CustomSelect } from './CustomSelect';
import { Checkbox } from './Checkbox';
import { buildEventAnnouncements } from '../types';
import type { AnnouncementAudience } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const UNIT_OPTIONS = [
  { value: '', label: 'Escola toda' },
  { value: 'barra', label: 'Barra' },
  { value: 'recreio', label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
];

export function EventoSheet({ open, onClose }: Props) {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [unit, setUnit] = useState('');
  const [location, setLocation] = useState('');
  const [notifyLeadership, setNotifyLeadership] = useState(true);
  const [notifySchool, setNotifySchool] = useState(true);
  const [notifyUnit, setNotifyUnit] = useState(true);
  const [notifyDayOf, setNotifyDayOf] = useState(true);
  const [error, setError] = useState('');

  const hasNotification = notifyLeadership || notifySchool || notifyUnit || notifyDayOf;
  const canSave = title.trim().length > 0 && eventDate.length > 0 && hasNotification;

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      setError('');
      const evPayload = {
        title: title.trim(),
        event_date: eventDate,
        start_time: startTime || null,
        unit: unit || null,
        location: location.trim() || null,
        notify_leadership: notifyLeadership,
        notify_school: notifySchool,
        notify_unit: notifyUnit,
        notify_day_of: notifyDayOf,
      };

      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator!.id,
      });

      const { data: ev, error: evErr } = await supabase
        .from('school_events')
        .insert({ ...evPayload, created_by: collaborator!.id })
        .select('id')
        .single();
      if (evErr) throw evErr;

      const specs = buildEventAnnouncements(evPayload);
      for (const spec of specs) {
        const { data: ann, error: annErr } = await supabase
          .from('announcements')
          .insert({
            created_by: collaborator!.id,
            body: spec.body,
            audience: spec.audience as AnnouncementAudience,
            status: 'scheduled',
            scheduled_at: spec.scheduled_at,
            source_event_id: ev.id,
          })
          .select('id')
          .single();
        if (annErr) throw annErr;

        let q = supabase
          .from('collaborators')
          .select('id, phone')
          .eq('is_active', true)
          .not('phone', 'is', null);
        const aud = spec.audience as AnnouncementAudience;
        if (!aud.all) {
          if (aud.function_role?.length) q = q.in('function_role', aud.function_role);
          if (aud.unidade?.length) q = q.in('unit', aud.unidade);
        }
        const { data: recipients } = await q;
        if (recipients?.length) {
          const jobs = recipients.map(r => ({
            announcement_id: ann.id,
            recipient_id: r.id,
            phone: r.phone,
          }));
          const { error: jobErr } = await supabase.from('announcement_jobs').insert(jobs);
          if (jobErr) {
            // compensating delete: remove orphan announcement
            await supabase.from('announcements').delete().eq('id', ann.id);
            throw jobErr;
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agenda-escolar'] });
      setTitle('');
      setEventDate('');
      setStartTime('');
      setUnit('');
      setLocation('');
      setNotifyLeadership(true);
      setNotifySchool(true);
      setNotifyUnit(true);
      setNotifyDayOf(true);
      setError('');
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const unitForLabel = unit
    ? UNIT_OPTIONS.find(o => o.value === unit)?.label ?? 'Unidade'
    : 'Escola toda';

  return (
    <BottomSheet open={open} onClose={onClose} title="Novo evento">
      <div className="space-y-4 pb-4">
        <div>
          <label className="text-caption text-fg-muted block mb-1">Título *</label>
          <input
            type="text"
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-tom"
            placeholder="Ex: Show de Fim de Ano"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-caption text-fg-muted block mb-1">Data *</label>
            <DateInput value={eventDate} onChange={setEventDate} />
          </div>
          <div className="flex-1">
            <label className="text-caption text-fg-muted block mb-1">Horário</label>
            <TimeInput value={startTime} onChange={setStartTime} />
          </div>
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Unidade</label>
          <CustomSelect
            value={unit}
            options={UNIT_OPTIONS}
            onChange={setUnit}
            placeholder="Selecionar"
          />
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Local (opcional)</label>
          <input
            type="text"
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-tom"
            placeholder="Ex: Teatro Municipal"
            value={location}
            onChange={e => setLocation(e.target.value)}
          />
        </div>

        <div>
          <p className="text-caption uppercase font-semibold text-fg-muted mb-2">Notificações</p>
          <div className="space-y-2">
            <Checkbox
              checked={notifyLeadership}
              onChange={setNotifyLeadership}
              label="Liderança — imediato ao criar"
            />
            <Checkbox
              checked={notifySchool}
              onChange={setNotifySchool}
              label="Escola toda — 3 dias antes"
            />
            <Checkbox
              checked={notifyUnit}
              onChange={setNotifyUnit}
              label={`${unitForLabel} — 1 dia antes`}
            />
            <Checkbox
              checked={notifyDayOf}
              onChange={setNotifyDayOf}
              label="Notif. No dia (09h)"
            />
          </div>
          {!hasNotification && (
            <p className="text-danger text-caption mt-1">Selecione ao menos uma notificação</p>
          )}
        </div>

        {error && <p className="text-danger text-caption">{error}</p>}

        <Button
          variant="primary"
          fullWidth
          disabled={!canSave || isPending}
          onClick={() => mutate()}
        >
          {isPending ? 'Criando…' : 'Criar evento'}
        </Button>
      </div>
    </BottomSheet>
  );
}
