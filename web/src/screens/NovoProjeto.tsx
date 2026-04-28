// Sprint 8 Etapa 2/3 — Wizard visual de criação de projeto.
// Espelha o fluxo conversacional do TOM no WhatsApp (skill cadastro-projeto-5w2h),
// sem expor jargão ("5W2H", "wizard", "form"). Copy desenhada como condução
// guiada de pensamento. Submit real (Etapa 3) faz INSERT em projects via
// authenticated session — gateado pela RLS auth_insert_own_projects (created_by=self).
//
// Débitos registrados no roadmap (Sprint 9+ parking lot):
//   - Member picker (substituir texto livre de "Quem participa" por seleção
//     de collaborators cadastrados; popular project_members no submit).
//   - Hierarquia tipográfica (labels vs valores no resumo do passo 4 e tela
//     final precisam de peso/tamanho mais distintos).
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { notifyProjectCreated } from '../lib/tomEngine';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import {
  PROJECT_CATEGORY_LABELS,
  PROJECT_LOCATION_LABELS,
} from '../lib/projectLabels';
import type { ProjectCategory, ProjectLocation, ProjectStatus } from '../types';

type WizardData = {
  name: string;
  justification: string;
  location: ProjectLocation | '';
  start_date: string; // YYYY-MM-DD
  end_date: string;
  // Sprint 9: "Quem participa" agora é multi-select de collaborators (member_ids)
  // + texto livre opcional pra pessoas de fora do sistema. description (no banco)
  // é composto na hora do submit como "Nome1, Nome2 + extras".
  member_ids: string[];
  extra_members: string;
  methodology: string;
  estimated_hours_week: string;
  category: ProjectCategory;
};

const initial: WizardData = {
  name: '',
  justification: '',
  location: '',
  start_date: '',
  end_date: '',
  member_ids: [],
  extra_members: '',
  methodology: '',
  estimated_hours_week: '',
  category: 'operational',
};

type CollabLite = { id: string; full_name: string; role: string };

type Step = 1 | 2 | 3 | 4;
const TOTAL_STEPS = 4;

function todayISO(): string {
  const d = new Date();
  const sp = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return sp.toISOString().slice(0, 10);
}

function validateStep(step: Step, d: WizardData): string | null {
  if (step === 1) {
    const n = d.name.trim();
    if (n.length < 3) return 'Dá pelo menos 3 letras pro nome.';
    if (n.length > 100) return 'Nome muito longo (máx 100).';
    if (d.justification.trim().length < 10) return 'Conta um pouco mais — pelo menos 10 caracteres.';
    return null;
  }
  if (step === 2) {
    if (!d.location) return 'Escolhe um local pra continuar.';
    if (!d.start_date) return 'Defina quando começa.';
    if (!d.end_date) return 'Defina quando termina.';
    if (d.start_date < todayISO()) return 'Início não pode ser no passado.';
    if (d.end_date <= d.start_date) return 'Término precisa ser depois do início.';
    return null;
  }
  if (step === 3) {
    // Sprint 9: pelo menos 1 membro selecionado OU pelo menos 10 chars em "outros"
    const hasMembers = d.member_ids.length > 0;
    const hasExtras = d.extra_members.trim().length >= 10;
    if (!hasMembers && !hasExtras) return 'Marca pelo menos 1 pessoa do time, ou descreve quem mais vai participar.';
    if (d.methodology.trim().length < 10) return 'Conta a abordagem — pelo menos 10 caracteres.';
    if (d.estimated_hours_week.trim()) {
      const n = Number(d.estimated_hours_week);
      if (!Number.isFinite(n) || n < 0 || n > 80) return 'Horas/semana entre 0 e 80.';
    }
    return null;
  }
  return validateStep(1, d) || validateStep(2, d) || validateStep(3, d);
}

const inputClass =
  'w-full h-11 rounded-md border border-border bg-bg-surface px-3 text-body-md text-fg focus-ring placeholder:text-fg-muted disabled:opacity-60';
