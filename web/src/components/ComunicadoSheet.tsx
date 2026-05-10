import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { DateTimeInput } from './DateTimeInput';
import type { AnnouncementAudience } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pré-preenche body+audience (usado em "Reenviar"/duplicar). */
  initial?: { body: string; audience: AnnouncementAudience; requires_confirmation?: boolean } | null;
}

const ROLES = [
  { value: 'director', label: 'Diretoria' },
  { value: 'coordinator', label: 'Coordenação' },
  { value: 'manager', label: 'Gerência' },
];

const FUNCTION_ROLES = [
  { value: 'secretary_morning', label: 'Secretaria manhã' },
  { value: 'secretary_evening', label: 'Secretaria tarde' },
  { value: 'pedagogical_assistant', label: 'Pedagógico' },
  { value: 'cleaning', label: 'Limpeza' },
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

export function ComunicadoSheet({ open, onClose, initial }: Props) {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();

  const [body, setBody] = useState('');
  const [audienceAll, setAudienceAll] = useState(true);
  const [selectedCargos, setSelectedCargos] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedUnidades, setSelectedUnidades] = useState<string[]>([]);
  const [selectedTurnos, setSelectedTurnos] = useState<string[]>([]);
  const [selectedCollabIds, setSelectedCollabIds] = useState<string[]>([]);
  const [collabSearch, setCollabSearch] = useState('');
  const [scheduledMode, setScheduledMode] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const [error, setError] = useState('');

  // Pré-preenche quando abre via "Reenviar"; reseta quando fecha.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setBody(initial.body);
      const aud = initial.audience || {};
      const isAll = aud.all === true;
      setAudienceAll(isAll);
      setSelectedCargos(aud.role ?? []);
      setSelectedRoles(aud.function_role ?? []);
      setSelectedUnidades(aud.unidade ?? []);
      setSelectedTurnos(aud.turno ?? []);
      setSelectedCollabIds(aud.collaborator_ids ?? []);
      setScheduledMode(false);
      setScheduledAt('');
      setRequiresConfirmation(!!initial.requires_confirmation);
      setCollabSearch('');
      setError('');
    } else {
      setBody('');
      setAudienceAll(true);
      setSelectedCargos([]);
      setSelectedRoles([]);
      setSelectedUnidades([]);
      setSelectedTurnos([]);
      setSelectedCollabIds([]);
      setScheduledMode(false);
      setScheduledAt('');
      setRequiresConfirmation(false);
      setCollabSearch('');
      setError('');
    }
  }, [open, initial]);

  function toggleItem<T>(arr: T[], item: T): T[] {
    return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
  }

  // Lista de colaboradores ativos pra picker individual.
  const collabsQ = useQuery({
    queryKey: ['active-collabs-for-comunicado'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name, role, unit')
        .eq('is_active', true)
        .not('phone', 'is', null)
        .order('full_name');
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; full_name: string; role: string | null; unit: string | null }>;
    },
    enabled: open,
  });

  const filteredCollabs = useMemo(() => {
    const all = collabsQ.data ?? [];
    const q = collabSearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter(c => c.full_name.toLowerCase().includes(q));
  }, [collabsQ.data, collabSearch]);

  function buildAudience(): AnnouncementAudience {
    if (audienceAll) return { all: true };
    const aud: AnnouncementAudience = {};
    if (selectedCargos.length) aud.role = selectedCargos;
    if (selectedRoles.length) aud.function_role = selectedRoles;
    if (selectedUnidades.length) aud.unidade = selectedUnidades;
    if (selectedTurnos.length) aud.turno = selectedTurnos;
    if (selectedCollabIds.length) aud.collaborator_ids = selectedCollabIds;
    return aud;
  }

  function clearGranular() {
    setSelectedCargos([]);
    setSelectedRoles([]);
    setSelectedUnidades([]);
    setSelectedTurnos([]);
    setSelectedCollabIds([]);
  }

  // Quando user seleciona qualquer granular, "Todos" desmarca automaticamente.
  function pickGranular(setter: (fn: (prev: string[]) => string[]) => void, value: string) {
    setAudienceAll(false);
    setter(prev => toggleItem(prev, value));
  }

  const hasAudienceSelection =
    audienceAll ||
    selectedCargos.length > 0 ||
    selectedRoles.length > 0 ||
    selectedUnidades.length > 0 ||
    selectedTurnos.length > 0 ||
    selectedCollabIds.length > 0;
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
        if (audience.role?.length) q = q.in('role', audience.role);
        if (audience.function_role?.length) q = q.in('function_role', audience.function_role);
        if (audience.unidade?.length) q = q.in('unit', audience.unidade);
        if (audience.turno?.length) q = q.in('shift', audience.turno);
        if (audience.collaborator_ids?.length) q = q.in('id', audience.collaborator_ids);
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
          requires_confirmation: requiresConfirmation,
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
        if (audience.role?.length) rq = rq.in('role', audience.role);
        if (audience.function_role?.length) rq = rq.in('function_role', audience.function_role);
        if (audience.unidade?.length) rq = rq.in('unit', audience.unidade);
        if (audience.turno?.length) rq = rq.in('shift', audience.turno);
        if (audience.collaborator_ids?.length) rq = rq.in('id', audience.collaborator_ids);
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
      clearGranular();
      setScheduledMode(false);
      setScheduledAt('');
      setRequiresConfirmation(false);
      setCollabSearch('');
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
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-tom resize-none"
            rows={4}
            maxLength={1000}
            placeholder="Digite o comunicado..."
            value={body}
            onChange={e => setBody(e.target.value)}
          />
          <p className="text-caption text-fg-muted text-right">{body.length}/1000</p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-caption uppercase font-semibold text-fg-muted">Público</p>
            <button
              type="button"
              onClick={() => { setAudienceAll(true); clearGranular(); }}
              className={[
                'text-caption rounded-full px-3 py-1 border transition-colors',
                audienceAll ? 'bg-tom/15 text-tom border-tom/40 font-semibold' : 'border-border text-fg-muted hover:text-fg',
              ].join(' ')}
            >
              ✓ Todos os colaboradores
            </button>
          </div>

          <details className="bg-bg-elevated rounded-md border border-border" open={!audienceAll}>
            <summary className="cursor-pointer px-3 py-2 text-body-sm select-none flex items-center justify-between">
              <span>Filtrar por grupo ou pessoas</span>
              <span className="text-caption text-fg-muted">▾</span>
            </summary>
            <div className="px-3 pb-3 pt-1 space-y-3">
              <div>
                <p className="text-caption text-fg-muted mb-1">Por cargo</p>
                <div className="flex flex-wrap gap-3">
                  {ROLES.map(r => (
                    <label key={r.value} className="flex items-center gap-1.5 text-body">
                      <input type="checkbox" className="accent-tom"
                        checked={selectedCargos.includes(r.value)}
                        onChange={() => pickGranular(setSelectedCargos as never, r.value)} />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-caption text-fg-muted mb-1">Por função</p>
                <div className="space-y-1">
                  {FUNCTION_ROLES.map(r => (
                    <label key={r.value} className="flex items-center gap-2 text-body">
                      <input type="checkbox" className="accent-tom"
                        checked={selectedRoles.includes(r.value)}
                        onChange={() => pickGranular(setSelectedRoles as never, r.value)} />
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
                      <input type="checkbox" className="accent-tom"
                        checked={selectedUnidades.includes(u.value)}
                        onChange={() => pickGranular(setSelectedUnidades as never, u.value)} />
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
                      <input type="checkbox" className="accent-tom"
                        checked={selectedTurnos.includes(t.value)}
                        onChange={() => pickGranular(setSelectedTurnos as never, t.value)} />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-caption text-fg-muted mb-1">
                  Pessoas específicas {selectedCollabIds.length > 0 && (
                    <span className="text-tom font-semibold">({selectedCollabIds.length} selecionada{selectedCollabIds.length > 1 ? 's' : ''})</span>
                  )}
                </p>
                <input
                  type="text"
                  placeholder="Buscar por nome..."
                  value={collabSearch}
                  onChange={e => setCollabSearch(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-border bg-bg-app text-body-sm focus:outline-none focus:border-tom mb-2"
                />
                <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-bg-surface divide-y divide-border">
                  {collabsQ.isLoading ? (
                    <p className="px-3 py-2 text-body-sm text-fg-muted">Carregando…</p>
                  ) : filteredCollabs.length === 0 ? (
                    <p className="px-3 py-2 text-body-sm text-fg-muted">Nenhum colaborador.</p>
                  ) : (
                    filteredCollabs.map(c => (
                      <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-body-sm hover:bg-bg-elevated cursor-pointer">
                        <input
                          type="checkbox"
                          className="accent-tom"
                          checked={selectedCollabIds.includes(c.id)}
                          onChange={() => pickGranular(setSelectedCollabIds as never, c.id)}
                        />
                        <span className="flex-1 truncate">{c.full_name}</span>
                        {c.role && <span className="text-caption text-fg-muted">{c.role}</span>}
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
          </details>
        </div>

        <div>
          <label className="flex items-center gap-2 text-body">
            <input
              type="checkbox"
              className="accent-tom"
              checked={requiresConfirmation}
              onChange={e => setRequiresConfirmation(e.target.checked)}
            />
            Pedir confirmação de leitura
          </label>
          {requiresConfirmation && (
            <p className="text-caption text-fg-muted mt-1 pl-6">
              Cada destinatário recebe a mensagem com instrução pra responder "ok". Lembrete automático após 6h sem resposta.
            </p>
          )}
        </div>

        <div>
          <label className="flex items-center gap-2 text-body">
            <input
              type="checkbox"
              className="accent-tom"
              checked={scheduledMode}
              onChange={e => setScheduledMode(e.target.checked)}
            />
            Agendar envio
          </label>
          {scheduledMode && (
            <div className="mt-2">
              <DateTimeInput value={scheduledAt} onChange={setScheduledAt} />
            </div>
          )}
        </div>

        {error && <p className="text-danger text-caption">{error}</p>}

        <Button
          variant="primary"
          fullWidth
          disabled={!canSave || isPending}
          onClick={() => mutate()}
        >
          {isPending ? 'Enviando…' : 'Enviar comunicado'}
        </Button>
      </div>
    </BottomSheet>
  );
}
