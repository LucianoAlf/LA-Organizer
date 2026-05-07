import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Rocket } from 'lucide-react';
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
import { ProjectCard } from '../components/ProjectCard';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import type { Project } from '../types';

// Sprint 22.7 — listagem ganha CRUD inline (rename/delete) + drag-and-drop,
// mesmo padrao da ProjetoDetalhe. sort_position vira fonte de verdade da ordem.

const ALIVE_STATUSES = ['active', 'planning', 'pending_approval', 'paused'] as const;
const SELECT = 'id, name, description, category, status, progress_percent, start_date, end_date, sort_position, created_by';

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
}: {
  projects: Project[];
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
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
}: {
  project: Project;
  onRename: (name: string) => void;
  onDelete: () => void;
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
      sortableRef={setNodeRef}
      sortableStyle={style}
      sortableAttributes={attributes}
      sortableListeners={listeners}
      isDragging={isDragging}
    />
  );
}