const textareaClass =
  'w-full min-h-[88px] rounded-md border border-border bg-bg-surface px-3 py-2 text-body-md text-fg focus-ring placeholder:text-fg-muted resize-y disabled:opacity-60';

function Field({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-body-sm font-semibold text-fg block">{label}</label>
      {sub && <div className="text-body-xs text-fg-muted leading-snug">{sub}</div>}
      {children}
    </div>
  );
}

function SummaryInline({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-md text-body-sm">
      <span className="text-fg-muted shrink-0">{label}</span>
      <span className="font-medium text-right break-words">{children}</span>
    </div>
  );
}

function SummaryBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-body-xs text-fg-muted">{label}</div>
      <div className="text-body-sm text-fg whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}

function formatBR(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Sprint 9: multi-select inline de collaborators ativos.
// Tap pra selecionar/deselecionar. Lista vira chips.
function MemberPicker({
  collabs,
  selected,
  onToggle,
}: {
  collabs: CollabLite[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = query.trim()
    ? collabs.filter((c) =>
        c.full_name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : collabs;

  const selectedSet = new Set(selected);
  const selectedNames = collabs.filter((c) => selectedSet.has(c.id));

  return (
    <div className="space-y-sm">
      {selectedNames.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedNames.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggle(c.id)}
              className="inline-flex items-center gap-1 text-body-sm bg-brand/15 text-fg rounded-full pl-3 pr-2 py-1 border border-brand/40 focus-ring"
              aria-label={`Remover ${c.full_name}`}
            >
              <span>{c.full_name}</span>
              <span className="text-fg-muted text-body-md leading-none">×</span>
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar pelo nome…"
        className={inputClass}
      />

      <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-bg-surface">
        {filtered.length === 0 ? (
          <div className="px-md py-sm text-body-sm text-fg-muted">
            Ninguém com esse nome.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((c) => {
              const isSel = selectedSet.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(c.id)}
                    className={[
                      'w-full text-left px-md py-2 flex items-center gap-md focus-ring',
                      isSel ? 'bg-brand/10' : 'hover:bg-bg-elevated',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'h-5 w-5 rounded-md border flex items-center justify-center shrink-0',
                        isSel ? 'bg-brand border-brand' : 'bg-bg border-border',
                      ].join(' ')}
                      aria-hidden
                    >
                      {isSel && (
                        <span className="text-white text-body-xs font-bold">✓</span>
                      )}
                    </span>
                    <span className="text-body-md text-fg flex-1 truncate">
                      {c.full_name}
                    </span>
                    <span className="text-body-xs text-fg-muted">{c.role}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatBRShort(iso: string): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export function NovoProjeto() {
  const navigate = useNavigate();
  const { role, collaborator } = useAuth();
  const queryClient = useQueryClient();
  const isCoordOrDir = role === 'coordinator' || role === 'director';

  const [step, setStep] = useState<Step>(1);
  const [data, setData] = useState<WizardData>(initial);
  const [touched, setTouched] = useState<Record<Step, boolean>>({ 1: false, 2: false, 3: false, 4: false });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{
    snapshot: WizardData;
    supervisorName: string | null;
    projectId: string;
  } | null>(null);

  // Sprint 9: lista de collaborators ativos pra member picker (passo 3).
  // Exclui o próprio criador — engine adiciona como owner automaticamente.
  const { data: collabsAvailable = [] } = useQuery<CollabLite[]>({
    queryKey: ['novo-projeto-collabs', collaborator?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name, role')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) return [];
      return ((data || []) as CollabLite[]).filter(c => c.id !== collaborator?.id);
    },
    enabled: !!collaborator?.id,
    staleTime: 5 * 60_000,
  });

  const { data: supervisorName } = useQuery({
    queryKey: ['novo-projeto-supervisor'],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('full_name')
        .in('role', ['coordinator', 'director'])
        .eq('is_active', true)
        .order('role', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      return (data.full_name as string) ?? null;
    },
    enabled: !isCoordOrDir,
    staleTime: 5 * 60_000,
  });

  function update<K extends keyof WizardData>(k: K, v: WizardData[K]) {
    setData((prev) => ({ ...prev, [k]: v }));
  }

  const stepError = validateStep(step, data);
  const showError = touched[step] && stepError !== null;

  function next() {
    if (stepError) {
      setTouched((t) => ({ ...t, [step]: true }));
      return;
    }
    if (step < TOTAL_STEPS) setStep(((step + 1) as Step));
    else void handleSubmit();
  }

  function back() {
    if (step > 1) setStep(((step - 1) as Step));
    else navigate('/projetos');
  }

  async function handleSubmit() {
    if (!collaborator?.id) {
      setSubmitError('Sua sessão expirou. Faz login de novo e tenta outra vez.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);

    // Sprint 8 — gate por role. Coord/director cria direto em planning;
    // collaborator comum entra como pending_approval e exige supervisor
    // aprovar via WhatsApp (skill aprovar-projeto, Etapa 5).
    const requires_approval = !isCoordOrDir;
    const status: ProjectStatus = isCoordOrDir ? 'planning' : 'pending_approval';
    const hours = data.estimated_hours_week.trim() ? Number(data.estimated_hours_week) : null;

    // Sprint 9: compõe description a partir dos nomes selecionados + extras.
    // Solução temporária — quando member picker maduro, description ganha
    // outra função (ex.: notas livres do projeto).
    const memberNames = data.member_ids
      .map((id) => collabsAvailable.find((c) => c.id === id)?.full_name)
      .filter(Boolean) as string[];
    const composedDescription = [
      memberNames.join(', '),
      data.extra_members.trim() ? `+ ${data.extra_members.trim()}` : '',
    ].filter(Boolean).join(' ').trim();

    const insertPayload = {
      name: data.name.trim(),
      justification: data.justification.trim(),
      location: data.location || null,
      start_date: data.start_date,
      end_date: data.end_date,
      description: composedDescription,
      methodology: data.methodology.trim(),
      estimated_hours_week: hours,
      category: data.category,
      status,
      requires_approval,
      progress_percent: 0,
      color: '#E91451',
      created_by: collaborator.id,
    };

    const { data: inserted, error } = await supabase
      .from('projects')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error || !inserted?.id) {
      setSubmitting(false);
      // Mensagem em português para erros conhecidos; fallback técnico.
      const m = (error?.message || '').toLowerCase();
      if (m.includes('row-level security') || m.includes('policy')) {
        setSubmitError('Você não tem permissão pra criar projeto. Confere com o coordenador.');
      } else if (m.includes('check constraint')) {
        setSubmitError('Algum campo veio fora do formato esperado. Tenta de novo.');
      } else {
        setSubmitError(error?.message || 'Não consegui criar o projeto. Tenta de novo daqui a pouco.');
      }
      return;
    }

    // Invalida cache de projetos pra próxima visita ao /projetos mostrar o novo.
    await queryClient.invalidateQueries({ queryKey: ['projects'] });

    // Notifica engine TOM (fire-ish: aguarda mas não bloqueia em caso de falha).
    // Endpoint é idempotente por project_id — retry futuro é seguro.
    // Sprint 9: passa member_ids pra engine inserir project_members + WA por membro.
    const ack = await notifyProjectCreated(inserted.id as string, data.member_ids);
    if (!ack.ok) {
      console.warn('[NovoProjeto] engine notify falhou:', ack.reason);
      // Projeto está salvo no DB; só a notificação automática falhou.
      // Sprint 9+: cron de retry varre projects sem PROJECT_BOOTSTRAPPED.
    }

    setSubmitted({
      snapshot: { ...data },
      supervisorName: supervisorName ?? null,
      projectId: inserted.id as string,
    });
    setSubmitting(false);
  }

  // ---------- Tela final ----------
  if (submitted) {
    const s = submitted.snapshot;
    const periodo = `${formatBRShort(s.start_date)} → ${formatBR(s.end_date)}`;

    if (isCoordOrDir) {
      return (
        <div className="space-y-lg max-w-md mx-auto pt-md">
          <div className="text-center pt-md">
            <div className="text-6xl mb-sm" aria-hidden>✅</div>
            <h2 className="text-section-title">Projeto criado</h2>
            <p className="text-body-sm text-fg-muted mt-1">
              O TOM já foi notificado e vai começar a estruturar.
            </p>
          </div>

          <Card padded variant="elevated">
            <div className="space-y-md">
              <div className="flex items-start justify-between gap-sm flex-wrap">
                <div className="text-body-lg font-semibold text-fg leading-tight min-w-0 flex-1 break-words">{s.name}</div>
                <span className="shrink-0 text-body-xs text-fg-muted bg-bg-surface rounded-full px-2 py-1 border border-border whitespace-nowrap">
                  Em planejamento
                </span>
              </div>

              <div className="space-y-1 text-body-sm text-fg-secondary">
                <div>📍 {PROJECT_LOCATION_LABELS[s.location as ProjectLocation] || '—'}</div>
                <div>🗓️ {periodo}</div>
                <div>🏷️ {PROJECT_CATEGORY_LABELS[s.category]}</div>
              </div>

              <div className="border-t border-border pt-md">
                <div className="text-body-xs text-fg-muted mb-1">🎯 Por que existe</div>
                <div className="text-body-sm text-fg italic">"{s.justification.trim()}"</div>
              </div>

              <div className="border-t border-border pt-md text-body-sm text-fg-secondary">
                Agora ele pode começar a distribuir checkpoints e tarefas pelo time.
              </div>
            </div>
          </Card>

          <div className="flex gap-md">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => navigate(`/projetos/${submitted.projectId}`)}
            >
              Ver projeto
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                setSubmitted(null);
                setData(initial);
                setStep(1);
                setTouched({ 1: false, 2: false, 3: false, 4: false });
                setSubmitError(null);
              }}
            >
              Criar outro
            </Button>
          </div>
        </div>
      );
    }

    // Collaborator comum
    const sup = submitted.supervisorName ?? 'um supervisor';
    return (
      <div className="space-y-lg max-w-md mx-auto pt-md">
        <div className="text-center pt-md">
          <div className="text-6xl mb-sm" aria-hidden>⏳</div>
          <h2 className="text-section-title">Enviado para aprovação</h2>
          <p className="text-body-sm text-fg-muted mt-1">
            O projeto foi estruturado — agora aguarda o ok.
          </p>
        </div>

        <Card padded variant="elevated">
          <div className="space-y-md">
            <div className="flex items-start justify-between gap-md">
              <div className="text-body-lg font-semibold text-fg leading-tight">{s.name}</div>
              <span className="shrink-0 text-body-xs text-fg-muted bg-bg-surface rounded-full px-2 py-1 border border-border">
                Aguardando aprovação
              </span>
            </div>

            <div className="space-y-1 text-body-sm text-fg-secondary">
              <div>📍 {PROJECT_LOCATION_LABELS[s.location as ProjectLocation] || '—'}</div>
              <div>🗓️ {periodo}</div>
              <div>🏷️ {PROJECT_CATEGORY_LABELS[s.category]}</div>
            </div>

            <div className="border-t border-border pt-md">
              <div className="text-body-xs text-fg-muted mb-1">🎯 Por que existe</div>
              <div className="text-body-sm text-fg italic">"{s.justification.trim()}"</div>
            </div>

            <div className="border-t border-border pt-md space-y-1">
              <div className="text-body-sm">
                <span className="font-semibold text-fg">Próximo passo:</span>{' '}
                <span className="text-fg-secondary">{sup} precisa aprovar este projeto no WhatsApp.</span>
              </div>
              <div className="text-body-xs text-fg-muted">
                Assim que ele aprovar, o TOM continua o fluxo automaticamente.
              </div>
            </div>
          </div>
        </Card>

        <Button variant="secondary" fullWidth onClick={() => navigate('/projetos')}>
          Ver meus projetos
        </Button>
      </div>
    );
  }

  // ---------- Wizard ----------
  return (
    <div className="pb-24">
      <div className="sticky top-0 z-10 bg-bg pt-2 pb-3 -mx-md px-md border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={back}
            className="text-body-sm text-fg-muted inline-flex items-center gap-1 focus-ring rounded-md px-1 -ml-1"
          >
            <ChevronLeft size={18} />
            {step === 1 ? 'Cancelar' : 'Voltar'}
          </button>
          <span className="text-body-xs text-fg-muted font-semibold tracking-wide">
            {step}/{TOTAL_STEPS}
          </span>
        </div>
        <div className="h-1.5 bg-bg-surface rounded-full overflow-hidden">
          <div
            className="h-full bg-brand transition-all duration-300"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      <div className="space-y-lg mt-lg max-w-md mx-auto">
        {step === 1 && (
          <>
            <header>
              <h2 className="text-section-title">Vamos partir do essencial</h2>
              <p className="text-body-sm text-fg-muted mt-1">
                Antes de tudo: o que é esse projeto, e por que vale a pena fazer?
              </p>
            </header>
            <Field label="🗂️ Como vai chamar?">
              <input
                type="text"
                value={data.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Ex: Sarau de Violinos"
                maxLength={100}
                className={inputClass}
                autoFocus
              />
            </Field>
            <Field
              label="🎯 Por que esse projeto existe?"
              sub="O que justifica investir tempo nisso? É isso que o TOM vai usar pra alinhar prioridade."
            >
              <textarea
                value={data.justification}
                onChange={(e) => update('justification', e.target.value)}
                placeholder="Ex: Celebrar 14 anos da escola"
                rows={3}
                className={textareaClass}
              />
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <header>
              <h2 className="text-section-title">Onde e quando acontece</h2>
              <p className="text-body-sm text-fg-muted mt-1">
                Pra ancorar o projeto no mundo real.
              </p>
            </header>
            <Field label="📍 Onde vai rolar?">
              <select
                value={data.location}
                onChange={(e) => update('location', e.target.value as ProjectLocation)}
                className={inputClass}
              >
                <option value="">Selecione…</option>
                {(Object.entries(PROJECT_LOCATION_LABELS) as [ProjectLocation, string][]).map(
                  ([k, lbl]) => (
                    <option key={k} value={k}>
                      {lbl}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <Field label="🗓️ Quando começa">
              <input
                type="date"
                value={data.start_date}
                min={todayISO()}
                onChange={(e) => update('start_date', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="🗓️ Quando termina">
              <input
                type="date"
                value={data.end_date}
                min={data.start_date || todayISO()}
                onChange={(e) => update('end_date', e.target.value)}
                className={inputClass}
              />
            </Field>
          </>
        )}

        {step === 3 && (
          <>
            <header>
              <h2 className="text-section-title">Quem vai junto, e como</h2>
              <p className="text-body-sm text-fg-muted mt-1">
                Pessoas e caminho. O TOM precisa entender o time pra distribuir tarefas certo.
              </p>
            </header>
            <Field
              label="👥 Quem vai participar?"
              sub="Marca quem do time vai junto. Cada um recebe um aviso pelo WhatsApp quando o projeto começar."
            >
              <MemberPicker
                collabs={collabsAvailable}
                selected={data.member_ids}
                onToggle={(id) => {
                  update(
                    'member_ids',
                    data.member_ids.includes(id)
                      ? data.member_ids.filter((x) => x !== id)
                      : [...data.member_ids, id],
                  );
                }}
              />
            </Field>
            <Field
              label="Alguém de fora do time?"
              sub="Opcional. Texto livre — quem não está cadastrado aqui."
            >
              <textarea
                value={data.extra_members}
                onChange={(e) => update('extra_members', e.target.value)}
                placeholder="Ex: pais dos alunos, professor convidado da escola X"
                rows={2}
                className={textareaClass}
              />
            </Field>
            <Field
              label="🛠️ Como você imagina executar?"
              sub="Que abordagem ou caminho você tá vendo? Não precisa de plano detalhado, só o método."
            >
              <textarea
                value={data.methodology}
                onChange={(e) => update('methodology', e.target.value)}
                placeholder="Ex: 4 ensaios coletivos + ensaio geral + show"
                rows={3}
                className={textareaClass}
              />
            </Field>
            <Field
              label="⏱️ Quantas horas por semana o time vai investir?"
              sub="Opcional. Ajuda o TOM a calcular carga. De 0 a 80."
            >
              <input
                type="number"
                inputMode="numeric"
                value={data.estimated_hours_week}
                onChange={(e) => update('estimated_hours_week', e.target.value)}
                min={0}
                max={80}
                placeholder="Ex: 6"
                className={inputClass}
              />
            </Field>
          </>
        )}

        {step === 4 && (
          <>
            <header>
              <h2 className="text-section-title">Confere se tá certo</h2>
              <p className="text-body-sm text-fg-muted mt-1">
                Última conferida antes do TOM começar a estruturar.
              </p>
            </header>

            <Field
              label="🏷️ Categoria"
              sub="Ajuda na visualização e nos relatórios. Dá pra mudar depois."
            >
              <select
                value={data.category}
                onChange={(e) => update('category', e.target.value as ProjectCategory)}
                className={inputClass}
              >
                {(Object.entries(PROJECT_CATEGORY_LABELS) as [ProjectCategory, string][]).map(
                  ([k, lbl]) => (
                    <option key={k} value={k}>
                      {lbl}
                    </option>
                  ),
                )}
              </select>
            </Field>

            <Card padded variant="outline">
              <div className="space-y-md">
                <SummaryInline label="Nome">{data.name || '—'}</SummaryInline>
                <SummaryBlock label="🎯 Por que existe">
                  {data.justification || '—'}
                </SummaryBlock>
                <SummaryInline label="📍 Local">
                  {data.location ? PROJECT_LOCATION_LABELS[data.location] : '—'}
                </SummaryInline>
                <SummaryInline label="🗓️ Janela">
                  {formatBR(data.start_date)} → {formatBR(data.end_date)}
                </SummaryInline>
                <SummaryBlock label="👥 Quem participa">
                  {(() => {
                    const names = data.member_ids
                      .map((id) => collabsAvailable.find((c) => c.id === id)?.full_name)
                      .filter(Boolean) as string[];
                    if (names.length === 0 && !data.extra_members.trim()) return '—';
                    return (
                      <div className="space-y-1">
                        {names.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {names.map((n) => (
                              <span
                                key={n}
                                className="inline-block text-body-xs bg-bg-elevated rounded-full px-2 py-0.5 border border-border"
                              >
                                {n}
                              </span>
                            ))}
                          </div>
                        )}
                        {data.extra_members.trim() && (
                          <div className="text-body-sm text-fg-secondary italic">
                            + {data.extra_members.trim()}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </SummaryBlock>
                <SummaryBlock label="🛠️ Como executar">
                  {data.methodology || '—'}
                </SummaryBlock>
                {data.estimated_hours_week && (
                  <SummaryInline label="⏱️ Horas/sem">
                    {data.estimated_hours_week}h
                  </SummaryInline>
                )}
                <SummaryInline label="🏷️ Categoria">
                  {PROJECT_CATEGORY_LABELS[data.category]}
                </SummaryInline>
              </div>
            </Card>

            {!isCoordOrDir && (
              <div className="text-body-sm text-fg-secondary bg-bg-surface rounded-md px-md py-sm border border-border">
                Como você é colaborador, ao confirmar este projeto vai pra aprovação antes de começar.
              </div>
            )}
          </>
        )}

        {showError && (
          <div className="text-body-sm text-danger" role="alert">
            {stepError}
          </div>
        )}
        {submitError && (
          <div className="text-body-sm text-danger bg-danger/10 border border-danger/30 rounded-md px-md py-sm" role="alert">
            {submitError}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-bg border-t border-border px-md py-sm pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <div className="max-w-md mx-auto flex gap-md">
          {step > 1 && (
            <Button variant="secondary" onClick={back} fullWidth>
              Voltar
            </Button>
          )}
          <Button
            variant="primary"
            onClick={next}
            disabled={submitting}
            loading={submitting}
            fullWidth
          >
            {step < TOTAL_STEPS ? 'Continuar' : 'Criar projeto'}
          </Button>
        </div>
      </div>
    </div>
  );
}
