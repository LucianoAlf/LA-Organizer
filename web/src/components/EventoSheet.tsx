import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { DateInput } from './DateInput';
import { TimeInput } from './TimeInput';
import { CustomSelect } from './CustomSelect';
import { Checkbox } from './Checkbox';
import { showToast } from './Toast';
import { buildEventAnnouncements, unitLabel } from '../types';
import type { AnnouncementAudience, EventType, SchoolEvent, SchoolUnit } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  editTarget?: SchoolEvent | null;
}

const ALL_UNITS: SchoolUnit[] = ['barra', 'recreio', 'campo_grande'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

type Attachment = { url: string; filename: string };

export function EventoSheet({ open, onClose, editTarget = null }: Props) {
  const isEditing = !!editTarget;
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState<string>('outro');
  const [eventDate, setEventDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [isAllDay, setIsAllDay] = useState(false);
  const [units, setUnits] = useState<SchoolUnit[]>([]);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notifyLeadership, setNotifyLeadership] = useState(true);
  const [notifySchool, setNotifySchool] = useState(true);
  const [notifyUnit, setNotifyUnit] = useState(true);
  const [notifyDayOf, setNotifyDayOf] = useState(true);
  const [error, setError] = useState('');

  // Pre-populate or reset on open.
  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      setTitle(editTarget.title ?? '');
      setEventType(editTarget.event_type ?? 'outro');
      setEventDate(editTarget.event_date ?? '');
      setEndDate(editTarget.end_date ?? '');
      setStartTime(editTarget.start_time?.slice(0, 5) ?? '');
      setIsAllDay(editTarget.is_all_day ?? false);
      const u = (editTarget.units && editTarget.units.length > 0)
        ? editTarget.units as SchoolUnit[]
        : (editTarget.unit ? [editTarget.unit as SchoolUnit] : []);
      setUnits(u);
      setLocation(editTarget.location ?? '');
      setDescription(editTarget.description ?? '');
      setImage(editTarget.image_url ? { url: editTarget.image_url, filename: editTarget.image_filename ?? '' } : null);
      setNotifyLeadership(false);
      setNotifySchool(false);
      setNotifyUnit(false);
      setNotifyDayOf(false);
    } else {
      setTitle('');
      setEventType('outro');
      setEventDate('');
      setEndDate('');
      setStartTime('');
      setIsAllDay(false);
      setUnits([]);
      setLocation('');
      setDescription('');
      setImage(null);
      setNotifyLeadership(true);
      setNotifySchool(true);
      setNotifyUnit(true);
      setNotifyDayOf(true);
    }
    setError('');
  }, [open, editTarget]);

  const typesQ = useQuery({
    queryKey: ['event-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_types')
        .select('*')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as EventType[];
    },
    enabled: open,
  });

  const typeOptions = (typesQ.data ?? []).map(t => ({
    value: t.id,
    label: `${t.emoji} ${t.label}`,
  }));

  const hasNotification = notifyLeadership || notifySchool || notifyUnit || notifyDayOf;
  const canSave = title.trim().length > 0 && eventDate.length > 0 && (isEditing || hasNotification);

  function toggleUnit(u: SchoolUnit, checked: boolean) {
    setUnits(prev => checked ? [...new Set([...prev, u])] : prev.filter(x => x !== u));
  }

  async function handleImagePick(file: File) {
    setError('');
    if (!ALLOWED_IMAGE_MIME.has(file.type)) {
      setError('Formato não suportado. Use JPG, PNG, WEBP ou GIF.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`Imagem muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo 5 MB.`);
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `event/${collaborator!.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('comunicado-anexos')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('comunicado-anexos').getPublicUrl(path);
      setImage({ url: pub.publicUrl, filename: file.name });
    } catch (e) {
      setError(`Falha no upload: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  }

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      setError('');
      if (endDate && endDate < eventDate) {
        throw new Error('Data fim não pode ser antes da data início.');
      }
      const primaryUnit: SchoolUnit | null = units[0] ?? null;
      const evPayload = {
        title: title.trim(),
        event_type: eventType,
        event_date: eventDate,
        end_date: endDate || null,
        start_time: isAllDay ? null : (startTime || null),
        is_all_day: isAllDay,
        unit: primaryUnit,
        units,
        location: location.trim() || null,
        description: description.trim() || null,
        image_url: image?.url ?? null,
        image_filename: image?.filename ?? null,
        notify_leadership: notifyLeadership,
        notify_school: notifySchool,
        notify_unit: notifyUnit,
        notify_day_of: notifyDayOf,
      };

      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator!.id,
      });

      if (isEditing) {
        const { error: upErr } = await supabase
          .from('school_events')
          .update(evPayload)
          .eq('id', editTarget!.id);
        if (upErr) throw upErr;
        return;
      }

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
            await supabase.from('announcements').delete().eq('id', ann.id);
            throw jobErr;
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agenda-escolar'] });
      queryClient.invalidateQueries({ queryKey: ['evento', editTarget?.id] });
      showToast({ kind: 'success', title: isEditing ? 'Evento atualizado' : 'Evento criado' });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <AdaptiveSheet open={open} onClose={onClose} title={isEditing ? 'Editar evento' : 'Novo evento'} size="md">
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

        <div>
          <label className="text-caption text-fg-muted block mb-1">Tipo *</label>
          <CustomSelect
            value={eventType}
            options={typeOptions}
            onChange={setEventType}
            placeholder="Selecionar tipo"
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-caption text-fg-muted block mb-1">Início *</label>
            <DateInput value={eventDate} onChange={setEventDate} />
          </div>
          <div className="flex-1">
            <label className="text-caption text-fg-muted block mb-1">Fim (opcional)</label>
            <DateInput value={endDate} onChange={setEndDate} />
          </div>
        </div>

        <div>
          <Checkbox
            checked={isAllDay}
            onChange={setIsAllDay}
            label="Dia inteiro (sem horário específico)"
          />
        </div>

        {!isAllDay && (
          <div>
            <label className="text-caption text-fg-muted block mb-1">Horário</label>
            <TimeInput value={startTime} onChange={setStartTime} />
          </div>
        )}

        <div>
          <p className="text-caption uppercase font-semibold text-fg-muted mb-2">Unidades</p>
          <p className="text-caption text-fg-muted mb-2">Vazio = escola toda</p>
          <div className="space-y-2">
            {ALL_UNITS.map(u => (
              <Checkbox
                key={u}
                checked={units.includes(u)}
                onChange={(c) => toggleUnit(u, c)}
                label={unitLabel(u)}
              />
            ))}
          </div>
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
          <label className="text-caption text-fg-muted block mb-1">Descrição (opcional)</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-tom resize-none"
            rows={3}
            maxLength={500}
            placeholder="Detalhes do evento, programação, observações..."
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <p className="text-caption text-fg-muted text-right">{description.length}/500</p>
        </div>

        <div>
          <p className="text-caption uppercase font-semibold text-fg-muted mb-1">Cartaz / flyer (opcional)</p>
          {image ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-elevated p-2">
              <img src={image.url} alt="" className="w-16 h-16 rounded object-cover" />
              <div className="flex-1 min-w-0">
                <p className="text-body-sm truncate">{image.filename}</p>
              </div>
              <button
                type="button"
                onClick={() => setImage(null)}
                className="text-caption text-danger underline px-2"
              >Remover</button>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2 h-10 rounded-lg border border-dashed border-border bg-bg-surface text-body-sm text-fg-muted hover:border-tom hover:text-tom cursor-pointer transition-colors">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                disabled={uploading}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleImagePick(f);
                  e.target.value = '';
                }}
              />
              {uploading ? 'Enviando…' : '🖼️ Anexar cartaz'}
            </label>
          )}
          <p className="text-caption text-fg-muted mt-1">JPG, PNG, WEBP ou GIF — até 5 MB</p>
        </div>

        {!isEditing && (
          <div>
            <p className="text-caption uppercase font-semibold text-fg-muted mb-2">Notificações</p>
            <div className="space-y-2">
              <Checkbox checked={notifyLeadership} onChange={setNotifyLeadership} label="Liderança — imediato ao criar" />
              <Checkbox checked={notifySchool} onChange={setNotifySchool} label="Escola toda — 3 dias antes" />
              <Checkbox checked={notifyUnit} onChange={setNotifyUnit} label="Unidades selecionadas — 1 dia antes" />
              <Checkbox checked={notifyDayOf} onChange={setNotifyDayOf} label="Notif. No dia (09h)" />
            </div>
            {!hasNotification && (
              <p className="text-danger text-caption mt-1">Selecione ao menos uma notificação</p>
            )}
          </div>
        )}

        {error && <p className="text-danger text-caption">{error}</p>}

        <Button
          variant="primary"
          fullWidth
          disabled={!canSave || isPending}
          onClick={() => mutate()}
        >
          {isPending ? (isEditing ? 'Salvando…' : 'Criando…') : (isEditing ? 'Salvar alterações' : 'Criar evento')}
        </Button>
      </div>
    </AdaptiveSheet>
  );
}
