import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Rocket, Clock, CheckCircle } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { notifyProjectApproved } from '../lib/tomEngine';
import { ProjectCard } from '../components/ProjectCard';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CategoryTag } from '../components/CategoryTag';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Project } from '../types';

// Sprint 22.7 — listagem ganha CRUD inline (rename/delete) + drag-and-drop,
// mesmo padrao da ProjetoDetalhe. sort_position vira fonte de verdade da ordem.

const ALIVE_STATUSES = ['active', 'planning', 'pending_approval', 'paused'] as const;
const SELECT = 'id, name, description, category, status, progress_percent, start_date, end_date, sort_position, created_by';

// Sprint 22.30 — Banner "Aguardando sua aprovação"
const SELECT_PENDING = 'id, name, category, status, requires_approval, created_by, created_at, justification, creator:collaborators!created_by(id, full_name, supervisor_id)';

interface PendingProject {
  id: string;
  name: string;
  category: Project['category'];
  status: string;
  requires_approval: boolean;
  created_by: string;
  created_at: string;
  justification?: string | null;
  creator: { id: string; full_name: string; supervisor_id: string | null } | null;
  supervisorName?: string | null;
}

async function fetchPendingApprovals(collabId: string, isDirector: boolean): Promise<PendingProject[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(SELECT_PENDING)
    .eq('status', 'pending_approval')
    .eq('requires_approval', true);
  if (error) throw error;
  const rows = (data ?? []) as unknown as PendingProject[];

  // Filtro client-side: só mostra se o user é supervisor do criador OU é director
  const filtered = rows.filter(p => {
    if (isDirector) return true;
    return p.creator?.supervisor_id === collabId;
  });

  // Resolve nomes dos supervisores para exibir na Seção 2
  const supervisorIds = [...new Set(filtered.map(p => p.creator?.supervisor_id).filter(Boolean))] as string[];
  const supervisorsMap = new Map<string, string>();
  if (supervisorIds.length > 0) {
    const { data: sups } = await supabase
      .from('collaborators')
      .select('id, full_name')
      .in('id', supervisorIds);
    for (const s of (sups ?? [])) supervisorsMap.set(s.id, s.full_name);
  }

  return filtered.map(p => ({
    ...p,
    supervisorName: p.creator?.supervisor_id ? (supervisorsMap.get(p.creator.supervisor_id) ?? null) : null,
  }));
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `há ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `há ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `há ${days}d`;
}

// ---- Banner de aprovações pendentes ----------------------------------------

