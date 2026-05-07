import { useState, useEffect, useRef, FormEvent, KeyboardEvent } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Rocket, Check, AlertTriangle, Plus, ChevronDown, ChevronRight, MoreVertical, GripVertical } from 'lucide-react';
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
import { supabase, supabaseConfigured } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Tabs } from '../components/Tabs';
import { CategoryTag } from '../components/CategoryTag';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { MembersTab } from '../components/MembersTab';
import { AssigneePicker, type AssigneeOption } from '../components/AssigneePicker';
import { PROJECT_CATEGORY_LABELS } from '../lib/projectLabels';
import { brShort } from '../utils/date';
import type { Project, Task, Checkpoint, ProjectMember } from '../types';

// Sprint 22.21b — Checkpoint vira container das tarefas. Conceitualmente alinha
// com Musicolandia: marco (checkpoint) + acoes (tarefas dentro dele). Drop aba
// "Tarefas" — fica 3 abas: Checkpoints / Contingencias / Time.

type TabId = 'checkpoints' | 'contingencias' | 'time';

interface ProjectFull extends Project {
  event_date?: string | null;
}

interface CheckpointFull extends Checkpoint {
  rationale?: string | null;
}

interface Contingency {
  id: string;
  project_id: string;
  scenario: string;
  protocol: string;
  position: number;
}

async function fetchProject(id: string): Promise<ProjectFull | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, category, status, progress_percent, start_date, end_date, event_date, created_by')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  return data as ProjectFull | null;
}

