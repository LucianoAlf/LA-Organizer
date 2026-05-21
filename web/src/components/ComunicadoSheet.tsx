import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { DateTimeInput } from './DateTimeInput';
import { CustomSelect } from './CustomSelect';
import { formatEventRange } from '../types';
import type { AnnouncementAudience, SchoolEvent } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pré-preenche body+audience (usado em "Reenviar"/duplicar). */
  initial?: { body: string; audience: AnnouncementAudience; requires_confirmation?: boolean; scheduled_at?: string | null; attachment?: Attachment | null } | null;
  /** Modo edição: passa a row do announcement. UPDATE em vez de INSERT. */
  editTarget?: {
    id: string;
    body: string;
    audience: AnnouncementAudience;
    requires_confirmation?: boolean;
    scheduled_at?: string | null;
    status: string;
    attachment_url?: string | null;
    attachment_type?: 'image' | 'document' | null;
    attachment_mime?: string | null;
    attachment_filename?: string | null;
    attachment_size_bytes?: number | null;
    source_event_id?: string | null;
  } | null;
}

type Attachment = {
  url: string;
  type: 'image' | 'document';
  mime: string;
  filename: string;
  size: number;
};

const MAX_ATTACH_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
]);

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

export function ComunicadoSheet({ open, onClose, initial, editTarget }: Props) {
  const isEdit = !!editTarget;
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
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [linkedEventId, setLinkedEventId] = useState<string>('');
  const [error, setError] = useState('');

  // Eventos institucionais futuros (próximos 90 dias) pra picker de vínculo opcional.
  const eventsQ = useQuery({
    queryKey: ['comunicado-sheet-events'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 90);
      const horizonYmd = horizon.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('school_events')
        .select('id, title, event_date, end_date')
        .eq('status', 'active')
        .gte('event_date', today)
        .lte('event_date', horizonYmd)
        .order('event_date', { ascending: true })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as Pick<SchoolEvent, 'id' | 'title' | 'event_date' | 'end_date'>[];
    },
    enabled: open,
  });

  const eventOptions = [
    { value: '', label: 'Sem vínculo' },
    ...(eventsQ.data ?? []).map(ev => ({
      value: ev.id,
      label: `${formatEventRange(ev.event_date, ev.end_date)} — ${ev.title}`,
    })),
  ];

  // Pré-preenche quando abre via "Reenviar" ou "Editar"; reseta quando fecha.
  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      setBody(editTarget.body);
      const aud = editTarget.audience || {};
      const isAll = aud.all === true;
      setAudienceAll(isAll);
      setSelectedCargos(aud.role ?? []);
      setSelectedRoles(aud.function_role ?? []);
      setSelectedUnidades(aud.unidade ?? []);
      setSelectedTurnos(aud.turno ?? []);
      setSelectedCollabIds(aud.collaborator_ids ?? []);
      setScheduledMode(!!editTarget.scheduled_at);
      // datetime-local format: YYYY-MM-DDTHH:MM
      setScheduledAt(editTarget.scheduled_at ? editTarget.scheduled_at.slice(0, 16) : '');
      setRequiresConfirmation(!!editTarget.requires_confirmation);
      setAttachment(
        editTarget.attachment_url && editTarget.attachment_type
          ? {
              url: editTarget.attachment_url,
              type: editTarget.attachment_type,
              mime: editTarget.attachment_mime || '',
              filename: editTarget.attachment_filename || '',
              size: editTarget.attachment_size_bytes || 0,
            }
          : null,
      );
      setLinkedEventId(editTarget.source_event_id ?? '');
      setCollabSearch('');
      setError('');
    } else if (initial) {
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
      setAttachment(initial.attachment ?? null);
      setLinkedEventId('');
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
      setAttachment(null);
      setLinkedEventId('');
      setCollabSearch('');
      setError('');
    }
  }, [open, initial, editTarget]);

  async function handleFilePick(file: File) {
    setError('');
    if (!ALLOWED_MIME.has(file.type)) {
      setError('Formato não suportado. Use JPG, PNG, WEBP, GIF ou PDF.');
      return;
    }
    if (file.size > MAX_ATTACH_BYTES) {
      setError(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo 10 MB.`);
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'bin';
      const path = `${collaborator!.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('comunicado-anexos')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('comunicado-anexos').getPublicUrl(path);
      setAttachment({
        url: pub.publicUrl,
        type: file.type === 'application/pdf' ? 'document' : 'image',
        mime: file.type,
        filename: file.name,
        size: file.size,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Falha no upload: ${msg}`);
    } finally {
      setUploading(false);
    }
  }

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

      const attachmentFields = attachment
        ? {
            attachment_url: attachment.url,
            attachment_type: attachment.type,
            attachment_mime: attachment.mime,
            attachment_filename: attachment.filename,
            attachment_size_bytes: attachment.size,
          }
        : {
            attachment_url: null,
            attachment_type: null,
            attachment_mime: null,
            attachment_filename: null,
            attachment_size_bytes: null,
          };

      const linkFields = { source_event_id: linkedEventId || null };

      if (isEdit && editTarget) {
        // UPDATE — só permitido em pending_approval (edit normal)
        // ou scheduled (apenas reagendar/edit body — audience pode ter sido
        // mudada mas dispatcher detecta jobs existentes e não recria).
        const { error: updErr } = await supabase
          .from('announcements')
          .update({
            body: body.trim(),
            audience,
            scheduled_at,
            requires_confirmation: requiresConfirmation,
            ...attachmentFields,
            ...linkFields,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editTarget.id);
        if (updErr) throw updErr;
      } else {
        const { data: ann, error: annErr } = await supabase
          .from('announcements')
          .insert({
            created_by: collaborator!.id,
            body: body.trim(),
            audience,
            status: 'scheduled',
            scheduled_at,
            requires_confirmation: requiresConfirmation,
            ...attachmentFields,
            ...linkFields,
          })
          .select('id')
          .single();
        if (annErr) throw annErr;
        void ann;
        // Jobs criados pelo dispatcher (lazy) — RLS bloqueia INSERT direto.
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
      setAttachment(null);
      setCollabSearch('');
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <AdaptiveSheet open={open} onClose={onClose} title={isEdit ? 'Editar comunicado' : 'Novo comunicado'} size="lg">
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

        <div>
          <p className="text-caption uppercase font-semibold text-fg-muted mb-1">Anexo (opcional)</p>
          {attachment ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-elevated p-2">
              {attachment.type === 'image' ? (
                <img src={attachment.url} alt="" className="w-12 h-12 rounded object-cover" />
              ) : (
                <div className="w-12 h-12 rounded bg-bg-app border border-border flex items-center justify-center text-caption text-fg-muted">PDF</div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-body-sm truncate">{attachment.filename}</p>
                <p className="text-caption text-fg-muted">{(attachment.size / 1024).toFixed(0)} KB</p>
              </div>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-caption text-danger underline px-2"
              >Remover</button>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2 h-10 rounded-lg border border-dashed border-border bg-bg-surface text-body-sm text-fg-muted hover:border-tom hover:text-tom cursor-pointer transition-colors">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                className="hidden"
                disabled={uploading}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleFilePick(f);
                  e.target.value = '';
                }}
              />
              {uploading ? 'Enviando…' : '📎 Anexar imagem ou PDF'}
            </label>
          )}
          <p className="text-caption text-fg-muted mt-1">JPG, PNG, WEBP, GIF ou PDF — até 10 MB</p>
        </div>

        <div>
          <p className="text-caption uppercase font-semibold text-fg-muted mb-1">Vincular a evento (opcional)</p>
          <CustomSelect
            value={linkedEventId}
            options={eventOptions}
            onChange={setLinkedEventId}
            size="sm"
            placeholder="Sem vínculo"
          />
          <p className="text-caption text-fg-muted mt-1">Se vincular, o comunicado aparece na página do evento.</p>
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
          {isPending ? (isEdit ? 'Salvando…' : 'Enviando…') : (isEdit ? 'Salvar alterações' : 'Enviar comunicado')}
        </Button>
      </div>
    </AdaptiveSheet>
  );
}
