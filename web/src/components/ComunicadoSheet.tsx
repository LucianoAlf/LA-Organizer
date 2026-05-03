import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { BottomSheet } from './BottomSheet';
import type { AnnouncementAudience } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const FUNCTION_ROLES = [
  { value: 'secretary_morning', label: 'Secretaria manhã' },
  { value: 'secretary_evening', label: 'Secretaria tarde' },
  { value: 'pedagogical_assistant', label: 'Pedagógico' },
  { value: 'cleaning', label: 'Limpeza' },
  { value: 'coordinator', label: 'Coordenação' },
];

const UNIDADES = [
  { value: 'barra', label: 'Barra' },
  { value: 'recreio', label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
];

const TURNOS = [
  { value: 'morning', label: 'Manhã' },
  { value: 'afternoon', label: 'Tarde' },
  { value: 'evening', label: 'Noite' },
  { value: 'full', label: 'Integral' },
];

export function ComunicadoSheet({ open, onClose }: Props) {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();

  const [body, setBody] = useState('');
  const [audienceAll, setAudienceAll] = useState(true);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedUnidades, setSelectedUnidades] = useState<string[]>([]);
  const [selectedTurnos, setSelectedTurnos] = useState<string[]>([]);
  const [scheduledMode, setScheduledMode] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState('');

  function toggleItem<T>(arr: T[], item: T): T[] {
    return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
  }

  function buildAudience(): AnnouncementAudience {
    if (audienceAll) return { all: true };
    const aud: AnnouncementAudience = {};
    if (selectedRoles.length) aud.function_role = selectedRoles;
    if (selectedUnidades.length) aud.unidade = selectedUnidades;
    if (selectedTurnos.length) aud.turno = selectedTurnos;
    return aud;
  }

  const hasAudienceSelection =
    audienceAll ||
    selectedRoles.length > 0 ||
    selectedUnidades.length > 0 ||
    selectedTurnos.length > 0;
  const canSave =
    body.trim().length > 0 && hasAudienceSelection && (!scheduledMode || scheduledAt);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      setError('');
      const audience = buildAudience();

      let q = supabase
        .from('collaborators')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .not('phone', 'is', null);
      if (!audience.all) {
        if (audience.function_role?.length) q = q.in('function_role', audience.function_role);
        if (audience.unidade?.length) q = q.in('unit', audience.unidade);
        if (audience.turno?.length) q = q.in('shift', audience.turno);
      }
      const { count } = await q;
      if (!count || count === 0)
        throw new Error('Nenhum colaborador encontrado para este público');

      let scheduled_at: string | null = null;
      if (scheduledMode && scheduledAt) {
        const dt = new Date(scheduledAt);
        if (dt <= new Date()) throw new Error('Horário de envio deve ser no futuro');
        scheduled_at = dt.toISOString();
      }

      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator!.id,
      });

      const { data: ann, error: annErr } = await supabase
        .from('announcements')
        .insert({
          created_by: collaborator!.id,
          body: body.trim(),
          audience,
          status: 'scheduled',
          scheduled_at,
        })
        .select('id')
        .single();
      if (annErr) throw annErr;

      let rq = supabase
        .from('collaborators')
        .select('id, phone')
        .eq('is_active', true)
        .not('phone', 'is', null);
      if (!audience.all) {
        if (audience.function_role?.length) rq = rq.in('function_role', audience.function_role);
        if (audience.unidade?.length) rq = rq.in('unit', audience.unidade);
        if (audience.turno?.length) rq = rq.in('shift', audience.turno);
      }
      const { data: recipients } = await rq;
      if (recipients?.length) {
        const jobs = recipients.map(r => ({
          announcement_id: ann.id,
          recipient_id: r.id,
          phone: r.phone,
        }));
        const { error: jobErr } = await supabase.from('announcement_jobs').insert(jobs);
        if (jobErr) throw jobErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comunicados'] });
      setBody('');
      setAudienceAll(true);
      setSelectedRoles([]);
      setSelectedUnidades([]);
      setSelectedTurnos([]);
      setScheduledMode(false);
      setScheduledAt('');
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <BottomSheet open={open} onClose={onClose} title="Novo comunicado">
      <div className="space-y-4 pb-4">
        <div>
          <label className="text-caption text-fg-muted block mb-1">Mensagem</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand resize-none"
            rows={4}
            maxLength={1000}
            placeholder="Digite o comunicado..."
            value={body}
            onChange={e => setBody(e.target.value)}
          />
          <p className="text-caption text-fg-muted text-right">{body.length}/1000</p>
        </div>

        <div>
          <p className="text-caption text-fg-muted mb-1">Público</p>
          <label className="flex items-center gap-2 text-body">
            <input
              type="checkbox"
              checked={audienceAll}
              onChange={e => {
                setAudienceAll(e.target.checked);
                if (e.target.checked) {
                  setSelectedRoles([]);
                  setSelectedUnidades([]);
                  setSelectedTurnos([]);
                }
              }}
            />
            Todos os colaboradores
          </label>
        </div>

        {!audienceAll && (
          <>
            <div>
              <p className="text-caption text-fg-muted mb-1">Por função</p>
              <div className="space-y-1">
                {FUNCTION_ROLES.map(r => (
                  <label key={r.value} className="flex items-center gap-2 text-body">
                    <input
                      type="checkbox"
                      checked={selectedRoles.includes(r.value)}
                      onChange={() =>
                        setSelectedRoles(prev => toggleItem(prev, r.value))
                      }
                    />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-caption text-fg-muted mb-1">Por unidade</p>
              <div className="flex flex-wrap gap-3">
                {UNIDADES.map(u => (
                  <label key={u.value} className="flex items-center gap-1.5 text-body">
                    <input
                      type="checkbox"
                      checked={selectedUnidades.includes(u.value)}
                      onChange={() =>
                        setSelectedUnidades(prev => toggleItem(prev, u.value))
                      }
                    />
                    {u.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-caption text-fg-muted mb-1">Por turno</p>
              <div className="flex flex-wrap gap-3">
                {TURNOS.map(t => (
                  <label key={t.value} className="flex items-center gap-1.5 text-body">
                    <input
                      type="checkbox"
                      checked={selectedTurnos.includes(t.value)}
                      onChange={() =>
                        setSelectedTurnos(prev => toggleItem(prev, t.value))
                      }
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        <div>
          <label className="flex items-center gap-2 text-body">
            <input
              type="checkbox"
              checked={scheduledMode}
              onChange={e => setScheduledMode(e.target.checked)}
            />
            Agendar envio
          </label>
          {scheduledMode && (
            <input
              type="datetime-local"
              className="mt-2 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          )}
        </div>

        {error && <p className="text-danger text-caption">{error}</p>}

        <button
          type="button"
          disabled={!canSave || isPending}
          onClick={() => mutate()}
          className="w-full py-3 bg-brand text-white rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {isPending ? 'Enviando...' : 'Enviar comunicado'}
        </button>
      </div>
    </BottomSheet>
  );
}