async function fetchCheckpoints(projectId: string): Promise<CheckpointFull[]> {
  const { data, error } = await supabase
    .from('project_checkpoints')
    .select('id, project_id, name, due_date, status, completed_at, sort_order, rationale')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('due_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CheckpointFull[];
}

async function fetchProjectTasks(projectId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, due_date, scheduled_date, remind_at, eisenhower_quadrant, project_id, checkpoint_id, sort_position, assigned_to, created_by, completed_at, action_type, source')
    .eq('project_id', projectId)
    .order('sort_position', { ascending: true, nullsFirst: false })
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Task[];
}

async function fetchMembers(projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await supabase
    .from('project_members')
    .select('id, project_id, collaborator_id, role_in_project, function_in_project, guest_name, guest_role, sort_position, created_at, collaborators(id, full_name, function_title)')
    .eq('project_id', projectId)
    .order('sort_position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  // Supabase pode devolver collaborators como array (FK) — normalizar pra objeto.
  return ((data ?? []) as Array<Record<string, unknown>>).map(row => {
    const coll = row.collaborators as { id: string; full_name: string; function_title: string | null } | { id: string; full_name: string; function_title: string | null }[] | null;
    const collaborator = Array.isArray(coll) ? (coll[0] ?? null) : coll;
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      collaborator_id: (row.collaborator_id as string | null) ?? null,
      role_in_project: row.role_in_project as ProjectMember['role_in_project'],
      function_in_project: (row.function_in_project as string | null) ?? null,
      guest_name: (row.guest_name as string | null) ?? null,
      guest_role: (row.guest_role as string | null) ?? null,
      created_at: row.created_at as string,
      collaborator,
    };
  });
}

async function fetchContingencies(projectId: string): Promise<Contingency[]> {
  const { data, error } = await supabase
    .from('project_contingencies')
    .select('id, project_id, scenario, protocol, position')
    .eq('project_id', projectId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Contingency[];
}

export function ProjetoDetalhe() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('checkpoints');
  const { collaborator, role } = useAuth();
  const qc = useQueryClient();
  const isGlobalLead = role === 'coordinator' || role === 'director';
  const [viewMode, setViewMode] = useState<'by_checkpoint' | 'by_person'>('by_checkpoint');

  const { data: project, isLoading: pLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => fetchProject(id),
    enabled: Boolean(id && supabaseConfigured),
  });
  const { data: checkpoints = [] } = useQuery({
    queryKey: ['project', id, 'checkpoints'],
    queryFn: () => fetchCheckpoints(id),
    enabled: Boolean(id && supabaseConfigured),
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ['project', id, 'tasks'],
    queryFn: () => fetchProjectTasks(id),
    enabled: Boolean(id && supabaseConfigured),
  });
  const { data: members = [] } = useQuery<ProjectMember[]>({
    queryKey: ['project', id, 'members'],
    queryFn: () => fetchMembers(id),
    enabled: Boolean(id && supabaseConfigured),
  });

  // Sprint 22.22 — papel do user neste projeto + permissoes de visao/edicao.
  const myMembership = members.find(m => m.collaborator_id === collaborator?.id);
  const isProjectLead = myMembership?.role_in_project === 'owner' || myMembership?.role_in_project === 'coordinator';
  const canSeeAll = isGlobalLead || isProjectLead;
  // Membros internos do projeto disponiveis pra atribuicao de task.
  const assigneeOptions: AssigneeOption[] = members
    .filter(m => m.collaborator_id && m.collaborator?.full_name)
    .map(m => ({
      id: m.collaborator_id!,
      full_name: m.collaborator!.full_name,
      role_in_project: m.role_in_project,
    }));
  const { data: contingencies = [] } = useQuery({
    queryKey: ['project', id, 'contingencies'],
    queryFn: () => fetchContingencies(id),
    enabled: Boolean(id && supabaseConfigured),
  });

  const toggleCheckpoint = useMutation({
    mutationFn: async (cp: CheckpointFull) => {
      if (!collaborator) throw new Error('no_auth');
      const isDone = cp.status === 'done';
      const update = isDone
        ? { status: 'pending', completed_at: null, completed_by: null }
        : { status: 'done', completed_at: new Date().toISOString(), completed_by: collaborator.id };
      const { error } = await supabase.from('project_checkpoints').update(update).eq('id', cp.id);
      if (error) throw error;
    },
    onMutate: async (cp) => {
      await qc.cancelQueries({ queryKey: ['project', id, 'checkpoints'] });
      const prev = qc.getQueryData<CheckpointFull[]>(['project', id, 'checkpoints']);
      qc.setQueryData<CheckpointFull[]>(['project', id, 'checkpoints'], (old) =>
        (old || []).map(x => x.id === cp.id
          ? { ...x, status: x.status === 'done' ? 'pending' : 'done' }
          : x),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['project', id, 'checkpoints'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['project', id, 'checkpoints'] });
    },
  });

  const toggleTask = useMutation({
    mutationFn: async (task: Task) => {
      const next = task.status === 'done' ? 'pending' : 'done';
      const { error } = await supabase
        .from('tasks')
        .update({ status: next, completed_at: next === 'done' ? new Date().toISOString() : null })
        .eq('id', task.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id, 'tasks'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const renameCheckpoint = useMutation({
    mutationFn: async ({ id: cpId, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('project_checkpoints').update({ name }).eq('id', cpId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id, 'checkpoints'] }),
  });

  const deleteCheckpoint = useMutation({
    mutationFn: async (cpId: string) => {
      // Tasks vinculadas viram orfas (checkpoint_id = NULL) — nao queremos deletar tasks junto.
      await supabase.from('tasks').update({ checkpoint_id: null }).eq('checkpoint_id', cpId);
      const { error } = await supabase.from('project_checkpoints').delete().eq('id', cpId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id, 'checkpoints'] });
      qc.invalidateQueries({ queryKey: ['project', id, 'tasks'] });
    },
  });

  const renameTask = useMutation({
    mutationFn: async ({ id: tId, title }: { id: string; title: string }) => {
      const { error } = await supabase.from('tasks').update({ title }).eq('id', tId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id, 'tasks'] }),
  });

  const deleteTask = useMutation({
    mutationFn: async (tId: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', tId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id, 'tasks'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const createCheckpoint = useMutation({
    mutationFn: async (name: string) => {
      if (!collaborator) throw new Error('no_auth');
      const maxOrder = checkpoints.reduce((m, c) => Math.max(m, c.sort_order ?? 0), -1);
      const { error } = await supabase.from('project_checkpoints').insert({
        project_id: id,
        name: name.slice(0, 200),
        status: 'pending',
        sort_order: maxOrder + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id, 'checkpoints'] }),
  });

  const updateProject = useMutation({
    mutationFn: async (patch: Partial<ProjectFull>) => {
      const { error } = await supabase.from('projects').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id] }),
  });

  const deleteProject = useMutation({
    mutationFn: async () => {
      // Tasks vinculadas viram orfas. Checkpoints e contingencias caem em CASCADE
      // (FK ON DELETE CASCADE). project_members tambem.
      await supabase.from('tasks').update({ project_id: null, checkpoint_id: null }).eq('project_id', id);
      const { error } = await supabase.from('projects').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      navigate('/projetos');
    },
  });

  // Sprint 22.22 — atribuir task a um membro do projeto.
  const assignTask = useMutation({
    mutationFn: async ({ taskId, collabId }: { taskId: string; collabId: string }) => {
      const { error } = await supabase.from('tasks').update({ assigned_to: collabId }).eq('id', taskId);
      if (error) throw error;
    },
    onMutate: async ({ taskId, collabId }) => {
      await qc.cancelQueries({ queryKey: ['project', id, 'tasks'] });
      const prev = qc.getQueryData<Task[]>(['project', id, 'tasks']);
      qc.setQueryData<Task[]>(['project', id, 'tasks'], (old) =>
        (old || []).map(t => t.id === taskId ? { ...t, assigned_to: collabId } : t),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['project', id, 'tasks'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['project', id, 'tasks'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const createContingency = useMutation({
    mutationFn: async ({ scenario, protocol }: { scenario: string; protocol: string }) => {
      const maxPos = contingencies.reduce((m, c) => Math.max(m, c.position ?? 0), -1);
      const { error } = await supabase.from('project_contingencies').insert({
        project_id: id,
        scenario: scenario.slice(0, 500),
        protocol: protocol.slice(0, 2000),
        position: maxPos + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id, 'contingencies'] }),
  });

  const updateContingency = useMutation({
    mutationFn: async ({ id: ctId, scenario, protocol }: { id: string; scenario: string; protocol: string }) => {
      const { error } = await supabase.from('project_contingencies')
        .update({ scenario: scenario.slice(0, 500), protocol: protocol.slice(0, 2000) })
        .eq('id', ctId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id, 'contingencies'] }),
  });

  const deleteContingency = useMutation({
    mutationFn: async (ctId: string) => {
      const { error } = await supabase.from('project_contingencies').delete().eq('id', ctId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id, 'contingencies'] }),
  });

  // Bulk reorder com optimistic update — drag-and-drop precisa de feedback imediato.
  const reorderCheckpoints = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      // Atualiza sort_order de cada CP pra match do indice.
      await Promise.all(
        orderedIds.map((cpId, idx) =>
          supabase.from('project_checkpoints').update({ sort_order: idx }).eq('id', cpId).then(({ error }) => {
            if (error) throw error;
          }),
        ),
      );
    },
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: ['project', id, 'checkpoints'] });
      const prev = qc.getQueryData<CheckpointFull[]>(['project', id, 'checkpoints']);
      qc.setQueryData<CheckpointFull[]>(['project', id, 'checkpoints'], (old) => {
        if (!old) return old;
        const map = new Map(old.map(c => [c.id, c]));
        return orderedIds.map((cpId, idx) => ({ ...(map.get(cpId)!), sort_order: idx }));
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['project', id, 'checkpoints'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['project', id, 'checkpoints'] }),
  });

  const reorderTasks = useMutation({
    mutationFn: async ({ checkpointId: _cpId, orderedIds }: { checkpointId: string | null; orderedIds: string[] }) => {
      await Promise.all(
        orderedIds.map((taskId, idx) =>
          supabase.from('tasks').update({ sort_position: idx }).eq('id', taskId).then(({ error }) => {
            if (error) throw error;
          }),
        ),
      );
    },
    onMutate: async ({ checkpointId, orderedIds }) => {
      await qc.cancelQueries({ queryKey: ['project', id, 'tasks'] });
      const prev = qc.getQueryData<Task[]>(['project', id, 'tasks']);
      qc.setQueryData<Task[]>(['project', id, 'tasks'], (old) => {
        if (!old) return old;
        // Atualiza sort_position dos itens reordenados; outros ficam intactos.
        const positionMap = new Map(orderedIds.map((tId, idx) => [tId, idx]));
        return old.map(t => {
          const k = (t as Task & { checkpoint_id?: string | null }).checkpoint_id ?? null;
          if (k !== checkpointId) return t;
          const newPos = positionMap.get(t.id);
          if (newPos == null) return t;
          return { ...t, sort_position: newPos } as Task;
        }).sort((a, b) => {
          const pa = (a as Task & { sort_position?: number | null }).sort_position ?? 0;
          const pb = (b as Task & { sort_position?: number | null }).sort_position ?? 0;
          return pa - pb;
        });
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['project', id, 'tasks'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['project', id, 'tasks'] }),
  });

  if (!supabaseConfigured) return <EmptyState icon={<Rocket size={32} />} title="Configure Supabase" />;
  if (pLoading) return <LoadingState rows={4} />;
  if (!project) return <EmptyState title="Projeto não encontrado" action={<Link to="/projetos" className="text-tom">Voltar</Link>} />;

  const next = checkpoints.find(c => c.status !== 'done' && c.status !== 'cancelled');
  const checklistTotal = checkpoints.length;
  const checklistDone = checkpoints.filter(c => c.status === 'done').length;
  const pctRuntime = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0;
  const pct = checklistTotal > 0 ? pctRuntime : Math.max(0, Math.min(100, project.progress_percent ?? 0));

  // Agrupa tasks por checkpoint_id. Tasks sem checkpoint vão pra um grupo "soltas".
  const tasksByCheckpoint = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const k = (t as Task & { checkpoint_id?: string | null }).checkpoint_id ?? null;
    if (!tasksByCheckpoint.has(k)) tasksByCheckpoint.set(k, []);
    tasksByCheckpoint.get(k)!.push(t);
  }
  const orphanTasks = tasksByCheckpoint.get(null) ?? [];
  const totalTaskCount = tasks.length;

  return (
    <div className="space-y-md">
      <ProjectHeader
        project={project}
        pct={pct}
        onRename={(name) => updateProject.mutate({ name })}
        onUpdateDescription={(description) => updateProject.mutate({ description: description || null })}
        onUpdateEventDate={(event_date) => updateProject.mutate({ event_date: event_date || null })}
        onUpdateCategory={(category) => updateProject.mutate({ category })}
        onDelete={() => deleteProject.mutate()}
      />

      {/* Próximo passo — sempre visível, independente da aba. */}
      {next && (
        <div className="surface p-md">
          <div className="text-label text-fg-muted uppercase tracking-wide">Próximo passo</div>
          <div className="mt-1.5">
            <div className="text-card-title">{next.name}</div>
            {next.due_date && (
              <div className="text-body-sm text-fg-muted mt-1">
                Prazo: <span className="tabular-nums">{brShort(next.due_date)}</span>
              </div>
            )}
            {next.rationale && (
              <div className="mt-2 bg-tom/5 border-l-2 border-tom rounded-sm p-md text-body-sm text-fg-secondary">
                <div className="text-label text-tom mb-1">💡 POR QUE ESSE CHECKPOINT</div>
                <p className="whitespace-pre-line">{next.rationale}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <Tabs<TabId>
        tabs={[
          { id: 'checkpoints', label: 'Checkpoints', badge: checkpoints.length },
          { id: 'contingencias', label: 'Contingências', badge: contingencies.length },
          { id: 'time', label: 'Time', badge: members.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'checkpoints' && (
        <section className="space-y-sm">
          {canSeeAll && (checkpoints.length > 0 || totalTaskCount > 0) && (
            <div className="flex items-center gap-1 text-body-sm" data-no-nav>
              <button
                type="button"
                onClick={() => setViewMode('by_checkpoint')}
                className={[
                  'px-3 py-1.5 rounded-sm focus-ring transition-colors',
                  viewMode === 'by_checkpoint' ? 'bg-bg-elevated text-fg' : 'text-fg-muted hover:text-fg',
                ].join(' ')}
              >
                Por checkpoint
              </button>
              <button
                type="button"
                onClick={() => setViewMode('by_person')}
                className={[
                  'px-3 py-1.5 rounded-sm focus-ring transition-colors',
                  viewMode === 'by_person' ? 'bg-bg-elevated text-fg' : 'text-fg-muted hover:text-fg',
                ].join(' ')}
              >
                Por pessoa
              </button>
            </div>
          )}
          {checkpoints.length === 0 && totalTaskCount === 0 ? (
            <div className="surface">
              <EmptyState
                title="Sem checkpoints ainda"
                description="Marcos do projeto. Peça pro TOM estruturar pelo WhatsApp ou crie manualmente quando o CRUD inline subir."
              />
            </div>
          ) : (
            <>
              {canSeeAll && viewMode === 'by_person' ? (
                <PeopleGroupedTasks
                  members={members}
                  tasks={tasks}
                  checkpoints={checkpoints}
                  onToggleTask={(t) => toggleTask.mutate(t)}
                  onRenameTask={(tId, title) => renameTask.mutate({ id: tId, title })}
                  onDeleteTask={(tId) => deleteTask.mutate(tId)}
                  onAssignTask={(tId, cId) => assignTask.mutate({ taskId: tId, collabId: cId })}
                  assigneeOptions={assigneeOptions}
                />
              ) : (
                <CheckpointSortableList
                  checkpoints={checkpoints}
                  tasksByCheckpoint={tasksByCheckpoint}
                  projectId={id}
                  collaboratorId={collaborator?.id ?? null}
                  toggleDisabled={toggleCheckpoint.isPending}
                  onToggleCheckpoint={(cp) => toggleCheckpoint.mutate(cp)}
                  onToggleTask={(t) => toggleTask.mutate(t)}
                  onRenameCheckpoint={(cpId, name) => renameCheckpoint.mutate({ id: cpId, name })}
                  onDeleteCheckpoint={(cpId) => deleteCheckpoint.mutate(cpId)}
                  onRenameTask={(tId, title) => renameTask.mutate({ id: tId, title })}
                  onDeleteTask={(tId) => deleteTask.mutate(tId)}
                  onAssignTask={canSeeAll ? (tId, cId) => assignTask.mutate({ taskId: tId, collabId: cId }) : undefined}
                  assigneeOptions={assigneeOptions}
                  showAssignee={canSeeAll}
                  onReorderCheckpoints={(ids) => reorderCheckpoints.mutate(ids)}
                  onReorderTasks={(cpId, ids) => reorderTasks.mutate({ checkpointId: cpId, orderedIds: ids })}
                />
              )}
              {orphanTasks.length > 0 && (
                <div className="surface p-md">
                  <div className="text-label text-fg-muted uppercase tracking-wide mb-2">
                    Tarefas sem checkpoint
                  </div>
                  <ul className="divide-y divide-border">
                    {orphanTasks.map(t => (
                      <TaskListItem
                        key={t.id}
                        task={t}
                        onToggle={() => toggleTask.mutate(t)}
                        onRename={(title) => renameTask.mutate({ id: t.id, title })}
                        onDelete={() => deleteTask.mutate(t.id)}
                        onAssign={canSeeAll ? (tId, cId) => assignTask.mutate({ taskId: tId, collabId: cId }) : undefined}
                        assigneeOptions={assigneeOptions}
                        showAssignee={canSeeAll}
                      />
                    ))}
                  </ul>
                </div>
              )}
              <CreateCheckpointInline onCreate={(name) => createCheckpoint.mutate(name)} />
            </>
          )}
        </section>
      )}

      {tab === 'contingencias' && (
        <section className="space-y-sm">
          {contingencies.length === 0 ? (
            <div className="surface p-md">
              <EmptyState
                icon={<AlertTriangle size={32} />}
                title="Sem cenários de contingência"
                description='Defina antes "se X acontecer → faça Y". O TOM cria pelo WhatsApp quando você pede pra mapear riscos do projeto.'
              />
            </div>
          ) : (
            <ul className="space-y-sm">
              {contingencies.map(ct => (
                <ContingencyCard
                  key={ct.id}
                  contingency={ct}
                  onUpdate={(scenario, protocol) => updateContingency.mutate({ id: ct.id, scenario, protocol })}
                  onDelete={() => deleteContingency.mutate(ct.id)}
                />
              ))}
            </ul>
          )}
          <CreateContingencyInline
            onCreate={(scenario, protocol) => createContingency.mutate({ scenario, protocol })}
          />
        </section>
      )}

      {tab === 'time' && (
        <MembersTab
          projectId={id}
          members={members}
          canEdit={canSeeAll}
        />
      )}
    </div>
  );
}

// ---- Subcomponentes ----------------------------------------------------------

function TaskListItem({
  task,
  index,
  onToggle,
  onRename,
  onDelete,
  onAssign,
  assigneeOptions,
  showAssignee,
  sortableRef,
  sortableStyle,
  sortableAttributes,
  sortableListeners,
  isDragging,
}: {
  task: Task;
  /** Posicao na lista (0-based). Mostrado como "{index+1}." na frente do titulo. */
  index?: number;
  onToggle: () => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
  /** Quando passado + showAssignee, exibe AssigneePicker. */
  onAssign?: (taskId: string, collabId: string) => void;
  assigneeOptions?: AssigneeOption[];
  /** True quando o user atual eh owner/coord do projeto (ve assignees + edita). */
  showAssignee?: boolean;
  sortableRef?: (node: HTMLElement | null) => void;
  sortableStyle?: React.CSSProperties;
  sortableAttributes?: React.HTMLAttributes<HTMLElement>;
  sortableListeners?: React.DOMAttributes<HTMLElement>;
  isDragging?: boolean;
}) {
  const isDone = task.status === 'done';
  // Sprint 22.22i — atrasada quando due_date < hoje SP e nao concluida.
  const todaySP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    .toISOString().slice(0, 10);
  const isOverdue = !isDone && !!task.due_date && task.due_date < todaySP;
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.title);

  function commitEdit() {
    const v = editValue.trim();
    if (v && v !== task.title && onRename) onRename(v.slice(0, 200));
    setEditing(false);
  }

  return (
    <li
      ref={sortableRef as ((node: HTMLLIElement | null) => void) | undefined}
      style={{ ...sortableStyle, opacity: isDragging ? 0.5 : undefined, zIndex: isDragging ? 20 : undefined }}
      className="py-2 flex items-start gap-2 group touch-none"
      {...(sortableAttributes ?? {})}
      {...(sortableListeners ?? {})}
    >
      {sortableListeners && (
        <span aria-hidden className="mt-1 text-fg-muted/40 cursor-grab">
          <GripVertical size={14} />
        </span>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-label={isDone ? 'Reabrir tarefa' : 'Concluir tarefa'}
        className={[
          'mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 grid place-items-center transition-colors focus-ring',
          isDone
            ? 'bg-tom border-tom text-white'
            : isOverdue
              ? 'border-danger text-transparent hover:border-danger animate-pulse'
              : 'border-fg-muted text-transparent hover:border-tom',
        ].join(' ')}
      >
        {isDone && <Check size={12} strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            type="text"
            autoFocus
            value={editValue}
            maxLength={200}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
              if (e.key === 'Escape') { setEditValue(task.title); setEditing(false); }
            }}
            className="w-full h-8 px-2 -ml-2 rounded-sm bg-bg-elevated border border-border text-body-md text-fg focus-ring"
          />
        ) : (
          <div className={['text-body-md', isDone ? 'line-through text-fg-muted' : ''].join(' ')}>
            {typeof index === 'number' && (
              <span className="text-fg-muted tabular-nums mr-1.5">{index + 1}.</span>
            )}
            {task.title}
          </div>
        )}
        {task.due_date && !editing && (
          <div className={['text-body-sm tabular-nums mt-0.5 inline-flex items-center gap-1', isOverdue ? 'text-danger font-medium' : 'text-fg-muted'].join(' ')}>
            {isOverdue && <span aria-hidden>⚠️</span>}
            <span>{brShort(task.due_date)}</span>
            {isOverdue && (
              <span className="ml-1">
                · atrasada {daysOverdue(task.due_date)}d
              </span>
            )}
          </div>
        )}
      </div>
      {showAssignee && onAssign && !editing && (
        <AssigneePicker
          value={task.assigned_to}
          options={assigneeOptions ?? []}
          onChange={(collabId) => onAssign(task.id, collabId)}
        />
      )}
      {(onRename || onDelete) && !editing && (
        <RowMenu
          items={[
            ...(onRename ? [{ label: 'Editar', onClick: () => { setEditValue(task.title); setEditing(true); } }] : []),
            ...(onDelete ? [{ label: 'Excluir tarefa', danger: true, confirm: 'Excluir essa tarefa?', onClick: () => onDelete() }] : []),
          ]}
        />
      )}
    </li>
  );
}

function CheckpointCard({
  checkpoint,
  tasks,
  onToggleCheckpoint,
  onToggleTask,
  onRenameCheckpoint,
  onDeleteCheckpoint,
  onRenameTask,
  onDeleteTask,
  onAssignTask,
  assigneeOptions,
  showAssignee,
  onReorderTasks,
  toggleDisabled,
  projectId,
  collaboratorId,
  sortableRef,
  sortableStyle,
  sortableAttributes,
  sortableListeners,
  isDragging,
}: {
  checkpoint: CheckpointFull;
  tasks: Task[];
  onToggleCheckpoint: () => void;
  onToggleTask: (t: Task) => void;
  onRenameCheckpoint: (name: string) => void;
  onDeleteCheckpoint: () => void;
  onRenameTask: (taskId: string, title: string) => void;
  onDeleteTask: (taskId: string) => void;
  onAssignTask?: (taskId: string, collabId: string) => void;
  assigneeOptions?: AssigneeOption[];
  showAssignee?: boolean;
  onReorderTasks: (orderedIds: string[]) => void;
  toggleDisabled: boolean;
  projectId: string;
  collaboratorId: string | null;
  sortableRef?: (node: HTMLElement | null) => void;
  sortableStyle?: React.CSSProperties;
  sortableAttributes?: React.HTMLAttributes<HTMLElement>;
  sortableListeners?: React.DOMAttributes<HTMLElement>;
  isDragging?: boolean;
}) {
  const isDone = checkpoint.status === 'done';
  const [expanded, setExpanded] = useState(!isDone);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(checkpoint.name);
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;

  function commitEdit() {
    const v = editValue.trim();
    if (v && v !== checkpoint.name) onRenameCheckpoint(v.slice(0, 200));
    setEditing(false);
  }

  return (
    <article
      ref={sortableRef}
      style={{ ...sortableStyle, opacity: isDragging ? 0.5 : undefined, zIndex: isDragging ? 20 : undefined }}
      className="surface touch-none"
      {...(sortableAttributes ?? {})}
      {...(sortableListeners ?? {})}
    >
      {/* Header — visual de "marco/container". Padding maior, fundo do surface, checkbox quadrado grande. */}
      <div className="p-md flex items-start gap-md">
        {sortableListeners && (
          <span
            aria-hidden
            className="mt-1 text-fg-muted/40 cursor-grab"
          >
            <GripVertical size={16} />
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCheckpoint}
          disabled={toggleDisabled}
          aria-label={isDone ? 'Reabrir checkpoint' : 'Marcar como feito'}
          className={[
            'mt-0.5 h-7 w-7 shrink-0 rounded-md border-2 grid place-items-center transition-colors focus-ring',
            isDone
              ? 'bg-tom border-tom text-white hover:bg-tom-shade'
              : 'bg-tom/10 border-tom/40 text-transparent hover:border-tom hover:bg-tom/20',
          ].join(' ')}
        >
          {isDone && <Check size={16} strokeWidth={3} />}
        </button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              type="text"
              autoFocus
              value={editValue}
              maxLength={200}
              onChange={e => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                if (e.key === 'Escape') { setEditValue(checkpoint.name); setEditing(false); }
              }}
              className="w-full h-9 px-2 -ml-2 rounded-md bg-bg-elevated border border-border text-card-title text-fg focus-ring"
            />
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              className="w-full text-left focus-ring rounded-sm"
            >
              <div className={['text-card-title', isDone ? 'line-through text-fg-muted' : ''].join(' ')}>
                {checkpoint.name}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-body-sm text-fg-muted tabular-nums">
                {checkpoint.due_date && <span>{brShort(checkpoint.due_date)}</span>}
                {total > 0 && <span>· {done}/{total} {total === 1 ? 'tarefa' : 'tarefas'}</span>}
              </div>
            </button>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-1">
          <RowMenu
            items={[
              { label: 'Editar nome', onClick: () => { setEditValue(checkpoint.name); setEditing(true); } },
              {
                label: 'Excluir checkpoint',
                danger: true,
                confirm: 'Excluir? Tarefas viram sem checkpoint.',
                onClick: () => onDeleteCheckpoint(),
              },
            ]}
          />
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? 'Recolher' : 'Expandir'}
            className="text-fg-muted hover:text-fg p-1 focus-ring rounded-sm"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      </div>

      {/* Corpo — fundo levemente diferente + border-top pra dar separacao visual de container. */}
      {expanded && (
        <div className="space-y-3 bg-bg-subtle border-t border-border px-md pt-3 pb-md rounded-b-md">
          {checkpoint.rationale && (
            <div className="bg-tom/5 border-l-2 border-tom rounded-sm p-md text-body-sm text-fg-secondary">
              <div className="text-label text-tom mb-1">💡 POR QUE ESSE CHECKPOINT</div>
              <p className="whitespace-pre-line">{checkpoint.rationale}</p>
            </div>
          )}
          <div>
            <div className="text-label text-fg-muted uppercase tracking-wide mb-1">Tarefas</div>
            <div className="border-l-2 border-border pl-md">
              {tasks.length > 0 && (
                <SortableTaskList
                  tasks={tasks}
                  onReorder={onReorderTasks}
                  onToggleTask={onToggleTask}
                  onRenameTask={onRenameTask}
                  onDeleteTask={onDeleteTask}
                  onAssignTask={onAssignTask}
                  assigneeOptions={assigneeOptions}
                  showAssignee={showAssignee}
                />
              )}
              <div className={tasks.length > 0 ? 'pt-2' : ''}>
                <CreateTaskInline
                  projectId={projectId}
                  checkpointId={checkpoint.id}
                  collaboratorId={collaboratorId}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function CreateTaskInline({
  projectId,
  checkpointId,
  collaboratorId,
}: {
  projectId: string;
  checkpointId: string;
  collaboratorId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const qc = useQueryClient();
  const createTask = useMutation({
    mutationFn: async () => {
      if (!collaboratorId) throw new Error('no_auth');
      const t = title.trim();
      if (!t) return;
      const { error } = await supabase.from('tasks').insert({
        title: t.slice(0, 200),
        project_id: projectId,
        checkpoint_id: checkpointId,
        assigned_to: collaboratorId,
        created_by: collaboratorId,
        source: 'manual',
        status: 'pending',
        context: 'work',
        priority: 'medium',
        action_type: 'task',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle('');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['project', projectId, 'tasks'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (title.trim()) createTask.mutate();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      setTitle('');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-body-sm text-fg-muted hover:text-tom focus-ring rounded-sm px-1 py-0.5"
      >
        <Plus size={14} /> Tarefa
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <input
        type="text"
        autoFocus
        value={title}
        maxLength={200}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="O que precisa fazer..."
        className="w-full h-9 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg placeholder:text-fg-muted focus-ring"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setTitle(''); }}
          className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!title.trim() || createTask.isPending}
          className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold disabled:opacity-50 focus-ring"
        >
          Salvar
        </button>
      </div>
      {createTask.error && (
        <p className="text-body-sm text-danger" role="alert">
          Não consegui salvar: {(createTask.error as Error).message}
        </p>
      )}
    </form>
  );
}

// ---- RowMenu — ⋯ acionador com dropdown e confirmação inline pra acoes destrutivas.
type MenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Quando presente, click no item nao executa direto — exibe confirm inline. */
  confirm?: string;
};

function RowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmIdx(null);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); setConfirmIdx(null); }}
        aria-label="Mais ações"
        className="text-fg-muted hover:text-fg p-1 focus-ring rounded-sm"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-md border border-border bg-bg-surface shadow-soft overflow-hidden">
          {items.map((item, i) => {
            const isConfirming = confirmIdx === i;
            if (isConfirming && item.confirm) {
              return (
                <div key={i} className="px-3 py-2 border-b border-border last:border-b-0 bg-danger/5">
                  <div className="text-body-sm text-fg mb-2">{item.confirm}</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmIdx(null); }}
                      className="flex-1 h-7 px-2 rounded-sm text-body-sm text-fg-muted hover:text-fg border border-border focus-ring"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); item.onClick(); setOpen(false); setConfirmIdx(null); }}
                      className="flex-1 h-7 px-2 rounded-sm text-body-sm font-semibold bg-danger text-white focus-ring"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.confirm) { setConfirmIdx(i); return; }
                  item.onClick();
                  setOpen(false);
                }}
                className={[
                  'w-full px-3 py-2 text-left text-body-sm hover:bg-bg-elevated transition-colors',
                  item.danger ? 'text-danger' : 'text-fg',
                ].join(' ')}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Sortable wrappers (drag-and-drop via @dnd-kit). Sensors com delay
// de 200ms pra nao conflitar com tap (toggle/expand/click no menu).

function makeSensors() {
  // Hooks chamados em ordem fixa — wrapper usado dentro de componentes que sao
  // sortable hosts (CheckpointSortableList e SortableTaskList).
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  return useSensors(pointerSensor, touchSensor, keyboardSensor);
}

function CheckpointSortableList({
  checkpoints,
  tasksByCheckpoint,
  projectId,
  collaboratorId,
  toggleDisabled,
  onToggleCheckpoint,
  onToggleTask,
  onRenameCheckpoint,
  onDeleteCheckpoint,
  onRenameTask,
  onDeleteTask,
  onAssignTask,
  assigneeOptions,
  showAssignee,
  onReorderCheckpoints,
  onReorderTasks,
}: {
  checkpoints: CheckpointFull[];
  tasksByCheckpoint: Map<string | null, Task[]>;
  projectId: string;
  collaboratorId: string | null;
  toggleDisabled: boolean;
  onToggleCheckpoint: (cp: CheckpointFull) => void;
  onToggleTask: (t: Task) => void;
  onRenameCheckpoint: (cpId: string, name: string) => void;
  onDeleteCheckpoint: (cpId: string) => void;
  onRenameTask: (taskId: string, title: string) => void;
  onDeleteTask: (taskId: string) => void;
  onAssignTask?: (taskId: string, collabId: string) => void;
  assigneeOptions?: AssigneeOption[];
  showAssignee?: boolean;
  onReorderCheckpoints: (orderedIds: string[]) => void;
  onReorderTasks: (checkpointId: string, orderedIds: string[]) => void;
}) {
  const sensors = makeSensors();
  const ids = checkpoints.map(c => c.id);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorderCheckpoints(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-sm">
          {checkpoints.map(cp => (
            <SortableCheckpointWrapper
              key={cp.id}
              checkpoint={cp}
              tasks={tasksByCheckpoint.get(cp.id) ?? []}
              projectId={projectId}
              collaboratorId={collaboratorId}
              toggleDisabled={toggleDisabled}
              onToggleCheckpoint={() => onToggleCheckpoint(cp)}
              onToggleTask={onToggleTask}
              onRenameCheckpoint={(name) => onRenameCheckpoint(cp.id, name)}
              onDeleteCheckpoint={() => onDeleteCheckpoint(cp.id)}
              onRenameTask={onRenameTask}
              onDeleteTask={onDeleteTask}
              onAssignTask={onAssignTask}
              assigneeOptions={assigneeOptions}
              showAssignee={showAssignee}
              onReorderTasks={(ids) => onReorderTasks(cp.id, ids)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableCheckpointWrapper(props: {
  checkpoint: CheckpointFull;
  tasks: Task[];
  projectId: string;
  collaboratorId: string | null;
  toggleDisabled: boolean;
  onToggleCheckpoint: () => void;
  onToggleTask: (t: Task) => void;
  onRenameCheckpoint: (name: string) => void;
  onDeleteCheckpoint: () => void;
  onRenameTask: (taskId: string, title: string) => void;
  onDeleteTask: (taskId: string) => void;
  onAssignTask?: (taskId: string, collabId: string) => void;
  assigneeOptions?: AssigneeOption[];
  showAssignee?: boolean;
  onReorderTasks: (orderedIds: string[]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.checkpoint.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <CheckpointCard
      {...props}
      sortableRef={setNodeRef}
      sortableStyle={style}
      sortableAttributes={attributes}
      sortableListeners={listeners}
      isDragging={isDragging}
    />
  );
}

function SortableTaskList({
  tasks,
  onReorder,
  onToggleTask,
  onRenameTask,
  onDeleteTask,
  onAssignTask,
  assigneeOptions,
  showAssignee,
}: {
  tasks: Task[];
  onReorder: (orderedIds: string[]) => void;
  onToggleTask: (t: Task) => void;
  onRenameTask: (taskId: string, title: string) => void;
  onDeleteTask: (taskId: string) => void;
  onAssignTask?: (taskId: string, collabId: string) => void;
  assigneeOptions?: AssigneeOption[];
  showAssignee?: boolean;
}) {
  const sensors = makeSensors();
  const ids = tasks.map(t => t.id);

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
        <ul className="divide-y divide-border">
          {tasks.map((t, i) => (
            <SortableTaskItem
              key={t.id}
              task={t}
              index={i}
              onToggle={() => onToggleTask(t)}
              onRename={(title) => onRenameTask(t.id, title)}
              onDelete={() => onDeleteTask(t.id)}
              onAssign={onAssignTask}
              assigneeOptions={assigneeOptions}
              showAssignee={showAssignee}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableTaskItem(props: {
  task: Task;
  index: number;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onAssign?: (taskId: string, collabId: string) => void;
  assigneeOptions?: AssigneeOption[];
  showAssignee?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <TaskListItem
      task={props.task}
      index={props.index}
      onToggle={props.onToggle}
      onRename={props.onRename}
      onDelete={props.onDelete}
      onAssign={props.onAssign}
      assigneeOptions={props.assigneeOptions}
      showAssignee={props.showAssignee}
      sortableRef={setNodeRef}
      sortableStyle={style}
      sortableAttributes={attributes}
      sortableListeners={listeners}
      isDragging={isDragging}
    />
  );
}

// ---- ProjectHeader — header com tap-to-edit nome/descricao/event_date e menu (...).
function ProjectHeader({
  project,
  pct,
  onRename,
  onUpdateDescription,
  onUpdateEventDate,
  onUpdateCategory,
  onDelete,
}: {
  project: ProjectFull;
  pct: number;
  onRename: (name: string) => void;
  onUpdateDescription: (description: string) => void;
  onUpdateEventDate: (eventDate: string) => void;
  onUpdateCategory: (category: ProjectFull['category']) => void;
  onDelete: () => void;
}) {
  const [editName, setEditName] = useState(false);
  const [nameVal, setNameVal] = useState(project.name);
  const [editDesc, setEditDesc] = useState(false);
  const [descVal, setDescVal] = useState(project.description ?? '');
  const [editDate, setEditDate] = useState(false);
  const [dateVal, setDateVal] = useState(project.event_date ?? '');

  function commitName() {
    const v = nameVal.trim();
    if (v && v !== project.name) onRename(v.slice(0, 200));
    setEditName(false);
  }
  function commitDesc() {
    const v = descVal.trim();
    if (v !== (project.description ?? '')) onUpdateDescription(v.slice(0, 1000));
    setEditDesc(false);
  }
  function commitDate() {
    if (dateVal !== (project.event_date ?? '')) onUpdateEventDate(dateVal);
    setEditDate(false);
  }

  return (
    <header>
      <Link to="/projetos" className="inline-flex items-center gap-2 text-body-sm text-fg-muted hover:text-fg focus-ring">
        <ArrowLeft size={16} /> Projetos
      </Link>
      <div className="mt-md flex items-start gap-md justify-between flex-wrap">
        <div className="min-w-0 flex-1">
          {editName ? (
            <input
              type="text"
              autoFocus
              value={nameVal}
              maxLength={200}
              onChange={e => setNameVal(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitName(); }
                if (e.key === 'Escape') { setNameVal(project.name); setEditName(false); }
              }}
              className="w-full h-12 px-2 -ml-2 rounded-md bg-bg-elevated border border-border text-screen-title text-fg focus-ring"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setNameVal(project.name); setEditName(true); }}
              className="text-screen-title text-left hover:text-tom transition-colors focus-ring rounded-sm"
            >
              {project.name}
            </button>
          )}

          {editDesc ? (
            <textarea
              autoFocus
              value={descVal}
              maxLength={1000}
              onChange={e => setDescVal(e.target.value)}
              onBlur={commitDesc}
              onKeyDown={e => {
                if (e.key === 'Escape') { setDescVal(project.description ?? ''); setEditDesc(false); }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitDesc(); }
              }}
              rows={3}
              className="w-full mt-1 px-2 py-1.5 -ml-2 rounded-md bg-bg-elevated border border-border text-body-md text-fg focus-ring resize-none"
              placeholder="Descrição do projeto"
            />
          ) : project.description ? (
            <button
              type="button"
              onClick={() => { setDescVal(project.description ?? ''); setEditDesc(true); }}
              className="text-body-md text-fg-muted mt-1 max-w-prose text-left hover:text-fg transition-colors focus-ring rounded-sm"
            >
              {project.description}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setDescVal(''); setEditDesc(true); }}
              className="text-body-sm text-fg-muted/60 mt-1 italic hover:text-fg-muted transition-colors focus-ring rounded-sm"
            >
              + descrição
            </button>
          )}

          {editDate ? (
            <input
              type="date"
              autoFocus
              value={dateVal}
              onChange={e => setDateVal(e.target.value)}
              onBlur={commitDate}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitDate(); }
                if (e.key === 'Escape') { setDateVal(project.event_date ?? ''); setEditDate(false); }
              }}
              className="mt-1 h-9 px-2 rounded-md bg-bg-elevated border border-border text-body-sm text-fg focus-ring tabular-nums"
            />
          ) : project.event_date ? (
            <button
              type="button"
              onClick={() => { setDateVal(project.event_date ?? ''); setEditDate(true); }}
              className="text-body-sm text-fg-muted mt-1 hover:text-fg transition-colors focus-ring rounded-sm"
            >
              <span aria-hidden>🎯</span>{' '}
              Evento: <span className="text-fg tabular-nums">{brShort(project.event_date)}</span>
            </button>
          ) : project.category === 'event' ? (
            <button
              type="button"
              onClick={() => { setDateVal(''); setEditDate(true); }}
              className="block text-body-sm text-fg-muted/60 mt-1 italic hover:text-fg-muted transition-colors focus-ring rounded-sm"
            >
              + data do evento
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CategoryTag
            project={project}
            label={PROJECT_CATEGORY_LABELS[project.category]}
            onChange={onUpdateCategory}
          />
          <RowMenu
            items={[
              {
                label: 'Excluir projeto',
                danger: true,
                confirm: 'Excluir esse projeto? Tarefas viram orfas. Essa acao nao pode ser desfeita.',
                onClick: onDelete,
              },
            ]}
          />
        </div>
      </div>

      <div className="mt-md">
        <div className="flex items-center justify-between text-body-sm text-fg-muted mb-1.5 tabular-nums">
          <span>Progresso</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full bg-bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-tom transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </header>
  );
}

// ---- ContingencyCard — card editavel com menu (...).
function ContingencyCard({
  contingency,
  onUpdate,
  onDelete,
}: {
  contingency: Contingency;
  onUpdate: (scenario: string, protocol: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [scenarioVal, setScenarioVal] = useState(contingency.scenario);
  const [protocolVal, setProtocolVal] = useState(contingency.protocol);

  function commit() {
    const s = scenarioVal.trim();
    const p = protocolVal.trim();
    if (!s || !p) { setEditing(false); return; }
    if (s !== contingency.scenario || p !== contingency.protocol) onUpdate(s, p);
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="surface p-md space-y-2">
        <div className="text-label text-fg-muted uppercase tracking-wide">Editar cenário</div>
        <input
          type="text"
          autoFocus
          value={scenarioVal}
          maxLength={500}
          onChange={e => setScenarioVal(e.target.value)}
          placeholder='Ex: "Se chuva cancelar"'
          className="w-full h-10 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg focus-ring"
        />
        <textarea
          value={protocolVal}
          maxLength={2000}
          onChange={e => setProtocolVal(e.target.value)}
          rows={3}
          placeholder="Protocolo: o que fazer"
          className="w-full px-3 py-2 rounded-md bg-bg-elevated border border-border text-body-md text-fg focus-ring resize-none"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setScenarioVal(contingency.scenario);
              setProtocolVal(contingency.protocol);
              setEditing(false);
            }}
            className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!scenarioVal.trim() || !protocolVal.trim()}
            className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold disabled:opacity-50 focus-ring"
          >
            Salvar
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="surface p-md">
      <div className="flex items-start gap-md">
        <span className="mt-0.5 shrink-0 text-warning" aria-hidden>🚨</span>
        <div className="min-w-0 flex-1">
          <div className="text-body-md font-semibold">{contingency.scenario}</div>
          <p className="mt-1 text-body-sm text-fg-muted whitespace-pre-line">{contingency.protocol}</p>
        </div>
        <RowMenu
          items={[
            { label: 'Editar', onClick: () => setEditing(true) },
            { label: 'Excluir', danger: true, confirm: 'Excluir esse cenário?', onClick: onDelete },
          ]}
        />
      </div>
    </li>
  );
}

// ---- CreateContingencyInline — botao + form inline pra criar contingencia.
function CreateContingencyInline({
  onCreate,
}: {
  onCreate: (scenario: string, protocol: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState('');
  const [protocol, setProtocol] = useState('');

  function commit(e: FormEvent) {
    e.preventDefault();
    const s = scenario.trim();
    const p = protocol.trim();
    if (!s || !p) return;
    onCreate(s, p);
    setScenario('');
    setProtocol('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="surface w-full p-md flex items-center gap-2 text-body-md text-fg-muted hover:text-tom hover:border-tom/40 transition-colors focus-ring"
      >
        <Plus size={16} /> Adicionar contingência
      </button>
    );
  }

  return (
    <form onSubmit={commit} className="surface p-md space-y-2">
      <div className="text-label text-fg-muted uppercase tracking-wide">Novo cenário</div>
      <input
        type="text"
        autoFocus
        value={scenario}
        maxLength={500}
        onChange={e => setScenario(e.target.value)}
        placeholder='Ex: "Se chuva cancelar"'
        className="w-full h-10 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg placeholder:text-fg-muted focus-ring"
      />
      <textarea
        value={protocol}
        maxLength={2000}
        onChange={e => setProtocol(e.target.value)}
        rows={3}
        placeholder="Protocolo: o que fazer se acontecer"
        className="w-full px-3 py-2 rounded-md bg-bg-elevated border border-border text-body-md text-fg placeholder:text-fg-muted focus-ring resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setScenario(''); setProtocol(''); }}
          className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!scenario.trim() || !protocol.trim()}
          className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold disabled:opacity-50 focus-ring"
        >
          Criar
        </button>
      </div>
    </form>
  );
}

// ---- CreateCheckpointInline — botao + form inline pra criar checkpoint.
function CreateCheckpointInline({ onCreate }: { onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  function commit(e: FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    onCreate(v);
    setName('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="surface w-full p-md flex items-center gap-2 text-body-md text-fg-muted hover:text-tom hover:border-tom/40 transition-colors focus-ring"
      >
        <Plus size={16} /> Adicionar checkpoint
      </button>
    );
  }

  return (
    <form onSubmit={commit} className="surface p-md space-y-2">
      <div className="text-label text-fg-muted uppercase tracking-wide">Novo checkpoint</div>
      <input
        type="text"
        autoFocus
        value={name}
        maxLength={200}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setName(''); } }}
        placeholder="Ex: Reservar local"
        className="w-full h-10 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg placeholder:text-fg-muted focus-ring"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setName(''); }}
          className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold disabled:opacity-50 focus-ring"
        >
          Criar
        </button>
      </div>
    </form>
  );
}

// Helper Sprint 22.22i — quantos dias atras venceu (timezone SP).
function daysOverdue(dueDateYmd: string): number {
  try {
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const [y, m, d] = dueDateYmd.split('-').map(Number);
    const due = new Date(y, m - 1, d);
    const diffMs = today.setHours(0, 0, 0, 0) - due.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor(diffMs / 86400000));
  } catch { return 0; }
}

// ---- PeopleGroupedTasks — visao "Por pessoa" (so canSeeAll usa) ------------
// Agrupa as tasks por assigned_to, mostrando cada pessoa como um header com
// suas tasks dentro. Membros sem tarefas tambem aparecem (estado vazio).
function PeopleGroupedTasks({
  members,
  tasks,
  checkpoints,
  onToggleTask,
  onRenameTask,
  onDeleteTask,
  onAssignTask,
  assigneeOptions,
}: {
  members: ProjectMember[];
  tasks: Task[];
  checkpoints: CheckpointFull[];
  onToggleTask: (t: Task) => void;
  onRenameTask: (taskId: string, title: string) => void;
  onDeleteTask: (taskId: string) => void;
  onAssignTask: (taskId: string, collabId: string) => void;
  assigneeOptions: AssigneeOption[];
}) {
  // Agrupa tasks por assigned_to. Tasks sem assigned vao pra "Sem atribuicao".
  const byPerson = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.assigned_to ?? '__none__';
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key)!.push(t);
  }

  // Lista de "buckets": membros internos primeiro (ordem do cadastro), depois "sem atribuicao" se houver.
  const internalMembers = members.filter(m => m.collaborator_id);
  const buckets: Array<{ key: string; name: string; subtitle?: string; tasks: Task[]; isUnassigned?: boolean }> = [];
  for (const m of internalMembers) {
    buckets.push({
      key: m.collaborator_id!,
      name: m.collaborator?.full_name ?? '—',
      subtitle: m.role_in_project,
      tasks: byPerson.get(m.collaborator_id!) ?? [],
    });
  }
  const unassigned = byPerson.get('__none__') ?? [];
  if (unassigned.length > 0) {
    buckets.push({ key: '__none__', name: 'Sem atribuição', tasks: unassigned, isUnassigned: true });
  }

  // Map de checkpoint_id -> nome pra mostrar no contexto da task
  const cpName = new Map(checkpoints.map(c => [c.id, c.name] as const));

  return (
    <div className="space-y-sm">
      {buckets.map(b => {
        const done = b.tasks.filter(t => t.status === 'done').length;
        return (
          <article key={b.key} className="surface">
            <div className="p-md flex items-center justify-between gap-md border-b border-border">
              <div className="min-w-0">
                <div className="text-card-title flex items-center gap-2">
                  <span className="truncate">{b.name}</span>
                  {b.subtitle && (
                    <span className="text-[11px] font-medium text-fg-muted bg-bg-elevated rounded-sm px-1.5 py-0.5 border border-border shrink-0">
                      {b.subtitle}
                    </span>
                  )}
                </div>
                <div className="text-body-sm text-fg-muted tabular-nums mt-0.5">
                  {b.tasks.length === 0 ? 'sem tarefas' : `${done}/${b.tasks.length} ${b.tasks.length === 1 ? 'tarefa' : 'tarefas'}`}
                </div>
              </div>
            </div>
            {b.tasks.length > 0 && (
              <ul className="divide-y divide-border px-md">
                {b.tasks.map(t => (
                  <TaskListItem
                    key={t.id}
                    task={t}
                    onToggle={() => onToggleTask(t)}
                    onRename={(title) => onRenameTask(t.id, title)}
                    onDelete={() => onDeleteTask(t.id)}
                    onAssign={(taskId, collabId) => onAssignTask(taskId, collabId)}
                    assigneeOptions={assigneeOptions}
                    showAssignee
                  />
                ))}
                {/* Hint de quantos checkpoints a pessoa cobre */}
                {(() => {
                  const cpIds = new Set(b.tasks.map(t => (t as Task & { checkpoint_id?: string | null }).checkpoint_id).filter(Boolean));
                  if (cpIds.size === 0) return null;
                  return (
                    <li className="py-2 text-[11px] text-fg-muted/60 italic">
                      {cpIds.size === 1 ? `1 checkpoint envolvido` : `${cpIds.size} checkpoints envolvidos`}
                      {cpIds.size <= 3 && (
                        <span> · {Array.from(cpIds).map(cid => cpName.get(cid as string) || '').filter(Boolean).join(', ')}</span>
                      )}
                    </li>
                  );
                })()}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}