function PendingApprovalsBanner({
  collabId,
  isDirector,
}: {
  collabId: string;
  isDirector: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [confirmProject, setConfirmProject] = useState<PendingProject | null>(null);

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['projects-pending-approval', collabId, isDirector],
    queryFn: () => fetchPendingApprovals(collabId, isDirector),
    enabled: Boolean(collabId && supabaseConfigured),
  });

  async function handleApprove(project: PendingProject) {
    setApprovingId(project.id);
    try {
      const { error } = await supabase
        .from('projects')
        .update({
          status: 'planning',
          requires_approval: false,
          approved_by: collabId,
          approved_at: new Date().toISOString(),
        })
        .eq('id', project.id);
      if (error) throw error;
      // Notifica o criador via WhatsApp (não bloqueia se falhar)
      notifyProjectApproved(project.id).catch(e =>
        console.warn('[Approve] WhatsApp notify failed:', e));
      // Invalida as duas queries para o banner sumir e a lista atualizar
      qc.invalidateQueries({ queryKey: ['projects-pending-approval'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao aprovar';
      alert(`Falha: ${msg}`);
    } finally {
      setApprovingId(null);
    }
  }

  const mineToApprove = pending.filter(p => p.creator?.supervisor_id === collabId);
  const othersWaiting = pending.filter(p => p.creator?.supervisor_id !== collabId && isDirector);

  if (isLoading || (mineToApprove.length === 0 && othersWaiting.length === 0)) return null;

  function PendingCard({
    project,
    variant,
    extraInfo,
  }: {
    project: PendingProject;
    variant: 'primary' | 'secondary';
    extraInfo?: string | null;
  }) {
    const isPrimary = variant === 'primary';
    return (
      <Card
        variant="outline"
        padded={false}
        className={
          isPrimary
            ? 'border-amber-400/30 bg-amber-400/5 overflow-hidden'
            : 'border-zinc-600/30 bg-zinc-800/30 overflow-hidden'
        }
      >
        <div className="p-md space-y-2">
          {/* Header: tag + tempo */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CategoryTag project={project} label={project.category} />
            <span className="text-[11px] text-fg-muted">{timeAgo(project.created_at)}</span>
          </div>

          {/* Nome do projeto */}
          <p className="text-body-md font-semibold text-fg leading-snug">{project.name}</p>

          {/* Criador */}
          {project.creator && (
            <p className="text-body-sm text-fg-muted">
              Por <span className="text-fg">{project.creator.full_name}</span>
            </p>
          )}

          {/* Supervisor real (Seção 2) */}
          {extraInfo && (
            <p className="text-[11px] text-zinc-400">
              → {extraInfo}
            </p>
          )}

          {/* Justificativa (se houver) */}
          {project.justification && (
            <p className="text-[11px] text-fg-muted line-clamp-2 italic">
              "{project.justification}"
            </p>
          )}

          {/* Ações */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<CheckCircle size={14} />}
              loading={approvingId === project.id}
              disabled={approvingId !== null}
              onClick={() => setConfirmProject(project)}
              className={
                isPrimary
                  ? 'bg-green-600 hover:bg-green-500 active:bg-green-700 text-white'
                  : 'bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-800 text-zinc-100'
              }
            >
              Aprovar
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(`/projetos/${project.id}`)}
              disabled={approvingId !== null}
            >
              Abrir
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4" aria-label="Projetos aguardando aprovação">
      {/* Seção 1 — Minhas aprovações (âmbar, primária) */}
      {mineToApprove.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-amber-400 shrink-0" />
            <h3 className="text-body-sm font-semibold text-amber-400">
              ⏳ Aguardando sua aprovação
            </h3>
            <span className="ml-1 inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-amber-400/20 text-amber-400 text-[11px] font-semibold">
              {mineToApprove.length}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            {mineToApprove.map(project => (
              <PendingCard key={project.id} project={project} variant="primary" />
            ))}
          </div>
        </section>
      )}

      {/* Seção 2 — Outras aprovações (cinza neutra, só directors) */}
      {othersWaiting.length > 0 && (
        <section className="opacity-90">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} className="text-zinc-400 shrink-0" />
            <h3 className="text-body-sm font-medium text-zinc-400">
              👀 Outras aprovações pendentes
            </h3>
            <span className="ml-1 inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-zinc-700/50 text-zinc-400 text-[11px] font-semibold">
              {othersWaiting.length}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            {othersWaiting.map(project => (
              <PendingCard
                key={project.id}
                project={project}
                variant="secondary"
                extraInfo={project.supervisorName ? `Aguarda: ${project.supervisorName}` : null}
              />
            ))}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirmProject !== null}
        title="Aprovar projeto?"
        description={
          confirmProject && (
            <>
              <strong>{confirmProject.name}</strong>
              {confirmProject.creator && (
                <>
                  <br />
                  Por {confirmProject.creator.full_name}
                </>
              )}
              <br />
              <br />
              O criador será notificado por WhatsApp.
            </>
          )
        }
        confirmLabel="✅ Aprovar"
        cancelLabel="Cancelar"
        variant="primary"
        onConfirm={() => {
          if (confirmProject) {
            const p = confirmProject;
            setConfirmProject(null);
            handleApprove(p);
          }
        }}
        onCancel={() => setConfirmProject(null)}
      />
    </div>
  );
}

async function fetchProjects(collabId: string, isCoordOrDir: boolean): Promise<Project[]> {
  if (isCoordOrDir) {
    const { data, error } = await supabase
      .from('projects')
      .select(SELECT)
      .in('status', ALIVE_STATUSES as unknown as string[])
      .order('sort_position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as Project[];
  }
  const { data: created, error: e1 } = await supabase
    .from('projects')
    .select(SELECT)
    .eq('created_by', collabId)
    .in('status', ALIVE_STATUSES as unknown as string[]);
  if (e1) throw e1;
  const { data: memberRows, error: e2 } = await supabase
    .from('project_members')
    .select('project_id, projects(' + SELECT + ')')
    .eq('collaborator_id', collabId);
  if (e2) throw e2;
  const merged = new Map<string, Project>();
  for (const p of (created ?? []) as unknown as Project[]) merged.set(p.id, p);
  for (const m of memberRows ?? []) {
    const p = (m as { projects?: Project }).projects;
    if (p && (ALIVE_STATUSES as readonly string[]).includes(p.status)) merged.set(p.id, p);
  }
  return [...merged.values()].sort((a, b) => {
    const pa = (a as Project & { sort_position?: number | null }).sort_position ?? Number.MAX_SAFE_INTEGER;
    const pb = (b as Project & { sort_position?: number | null }).sort_position ?? Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
}

export function Projetos() {
  const { collaborator, role } = useAuth();
  const isCoordOrDir = role === 'coordinator' || role === 'director';
  const qc = useQueryClient();

  const queryKey = ['projects', collaborator?.id, isCoordOrDir];
  const { data: projects = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: () => collaborator ? fetchProjects(collaborator.id, isCoordOrDir) : Promise.resolve([]),
    enabled: Boolean(collaborator?.id && supabaseConfigured),
  });

  const renameProject = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('projects').update({ name }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  const updateCategory = useMutation({
    mutationFn: async ({ id, category }: { id: string; category: Project['category'] }) => {
      const { error } = await supabase.from('projects').update({ category }).eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, category }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<Project[]>(queryKey);
      qc.setQueryData<Project[]>(queryKey, (old) => old?.map(p => p.id === id ? { ...p, category } : p));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  const deleteProject = useMutation({
    mutationFn: async (id: string) => {
      // Tasks viram orfas; checkpoints/contingencies/members caem em CASCADE.
      await supabase.from('tasks').update({ project_id: null, checkpoint_id: null }).eq('project_id', id);
      const { error } = await supabase.from('projects').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const reorderProjects = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((pid, idx) =>
          supabase.from('projects').update({ sort_position: idx }).eq('id', pid).then(({ error }) => {
            if (error) throw error;
          }),
        ),
      );
    },
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<Project[]>(queryKey);
      qc.setQueryData<Project[]>(queryKey, (old) => {
        if (!old) return old;
        const map = new Map(old.map(p => [p.id, p]));
        return orderedIds.map((pid, idx) => ({ ...(map.get(pid)!), sort_position: idx } as Project));
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  return (
    <div className="space-y-lg">
      <header className="flex items-start justify-between gap-md">
        <div>
          <h2 className="text-section-title">Projetos</h2>
          <p className="text-body-sm text-fg-muted mt-1">
            {isCoordOrDir ? 'Todos os projetos ativos' : 'Os que você lidera ou participa'}
          </p>
        </div>
        <Link to="/projetos/novo">
          <Button variant="primary" size="md" leadingIcon={<Plus size={18} />}>
            Novo
          </Button>
        </Link>
      </header>

      {/* Banner de aprovações — visível apenas para quem precisa aprovar */}
      {supabaseConfigured && collaborator && (
        <PendingApprovalsBanner
          collabId={collaborator.id}
          isDirector={role === 'director'}
        />
      )}

      {!supabaseConfigured ? (
        <EmptyState icon={<Rocket size={32} />} title="Configure Supabase" />
      ) : isLoading ? (
        <LoadingState rows={3} />
      ) : error ? (
        <EmptyState title="Erro" description={(error as Error).message} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<Rocket size={32} />}
          title={isCoordOrDir ? 'Nenhum projeto ativo' : 'Você ainda não tá em nenhum projeto'}
          description="Toque em Novo pra criar pelo wizard, ou peça pelo TOM no WhatsApp."
          action={
            <Link to="/projetos/novo">
              <Button variant="primary" leadingIcon={<Plus size={18} />}>
                Novo projeto
              </Button>
            </Link>
          }
        />
      ) : (
        <SortableProjectList
          projects={projects}
          onRename={(id, name) => renameProject.mutate({ id, name })}
          onDelete={(id) => deleteProject.mutate(id)}
          onReorder={(ids) => reorderProjects.mutate(ids)}
          onUpdateCategory={(id, category) => updateCategory.mutate({ id, category })}
        />
      )}
    </div>
  );
}

// ---- Sortable wrapper -----------------------------------------------------

function SortableProjectList({
  projects,
  onRename,
  onDelete,
  onReorder,
  onUpdateCategory,
}: {
  projects: Project[];
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onUpdateCategory: (id: string, category: Project['category']) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = projects.map(p => p.id);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          {projects.map(p => (
            <SortableProjectCard
              key={p.id}
              project={p}
              onRename={(name) => onRename(p.id, name)}
              onDelete={() => onDelete(p.id)}
              onUpdateCategory={(category) => onUpdateCategory(p.id, category)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableProjectCard({
  project,
  onRename,
  onDelete,
  onUpdateCategory,
}: {
  project: Project;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUpdateCategory: (category: Project['category']) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <ProjectCard
      project={project}
      onRename={onRename}
      onDelete={onDelete}
      onUpdateCategory={onUpdateCategory}
      sortableRef={setNodeRef}
      sortableStyle={style}
      sortableAttributes={attributes}
      sortableListeners={listeners}
      isDragging={isDragging}
    />
  );
}
